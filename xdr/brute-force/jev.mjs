// Optional server-owned adapter. No guessed endpoint or credentials are shipped.
// A configured HTTPS adapter must return { confidence: number }.
export async function askJev(summary, { signal, endpoint = process.env.JEV_ENDPOINT,
  apiKey = process.env.JEV_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint) throw new Error('jev_unconfigured');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('jev_configuration_invalid');
  }
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
