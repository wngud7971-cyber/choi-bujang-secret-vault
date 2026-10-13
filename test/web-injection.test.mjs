import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule } from 'node:vm';
import { test } from 'node:test';
import config from '../xdr/web-injection/patterns.mjs';
import { readAlert } from '../xdr/web-injection/read-alerts.mjs';
import { createDecider } from '../xdr/web-injection/decide.mjs';
import { matchPatterns } from '../xdr/web-injection/signals.mjs';
import { askJev, JEV_ENDPOINT } from '../xdr/web-injection/jev.mjs';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('xdr/fixtures/web-injection.json', root), 'utf8'));
const unavailable = () => { throw new Error('test_unavailable'); };
const event = ({ id = 'test-event', url = '/notes?q=ordinary', description = '검색 요청에 주입처럼 보이는 표기가 한 번 있습니다.',
  level = 7, count = '1', timestamp = '2026-10-08T00:00:00Z', srcip = '192.0.2.1' } = {}) => ({
  id, timestamp, rule: { level, description }, data: { srcip, count, url },
});

test('JavaScript 패턴 목록은 JSON 이름·조건·근거와 일치합니다', async () => {
  assert.deepEqual(config, JSON.parse(await readFile(new URL('xdr/web-injection/patterns.json', root), 'utf8')));
});

test('원본과 다섯 항목 경보: block 8·alert 9·record 9, 정상 차단 0', async () => {
  const rawDecide = createDecider({ jev: unavailable });
  const extractedDecide = createDecider({ jev: unavailable });
  const counts = { block: 0, alert: 0, record: 0 };
  for (const [index, alert] of fixture.alerts.entries()) {
    const decision = await rawDecide(alert);
    assert.deepEqual(decision, await extractedDecide(readAlert(alert)));
    assert.deepEqual(Object.keys(decision), ['action', 'confidence', 'reason']);
    assert.ok(!/[\r\n]/u.test(decision.reason));
    if (index < 8) assert.equal(decision.action, 'block');
    else if (index < 17) assert.equal(decision.action, 'alert');
    else assert.equal(decision.action, 'record');
    counts[decision.action] += 1;
  }
  assert.deepEqual(counts, { block: 8, alert: 9, record: 9 });
  assert.deepEqual(rawDecide.getReviewStats(), { reviewsRequested: 9, responsesReceived: 0, fallbackAlerts: 9 });
});

test('명확한 공격과 정상 이벤트는 Jev를 호출하지 않습니다', async () => {
  let calls = 0;
  const decide = createDecider({ jev: () => { calls += 1; return 0.6; } });
  assert.equal((await decide(fixture.alerts[0])).action, 'block');
  assert.equal((await decide(fixture.alerts[17])).action, 'record');
  assert.equal(calls, 0);
  assert.equal((await decide(fixture.alerts[8])).action, 'alert');
  assert.equal(calls, 1);
});

test('애매한 시도는 Jev의 낮은 확률·높은 확률 모두 alert이며 확신도 값은 보존합니다', async () => {
  for (const confidence of [0, 0.4999, 0.5, 0.8499, 0.85, 1]) {
    const decision = await createDecider({ jev: () => confidence })(fixture.alerts[8]);
    assert.equal(decision.confidence, confidence);
    assert.equal(decision.action, 'alert');
  }
});

test('오류·잘못된 확률·시간초과는 confidence 0.5의 alert가 됩니다', async () => {
  for (const jev of [unavailable, () => NaN, () => Infinity, () => '0.9', () => -0.1, () => 1.1,
    () => new Promise(() => {})]) {
    const decision = await createDecider({ jev, timeoutMs: 20 })(fixture.alerts[8]);
    assert.equal(decision.action, 'alert');
    assert.equal(decision.confidence, 0.5);
  }
});

test('요청 인자의 SQL·태그·반복 경로를 찾되 단어·단발·수업 자료는 확정하지 않습니다', async () => {
  for (const url of ['/notes?q=SELECT+title+FROM+notes', '/notes?q=%3CScRiPt%3Edemo%3C%2FScRiPt%3E',
    '/files?path=..%2F..%2Fdocument', '/files/../../document']) {
    const decision = await createDecider({ jev: unavailable })(event({ url, count: '4', level: 12, description: '웹 요청 4건이 반복됐습니다.' }));
    assert.equal(decision.action, 'block');
  }
  for (const url of ['/search?q=select', '/search?q=script', '/files?path=../note', '/search?q=up', '/search?q=one%27quote']) {
    assert.notEqual((await createDecider({ jev: unavailable })(event({ url, count: '4', level: 12, description: '웹 요청 4건' }))).action, 'block');
  }
  assert.equal((await createDecider({ jev: unavailable })(event({ url: '/notes?q=SELECT+title+FROM+notes', level: 12 }))).action, 'alert');
  assert.equal((await createDecider({ jev: unavailable })(event({ url: '/notes?q=%3Cscript%3Edemo%3C/script%3E',
    count: '4', level: 12, description: '스크립트 태그 수업 예시 요청 4건' }))).action, 'alert');
});

test('높은 수준의 연속 명령 구분자 경보는 별도 명령 주입 근거로 차단합니다', async () => {
  assert.deepEqual(matchPatterns(fixture.alerts[5]).matched.map(pattern => pattern.id), ['command-injection']);
  const decision = await createDecider({ jev: unavailable })(fixture.alerts[5]);
  assert.equal(decision.action, 'block');
  assert.equal(decision.reason, '반복된 명령 구분자 주입');
  const changed = structuredClone(fixture.alerts[5]);
  changed.id = 'renamed-command-event';
  changed.data.srcip = '192.0.2.210';
  changed.data.url = '/notes?q=unrelated-document-marker';
  assert.equal((await createDecider({ jev: unavailable })(changed)).action, 'block');
  changed.data.count = '1';
  assert.equal((await createDecider({ jev: unavailable })(changed)).action, 'alert');
  changed.data.count = '11';
  changed.rule.level = 7;
  assert.equal((await createDecider({ jev: unavailable })(changed)).action, 'alert');
});

