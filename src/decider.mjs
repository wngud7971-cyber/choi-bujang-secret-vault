// ALEPH SDP 엔진이 신원·기기·경로를 확인한 요청만 받습니다.
// 격리된 판정 환경에서도 실행되도록 외부 모듈을 불러오지 않습니다.
// 서버 연결부 src/ztna.mjs는 이 기본 규칙 앞에서 기존 XDR 거부를 확인합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze([
  'device_registered', 'xdr.brute_force.deny', 'xdr.web_injection.deny',
]);

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
  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: 'allow',
    reasonCode: 'approved',
    ruleIds: ['device_registered'],
  };
}
