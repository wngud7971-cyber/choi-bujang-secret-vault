// Optional server-owned adapter. No guessed endpoint or credentials are shipped.
// A configured HTTPS adapter must return { confidence: number }.
export async function askJev(summary, { signal } = {}) {
  if (!process.env.JEV_ENDPOINT) throw new Error('jev_unconfigured');
  const endpoint = new URL(process.env.JEV_ENDPOINT);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('jev_configuration_invalid');
  }
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json',
      ...(process.env.JEV_API_KEY ? { Authorization: `Bearer ${process.env.JEV_API_KEY}` } : {}),
    },
    body: JSON.stringify(summary),
  });
  if (!response.ok) throw new Error('jev_unavailable');
  const result = await response.json();
  if (!Number.isFinite(result?.confidence) || result.confidence < 0 || result.confidence > 1) {
    throw new Error('jev_invalid_response');
  }
  return result.confidence;
}
