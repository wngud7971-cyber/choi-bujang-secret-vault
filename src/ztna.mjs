import { decide } from './decider.mjs';
import { loadDenyRules, withTrustedSource } from './xdr-policy.mjs';

// The request is the unchanged 18-field verified engine request. The transport
// is a server-owned IncomingMessage/socket; client headers/body are not sources.
export function createZtnaConnection({ rules = loadDenyRules, clock } = {}) {
  return (request, transport) => withTrustedSource({
    sourceIp: transport?.socket?.remoteAddress, rules, clock,
  }, () => decide(request));
}

export const decideFromTransport = createZtnaConnection();
