import { decide } from './decider.mjs';
import { activeXdrRule, loadAllDenyRules, withTrustedSource } from './xdr-policy.mjs';

// The request is the unchanged 18-field verified engine request. The transport
// is a server-owned IncomingMessage/socket; client headers/body are not sources.
export function createZtnaConnection({ rules = loadAllDenyRules, clock, resolveDestination } = {}) {
  // Optional server-owned egress routing callback. The default inbound adapter
  // has no destination evidence and never substitutes the inbound source IP.
  return async (request, transport) => {
    let destinationIp = null;
    if (typeof resolveDestination === 'function') destinationIp = await resolveDestination(request, transport);
    return withTrustedSource({
      sourceIp: transport?.socket?.remoteAddress, destinationIp, rules, clock,
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
  };
}

export const decideFromTransport = createZtnaConnection();
