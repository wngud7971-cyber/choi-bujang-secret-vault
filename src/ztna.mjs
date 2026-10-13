import { decide } from './decider.mjs';
import { activeXdrRule, loadAllDenyRules, withTrustedSource } from './xdr-policy.mjs';

// The request is the unchanged 18-field verified engine request. The transport
// is a server-owned IncomingMessage/socket; client headers/body are not sources.
export function createZtnaConnection({ rules = loadAllDenyRules, clock } = {}) {
  return (request, transport) => withTrustedSource({
    sourceIp: transport?.socket?.remoteAddress, rules, clock,
  }, async () => {
    // Keep server-only XDR state outside the standalone engine decision module.
    const xdrRule = await activeXdrRule();
    if (xdrRule) {
      return {
        schema: 'aleph.decision.v1',
        requestId: request.requestId,
        decision: 'deny',
        reasonCode: 'starter_not_ready',
        ruleIds: [xdrRule.ruleId],
      };
    }
    return decide(request);
  });
}

export const decideFromTransport = createZtnaConnection();
