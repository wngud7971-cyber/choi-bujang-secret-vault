// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 이 기본 응답은 모든 요청을 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
import { activeXdrRule, RULE_ID as XDR_RULE_ID } from './xdr-policy.mjs';

export const RULE_IDS = Object.freeze(['starter.deny', XDR_RULE_ID]);

export async function decide(request) {
  const xdrRule = await activeXdrRule();
  if (xdrRule) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      // Keep the existing engine-compatible denial code; ruleIds identify XDR.
      reasonCode: 'starter_not_ready',
      ruleIds: [XDR_RULE_ID],
    };
  }
  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: 'deny',
    reasonCode: 'starter_not_ready',
    ruleIds: [RULE_IDS[0]],
  };
}
