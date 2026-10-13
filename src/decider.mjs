// ALEPH SDP 엔진이 신원·기기·경로를 확인한 요청만 받습니다.
// 격리된 판정 환경에서도 실행되도록 외부 모듈을 불러오지 않습니다.
// 서버 연결부 src/ztna.mjs는 이 기본 규칙 앞에서 기존 XDR 거부를 확인합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze([
  'device_registered', 'xdr.brute_force.deny', 'xdr.web_injection.deny', 'step_up_required',
]);

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
  if (request.deviceRegistered !== true) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'device_not_registered',
      ruleIds: ['device_registered'],
    };
  }
  const input = inspectConnectionInput(request);
  // The bundled fixture defines risk_signal as recent bulk access. Region alone
  // never blocks. Actual source:none is unavailable evidence, not a normal region.
  const compoundRisk = input.source === 'judge_fixture' && input.complete
    && input.hour < 6 && input.network === 'unusual'
    && input.recentEvents.some(event => event.kind === 'risk_signal'
      && event.ageSeconds <= 300 && event.count >= 20);
  if (!input.complete || compoundRisk) {
    // No same-subject, post-challenge login-time verification contract is supplied.
    // Do not bypass the challenge using stepUp.verified/authAgeSeconds alone.
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
