import config from '../../aleph.config.json' with { type: 'json' };

const BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const ERROR_CODES = new Set(['invalid_credentials', 'email_not_confirmed', 'user_banned',
  'email_provider_disabled', 'over_request_rate_limit', 'over_email_send_rate_limit',
  'validation_failed', 'refresh_token_not_found', 'refresh_token_already_used']);

// Only password login, session refresh, local logout and current-user lookup.
// Never proxy Data API, admin endpoints, arbitrary URLs or caller-provided keys.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const fail = (status, code) => response.status(status).json({ code, message: 'Authentication request failed' });
  const incoming = new URL(request.url ?? '/', config.publicAppUrl);
  const action = /^\/api\/auth\/(token|logout|user)$/u.exec(incoming.pathname)?.[1];
  if (!action) return fail(404, 'auth_route_not_found');
  const method = action === 'user' ? 'GET' : 'POST';
  if (request.method !== method) {
    response.setHeader('Allow', method);
    return fail(405, 'auth_method_not_allowed');
  }
  if ((request.headers?.origin && request.headers.origin !== new URL(config.publicAppUrl).origin)
      || request.headers?.['sec-fetch-site'] === 'cross-site') return fail(403, 'auth_origin_not_allowed');

  let endpoint;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  try {
    const base = new URL(process.env.SUPABASE_URL);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
        || base.search || base.hash || config.identityProvider?.issuer !== `${base.origin}/auth/v1`
        || typeof secretKey !== 'string' || !secretKey.trim() || secretKey !== secretKey.trim()) throw new Error();
    endpoint = new URL(`/auth/v1/${action}`, base);
  } catch { return fail(503, 'auth_server_not_configured'); }

  const headers = { apikey: secretKey, Accept: 'application/json' };
  let payload;
  if (action === 'token') {
    const grant = incoming.searchParams.get('grant_type');
    if (!['password', 'refresh_token'].includes(grant)
        || [...incoming.searchParams.keys()].some(key => key !== 'grant_type')
        || incoming.searchParams.getAll('grant_type').length !== 1) return fail(400, 'validation_failed');
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) return fail(415, 'validation_failed');
    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
      if (grant === 'password') {
        if (typeof body.email !== 'string' || !body.email.trim() || body.email.length > 254
            || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw new Error();
        payload = { email: body.email.trim(), password: body.password };
      } else {
        if (typeof body.refresh_token !== 'string' || !body.refresh_token || body.refresh_token.length > 8192) throw new Error();
        payload = { refresh_token: body.refresh_token };
      }
    } catch { return fail(400, 'validation_failed'); }
    endpoint.searchParams.set('grant_type', grant);
    headers['Content-Type'] = 'application/json';
  } else {
    const authorization = request.headers?.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192 || !BEARER.test(authorization)) return fail(401, 'bad_jwt');
    headers.Authorization = authorization;
    if (action === 'logout') {
      if (incoming.searchParams.get('scope') !== 'local'
          || incoming.searchParams.getAll('scope').length !== 1
          || [...incoming.searchParams.keys()].some(key => key !== 'scope')) return fail(400, 'validation_failed');
      endpoint.searchParams.set('scope', 'local');
    } else if (incoming.search) return fail(400, 'validation_failed');
  }

  try {
    const upstream = await fetch(endpoint, {
      method, headers, body: payload ? JSON.stringify(payload) : undefined,
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (action === 'logout' && upstream.ok) return response.status(204).end();
    const data = await upstream.json();
    if (!upstream.ok) {
      const status = [400, 401, 403, 422, 429].includes(upstream.status) ? upstream.status : 502;
      return fail(status, ERROR_CODES.has(data?.code) ? data.code : 'auth_request_failed');
    }
    const user = action === 'user' ? data : data?.user;
    if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') throw new Error();
    const safeUser = { id: user.id, email: user.email };
    if (action === 'user') return response.status(200).json(safeUser);
    if (typeof data.access_token !== 'string' || !data.access_token
        || typeof data.refresh_token !== 'string' || !data.refresh_token
        || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0) throw new Error();
    return response.status(200).json({
      access_token: data.access_token, refresh_token: data.refresh_token,
      token_type: 'bearer', expires_in: data.expires_in,
      ...(Number.isSafeInteger(data.expires_at) ? { expires_at: data.expires_at } : {}), user: safeUser,
    });
  } catch {
    // Do not log upstream errors, credentials, tokens, keys or response bodies.
    return fail(502, 'auth_unavailable');
  }
}
