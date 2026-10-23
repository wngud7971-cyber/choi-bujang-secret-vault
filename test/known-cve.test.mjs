import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule } from 'node:vm';
import { test } from 'node:test';
import { decide } from '../xdr/known-cve/decide.mjs';
import { readAlert, readAlerts } from '../xdr/known-cve/read-alerts.mjs';
import { makeFixtureValue } from './fixture-values.mjs';

const fixtureRedactionMarker = makeFixtureValue();

const fixture = JSON.parse(await readFile(new URL('../xdr/fixtures/known-cve.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../xdr/known-cve/decide.mjs', import.meta.url), 'utf8');
const payload = fixture.alerts[0].data.useragent;
const event = data => ({ id: 'synthetic', timestamp: fixture.alerts[0].timestamp,
  rule: { level: 12, description: '원격 조회 요청', mitre: ['T1190'] }, data });

test('원본 24건과 읽은 24줄은 같고 다섯 항목만 출력합니다', async () => {
  const rows = await readAlerts();
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row), ['timestamp', 'srcip', 'account', 'level', 'description']);
  assert.equal(rows[16].account, 'user01');
  assert.ok(!JSON.stringify(rows).includes(payload));
});

test('읽기는 계정을 가명화하고 설명의 비밀값·인코딩·줄바꿈을 가립니다', () => {
  const secret = fixtureRedactionMarker;
  const row = readAlert({ timestamp: fixture.alerts[0].timestamp,
    data: { srcip: '192.0.2.205', srcuser: secret, headers: { authorization: secret } },
    rule: { level: 12, description: `password=${secret}\nBearer ${secret} %74%6f%6b%65%6e%3d${secret}` } });
  assert.match(row.account, /^account-[a-f\d]{12}$/u);
  assert.ok(!JSON.stringify(row).includes(secret));
  assert.ok(!row.description.includes('\n'));
});

test('명확한 8건·애매한 8건·정상 8건으로 나누고 ID를 바꿔도 같습니다', () => {
  const decisions = fixture.alerts.map(decide);
  assert.ok(decisions.slice(0, 8).every(item => item.action === 'block' && item.confidence >= 0.85));
  assert.ok(decisions.slice(8, 16).every(item => item.action === 'alert' && item.confidence >= 0.5 && item.confidence < 0.85));
  assert.ok(decisions.slice(16).every(item => item.action === 'record' && item.confidence < 0.5));
  fixture.alerts.forEach((alert, index) => {
    assert.deepEqual(decide({ ...alert, id: `changed-${index}` }), decisions[index]);
    assert.deepEqual(Object.keys(decisions[index]).sort(), ['action', 'confidence', 'reason']);
    assert.ok(!decisions[index].reason.includes('\n'));
  });
});

test('다른 파일·패키지·인터넷·호스트 기능 없이 한 파일만 격리 실행됩니다', async () => {
  const context = createContext({});
  const module = new SourceTextModule(source, { context,
    importModuleDynamically() { throw new Error('external_access_disabled'); } });
  assert.deepEqual(module.dependencySpecifiers, []);
  assert.ok(!/\bimport\s*(?:\(|[\w{*])/u.test(source));
  await module.link(() => { throw new Error('external_access_disabled'); });
  await module.evaluate({ timeout: 1000 });
  assert.deepEqual(Object.keys(module.namespace), ['decide']);
  const decideIsolated = module.namespace.decide;
  for (const alert of fixture.alerts) {
    context.input = structuredClone(alert);
    const result = decideIsolated(context.input);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), decide(alert));
  }
});

test('파일 상단 패턴 상수는 JSON의 조건·근거·이름과 일치합니다', () => {
  const json = JSON.parse(source.match(/const PATTERNS = (\[[\s\S]*?\n\]);/u)[1]);
  return readFile(new URL('../xdr/known-cve/patterns.json', import.meta.url), 'utf8').then(text => {
    assert.deepEqual(json, JSON.parse(text));
    for (const pattern of json) {
      assert.ok(pattern.name && pattern.condition && pattern.evidence && !pattern.evidence.includes('\n'));
      assert.ok(pattern.sources.every(url => url.startsWith('https://')));
    }
  });
});

test('머리글·인자·URL의 완전한 조회와 제한된 인코딩만 차단 근거가 됩니다', () => {
  for (const data of [{ useragent: payload }, { headers: { 'User-Agent': payload } },
    { params: { search: payload } }, { url: `/search?q=${encodeURIComponent(payload)}` },
    { query: encodeURIComponent(encodeURIComponent(payload)) }, { useragent: payload.toUpperCase() }]) {
    assert.equal(decide(event(data)).action, 'block');
  }
  assert.equal(decide({ ...event({ url: '/health' }), rule: { level: 16, description: payload, mitre: ['T1190'] } }).action, 'alert');
  assert.equal(decide({ ...event({ url: '/health' }), rule: { level: 16, description: '검사', mitre: ['T1190'] } }).action, 'record');
});

test('잘린 조회·점검 도구·교육 인용은 알림만 남기고 정상 요청은 기록합니다', () => {
  const fragment = payload.slice(0, -1);
  for (const data of [{ url: `/search?q=${fragment}` }, { useragent: 'CVE-2021-44228_scanner' },
    { useragent: 'Invoke-Log4ShellScan' }, { url: '/search?q=CVE-2021-44228' }]) {
    assert.equal(decide(event(data)).action, 'alert');
  }
  assert.equal(decide({ ...event({ useragent: payload }), rule: { level: 12, description: '수업 예제의 조회 문자열' } }).action, 'alert');
  const normal = { ...event({ url: '/api/notes/demo' }), rule: { level: 3, description: '정상 조회', mitre: [] } };
  assert.equal(decide(normal).action, 'record');
});

test('잘못된 경보·순환 구조를 안전하게 처리하고 입력·호출 이력을 보존하지 않습니다', () => {
  for (const input of [null, undefined, {}, 42, { data: { headers: null } }]) assert.equal(decide(input).action, 'record');
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(decide({ data: { params: cyclic } }).action, 'record');
  const alert = structuredClone(fixture.alerts[0]);
  const before = JSON.stringify(alert);
  const first = decide(alert);
  for (const other of fixture.alerts) decide(other);
  assert.deepEqual(decide(alert), first);
  assert.equal(JSON.stringify(alert), before);
});