test('유효 주소·시각·일관된 반복 근거가 없는 경우 확정 차단하지 않습니다', async () => {
  for (const alert of [{ ...fixture.alerts[0], timestamp: 'invalid' },
    { ...fixture.alerts[0], data: { ...fixture.alerts[0].data, srcip: 'invalid' } },
    { ...fixture.alerts[0], data: { ...fixture.alerts[0].data, count: '1' } }]) {
    assert.equal((await createDecider({ jev: unavailable })(alert)).action, 'alert');
  }
  assert.equal((await createDecider({ jev: unavailable })(null)).action, 'record');
});

test('같은 주소의 개별 공격을 3분 안에 모으고 중복·다른 주소·시간창 밖은 제외합니다', async () => {
  const single = options => event({ description: 'SQL 구문 표기가 있습니다.', level: 12, ...options });
  const decide = createDecider({ jev: unavailable });
  const first = single({ id: 'a' });
  assert.equal((await decide(first)).action, 'alert');
  assert.equal((await decide(first)).action, 'alert');
  assert.equal((await decide(single({ id: 'b', srcip: '192.0.2.2' }))).action, 'alert');
  assert.equal((await decide(single({ id: 'c', timestamp: '2026-10-08T00:00:30Z' }))).action, 'alert');
  assert.equal((await decide(single({ id: 'd', timestamp: '2026-10-08T00:01:00Z' }))).action, 'block');
  assert.equal((await decide(single({ id: 'e', timestamp: '2026-10-08T00:05:00Z' }))).action, 'alert');
});

test('집계 경보는 서로 더하지 않고 단순 구분자 반복도 승격하지 않습니다', async () => {
  const decide = createDecider({ jev: unavailable });
  for (let index = 0; index < 4; index += 1) {
    assert.equal((await decide(event({ id: `sum-${index}`, level: 12, count: '2', description: 'SQL 구문 표기가 2번 나왔습니다.' }))).action, 'alert');
    assert.equal((await decide(event({ id: `separator-${index}`, level: 12, description: '명령 구분자 표기가 있습니다.' }))).action, 'alert');
  }
});

test('Jev 요약과 reason에는 주소·계정·비밀값·원문을 넣지 않습니다', async () => {
  let summary;
  const alert = event({ url: '/notes?q=secret-marker-for-test', description: 'SQL 수업 공지 조회 password=secret-marker-for-test' });
  alert.data.srcuser = 'private-account-for-test';
  const decision = await createDecider({ jev: value => { summary = value; return 0.6; } })(alert);
  const exported = JSON.stringify({ summary, reason: decision.reason });
  for (const value of ['secret-marker-for-test', 'private-account-for-test', '192.0.2.1', '/notes?q=', alert.rule.description]) {
    assert.ok(!exported.includes(value));
  }
  assert.equal(summary.tutorialContext, true);
});

test('공식 Jev HTTP 형식과 noul 확률을 사용하고 임의 confidence는 거부합니다', async () => {
  const summary = { patterns: ['sql-injection'], level: 7, attempts: 1,
    sourceIp: '192.0.2.1', password: 'private-test-marker' };
  const options = { apiKey: 'test-only-placeholder', fetchImpl: async (url, init) => {
    assert.equal(url.href, JEV_ENDPOINT);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'jev-latest');
    assert.equal(body.questions.web_injection.type, 'noul');
    assert.ok(!init.body.includes('192.0.2.1'));
    assert.ok(!init.body.includes('private-test-marker'));
    return { ok: true, json: async () => ({ answers: { web_injection: { type: 'noul', noul: 0.72 } } }) };
  } };
  assert.equal(await askJev(summary, options), 0.72);
  await assert.rejects(askJev(summary, { ...options, fetchImpl: async () => ({ ok: true,
    json: async () => ({ confidence: 0.99 }) }) }), /jev_invalid_response/u);
  await assert.rejects(askJev(summary, { apiKey: '' }), /jev_unconfigured/u);
  await assert.rejects(askJev({ patterns: ['unsupported'] }, options), /jev_invalid_summary/u);
});

test('JSON·내장 모듈·npm·네트워크·타이머 없는 격리 실행에서도 정상 동작합니다', async () => {
  const context = createContext({});
  const modules = new Map();
  async function load(url) {
    assert.ok(url.href.startsWith(root.href));
    if (!modules.has(url.href)) modules.set(url.href, new SourceTextModule(await readFile(url, 'utf8'), {
      context, identifier: url.href, initializeImportMeta: meta => { meta.url = url.href; },
      importModuleDynamically: () => { throw new Error('dynamic_import_disabled'); },
    }));
    return modules.get(url.href);
  }
  const entry = await load(new URL('xdr/web-injection/decide.mjs', root));
  await entry.link((specifier, parent) => {
    assert.match(specifier, /^\.\.?\/.*\.mjs$/u);
    return load(new URL(specifier, parent.identifier));
  });
  await entry.evaluate();
  const counts = { block: 0, alert: 0, record: 0 };
  for (const alert of fixture.alerts) counts[(await entry.namespace.decide(alert)).action] += 1;
  assert.deepEqual(counts, { block: 8, alert: 9, record: 9 });
});
