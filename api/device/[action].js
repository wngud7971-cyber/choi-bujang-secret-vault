// Keep existing deployment URLs usable while the rebuilt client uses /api/device.
import config from '../../aleph.config.json' with { type: 'json' };
import device from '../device.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const reject = (status, error) => response.status(status).json({ error });
  let action;
  try {
    const raw = request.url ?? '';
    if (/[\\#\s]/u.test(raw) || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(raw)) throw new Error();
    const incoming = new URL(raw, config.publicAppUrl);
    if (incoming.origin !== new URL(config.publicAppUrl).origin) throw new Error();
    action = /^\/api\/device\/(status|register|finish|options|verify)\/?$/u.exec(incoming.pathname)?.[1];
    if (!action && ['/api/device/[action]', '/api/device/[action].js'].includes(incoming.pathname)) {
      action = incoming.searchParams.get('action') ?? request.query?.action;
    }
    if (!['status', 'register', 'finish', 'options', 'verify'].includes(action)) throw new Error();
    if ([...incoming.searchParams.keys()].some(key => key !== 'action')
        || incoming.searchParams.getAll('action').length > 1
        || (incoming.searchParams.has('action') && incoming.searchParams.get('action') !== action)
        || (request.query?.action !== undefined && request.query.action !== action)) return reject(400, 'INVALID_DEVICE_REQUEST');
  } catch { return reject(404, 'DEVICE_ROUTE_NOT_FOUND'); }
  const method = action === 'status' ? 'GET' : 'POST';
  if (request.method !== method) {
    response.setHeader('Allow', method);
    return reject(405, 'METHOD_NOT_ALLOWED');
  }
  let body;
  if (method === 'POST') {
    try {
      body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.hasOwn(body, 'action')) throw new Error();
    } catch { return reject(400, 'INVALID_DEVICE_REQUEST'); }
    body = { action, ...body };
  }
  return device({ method, url: '/api/device', headers: request.headers, body }, response);
}
