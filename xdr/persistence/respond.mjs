import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { decide } from './decide.mjs';
import { readAlert } from './read-alerts.mjs';
import { safeId } from '../brute-force/alert-fields.mjs';
import { createZtnaConnection } from '../../src/ztna.mjs';
import { canonicalIp, checkSource, PERSISTENCE_RULE_ID, TTL_MS, XDR_RULE_IDS, loadAllDenyRules } from '../../src/xdr-policy.mjs';

export { PERSISTENCE_RULE_ID, TTL_MS };
const patterns = [
  {
    "id": "unsigned-service-change",
    "name": "서명 없는 서비스 생성·변경",
    "technique": "T1543"
  },
  {
    "id": "unfamiliar-service-autostart",
    "name": "미등록 서비스의 임시 파일 자동 시작",
    "technique": "T1543"
  },
  {
    "id": "suspicious-scheduled-task",
    "name": "낯선 예약 작업의 임시 파일 실행",
    "technique": "T1053"
  },
  {
    "id": "unfamiliar-startup-entry",
    "name": "평소 목록 밖의 시작 폴더 프로그램",
    "technique": "T1547.001"
  }
];

function analyze(alerts) {
  return alerts.map(alert => ({ row: readAlert(alert), id: safeId(alert?.id), decision: decide(alert) }));
}

function buildRules(analysis, decisions) {
  const counts = new Map();
  const submittedCounts = new Map();
  for (const item of analysis) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  for (const item of decisions) {
    const id = safeId(item?.alertId);
    submittedCounts.set(id, (submittedCounts.get(id) ?? 0) + 1);
  }
  const byId = new Map(decisions.map(item => [safeId(item?.alertId), item]));
  const rules = [];
  for (const item of analysis) {
    const { row, id, decision } = item;
    const submitted = byId.get(id);
    const sourceIp = canonicalIp(row.srcip);
    if (id === 'unknown' || counts.get(id) !== 1 || submittedCounts.get(id) !== 1 || !sourceIp || !row.timestamp
      || decision.action !== 'block' || submitted?.action !== 'block'
      || submitted.confidence !== decision.confidence || submitted.reason !== decision.reason) continue;
    const pattern = patterns.find(pattern => pattern.name === decision.reason);
    if (!pattern) continue;
    const start = Date.parse(row.timestamp);
    // A source may be a shared proxy. Protect both ordinary and ambiguous
    // requests observed near this lifetime; never install a blanket account deny.
    const shared = analysis.some(other => other.decision.action !== 'block'
      && canonicalIp(other.row.srcip) === sourceIp && other.row.timestamp
      && Date.parse(other.row.timestamp) >= start - TTL_MS
      && Date.parse(other.row.timestamp) < start + TTL_MS);
    if (shared) continue;
    rules.push({ ruleId: PERSISTENCE_RULE_ID, action: 'deny', sourceIp,
      startsAt: row.timestamp, expiresAt: new Date(start + TTL_MS).toISOString(),
      alertIds: [id], confidence: decision.confidence, pattern: decision.reason,
      patternIds: [pattern.id], technique: pattern.technique });
  }
  return { schema: 'aleph.xdr.deny-rules.v1', moduleKey: 'persistence', rules };
}

export function makeDenyRules(alerts, decisions) {
  return buildRules(analyze(alerts), decisions);
}

