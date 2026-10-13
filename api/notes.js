import config from '../aleph.config.json' with { type: 'json' };
import { enforceDeviceRequest } from '../src/device-approval.mjs';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { randomUUID } from 'node:crypto';
import { UUID, parseResourceTarget, recordResourceDenial } from '../src/resource-path.mjs';
import { createBackedUpNote, isRecoveryIdentity } from '../src/note-recovery.mjs';

let loginVerifier;
let verifierKey;

function unauthorized(response) {
  response.setHeader('WWW-Authenticate', 'Bearer');
  return response.status(401).json({ error: 'LOGIN_REQUIRED' });
}

// Stage 4 binds every operation to the verified identity's own notes.
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
  const device = await enforceDeviceRequest(request, identity, config, new URL(urlValue), secretKey);
  if (!device.ok) return response.status(device.status).json({ error: device.error });
  const refuse = (status, error) => {
    recordResourceDenial('notes', request.method, error);
    return response.status(status).json({ error });
  };
  // Query parameters, request bodies and custom user/role headers are not identities.
  const resource = parseResourceTarget(request.url ?? '/api/notes', 'notes');
  if (resource.error) return refuse(resource.status, resource.error);
  if (resource.ownerId && resource.ownerId !== identity.userId.toLowerCase()) {
    return refuse(404, 'NOTE_NOT_FOUND');
  }
  let id = resource.id;
  response.setHeader('X-Resource-ID', `notes:${id ?? `owner:${identity.userId}`}`);
  const allowed = id ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    return refuse(405, 'METHOD_NOT_ALLOWED');
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
      if (request.method === 'PUT' && Object.hasOwn(payload, 'owner_id')) {
        return response.status(400).json({ error: 'OWNER_CHANGE_NOT_ALLOWED' });
      }
      if (request.method === 'POST') {
        if (resource.id) return refuse(405, 'METHOD_NOT_ALLOWED');
        if (payload.id !== undefined && (typeof payload.id !== 'string' || !UUID.test(payload.id))) {
          return response.status(400).json({ error: 'INVALID_NOTE_ID' });
        }
        id = payload.id?.toLowerCase() ?? randomUUID();
        response.setHeader('X-Resource-ID', `notes:${id}`);
      }
    } catch {
      return response.status(400).json({ error: 'INVALID_NOTE' });
    }
  }

  // Stage 10 creates B's new synthetic test note and its durable verified backup
  // in one transaction. Students and test A retain the existing CRUD behavior.
  if (config.step >= 10 && request.method === 'POST' && isRecoveryIdentity(identity)) {
    try {
      const result = await createBackedUpNote({ base: new URL(urlValue), secretKey, identity,
        id, title: payload.title.trim(), content: payload.body });
      return result.status === 'conflict'
        ? response.status(409).json({ error: 'NOTE_ID_EXISTS' })
        : response.status(201).json({ id: result.id });
    } catch { return response.status(503).json({ error: 'RECOVERY_STORAGE_NOT_READY' }); }
  }

  // Apply owner and ID together in the database operation, avoiding a gap
  // between checking the existing owner and reading, updating or deleting.
  if (request.method !== 'POST') {
    endpoint.searchParams.set('owner_id', `eq.${identity.userId}`);
  }
  if (request.method === 'GET' && !id) {
    endpoint.searchParams.set('order', 'created_at.asc,id.asc');
  } else if (request.method !== 'POST') {
    endpoint.searchParams.set('id', `eq.${id}`);
  }
  endpoint.searchParams.set('select', ['POST', 'DELETE'].includes(request.method) ? 'id' : 'id,title,content,owner_id');
  const options = {
    method: request.method === 'PUT' ? 'PATCH' : request.method,
    headers: { apikey: secretKey, Accept: 'application/json' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
  };
  if (request.method !== 'GET') options.headers.Prefer = 'return=representation';
  if (payload) {
    options.headers['Content-Type'] = 'application/json';
    // Inserts bind the new owner to the verified identity. Updates only write
    // title/content, so the matched existing owner remains the new row's owner.
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
        || typeof row.id !== 'string' || !UUID.test(row.id)
        || (['GET', 'PUT'].includes(request.method)
          && (typeof row.title !== 'string' || typeof row.content !== 'string')))) {
      throw new Error('invalid_notes_response');
    }
    // The database filter is the atomic boundary; validate returned ownership as
    // well so a malformed upstream response never releases another user's data.
    if (['GET', 'PUT'].includes(request.method)
        && rows.some(row => row.owner_id !== identity.userId)) {
      return refuse(502, 'NOTES_UNAVAILABLE');
    }
    const note = row => ({ id: row.id, title: row.title, body: row.content });
    if (request.method === 'GET' && !id) return response.status(200).json(rows.map(note));
    if (rows.length === 0 && request.method !== 'POST') return refuse(404, 'NOTE_NOT_FOUND');
    if (rows.length !== 1 || rows[0].id.toLowerCase() !== id) throw new Error('invalid_notes_response');
    if (request.method === 'POST') return response.status(201).json({ id: rows[0].id });
    if (request.method === 'DELETE') return response.status(200).json({ id: rows[0].id });
    return response.status(200).json(note(rows[0]));
  } catch {
    // Exception messages and upstream responses may contain secrets. Do not log them.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
