import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createDecider } from '../xdr/web-injection/decide.mjs';
import { makeDenyRules, TTL_MS, WEB_RULE_ID } from '../xdr/web-injection/integrate.mjs';
import { checkSource, loadAllDenyRules, RULE_ID } from '../src/xdr-policy.mjs';
import { createZtnaConnection } from '../src/ztna.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { runXdr } from '../scripts/xdr-run.mjs';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('xdr/fixtures/web-injection.json', root), 'utf8'));
const existing = JSON.parse(await readFile(new URL('xdr/brute-force/deny-rules.json', root), 'utf8'));
const unavailable = () => { throw new Error('test_unavailable'); };
async function decisionsFor(alerts, jev = unavailable) {
  const decide = createDecider({ jev });
  const decisions = [];
  for (const alert of alerts) decisions.push({ alertId: alert.id, ...await decide(alert) });
  return decisions;
}
async function removeTestDirectory(dir) {
  // Verify the absolute deletion target stays in this test's temporary root.
  const target = resolve(dir);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^web-injection-integration-/u);
  await rm(target, { recursive: true, force: true });
}

test('거부 규칙 8개는 반복된 패턴·경보 번호·15분 만료 근거를 갖습니다', async () => {
  const doc = await makeDenyRules(fixture.alerts, await decisionsFor(fixture.alerts));
  assert.equal(doc.rules.length, 8);
  for (const rule of doc.rules) {
    assert.equal(rule.ruleId, WEB_RULE_ID);
    assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.startsAt), TTL_MS);
    assert.ok(rule.alertIds.length > 0);
    assert.ok(rule.attempts >= 3);
    assert.ok(rule.patternIds.length > 0);
    assert.ok(checkSource(rule.sourceIp, rule.startsAt, doc));
    assert.equal(checkSource(rule.sourceIp, new Date(Date.parse(rule.startsAt) - 1).toISOString(), { ...doc, rules: [rule] }), null);
    assert.equal(checkSource(rule.sourceIp, rule.expiresAt, { ...doc, rules: [rule] }), null);
  }
  for (const alert of fixture.alerts.slice(8)) assert.equal(checkSource(alert.data.srcip, alert.timestamp, doc), null);
  assert.ok(checkSource(fixture.alerts[5].data.srcip, fixture.alerts[5].timestamp, doc));
});

test('Jev 확신도가 높아도 애매한 시도·수업 단어는 알림이며 거부 규칙에서 제외됩니다', async () => {
  const decisions = await decisionsFor(fixture.alerts, async () => 0.99);
  assert.equal(decisions.filter(item => item.action === 'block').length, 8);
  assert.ok(decisions.slice(8, 17).every(item => item.action === 'alert'));
  const doc = await makeDenyRules(fixture.alerts, decisions);
  assert.equal(doc.rules.length, 8);
  assert.ok(doc.rules.some(rule => rule.alertIds.includes('wi-06') && rule.patternIds.includes('command-injection')));
  const forgedNormal = fixture.alerts.slice(17).map(alert => ({ alertId: alert.id,
    action: 'block', confidence: 1, reason: '해당 없음' }));
  assert.equal((await makeDenyRules(fixture.alerts, forgedNormal)).rules.length, 0);
});

test('확신도·이유·경보 번호가 맞지 않는 후보는 거부 규칙에서 제외합니다', async () => {
  const alert = fixture.alerts[0];
  const decision = (await decisionsFor([alert]))[0];
  for (const mutation of [{ confidence: 0.84 }, { confidence: NaN }, { confidence: 1.1 },
    { action: 'alert' }, { reason: '비밀값을 포함한 임의 이유' }, { alertId: 'unknown' }]) {
    assert.equal((await makeDenyRules([alert], [{ ...decision, ...mutation }])).rules.length, 0);
  }
  assert.equal((await makeDenyRules([{ ...alert, id: 'unknown' }], [decision])).rules.length, 0);
});