export async function afterRun({ root, alerts, decisions }) {
  const analysis = analyze(alerts);
  const document = buildRules(analysis, decisions);
  const dir = join(root, 'xdr', 'persistence');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'deny-rules.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const installed = new Set(document.rules.flatMap(rule => rule.alertIds));
  const log = analysis.filter(item => item.id !== 'unknown' && item.decision.action !== 'record').map(item => {
    const withheld = item.decision.action === 'block' && !installed.has(item.id);
    return { timestamp: item.row.timestamp, alertId: item.id, action: withheld ? 'alert' : item.decision.action,
      confidence: item.decision.confidence,
      reason: item.decision.reason + (withheld ? ' (차단 보류: 정상 요청 보호 또는 근거 검증)' : '') };
  });
  if (log.length) await appendFile(join(root, 'xdr', 'alerts.log'), log.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf8');

  // Replay through the existing transport adapter, preserving prior modules'
  // priority. Fixture timestamps are used; historical rules are not revived now.
  const documents = await loadAllDenyRules(['brute-force', 'web-injection', 'known-cve', 'persistence']
    .map(key => join(root, 'xdr', key, 'deny-rules.json')));
  const transportResults = [];
  for (const item of analysis) {
    const connected = createZtnaConnection({ rules: async () => documents, clock: () => item.row.timestamp });
    const response = await connected({ schema: 'aleph.decision.v1', requestId: randomUUID(),
      classId: 'class_fixture', projectId: 'project_fixture', subjectId: 'learner_fixture',
      deviceId: 'a'.repeat(16), service: 'notes', method: 'GET', path: '/notes/demo', route: 'GET /notes/:id',
      queryLength: 0, querySha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      at: item.row.timestamp, policyRevision: 1, deviceRegistered: true,
      stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
      signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 9 },
    }, { socket: { remoteAddress: item.row.srcip } });
    transportResults.push({ alertId: item.id, category: item.decision.action, decision: response.decision,
      xdrDenied: response.ruleIds.some(id => XDR_RULE_IDS.includes(id)),
      persistenceDenied: response.ruleIds.includes(PERSISTENCE_RULE_ID),
      persistenceMatched: Boolean(checkSource(item.row.srcip, item.row.timestamp, document)) });
  }
  const normals = transportResults.filter(item => item.category === 'record');
  const ambiguous = transportResults.filter(item => item.category === 'alert');
  const attacks = transportResults.filter(item => item.category === 'block');
  const normalIds = new Set(normals.map(item => item.alertId));
  const verification = { schema: 'aleph.xdr.verification.v1', moduleKey: 'persistence', inputAlerts: alerts.length,
    blockCandidates: decisions.filter(item => item.action === 'block').length,
    installedRules: document.rules.length, clearAttacks: attacks.length,
    clearAttacksDenied: attacks.filter(item => item.decision === 'deny' && item.xdrDenied).length,
    clearPersistenceRulesMatched: attacks.filter(item => item.persistenceMatched).length,
    persistenceRuleDenials: transportResults.filter(item => item.persistenceDenied).length,
    existingRuleDenials: transportResults.filter(item => item.xdrDenied && !item.persistenceDenied).length,
    normalEvents: normals.length,
    normalBlocked: decisions.filter(item => normalIds.has(item.alertId) && item.action === 'block').length,
    normalDenied: normals.filter(item => item.decision === 'deny').length,
    normalAllowed: normals.filter(item => item.decision === 'allow').length,
    ambiguousEvents: ambiguous.length, ambiguousDenied: ambiguous.filter(item => item.decision === 'deny').length,
    withheldBlocks: analysis.filter(item => item.decision.action === 'block' && !installed.has(item.id)).length,
    expiresAfterSeconds: TTL_MS / 1000, mode: 'fixture-replay',
    connection: 'src/ztna.mjs -> src/xdr-policy.mjs; unmatched -> src/decider.mjs',
    isolationScope: 'trusted-transport-source-ip', deviceIdentityMapping: 'not_available',
    liveEnforcement: 'not_run' };
  await writeFile(join(dir, 'verification.json'), `${JSON.stringify(verification, null, 2)}\n`, 'utf8');
  if (verification.normalBlocked || verification.normalDenied || verification.ambiguousDenied
    || verification.normalAllowed !== normals.length
    || attacks.some(item => item.persistenceMatched && !(item.decision === 'deny' && item.xdrDenied))) {
    throw new Error('지속성 XDR 재현 검사 실패');
  }
  return verification;
}
