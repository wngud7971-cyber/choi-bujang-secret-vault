import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createDecider } from './decide.mjs';
import { matchPatterns, POLICY } from './signals.mjs';
import { safeId } from '../brute-force/alert-fields.mjs';
import { createZtnaConnection } from '../../src/ztna.mjs';
import { TTL_MS, WEB_RULE_ID, XDR_RULE_IDS, checkSource, loadAllDenyRules } from '../../src/xdr-policy.mjs';

export { TTL_MS, WEB_RULE_ID };

async function analyzeAlerts(alerts) {
  // Replay the same correlation logic with a local neutral reviewer. This
  // independently distinguishes deterministic evidence from Jev-only blocks.
  const deterministic = createDecider({ jev: async () => 0.5 });
  const analysis = [];
  for (const [index, alert] of alerts.entries()) {
    analysis.push({ index, match: matchPatterns(alert), decision: await deterministic(alert) });
  }
  return analysis;
}

function buildRules(analysis, decisions) {
  const ids = new Map();
  for (const item of analysis) ids.set(item.match.row.id, (ids.get(item.match.row.id) ?? 0) + 1);
  const byId = new Map(decisions.filter(item => item && safeId(item.alertId) !== 'unknown').map(item => [item.alertId, item]));
  const protectedRows = analysis.filter(item => item.match.normal || item.match.signals.tutorialContext
    || item.match.signals.deniedSignal).map(item => item.match.row);
  const rules = [];
  for (const item of analysis) {
    const { row, matched, signals } = item.match;
    const decision = byId.get(row.id);
    if (row.id === 'unknown' || ids.get(row.id) !== 1 || !row.srcip || !row.timestamp
      || item.decision.action !== 'block' || !matched.length || signals.tutorialContext || signals.deniedSignal
      || decision?.action !== 'block' || !Number.isFinite(decision.confidence) || decision.confidence < 0.85
      || decision.confidence > 1 || decision.reason !== item.decision.reason) continue;
    const start = Date.parse(row.timestamp);
    // A source-level rule would also deny a normal request sharing that address.
    // Withhold such a rule within its proposed lifetime (e.g. a shared proxy).
    if (protectedRows.some(normal => normal.srcip === row.srcip && normal.timestamp
      && Date.parse(normal.timestamp) >= start && Date.parse(normal.timestamp) < start + TTL_MS)) continue;
    let alertIds = [row.id];
    let attempts = row.attempts;
    if (attempts < POLICY.minimumAttempts) {
      const proof = analysis.filter(other => other.index <= item.index && other.match.row.srcip === row.srcip
        && other.match.row.timestamp && start - Date.parse(other.match.row.timestamp) >= 0
        && start - Date.parse(other.match.row.timestamp) <= POLICY.windowSeconds * 1000
        && other.match.row.attempts <= 1 && other.match.row.id !== 'unknown'
        && !other.match.signals.tutorialContext && !other.match.signals.deniedSignal
        && other.match.matched.some(pattern => matched.some(current => current.id === pattern.id)));
      alertIds = [...new Set(proof.map(other => other.match.row.id))];
      attempts = alertIds.length;
      if (attempts < POLICY.minimumAttempts) continue;
    }
    rules.push({ ruleId: WEB_RULE_ID, action: 'deny', sourceIp: row.srcip,
      startsAt: row.timestamp, expiresAt: new Date(start + TTL_MS).toISOString(), alertIds,
      pattern: item.decision.reason, patternIds: matched.map(pattern => pattern.id),
      attempts, confidence: decision.confidence });
  }
  return { schema: 'aleph.xdr.deny-rules.v1', moduleKey: 'web-injection', rules };
}

export async function makeDenyRules(alerts, decisions) {
  return buildRules(await analyzeAlerts(alerts), decisions);
}