test('같은 주소의 정상 요청이 만료 시간 안에 있으면 주소 차단을 보류합니다', async () => {
  const attack = fixture.alerts[0];
  const normal = structuredClone(fixture.alerts[17]);
  normal.data.srcip = attack.data.srcip;
  normal.timestamp = new Date(Date.parse(attack.timestamp) + 30_000).toISOString();
  const alerts = [attack, normal];
  assert.equal((await makeDenyRules(alerts, await decisionsFor(alerts))).rules.length, 0);
});

test('개별 공격 상관분석의 규칙은 실제 경보 3개의 번호를 보존합니다', async () => {
  const alerts = Array.from({ length: 3 }, (_, index) => ({ id: `individual-${index}`,
    timestamp: new Date(Date.parse(fixture.alerts[0].timestamp) + index * 30_000).toISOString(),
    rule: { level: 12, description: '요청 인자에 SQL 구문 표기가 있습니다.' },
    data: { srcip: '192.0.2.201', count: '1', url: '/notes?q=doc-marker' } }));
  const decisions = await decisionsFor(alerts);
  assert.deepEqual(decisions.map(item => item.action), ['alert', 'alert', 'block']);
  const doc = await makeDenyRules(alerts, decisions);
  assert.equal(doc.rules.length, 1);
  assert.deepEqual(doc.rules[0].alertIds, alerts.map(alert => alert.id));
  assert.equal(doc.rules[0].startsAt, new Date(alerts[2].timestamp).toISOString());
});

test('실제 판정기는 웹 거부 규칙을 적용하고 만료 뒤 기존 기기 규칙을 따릅니다', async () => {
  const alert = fixture.alerts[0];
  const doc = await makeDenyRules([alert], await decisionsFor([alert]));
  const request = fixtureRequests().normal;
  const transport = { socket: { remoteAddress: alert.data.srcip } };
  const connected = createZtnaConnection({ rules: async () => doc, clock: () => alert.timestamp });
  const response = await connected(request, transport);
  assert.equal(response.decision, 'deny');
  assert.equal(response.reasonCode, 'starter_not_ready');
  assert.deepEqual(response.ruleIds, [WEB_RULE_ID]);
  assert.deepEqual(Object.keys(response).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.ok(RULE_IDS.includes(WEB_RULE_ID));
  assert.ok(RULE_IDS.includes(RULE_ID));
  const expired = createZtnaConnection({ rules: async () => doc, clock: () => doc.rules[0].expiresAt });
  assert.equal((await expired(request, transport)).decision, 'allow');
  assert.equal((await expired({ ...request, deviceRegistered: false }, transport)).decision, 'deny');
});

test('헤더·본문의 주소를 믿지 않고 동시 요청의 신뢰된 소켓 주소를 분리합니다', async () => {
  const alert = fixture.alerts[0];
  const doc = await makeDenyRules([alert], await decisionsFor([alert]));
  const request = fixtureRequests().normal;
  const connected = createZtnaConnection({ rules: async () => {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
    return doc;
  }, clock: () => alert.timestamp });
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => connected(request, index % 2 === 0
    ? { socket: { remoteAddress: `::ffff:${alert.data.srcip}` } }
    : { socket: { remoteAddress: '192.0.2.202' }, headers: { 'x-forwarded-for': alert.data.srcip }, body: { srcip: alert.data.srcip } })));
  results.forEach((result, index) => assert.equal(result.decision, index % 2 === 0 ? 'deny' : 'allow'));
  assert.equal((await connected(request, { headers: { 'x-forwarded-for': alert.data.srcip } })).decision, 'allow');
});

test('기존 무차별 로그인 규칙의 우선순위와 거부 응답은 유지됩니다', async () => {
  const web = await makeDenyRules(fixture.alerts, await decisionsFor(fixture.alerts));
  const alert = fixture.alerts[0];
  const connected = createZtnaConnection({ rules: async () => [existing, web], clock: () => alert.timestamp });
  const response = await connected(fixtureRequests().normal, { socket: { remoteAddress: alert.data.srcip } });
  assert.equal(response.decision, 'deny');
  assert.deepEqual(response.ruleIds, [RULE_ID]);
  assert.ok(checkSource(alert.data.srcip, alert.timestamp, web));
});

