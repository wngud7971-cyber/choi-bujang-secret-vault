import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDecider, matchPatterns } from '../xdr/brute-force/decide.mjs';
import { readAlerts, readAlert } from '../xdr/brute-force/read-alerts.mjs';
import { makeDenyRules, checkSource, withXdr, TTL_MS, RULE_ID } from '../xdr/brute-force/integrate.mjs';
import { runXdr } from '../scripts/xdr-run.mjs';
import { decide as original } from '../src/decider.mjs';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('../xdr/fixtures/brute-force.json', import.meta.url)));
const patterns = JSON.parse(await readFile(new URL('../xdr/brute-force/patterns.json', import.meta.url)));
const unavailable = () => { throw new Error('unavailable'); };
const copy = value => structuredClone(value);

test('읽기 결과는 원본과 같은 28행이며 허용한 다섯 항목만 나옵니다', async () => {
  const before = JSON.stringify(fixture);
  const rows = await readAlerts();
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row), ['timestamp', 'srcip', 'account', 'level', 'description']);
  assert.equal(JSON.stringify(fixture), before);
});

test('원문 경보의 비밀값·계정 개인정보·줄바꿈을 출력하지 않습니다', () => {
  const alert = copy(fixture.alerts[0]);
  alert.data.srcuser = 'private@example.invalid';
  alert.data.password = 'private-value';
  alert.rule.description += ' password="private-value" {"token":"hidden-value"}\nBearer private-token-value';
  const text = JSON.stringify(readAlert(alert));
  for (const value of ['private-value', 'hidden-value', 'private-token-value', 'private@example.invalid']) assert.ok(!text.includes(value));
  assert.ok(!readAlert(alert).description.includes('\n'));
});

test('모든 패턴에 MITRE 한 줄 근거와 실제 사용한 조건이 있습니다', () => {
  assert.equal(patterns.patterns.length, 3);
  for (const pattern of patterns.patterns) {
    assert.match(pattern.evidence, /MITRE ATT&CK T1110/u);
    assert.ok(!pattern.evidence.includes('\n'));
    assert.match(pattern.source, /^https:\/\/attack\.mitre\.org\/techniques\/T1110\//u);
    assert.ok(pattern.conditions.minimumLevel >= 10);
  }
});

test('시험 경보: 명확 10차단·애매 9알림·정상 9기록, Jev는 애매한 것만 받습니다', async () => {
  let calls = 0;
  const decide = createDecider({ jev: summary => {
    calls += 1;
    assert.deepEqual(Object.keys(summary), ['schema', 'pattern', 'level', 'failures', 'accountCount']);
    throw new Error('unavailable');
  } });
  const actions = [];
  for (const alert of fixture.alerts) actions.push((await decide(alert)).action);
  assert.deepEqual(actions, [...Array(10).fill('block'), ...Array(9).fill('alert'), ...Array(9).fill('record')]);
  assert.equal(calls, 9);
});

test('경보 번호·주소가 바뀌어도 행동 근거로 판단합니다', async () => {
  const decide = createDecider({ jev: unavailable });
  for (const input of fixture.alerts) {
    const alert = copy(input);
    alert.id = `renamed-${input.id}`;
    alert.data.srcip = '192.0.2.222';
    assert.equal((await decide(alert)).action, matchPatterns(input).clear ? 'block' : matchPatterns(input).normal ? 'record' : 'alert');
  }
});

test('MITRE 표기나 수준만으로 차단하지 않고 낮은 실패 수·긴 시간은 알림입니다', async () => {
  const decide = createDecider({ jev: unavailable });
  const alert = copy(fixture.alerts[0]);
  alert.data.count = '2';
  assert.equal((await decide(alert)).action, 'alert');
  alert.data.count = '48';
  alert.rule.description = '20분 동안 로그인 실패 48건입니다.';
  assert.equal((await decide(alert)).action, 'alert');
  alert.rule.description = '세션 유지를 확인했습니다.';
  assert.equal((await decide(alert)).action, 'record');
});

test('Jev 오류·범위 밖·형식 오류·시간초과는 alert로 내려갑니다', async () => {
  const alert = fixture.alerts[10];
  for (const jev of [unavailable, () => NaN, () => -1, () => 2, () => '0.9', () => ({ confidence: 0.9 }), () => new Promise(() => {})]) {
    const out = await createDecider({ jev, timeoutMs: 5 })(alert);
    assert.equal(out.action, 'alert');
    assert.equal(out.confidence, 0.5);
  }
});

test('확신도 0.5 경계와 약한 증거의 차단 방지 상한을 지킵니다', async () => {
  for (const [confidence, action, expected] of [[0.49, 'record', 0.49], [0.5, 'alert', 0.5], [0.84, 'alert', 0.84], [0.99, 'alert', 0.84]]) {
    const out = await createDecider({ jev: () => confidence })(fixture.alerts[10]);
    assert.equal(out.action, action);
    assert.equal(out.confidence, expected);
  }
});

const failure = (n, { seconds = n, source = '192.0.2.100', user = 'user99' } = {}) => ({
  id: `single-${n}`, timestamp: new Date(Date.parse('2026-09-27T00:00:00Z') + seconds * 1000).toISOString(),
  rule: { level: 3, description: '로그인 실패 1건입니다.', mitre: ['T1110'] },
  data: { srcip: source, srcuser: user, count: '1' },
});

test('3분 내 같은 주소·계정의 개별 실패 20건을 모아 차단합니다', async () => {
  const decide = createDecider({ jev: unavailable });
  const alerts = Array.from({ length: 20 }, (_, n) => failure(n));
  const decisions = [];
  for (const alert of alerts) decisions.push({ alertId: alert.id, ...await decide(alert) });
  assert.equal(decisions[18].action, 'record');
  assert.equal(decisions[19].action, 'block');
  assert.equal(makeDenyRules(alerts, decisions).rules.length, 1);
});

test('중복·다른 주소·다른 계정·시간창 밖의 실패는 합치지 않습니다', async () => {
  for (const variant of ['duplicate', 'source', 'user', 'outside']) {
    const decide = createDecider({ jev: unavailable });
    for (let n = 0; n < 25; n += 1) {
      const alert = variant === 'duplicate' ? failure(0) : failure(n, {
        source: variant === 'source' ? `192.0.2.${n + 1}` : '192.0.2.100',
        user: variant === 'user' ? `user${n + 1}` : 'user99',
        seconds: variant === 'outside' ? n * 200 : n,
      });
      assert.notEqual((await decide(alert)).action, 'block');
    }
  }
});

test('거부 규칙에는 명확한 근거만 들어가며 만료 후와 정상 주소는 통과합니다', async () => {
  const decide = createDecider({ jev: unavailable });
  const decisions = [];
  for (const alert of fixture.alerts) decisions.push({ alertId: alert.id, ...await decide(alert) });
  const document = makeDenyRules(fixture.alerts, decisions);
  assert.equal(document.rules.length, 10);
  for (const rule of document.rules) {
    assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.startsAt), TTL_MS);
    assert.equal(rule.alertIds.length, 1);
    assert.ok(checkSource(rule.sourceIp, rule.startsAt, document));
    assert.equal(checkSource(rule.sourceIp, rule.expiresAt, { ...document, rules: [rule] }), null);
  }
  for (const alert of fixture.alerts.slice(10)) assert.equal(checkSource(alert.data.srcip, alert.timestamp, document), null);
  const forged = fixture.alerts.slice(10).map(alert => ({ alertId: alert.id, action: 'block', confidence: 1 }));
  assert.equal(makeDenyRules(fixture.alerts, forged).rules.length, 0);
});