export async function afterRun({ root, alerts, decisions, jev = null }) {
  const analysis = await analyzeAlerts(alerts);
  const document = buildRules(analysis, decisions);
  const dir = join(root, 'xdr', 'web-injection');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'deny-rules.json'), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const byId = new Map(analysis.map(item => [item.match.row.id, item]));
  const installed = new Set(document.rules.map(rule => rule.alertIds.at(-1)));
  const log = [];
  for (const decision of decisions) {
    const item = byId.get(safeId(decision?.alertId));
    if (!item || item.match.row.id === 'unknown' || !['block', 'alert'].includes(decision.action)
      || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) continue;
    const withheld = decision.action === 'block' && !installed.has(decision.alertId);
    log.push({ timestamp: item.match.row.timestamp, alertId: item.match.row.id,
      action: withheld ? 'alert' : decision.action, confidence: decision.confidence,
      reason: item.decision.reason + (withheld ? ' (차단 보류: 반복 근거 또는 정상 요청 보호 확인)' : '') });
  }
  if (log.length) await appendFile(join(root, 'xdr', 'alerts.log'), log.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf8');

  // Use both existing and new documents through the actual transport adapter.
  // At fixture times, an existing brute-force rule can legitimately take precedence.
  const documents = await loadAllDenyRules([
    join(root, 'xdr', 'brute-force', 'deny-rules.json'), join(dir, 'deny-rules.json'),
  ]);
  const transportResults = [];
  for (const item of analysis) {
    const row = item.match.row;
    const connected = createZtnaConnection({ rules: async () => documents, clock: () => row.timestamp });
    const response = await connected({ schema: 'aleph.decision.v1', requestId: randomUUID(),
      classId: 'class_fixture', projectId: 'project_fixture', subjectId: 'learner_fixture',
      deviceId: 'a'.repeat(16), service: 'notes', method: 'GET', path: '/notes/demo', route: 'GET /notes/:id',
      queryLength: 0, querySha256: createHash('sha256').update('').digest('hex'),
      at: row.timestamp, policyRevision: 1, deviceRegistered: true,
      stepUp: { verified: false, authAgeSeconds: null }, recentEvents: [],
      signals: { source: 'judge_fixture', region: 'local', network: 'usual', hour: 9 },
    }, { socket: { remoteAddress: row.srcip } });
    transportResults.push({ alertId: row.id, decision: response.decision,
      xdrDenied: response.ruleIds.some(id => XDR_RULE_IDS.includes(id)),
      webRuleDenied: response.ruleIds.includes(WEB_RULE_ID),
      webRuleMatched: Boolean(checkSource(row.srcip, row.timestamp, document)) });
  }
  const normal = analysis.filter(item => item.match.normal);
  const clear = analysis.filter(item => item.decision.action === 'block');
  const normalIds = new Set(normal.map(item => item.match.row.id));
  const clearIds = new Set(clear.map(item => item.match.row.id));
  const normalResults = transportResults.filter(item => normalIds.has(item.alertId));
  const clearResults = transportResults.filter(item => clearIds.has(item.alertId));
  const verification = { schema: 'aleph.xdr.verification.v1', moduleKey: 'web-injection', inputAlerts: alerts.length,
    blockCandidates: decisions.filter(item => item.action === 'block').length, installedRules: document.rules.length,
    clearAttacks: clear.length, clearAttacksDenied: clearResults.filter(item => item.decision === 'deny' && item.xdrDenied).length,
    clearWebRulesMatched: clearResults.filter(item => item.webRuleMatched).length,
    webRuleDenials: transportResults.filter(item => item.webRuleDenied).length,
    existingRuleDenials: transportResults.filter(item => item.xdrDenied && !item.webRuleDenied).length,
    normalEvents: normal.length,
    normalBlocked: decisions.filter(item => normalIds.has(item.alertId) && item.action === 'block').length,
    normalDenied: normalResults.filter(item => item.decision === 'deny').length,
    normalAllowed: normalResults.filter(item => item.decision === 'allow').length,
    ambiguousDenied: transportResults.filter(item => !clearIds.has(item.alertId) && !normalIds.has(item.alertId)
      && item.decision === 'deny').length,
    withheldBlocks: decisions.filter(item => item.action === 'block' && !document.rules.some(rule => rule.alertIds.at(-1) === item.alertId)).length,
    expiresAfterSeconds: TTL_MS / 1000, mode: 'fixture-replay',
    connection: 'src/ztna.mjs -> src/decider.mjs -> src/xdr-policy.mjs', jev };
  await writeFile(join(dir, 'verification.json'), `${JSON.stringify(verification, null, 2)}\n`, 'utf8');
  if (verification.normalBlocked || verification.normalDenied || verification.ambiguousDenied
    || verification.normalAllowed !== normal.length || verification.clearAttacksDenied !== clear.length
    || verification.clearWebRulesMatched !== clear.length) throw new Error('웹 주입 XDR 재현 검사 실패');
  return verification;
}
