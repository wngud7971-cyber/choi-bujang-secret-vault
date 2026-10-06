// Stage 2 intentionally has no visitor authentication. Fictional notes only.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const urlValue = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  let endpoint;
  try {
    const base = new URL(urlValue);
    if (base.protocol !== 'https:' || base.username || base.password
        || base.pathname !== '/' || base.search || base.hash
        || typeof secretKey !== 'string' || !secretKey.trim()) {
      throw new Error('invalid_server_configuration');
    }
    endpoint = new URL('/rest/v1/training_notes', base);
    endpoint.searchParams.set('select', 'id,title,content');
    endpoint.searchParams.set('order', 'position.asc,id.asc');
  } catch {
    return response.status(503).json({ error: 'NOTES_SERVER_NOT_CONFIGURED' });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'GET',
      headers: { apikey: secretKey, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) throw new Error('notes_unavailable');
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.some(row => !row
        || typeof row.id !== 'string' || typeof row.title !== 'string'
        || typeof row.content !== 'string')) {
      throw new Error('invalid_notes_response');
    }
    // Only these fields reach the browser; never relay upstream errors or headers.
    return response.status(200).json({
      notes: rows.map(({ id, title, content }) => ({ id, title, content })),
    });
  } catch {
    // Exception messages and upstream responses may contain secrets. Do not log them.
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
