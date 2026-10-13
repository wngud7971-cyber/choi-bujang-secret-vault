import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { UUID, parseResourceTarget, recordResourceDenial } from '../src/resource-path.mjs';
import { randomUUID } from 'node:crypto';

let verifier;
let verifierKey;
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const refuse = (status, error) => {
    recordResourceDenial('announcements', request.method, error);
    if (status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(status).json({ error });
  };
  if (typeof request.headers?.authorization !== 'string') return refuse(401, 'LOGIN_REQUIRED');
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  let base;
  try {
    base = new URL(process.env.SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
        || base.search || base.hash || typeof secretKey !== 'string' || !secretKey.trim()
        || secretKey !== secretKey.trim() || config.identityProvider.issuer !== `${base.origin}/auth/v1`) {
      throw new Error('invalid_configuration');
    }
    if (!verifier || verifierKey !== secretKey) {
      verifier = createLoginVerifier({ config, supabaseSecretKey: secretKey });
      verifierKey = secretKey;
    }
  } catch { return refuse(503, 'ANNOUNCEMENTS_SERVER_NOT_CONFIGURED'); }
  let identity;
  try { identity = await verifier(request.headers.authorization); } catch { /* Never print token errors. */ }
  if (!identity) return refuse(401, 'LOGIN_REQUIRED');
  const resource = parseResourceTarget(request.url ?? '/api/announcements', 'announcements');
  if (resource.error) return refuse(resource.status, resource.error);
  response.setHeader('X-Resource-ID', resource.resourceId);
  const allowed = resource.id ? ['GET', 'PUT'] : ['GET', 'POST'];
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    return refuse(405, 'METHOD_NOT_ALLOWED');
  }
  const issuer = identity.kind === 'judge' ? config.judgeIssuer : config.identityProvider.issuer;
  const options = { headers: { apikey: secretKey, Accept: 'application/json' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) };
  if (request.method !== 'GET') {
    // A server-owned grant is bound to BOTH issuer and subject. A judge identity,
    // authenticated DB role, body role, or user_metadata is never a teacher grant.
    const grantUrl = new URL('/rest/v1/training_resource_grants', base);
    grantUrl.searchParams.set('issuer', `eq.${issuer}`);
    grantUrl.searchParams.set('subject_id', `eq.${identity.userId}`);
    grantUrl.searchParams.set('permission', 'eq.announcement_editor');
    grantUrl.searchParams.set('select', 'issuer,subject_id,permission');
    let granted = false;
    try {
      const upstream = await fetch(grantUrl, options);
      const grants = upstream.ok ? await upstream.json() : null;
      granted = Array.isArray(grants) && grants.length === 1
        && grants[0].issuer === issuer && grants[0].subject_id === identity.userId
        && grants[0].permission === 'announcement_editor';
    } catch { /* Missing or unavailable privilege storage never grants access. */ }
    if (!granted) return refuse(403, 'ANNOUNCEMENT_EDIT_FORBIDDEN');
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) {
      return refuse(415, 'JSON_REQUIRED');
    }
    let payload;
    try {
      payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!payload || Array.isArray(payload) || typeof payload !== 'object'
          || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 160
          || typeof payload.body !== 'string' || !payload.body.trim() || payload.body.length > 10000
          || ['owner_id', 'author_id', 'issuer', 'permission', 'role'].some(key => Object.hasOwn(payload, key))) {
        return refuse(400, 'INVALID_ANNOUNCEMENT');
      }
      if (request.method === 'POST' && payload.id !== undefined && !UUID.test(payload.id)) {
        return refuse(400, 'INVALID_NOTE_ID');
      }
      if (request.method === 'PUT' && payload.id !== undefined && payload.id !== resource.id) {
        return refuse(400, 'INVALID_NOTE_ID');
      }
    } catch { return refuse(400, 'INVALID_ANNOUNCEMENT'); }
    const id = resource.id ?? payload.id?.toLowerCase() ?? randomUUID();
    try {
      // The DB rechecks the stored grant inside the same transaction as the write.
      const upstream = await fetch(new URL('/rest/v1/rpc/write_training_announcement', base), {
        ...options, method: 'POST', headers: { ...options.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_issuer: issuer, p_subject: identity.userId, p_id: id,
          p_title: payload.title.trim(), p_content: payload.body, p_create: request.method === 'POST' }),
      });
      if (!upstream.ok) throw new Error('write_unavailable');
      const result = await upstream.json();
      if (result?.status === 'forbidden') return refuse(403, 'ANNOUNCEMENT_EDIT_FORBIDDEN');
      if (result?.status === 'not_found') return refuse(404, 'ANNOUNCEMENT_NOT_FOUND');
      if (result?.status === 'conflict') return refuse(409, 'ANNOUNCEMENT_ID_EXISTS');
      if (result?.status !== 'written' || result.id !== id
          || typeof result.title !== 'string' || typeof result.content !== 'string') throw new Error('bad_response');
      response.setHeader('X-Resource-ID', `announcements:${id}`);
      return request.method === 'POST' ? response.status(201).json({ id })
        : response.status(200).json({ id, title: result.title, body: result.content });
    } catch { return refuse(502, 'ANNOUNCEMENTS_UNAVAILABLE'); }
  }
  const endpoint = new URL('/rest/v1/training_announcements', base);
  endpoint.searchParams.set('select', 'id,title,content');
  if (resource.id) endpoint.searchParams.set('id', `eq.${resource.id}`);
  else endpoint.searchParams.set('order', 'created_at.asc,id.asc');
  try {
    const upstream = await fetch(endpoint, options);
    if (!upstream.ok) throw new Error('read_unavailable');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.some(row => !row || !UUID.test(row.id)
        || typeof row.title !== 'string' || typeof row.content !== 'string')) throw new Error('bad_response');
    const note = ({ id, title, content }) => ({ id, title, body: content });
    if (!resource.id) return response.status(200).json(rows.map(note));
    if (!rows.length) return refuse(404, 'ANNOUNCEMENT_NOT_FOUND');
    if (rows.length !== 1 || rows[0].id !== resource.id) throw new Error('bad_response');
    return response.status(200).json(note(rows[0]));
  } catch { return refuse(502, 'ANNOUNCEMENTS_UNAVAILABLE'); }
}
