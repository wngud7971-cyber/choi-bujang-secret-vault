// Separate detection output; never change decide(request) or revoke a device here.
// Only the engine/judge may call this function with verified synthetic events.
// This module deliberately has no imports, I/O, timers, or persistent state.
export const DETECTION_RULE_IDS = Object.freeze(['detection.compound_burst_read']);
export const READ_WINDOW_MS = 10 * 60 * 1000;
export const READ_LIMIT = 120;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Read only own data fields. Ignore inherited fields and accessors. Never
// enumerate, clone, retain or log raw events, including their secret fields.
const field = (value, key) => object(value)
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const pseudonym = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/u.test(value);
const uuid = value => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);

export function normalizeDetectionEvent(event) {
  if (!object(event)) return null;
  const at = field(event, 'at');
  if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(at)) return null;
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)
      || new Date(timestamp).toISOString() !== (at.length === 20 ? at.replace('Z', '.000Z') : at)) return null;
  const subjectId = field(event, 'subjectId');
  const legacySubject = field(field(event, 'identity'), 'sub');
  const subject = subjectId === undefined ? legacySubject : subjectId;
  if (!pseudonym(subject) || (legacySubject !== undefined && legacySubject !== subject)) return null;
  const method = field(event, 'method');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) return null;
  const rawDevice = field(event, 'deviceId');
  const deviceId = typeof rawDevice === 'string' && /^[a-f0-9]{16}$/u.test(rawDevice) ? rawDevice : null;
  const registered = field(event, 'deviceRegistered') === true;
  const decision = field(event, 'decision');
  if (decision !== undefined && !['allow', 'deny', 'step_up'].includes(decision)) return null;
  const requestId = field(event, 'requestId');
  if (requestId !== undefined && !uuid(requestId)) return null;
  const classId = field(event, 'classId');
  const projectId = field(event, 'projectId');
  if ((classId !== undefined || projectId !== undefined)
      && (!pseudonym(classId) || !pseudonym(projectId))) return null;
  const signals = field(event, 'signals');
  const source = field(signals, 'source');
  const rawNetwork = field(signals, 'network');
  const network = source === 'judge_fixture' && ['usual', 'unusual'].includes(rawNetwork)
    ? rawNetwork : 'unknown';
  return { at: new Date(timestamp).toISOString(), subjectId: subject, deviceId,
    deviceRegistered: registered, method, decision: decision ?? null,
    requestId: requestId?.toLowerCase() ?? null, classId: classId ?? null, projectId: projectId ?? null,
    signals: { source: source === 'judge_fixture' ? 'judge_fixture' : 'none', network } };
}

export function normalizeDetectionEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const safe = [];
  for (const event of events) {
    const normalized = normalizeDetectionEvent(event);
    if (normalized) safe.push(normalized);
  }
  return safe;
}

export function detect(events) {
  const safe = normalizeDetectionEvents(events);
  const groups = new Map();
  // A repeated request ID is one request. Inconsistent copies invalidate that
  // ID for this batch rather than letting their order create extra evidence.
  const requests = new Map();
  const conflicts = new Set();
  const fingerprint = event => JSON.stringify(event);
  for (const event of safe) {
    if (!event.requestId) continue;
    const key = JSON.stringify([event.classId, event.projectId, event.requestId]);
    const previous = requests.get(key);
    if (previous && fingerprint(previous) !== fingerprint(event)) conflicts.add(key);
    else requests.set(key, event);
  }
  const seen = new Set();
  const eligible = safe.filter(event => {
    if (event.requestId) {
      const key = JSON.stringify([event.classId, event.projectId, event.requestId]);
      if (conflicts.has(key) || seen.has(key)) return false;
      seen.add(key);
    }
    return event.method === 'GET' && event.deviceId !== null && event.deviceRegistered
      && event.signals.source === 'judge_fixture' && event.signals.network === 'unusual';
  }).sort((a, b) => a.at.localeCompare(b.at)
    || a.subjectId.localeCompare(b.subjectId) || a.deviceId.localeCompare(b.deviceId));
  for (const event of eligible) {
    const key = JSON.stringify([event.classId, event.projectId, event.subjectId, event.deviceId]);
    const times = groups.get(key) ?? [];
    const now = Date.parse(event.at);
    // Keep at most 121 timestamps per identity/device; no raw event is retained.
    while (times.length && now - times[0] > READ_WINDOW_MS) times.shift();
    times.push(now);
    groups.set(key, times);
    if (times.length > READ_LIMIT) return { action: 'propose_revocation',
      reasonCode: 'burst_read', subject: event.subjectId, deviceId: event.deviceId };
  }
  return { action: 'observe' };
}
