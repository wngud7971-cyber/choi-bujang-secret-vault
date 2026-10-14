// ALEPH SDP 엔진이 신원·기기·경로를 확인한 요청만 받습니다.
// 격리된 판정 환경에서도 실행되도록 외부 모듈을 불러오지 않습니다.
// 서버 연결부 src/ztna.mjs는 이 기본 규칙 앞에서 기존 XDR 거부를 확인합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze([
  'device_registered', 'xdr.brute_force.deny', 'xdr.web_injection.deny', 'xdr.known_cve.deny', 'xdr.persistence.deny', 'step_up_required',
  'resource.exact_route', 'resource.note_owner', 'resource.announcement_editor',
  'recovery.exact_route',
]);

// User-zone IDs are the ENGINE'S opaque subject IDs, never Supabase UUIDs.
// Single-note owner checks belong to the final API. Keep legacy exact routes
// usable; deny aggregate lists and every teacher-zone write at this boundary.
export function inspectResourceInput(request) {
  const path = request?.path;
  const method = request?.method;
  const subject = request?.subjectId;
  const invalid = ruleId => ({ allowed: false, ruleId });
  if (request?.schema !== 'aleph.decision.v1'
      || typeof subject !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/u.test(subject)
      || !/^[a-f0-9]{16}$/u.test(request.deviceId ?? '')
      || request.service !== 'notes' || typeof path !== 'string'
      || /[\\%?#\s]/u.test(path) || path.includes('//')
      || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(path)
      || request.queryLength !== 0
      || request.querySha256 !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      || typeof request.route !== 'string') return invalid('resource.exact_route');
  const root = path.startsWith('/api/') ? '/api' : '';
  const notes = `${root}/notes`;
  const notices = `${root}/announcements`;
  if (path === `${root}/restore`) {
    // Authentication, judge-B/run binding and backup ownership are checked at
    // the final recovery API, just as single-note ownership is checked there.
    return method === 'POST' && request.route === `POST ${root}/restore`
      ? { allowed: true, ruleId: 'recovery.exact_route', resourceId: 'notes:recovery' }
      : invalid('recovery.exact_route');
  }
  if (path === notes) {
    // The engine has no owner evidence for a collection. The API's personal
    // list remains available at its existing address, with its own owner filter.
    return method === 'POST' && request.route === `POST ${notes}`
      ? { allowed: true, ruleId: 'resource.exact_route', resourceId: 'notes:create' }
      : invalid('resource.exact_route');
  }
  const single = new RegExp(`^${notes}/([A-Za-z0-9_-]{1,128})$`, 'u').exec(path);
  const reserved = ['all', 'list', 'export', 'search', 'batch', 'bulk', 'download',
    'owners', 'announcements', 'notices', 'teacher', 'instructor', 'admin', 'class'];
  if (single && !reserved.includes(single[1].toLowerCase())
      && ['GET', 'PUT', 'DELETE'].includes(method)
      && request.route === `${method} ${notes}/:id`) {
    // A's and B's requests can reach this exact single-resource operation, but
    // the API's atomic owner condition independently denies a foreign record.
    return { allowed: true, ruleId: 'resource.exact_route', resourceId: `notes:${single[1]}` };
  }
  const own = new RegExp(`^${notes}/owners/([A-Za-z0-9_-]{1,160})(?:/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?$`, 'u').exec(path);
  if (own) {
    const [ , owner, id ] = own;
    const route = `${method} ${notes}/owners/:ownerId${id ? '/:id' : ''}`;
    if (request.route !== route || !(id ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST']).includes(method)) {
      return invalid('resource.exact_route');
    }
    return owner === subject
      ? { allowed: true, ruleId: 'resource.note_owner', resourceId: `notes:${owner}:${id ?? 'collection'}` }
      : invalid('resource.note_owner');
  }
  const notice = new RegExp(`^${notices}(?:/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?$`, 'u').exec(path);
  if (notice && request.route === `${method} ${notices}${notice[1] ? '/:id' : ''}`) {
    if (method === 'GET') return { allowed: true, ruleId: 'resource.exact_route', resourceId: `announcements:${notice[1] ?? 'collection'}` };
    // The current 18-field engine contract contains no verified teacher grant.
    // Never fabricate request.role or treat judge_fixture/subject spelling as one.
    if (method === (notice[1] ? 'PUT' : 'POST')) return invalid('resource.announcement_editor');
  }
  return invalid('resource.exact_route');
}

// Only inspect the verified engine request. Never read browser headers/body.
// A fixture is synthetic evidence; unavailable values stay null, never normal.
export function inspectConnectionInput(request) {
  const signals = request?.signals;
  const object = signals && typeof signals === 'object' && !Array.isArray(signals);
  const own = key => object && Object.hasOwn(signals, key);
  const source = own('source') && ['judge_fixture', 'none'].includes(signals.source)
    ? signals.source : 'untrusted';
  const region = source === 'judge_fixture' && own('region')
    && ['local', 'foreign'].includes(signals.region) ? signals.region : null;
  const network = source === 'judge_fixture' && own('network')
    && ['usual', 'unusual'].includes(signals.network) ? signals.network : null;
  const hour = source !== 'untrusted' && own('hour')
    && Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23
    ? signals.hour : null;
  const events = request?.recentEvents;
  const validEvents = Array.isArray(events) && events.length <= 12
    && Array.from(events).every(event => event && typeof event === 'object'
      && !Array.isArray(event) && ['kind', 'ageSeconds', 'count'].every(key => Object.hasOwn(event, key))
      && typeof event.kind === 'string' && event.kind.length > 0
      && Number.isSafeInteger(event.ageSeconds) && event.ageSeconds >= 0
      && Number.isSafeInteger(event.count) && event.count >= 1);
  const complete = source === 'judge_fixture'
    ? region !== null && network !== null && hour !== null && validEvents
    : source === 'none' && own('region') && own('network')
      && signals.region === 'unknown' && signals.network === 'unknown'
      && hour !== null && validEvents;
  return { source, region, network, hour,
    recentEvents: validEvents && source === 'judge_fixture'
      ? events.map(({ kind, ageSeconds, count }) => ({ kind, ageSeconds, count })) : null,
    complete: Boolean(complete) };
}

export function decide(request) {
  if (request?.deviceRegistered !== true) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request?.requestId,
      decision: 'deny',
      reasonCode: 'device_not_registered',
      ruleIds: ['device_registered'],
    };
  }
  const resource = inspectResourceInput(request);
  if (!resource.allowed) {
    return { schema: 'aleph.decision.v1', requestId: request.requestId,
      decision: 'deny', reasonCode: 'starter_not_ready', ruleIds: [resource.ruleId] };
  }
  const input = inspectConnectionInput(request);
  // The bundled fixture defines risk_signal as recent bulk access. Region alone
  // never blocks. Actual source:none is unavailable evidence, not a normal region.
  const compoundRisk = input.source === 'judge_fixture' && input.complete
    && input.hour < 6 && input.network === 'unusual'
    && input.recentEvents.some(event => event.kind === 'risk_signal'
      && event.ageSeconds <= 300 && event.count >= 20);
  // The engine-provided fixture can exercise re-confirmation without claiming
  // real login-time verification. Never obtain this state from browser headers.
  const fixtureStepUp = compoundRisk && request.stepUp
    && typeof request.stepUp === 'object' && !Array.isArray(request.stepUp)
    && Object.hasOwn(request.stepUp, 'verified') && request.stepUp.verified === true
    && Object.hasOwn(request.stepUp, 'authAgeSeconds')
    && Number.isInteger(request.stepUp.authAgeSeconds)
    && request.stepUp.authAgeSeconds >= 0 && request.stepUp.authAgeSeconds <= 900;
  if (!input.complete || (compoundRisk && !fixtureStepUp)) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'step_up',
      reasonCode: 'step_up_required',
      ruleIds: ['step_up_required'],
    };
  }
  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: 'allow',
    reasonCode: 'approved',
    ruleIds: ['device_registered'],
  };
}
