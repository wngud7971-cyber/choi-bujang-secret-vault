// Packaging starter only. Implement server-side authentication, a per-user
// daily limit, and a server-held AI key before using this endpoint.
import operations from '../src/operations.mjs';

export default function handler(request, response) {
  // Vercel can expose either the source or destination URL after a rewrite.
  // This dispatch only selects an already-public, read-only metadata response.
  // It never passes through to a protected device or data handler.
  let incoming;
  try { incoming = new URL(request.url ?? '/api/ai', 'https://local.invalid'); } catch {}
  const marker = request.query?.__byteback_route ?? incoming?.searchParams.get('__byteback_route');
  if (incoming?.pathname === '/api/operations'
      || (incoming?.pathname === '/api/ai' && marker === 'operations')) {
    const parameters = [...incoming.searchParams.entries(), ...Object.entries(request.query ?? {})];
    const invalid = parameters.some(([key, value]) => key !== '__byteback_route' || value !== 'operations');
    return operations({ method: request.method, url: '/api/operations', query: invalid ? { invalid: true } : {} }, response);
  }
  response.setHeader('Cache-Control', 'no-store');
  response.status(501).json({ error: 'AI_PROXY_NOT_IMPLEMENTED' });
}
