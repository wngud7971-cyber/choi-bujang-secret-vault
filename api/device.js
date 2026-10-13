import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { createDeviceService, createDeviceStore } from '../src/device-approval.mjs';

const FIELDS = Object.freeze({ register: [], finish: ['challengeId', 'credential'],
  options: ['kind', 'method', 'path', 'bodySha256'], verify: ['challengeId', 'credential'] });
let verifier;
let verifierKey;

// A fixed function URL: GET reads the account summary; POST selects one of
// four public-key operations. No operation can approve or revoke a device.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const reject = (status, error) => response.status(status).json({ error });
  try {
    const raw = request.url ?? '';
    if (/[\\#\s]/u.test(raw) || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(raw)) throw new Error();
    const incoming = new URL(raw, config.publicAppUrl);
    if (incoming.origin !== new URL(config.publicAppUrl).origin || incoming.pathname !== '/api/device') throw new Error();
    if (incoming.search || Object.keys(request.query ?? {}).length) return reject(400, 'INVALID_DEVICE_REQUEST');
  } catch { return reject(404, 'DEVICE_ROUTE_NOT_FOUND'); }
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return reject(405, 'METHOD_NOT_ALLOWED');
  }
  if ((request.headers?.origin && request.headers.origin !== new URL(config.publicAppUrl).origin)
      || request.headers?.['sec-fetch-site'] === 'cross-site') return reject(403, 'DEVICE_ORIGIN_NOT_ALLOWED');

  let action = 'status';
  let body = {};
  if (request.method === 'POST') {
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) return reject(415, 'JSON_REQUIRED');
    try {
      const packet = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!packet || Array.isArray(packet) || typeof packet !== 'object' || JSON.stringify(packet).length > 20000
          || !Object.hasOwn(FIELDS, packet.action)
          || Object.keys(packet).some(key => key !== 'action' && !FIELDS[packet.action].includes(key))) throw new Error();
      ({ action, ...body } = packet);
    } catch { return reject(400, 'INVALID_DEVICE_REQUEST'); }
  }
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
  try { identity = await verifier(authorization); } catch { /* Do not log credentials. */ }
  if (!identity) return reject(401, 'LOGIN_REQUIRED');
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
