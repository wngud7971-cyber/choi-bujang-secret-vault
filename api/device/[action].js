import config from '../../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../../src/verify-login.mjs';
import { createDeviceService, createDeviceStore } from '../../src/device-approval.mjs';

let verifier;
let verifierKey;
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const reject = (status, error) => response.status(status).json({ error });
  let action;
  try {
    const raw = request.url ?? '';
    if (/[\\#\s]/u.test(raw) || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(raw)) throw new Error();
    const incoming = new URL(raw, config.publicAppUrl);
    if (incoming.origin !== new URL(config.publicAppUrl).origin) throw new Error();
    action = /^\/api\/device\/(status|register|finish|options|verify)\/?$/u.exec(incoming.pathname)?.[1];
    // Vercel can invoke a dynamic file through its template URL and action
    // query parameter. These select a route only; they never grant approval.
    if (!action && ['/api/device/[action]', '/api/device/[action].js'].includes(incoming.pathname)) {
      action = incoming.searchParams.get('action') ?? request.query?.action;
    }
    if (!['status', 'register', 'finish', 'options', 'verify'].includes(action)) throw new Error();
    if ([...incoming.searchParams.keys()].some(key => key !== 'action')
        || incoming.searchParams.getAll('action').length > 1
        || (incoming.searchParams.has('action') && incoming.searchParams.get('action') !== action)
        || (request.query?.action !== undefined && request.query.action !== action)) {
      return reject(400, 'INVALID_DEVICE_REQUEST');
    }
  } catch { return reject(404, 'DEVICE_ROUTE_NOT_FOUND'); }
  const method = action === 'status' ? 'GET' : 'POST';
  if (request.method !== method) { response.setHeader('Allow', method); return reject(405, 'METHOD_NOT_ALLOWED'); }
  if ((request.headers?.origin && request.headers.origin !== new URL(config.publicAppUrl).origin)
      || request.headers?.['sec-fetch-site'] === 'cross-site') return reject(403, 'DEVICE_ORIGIN_NOT_ALLOWED');
  const authorization = request.headers?.authorization;
  if (!authorization) return reject(401, 'LOGIN_REQUIRED');
  let base;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  try {
    base = new URL(process.env.SUPABASE_URL);
    if (base.protocol !== 'https:' || base.pathname !== '/' || base.username || base.password
        || base.search || base.hash || config.identityProvider.issuer !== `${base.origin}/auth/v1`
        || typeof secretKey !== 'string' || !secretKey.trim() || secretKey.trim() !== secretKey) throw new Error();
    if (!verifier || verifierKey !== secretKey) {
      verifier = createLoginVerifier({ config, supabaseSecretKey: secretKey });
      verifierKey = secretKey;
    }
  } catch { return reject(503, 'DEVICE_SERVER_NOT_CONFIGURED'); }
  let identity;
  try { identity = await verifier(authorization); } catch { /* Fail closed without credential logs. */ }
  if (!identity) return reject(401, 'LOGIN_REQUIRED');
  let body = {};
  if (method === 'POST') {
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) return reject(415, 'JSON_REQUIRED');
    try {
      body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!body || Array.isArray(body) || typeof body !== 'object' || JSON.stringify(body).length > 20000
          || Object.keys(body).some(key => !({ register: [], finish: ['challengeId', 'credential'],
            verify: ['challengeId', 'credential'], options: ['kind', 'method', 'path', 'bodySha256'] })[action]?.includes(key))) throw new Error();
    } catch { return reject(400, 'INVALID_DEVICE_REQUEST'); }
  }
  const service = createDeviceService({ config, store: createDeviceStore(base, secretKey) });
  try {
    const result = action === 'status' ? await service.status(identity)
      : action === 'register' ? await service.registration(identity, authorization)
      : action === 'finish' ? await service.finish(body, identity, authorization)
      : action === 'verify' ? await service.verify(body, identity, authorization)
      : await service.options(body, identity, authorization);
    return response.status(200).json(result);
  } catch (error) { return reject(error.status ?? 503, error.status ? error.message : 'DEVICE_UNAVAILABLE'); }
}
