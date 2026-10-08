// ALEPH SDP 엔진이 신원·기기·경로를 확인한 요청만 받습니다.
// 등록 기기 기본 규칙 앞에 만료되는 XDR 거부 검사를 추가합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
import { activeXdrRule, XDR_RULE_IDS } from './xdr-policy.mjs';

export const RULE_IDS = Object.freeze(['device_registered', ...XDR_RULE_IDS]);

export async function decide(request) {
  const xdrRule = await activeXdrRule();
  if (xdrRule) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      // Retain the known engine-compatible code; the rule ID identifies XDR.
      reasonCode: 'starter_not_ready',
      ruleIds: [xdrRule.ruleId],
    };
  }
  const registered = request.deviceRegistered === true;
  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: registered ? 'allow' : 'deny',
    reasonCode: registered ? 'approved' : 'device_not_registered',
    ruleIds: ['device_registered'],
  };
}
