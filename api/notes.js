import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

let loginVerifier;
let verifierKey;

function unauthorized(response) {
  response.setHeader('WWW-Authenticate', 'Bearer');
  return response.status(401).json({ error: 'LOGIN_REQUIRED' });
}

// Stage 3 checks identity. Ownership checks follow in stage 4.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const authorization = request.headers?.authorization;
  if (typeof authorization !== 'string' || !authorization) return unauthorized(response);

  const urlValue = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  let endpoint;
  try {
    const base = new URL(urlValue);
    if (base.protocol !== 'https:' || base.username || base.password
        || base.pathname !== '/' || base.search || base.hash
        || typeof secretKey !== 'string' || !secretKey.trim()
        || secretKey !== secretKey.trim()
        || config.identityProvider?.issuer !== `${base.origin}/auth/v1`) {
      throw new Error('invalid_server_configuration');
    }
    if (!loginVerifier || verifierKey !== secretKey) {
      loginVerifier = createLoginVerifier({ config, supabaseSecretKey: secretKey });
      verifierKey = secretKey;
    }
    endpoint = new URL('/rest/v1/training_notes', base);
  } catch {
    return response.status(503).json({ error: 'NOTES_SERVER_NOT_CONFIGURED' });
  }

  let identity;
  try {
    identity = await loginVerifier(authorization);
  } catch {
    return unauthorized(response);
  }
  if (!identity) return unauthorized(response);
  // Query parameters, request bodies and custom user/role headers are not identities.
  let id;
  try {
    const path = new URL(request.url ?? '/api/notes', 'https://local.invalid').pathname;
    const route = /^\/api\/notes(?:\/([^/]+))?\/?$/u.exec(path);
    if (!route) return response.status(404).json({ error: 'NOT_FOUND' });
    id = route[1] === undefined ? null : decodeURIComponent(route[1]);
    if (id !== null && !UUID.test(id)) return response.status(400).json({ error: 'INVALID_NOTE_ID' });
    if (id) id = id.toLowerCase();
  } catch {
    return response.status(400).json({ error: 'INVALID_NOTE_ID' });
  }
  const allowed = id ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  let payload;
  if (['POST', 'PUT'].includes(request.method)) {
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) {
      return response.status(415).json({ error: 'JSON_REQUIRED' });
    }
    try {
      payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!payload || Array.isArray(payload) || typeof payload !== 'object'
          || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 160
          || typeof payload.body !== 'string' || !payload.body.trim() || payload.body.length > 10000) {
        return response.status(400).json({ error: 'INVALID_NOTE' });
      }
      if (request.method === 'POST') {
        if (payload.id !== undefined && (typeof payload.id !== 'string' || !UUID.test(payload.id))) {
          return response.status(400).json({ error: 'INVALID_NOTE_ID' });
        }
        id = payload.id?.toLowerCase() ?? randomUUID();
      }
    } catch {
      return response.status(400).json({ error: 'INVALID_NOTE' });
    }
  }

  // Only list reads are filtered by owner in stage 3. Individual operations
  // intentionally check login only; stage 4 adds their ownership checks.
  if (request.method === 'GET' && !id) {
    endpoint.searchParams.set('owner_id', `eq.${identity.userId}`);
    endpoint.searchParams.set('order', 'created_at.asc,id.asc');
  } else if (request.method !== 'POST') {
    endpoint.searchParams.set('id', `eq.${id}`);
  }
  endpoint.searchParams.set('select', ['POST', 'DELETE'].includes(request.method) ? 'id' : 'id,title,content');
  const options = {
    method: request.method === 'PUT' ? 'PATCH' : request.method,
    headers: { apikey: secretKey, Accept: 'application/json' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
  };
  if (request.method !== 'GET') options.headers.Prefer = 'return=representation';
  if (payload) {
    options.headers['Content-Type'] = 'application/json';
    // Discard browser-provided owner_id, userId, role and other fields.
    options.body = JSON.stringify(request.method === 'POST'
      ? { id, title: payload.title.trim(), content: payload.body, owner_id: identity.userId, position: 0 }
      : { title: payload.title.trim(), content: payload.body });
  }
  try {
    const upstream = await fetch(endpoint, options);
    if (request.method === 'POST' && upstream.status === 409) {
      return response.status(409).json({ error: 'NOTE_ID_EXISTS' });
    }
    if (!upstream.ok) throw new Error('notes_unavailable');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.some(row => !row
        || typeof row.id !== 'string'
        || (['GET', 'PUT'].includes(request.method)
          && (typeof row.title !== 'string' || typeof row.content !== 'string')))) {
      throw new Error('invalid_notes_response');
    }
    const note = row => ({ id: row.id, title: row.title, body: row.content });
    if (request.method === 'GET' && !id) return response.status(200).json(rows.map(note));
    if (rows.length === 0 && request.method !== 'POST') return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
    if (rows.length !== 1 || rows[0].id.toLowerCase() !== id) throw new Error('invalid_notes_response');
    if (request.method === 'POST') return response.status(201).json({ id: rows[0].id });
    if (request.method === 'DELETE') return response.status(200).json({ id: rows[0].id });
    return response.status(200).json(note(rows[0]));
  } catch {
    // Exception messages and upstream responses may contain secrets. Do not log them.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