test('추가 검사는 정상 요청을 기존 판정기로 넘기고 기존 거부도 보존합니다', async () => {
  const request = { schema: 'aleph.decision.v1', requestId: 'synthetic-request' };
  const document = makeDenyRules([fixture.alerts[0]], [{ alertId: fixture.alerts[0].id, action: 'block', confidence: 0.95 }]);
  const allow = async req => ({ schema: req.schema, requestId: req.requestId, decision: 'allow', reasonCode: 'approved', ruleIds: [] });
  const denyResponse = (req, rule) => ({ schema: req.schema, requestId: req.requestId, decision: 'deny', reasonCode: 'xdr_brute_force', ruleIds: [rule.ruleId] });
  const options = { rules: document, denyResponse, clock: () => fixture.alerts[0].timestamp };
  const blocked = withXdr({ ...options, decide: allow, sourceOf: () => fixture.alerts[0].data.srcip });
  assert.equal((await blocked(request)).decision, 'deny');
  const normal = withXdr({ ...options, decide: allow, sourceOf: () => '192.0.2.60' });
  assert.deepEqual(await normal(request), await allow(request));
  const existing = withXdr({ ...options, sourceOf: () => '192.0.2.60' });
  assert.deepEqual(await existing(request), await original(request));
  const expired = withXdr({ ...options, decide: allow, sourceOf: () => fixture.alerts[0].data.srcip,
    clock: () => document.rules[0].expiresAt });
  assert.equal((await expired(request)).decision, 'allow');
  const invalid = withXdr({ ...options, sourceOf: () => fixture.alerts[0].data.srcip, denyResponse: () => ({ decision: 'allow' }) });
  await assert.rejects(invalid(request), /契約|계약/u);
  assert.equal((await blocked(request)).ruleIds[0], RULE_ID);
});

test('실제 실행기의 처리 후 연결이 result·규칙·안전한 추가 로그를 만듭니다', async () => {
  // Keep a temporary copy: production outputs and fixtures remain untouched by this test.
  const { cp, rm } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'brute-force-'));
  try {
    await cp(new URL('../xdr', import.meta.url), join(dir, 'xdr'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    await cp(new URL('../src/decider.mjs', import.meta.url), join(dir, 'src', 'decider.mjs'));
    const before = await readFile(join(dir, 'xdr', 'fixtures', 'brute-force.json'));
    const first = await runXdr({ root: dir, moduleKey: 'brute-force' });
    const second = await runXdr({ root: dir, moduleKey: 'brute-force' });
    assert.deepEqual(first.counts, { block: 10, alert: 9, record: 9 });
    assert.deepEqual(first, second);
    assert.deepEqual(await readFile(join(dir, 'xdr', 'fixtures', 'brute-force.json')), before);
    const verification = JSON.parse(await readFile(join(dir, 'xdr', 'brute-force', 'verification.json')));
    assert.equal(verification.normalBlocked + verification.normalDenied + verification.ambiguousBlocked, 0);
    const lines = (await readFile(join(dir, 'xdr', 'alerts.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(lines.length >= 38);
    for (const line of lines) assert.deepEqual(Object.keys(line), ['timestamp', 'alertId', 'action', 'confidence', 'reason']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