test('웹 규칙의 근거 메타데이터가 없거나 기준 미달이면 적용하지 않습니다', async () => {
  const alert = fixture.alerts[0];
  const doc = await makeDenyRules([alert], await decisionsFor([alert]));
  for (const mutation of [{ confidence: 0.84 }, { attempts: 2 }, { attempts: 1.5 }, { patternIds: [] },
    { patternIds: ['unsupported'] }, { alertIds: [] }, { alertIds: ['unknown'] }]) {
    assert.equal(checkSource(alert.data.srcip, alert.timestamp, { ...doc, rules: [{ ...doc.rules[0], ...mutation }] }), null);
  }
});

test('선택적 웹 규칙 파일이 없거나 깨져도 기존 규칙은 계속 읽습니다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'web-injection-integration-'));
  try {
    const path = join(dir, 'broken.json');
    await writeFile(path, '{');
    const docs = await loadAllDenyRules([new URL('xdr/brute-force/deny-rules.json', root), path, join(dir, 'missing.json')]);
    assert.equal(docs.length, 1);
    assert.deepEqual(docs[0], existing);
  } finally { await removeTestDirectory(dir); }
});

test('실행기 후처리는 두 번 재현해도 정상 요청을 허용하고 로그만 추가합니다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'web-injection-integration-'));
  try {
    await cp(new URL('xdr', root), join(dir, 'xdr'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    for (const file of ['decider.mjs', 'xdr-policy.mjs', 'ztna.mjs']) await cp(new URL(`src/${file}`, root), join(dir, 'src', file));
    await writeFile(join(dir, 'xdr', 'web-injection', 'jev.mjs'), "export async function askJev() { throw new Error('test_unavailable'); }\n");
    const beforeLog = await readFile(join(dir, 'xdr', 'alerts.log'), 'utf8');
    const beforeFixture = await readFile(join(dir, 'xdr', 'fixtures', 'web-injection.json'));
    const beforeExistingRules = await readFile(join(dir, 'xdr', 'brute-force', 'deny-rules.json'));
    const first = await runXdr({ root: dir, moduleKey: 'web-injection' });
    const beforeRules = await readFile(join(dir, 'xdr', 'web-injection', 'deny-rules.json'));
    const second = await runXdr({ root: dir, moduleKey: 'web-injection' });
    assert.deepEqual(first.counts, { block: 8, alert: 9, record: 9 });
    assert.deepEqual(first, second);
    assert.deepEqual(await readFile(join(dir, 'xdr', 'web-injection', 'deny-rules.json')), beforeRules);
    assert.deepEqual(await readFile(join(dir, 'xdr', 'fixtures', 'web-injection.json')), beforeFixture);
    assert.deepEqual(await readFile(join(dir, 'xdr', 'brute-force', 'deny-rules.json')), beforeExistingRules);
    const verification = JSON.parse(await readFile(join(dir, 'xdr', 'web-injection', 'verification.json'), 'utf8'));
    assert.equal(verification.clearAttacksDenied, 8);
    assert.equal(verification.clearWebRulesMatched, 8);
    assert.equal(verification.normalAllowed, 9);
    assert.equal(verification.normalBlocked + verification.normalDenied + verification.ambiguousDenied, 0);
    assert.equal(verification.expiresAfterSeconds, 900);
    assert.equal(verification.withheldBlocks, 0);
    const log = await readFile(join(dir, 'xdr', 'alerts.log'), 'utf8');
    assert.ok(log.startsWith(beforeLog));
    const lines = log.slice(beforeLog.length).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.length, 34);
    for (const line of lines) {
      assert.deepEqual(Object.keys(line), ['timestamp', 'alertId', 'action', 'confidence', 'reason']);
      assert.match(line.alertId, /^wi-/u);
      assert.ok(!line.reason.includes('192.0.2.') && !line.reason.includes('/notes?'));
    }
  } finally { await removeTestDirectory(dir); }
});
