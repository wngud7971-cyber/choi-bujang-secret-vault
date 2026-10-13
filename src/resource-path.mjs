// Route on the raw request target: URL normalization must not turn traversal
// or encoded separators into a different resource. Queries select IDs only.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function parseResourceTarget(target, kind) {
  if (!['notes', 'announcements'].includes(kind) || typeof target !== 'string'
      || !target.startsWith('/') || target.startsWith('//')
      || /[\\#\s%]/u.test(target)) return { error: 'INVALID_RESOURCE_PATH', status: 400 };
  const [path, ...queryParts] = target.split('?');
  if (queryParts.length > 1 || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(path)) {
    return { error: 'INVALID_RESOURCE_PATH', status: 400 };
  }
  const prefix = `/api/${kind}`;
  let id = null;
  let ownerId = null;
  if (path === prefix || path === `${prefix}/`) {
    // Existing collection address remains usable.
  } else if (kind === 'notes' && path.startsWith(`${prefix}/owners/`)) {
    const match = /^\/api\/notes\/owners\/([^/]+)(?:\/([^/]+))?\/?$/u.exec(path);
    if (!match || !UUID.test(match[1]) || (match[2] && !UUID.test(match[2]))) {
      return { error: 'INVALID_RESOURCE_PATH', status: 400 };
    }
    ownerId = match[1].toLowerCase();
    id = match[2]?.toLowerCase() ?? null;
  } else {
    const match = new RegExp(`^${prefix}/([^/]+)/?$`, 'u').exec(path);
    if (!match) return { error: 'NOT_FOUND', status: 404 };
    if (!UUID.test(match[1])) return { error: 'INVALID_NOTE_ID', status: 400 };
    id = match[1].toLowerCase();
  }
  const query = new URLSearchParams(queryParts[0] ?? '');
  for (const key of query.keys()) {
    if (key !== 'id') return { error: 'QUERY_NOT_ALLOWED', status: 400 };
  }
  if (query.has('id')) {
    if (id || query.getAll('id').length !== 1 || !UUID.test(query.get('id'))) {
      return { error: 'INVALID_NOTE_ID', status: 400 };
    }
    id = query.get('id').toLowerCase();
  }
  return { kind, id, ownerId, resourceId: `${kind}:${id ?? 'collection'}` };
}

export function recordResourceDenial(kind, method, reason) {
  // Deliberately omit user IDs, paths, headers, payloads and upstream errors.
  console.warn(JSON.stringify({ event: 'resource_access_denied', resource: kind,
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method) ? method : 'OTHER', reason }));
}
