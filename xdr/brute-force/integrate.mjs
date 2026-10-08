import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { evidence, safeId } from './read-alerts.mjs';
import { correlateAlert, matchPatterns } from './decide.mjs';
import { decide as baseDecide } from '../../src/decider.mjs';
import { createZtnaConnection } from '../../src/ztna.mjs';
import { TTL_MS, RULE_ID, checkSource, loadDenyRules } from '../../src/xdr-policy.mjs';

export { TTL_MS, RULE_ID, checkSource, loadDenyRules };

export function makeDenyRules(alerts, decisions) {
  const byId = new Map(alerts.map(alert => [safeId(alert?.id), alert]));
  const rules = [];
  for (const decision of decisions) {
    const alert = byId.get(decision.alertId);
    const match = matchPatterns(correlateAlert(alert, alerts));
    if (decision.action !== 'block' || !Number.isFinite(decision.confidence) || decision.confidence < 0.85
      || decision.confidence > 1 || !alert || match.normal
      || decision.reason !== match.pattern.name) continue;
    const row = evidence(alert);
    if (row.id === 'unknown' || !row.srcip || !row.account || !row.timestamp) continue;
    rules.push({ ruleId: RULE_ID, action: 'deny', sourceIp: row.srcip,
      startsAt: row.timestamp, expiresAt: new Date(Date.parse(row.timestamp) + TTL_MS).toISOString(),
      alertIds: [row.id], pattern: matchPatterns(alert).pattern.name,
    });
  }
  return { schema: 'aleph.xdr.deny-rules.v1', moduleKey: 'brute-force', rules };
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
  const transportResults = [];
  for (const alert of alerts) {
    const row = evidence(alert);
    // Replay uses the same server connection and actual src/decider.mjs as live
    // calls, with a controlled event-time clock and the generated rules on disk.
    const connected = createZtnaConnection({ rules: () => loadDenyRules(join(dir, 'deny-rules.json')),
      clock: () => row.timestamp });
    const response = await connected({ schema: 'aleph.decision.v1', requestId: randomUUID(),
      classId: 'class_fixture', projectId: 'project_fixture', subjectId: 'learner_fixture',
      deviceId: 'a'.repeat(16), service: 'notes', method: 'GET', path: '/notes/demo', route: 'GET /notes/:id',
      queryLength: 0, querySha256: createHash('sha256').update('').digest('hex'),
      at: row.timestamp, policyRevision: 1, deviceRegistered: true,
      stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
      signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 9 },
    },
      { socket: { remoteAddress: row.srcip } });
    transportResults.push({ alertId: row.id, xdrDenied: response.ruleIds.includes(RULE_ID),
      decision: response.decision, ruleIds: response.ruleIds });
  }
  const normalDenied = normal.filter(alert => transportResults.some(item => item.alertId === safeId(alert.id) && item.xdrDenied));
  const clear = alerts.filter(alert => classify(alert).clear);
  const clearDenied = clear.filter(alert => transportResults.some(item => item.alertId === safeId(alert.id) && item.xdrDenied));
  const verification = { schema: 'aleph.xdr.verification.v1', inputAlerts: alerts.length,
    clearAttacks: clear.length, clearAttacksDenied: clearDenied.length,
    normalEvents: normal.length, normalBlocked: normalBlocked.length, normalDenied: normalDenied.length,
    ambiguousBlocked: decisions.filter(item => item.action === 'block' && item.confidence < 0.85).length,
    jevConfirmedBlocks: alerts.filter(alert => !classify(alert).clear)
      .filter(alert => decisions.some(item => item.alertId === safeId(alert.id) && item.action === 'block')).length,
    normalPassedToExistingPolicy: normal.length - normalDenied.length,
    expiresAfterSeconds: TTL_MS / 1000, mode: 'fixture-replay',
    connection: 'src/ztna.mjs -> src/decider.mjs -> src/xdr-policy.mjs',
  };
  await writeFile(join(dir, 'verification.json'), `${JSON.stringify(verification, null, 2)}\n`, 'utf8');
  if (verification.normalBlocked || verification.normalDenied || verification.ambiguousBlocked
    || clearDenied.length !== clear.length) throw new Error('XDR 재현 검사 실패');
}
