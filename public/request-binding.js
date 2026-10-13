// Canonical JSON binds the values the existing JSON API actually consumes.
// Never persist the result, tokens, signatures or request bodies.
export function canonicalBody(value, depth = 0) {
  if (depth > 30) throw new Error('invalid_request_body');
  if (value === undefined) return '';
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => canonicalBody(v, depth + 1)).join(',') + ']';
  if (typeof value !== 'object') throw new Error('invalid_request_body');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalBody(value[key], depth + 1)).join(',') + '}';
}
