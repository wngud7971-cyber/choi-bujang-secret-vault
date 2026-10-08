import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { evidence, safeId } from './read-alerts.mjs';
import { correlateAlert, matchPatterns } from './decide.mjs';
import { decide as baseDecide } from '../../src/decider.mjs';

export const TTL_MS = 15 * 60 * 1000;
export const RULE_ID = 'xdr.brute_force.deny';

export function makeDenyRules(alerts, decisions) {
  const byId = new Map(alerts.map(alert => [safeId(alert?.id), alert]));
  const rules = [];
  for (const decision of decisions) {
    const alert = byId.get(decision.alertId);
    if (decision.action !== 'block' || !Number.isFinite(decision.confidence) || decision.confidence < 0.85
      || decision.confidence > 1 || !alert || !matchPatterns(correlateAlert(alert, alerts)).clear) continue;
    const row = evidence(alert);
    if (row.id === 'unknown') continue;
    rules.push({ ruleId: RULE_ID, action: 'deny', sourceIp: row.srcip,
      startsAt: row.timestamp, expiresAt: new Date(Date.parse(row.timestamp) + TTL_MS).toISOString(),
      alertIds: [row.id], pattern: matchPatterns(alert).pattern.name,
    });
  }
  return { schema: 'aleph.xdr.deny-rules.v1', moduleKey: 'brute-force', rules };
}

export function checkSource(sourceIp, at, document) {
  if (typeof sourceIp !== 'string' || !isIP(sourceIp) || !Number.isFinite(Date.parse(at))
    || document?.schema !== 'aleph.xdr.deny-rules.v1' || document.moduleKey !== 'brute-force' || !Array.isArray(document.rules)) return null;
  const now = Date.parse(at);
  return document.rules.find(rule => rule.ruleId === RULE_ID && rule.action === 'deny' && rule.sourceIp === sourceIp
    && Number.isFinite(Date.parse(rule.startsAt)) && Number.isFinite(Date.parse(rule.expiresAt))
    && Date.parse(rule.expiresAt) - Date.parse(rule.startsAt) > 0
    && Date.parse(rule.expiresAt) - Date.parse(rule.startsAt) <= TTL_MS
    && Date.parse(rule.startsAt) <= now && now < Date.parse(rule.expiresAt)
    && Array.isArray(rule.alertIds) && rule.alertIds.length > 0 && rule.alertIds.every(id => safeId(id) === id && id !== 'unknown')) ?? null;
}

// sourceOf is supplied by the trusted server/relay, never by a browser field or header.
// denyResponse is supplied by the engine with its registered reason code.
// The existing 18-field request and five-field response contract remain intact.
export function withXdr({ sourceOf, denyResponse, decide = baseDecide, rules,
  clock = () => new Date().toISOString() }) {
  if (typeof sourceOf !== 'function' || typeof denyResponse !== 'function' || typeof decide !== 'function') {
    throw new Error('신뢰된 주소 연결과 등록된 거부 응답이 필요합니다.');
  }
  return async request => {
    const document = typeof rules === 'function' ? await rules() : rules;
    const match = checkSource(await sourceOf(request), clock(), document);
    if (!match) return decide(request);
    const response = await denyResponse(request, match);
    if (!response || Object.keys(response).sort().join(',') !== 'decision,reasonCode,requestId,ruleIds,schema'
      || response.schema !== 'aleph.decision.v1' || response.requestId !== request.requestId
      || response.decision !== 'deny' || typeof response.reasonCode !== 'string'
      || !/^[a-z][a-z0-9_]{0,79}$/u.test(response.reasonCode)
      || !Array.isArray(response.ruleIds) || !response.ruleIds.includes(RULE_ID)) {
      throw new Error('XDR 거부 응답 계약 오류');
    }
    return response;
  };
}

export async function loadDenyRules(path = new URL('./deny-rules.json', import.meta.url)) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function afterRun({ root, alerts, decisions }) {
  const dir = join(root, 'xdr', 'brute-force');
  await mkdir(dir, { recursive: true });
  const document = makeDenyRules(alerts, decisions);
  await writeFile(join(dir, 'deny-rules.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const byId = new Map(alerts.map(alert => [safeId(alert?.id), evidence(alert)]));
  const log = decisions.filter(decision => decision.action === 'block' || decision.action === 'alert')
    .map(decision => ({ timestamp: byId.get(decision.alertId)?.timestamp ?? null,
      alertId: safeId(decision.alertId), action: decision.action, confidence: decision.confidence,
      reason: matchPatterns(alerts.find(alert => safeId(alert?.id) === decision.alertId)).pattern.name }));
  if (log.length) await appendFile(join(root, 'xdr', 'alerts.log'), log.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  const classify = alert => matchPatterns(correlateAlert(alert, alerts));
  const normal = alerts.filter(alert => classify(alert).normal);
  const normalBlocked = normal.filter(alert => decisions.some(decision => decision.alertId === safeId(alert.id) && decision.action === 'block'));
  const normalDenied = normal.filter(alert => checkSource(evidence(alert).srcip, evidence(alert).timestamp, document));
  const clear = alerts.filter(alert => classify(alert).clear);
  const clearDenied = clear.filter(alert => checkSource(evidence(alert).srcip, evidence(alert).timestamp, document));
  const verification = { schema: 'aleph.xdr.verification.v1', inputAlerts: alerts.length,
    clearAttacks: clear.length, clearAttacksDenied: clearDenied.length,
    normalEvents: normal.length, normalBlocked: normalBlocked.length, normalDenied: normalDenied.length,
    ambiguousBlocked: alerts.filter(alert => !classify(alert).normal && !classify(alert).clear)
      .filter(alert => decisions.some(decision => decision.alertId === safeId(alert.id) && decision.action === 'block')).length,
    expiresAfterSeconds: TTL_MS / 1000, mode: 'fixture-replay',
  };
  await writeFile(join(dir, 'verification.json'), `${JSON.stringify(verification, null, 2)}\n`, 'utf8');
  if (verification.normalBlocked || verification.normalDenied || verification.ambiguousBlocked
    || clearDenied.length !== clear.length) throw new Error('XDR 재현 검사 실패');
}
