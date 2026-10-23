import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule } from 'node:vm';
import { test } from 'node:test';
import { decide } from '../xdr/privilege/decide.mjs';
import { readAlert, readAlerts } from '../xdr/privilege/read-alerts.mjs';
import { makeFixtureValue } from './fixture-values.mjs';

const fixtureRedactionMarker = makeFixtureValue();

const fixture = JSON.parse(await readFile(new URL('../xdr/fixtures/privilege.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../xdr/privilege/decide.mjs', import.meta.url), 'utf8');

test('privilege reader preserves 26 rows, redacts credentials and emits only five fields', async () => {
  const rows = await readAlerts();
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row), ['timestamp', 'srcip', 'account', 'level', 'description']);
  const secret = fixtureRedactionMarker;
  const row = readAlert({ data: { srcuser: secret }, rule: { description: `password=${secret}\nBearer ${secret} %74%6f%6b%65%6e%3d${secret}` } });
  assert.match(row.account, /^account-[a-f\d]{12}$/u);
  assert.ok(!JSON.stringify(row).includes(secret) && !row.description.includes('\n'));
});

test('privilege classifies evidence, independently of IDs, order, severity and prior calls', () => {
  const expected = [...Array(9).fill('block'), ...Array(8).fill('alert'), ...Array(9).fill('record')];
  fixture.alerts.forEach((alert, i) => {
    const before = JSON.stringify(alert);
    const result = decide({ ...alert, id: `unrelated-${i}`, rule: { ...alert.rule, level: 16 } });
    assert.equal(result.action, expected[i], alert.id);
    assert.deepEqual(Object.keys(result).sort(), ['action', 'confidence', 'reason']);
    assert.equal(result.action, result.confidence >= 0.85 ? 'block' : result.confidence >= 0.5 ? 'alert' : 'record');
    assert.ok(!result.reason.includes('\n') && !result.reason.includes(alert.data.srcip));
    for (const other of [...fixture.alerts].reverse()) decide(other);
    assert.deepEqual(decide(alert), result);
    assert.equal(JSON.stringify(alert), before);
  });
});

test('privilege judge loads only decide in an empty offline sandbox', async () => {
  const module = new SourceTextModule(source, { context: createContext({}), importModuleDynamically() { throw new Error('external_access_disabled'); } });
  assert.deepEqual(module.dependencySpecifiers, []);
  assert.ok(!/\bimport\s*(?:\(|[\w{*])/u.test(source));
  await module.link(() => { throw new Error('external_access_disabled'); });
  await module.evaluate({ timeout: 1000 });
  assert.deepEqual(Object.keys(module.namespace), ['decide']);
  for (const alert of fixture.alerts) assert.deepEqual(JSON.parse(JSON.stringify(module.namespace.decide(alert))), decide(alert));
});

test('privilege patterns have one-line evidence and identical inline constants', async () => {
  const inline = JSON.parse(source.match(/const PATTERNS = (\[[\s\S]*?\n\]);/u)[1]);
  assert.deepEqual(inline, JSON.parse(await readFile(new URL('../xdr/privilege/patterns.json', import.meta.url), 'utf8')));
  for (const p of inline) assert.ok(p.name && p.condition && p.evidence && !p.evidence.includes('\n') && p.sources.length);
});

test('privilege single signals, failures, approval, missing evidence and invalid counts never block', () => {
  for (const input of [null, undefined, {}, 42, { rule: { level: 16, mitre: ['T1068', 'T1078'] } }]) assert.equal(decide(input).action, 'record');
  const describe = (description, data = {}) => decide({ rule: { level: 16, description }, data });
  for (const description of ['관리자 그룹에 추가됐습니다.', '처음 보는 관리자 명령입니다.', '수업 시간 밖 권한 상승 창이 떴습니다.',
    '처음 보는 주소에서 수업 시간 밖 관리자 명령을 실행했지만 실패했습니다.',
    '다른 계정의 권한으로 관리자 명령을 실행했습니다. 승인된 관리 작업입니다.',
    '수업 예제: 방금 관리자가 된 계정이 관리자 명령을 실행했습니다.',
    '관리자 그룹에 추가됐습니다. 원격 주소입니다. 추가는 없습니다.']) {
    assert.equal(describe(description, { group: 'administrators' }).action, 'alert', description);
  }
  for (const count of ['invalid', '', '-1', 'Infinity', '3.5', '2', null]) {
    assert.equal(decide({ ...fixture.alerts[4], data: { ...fixture.alerts[4].data, count } }).action, 'alert');
  }
  const after = structuredClone(fixture.alerts[8]);
  after.data.count = '1';
  assert.equal(decide(after).action, 'alert');
  assert.equal(describe('평소 주소에서 관리자 계정이 로그인했습니다.').action, 'record');
  assert.equal(describe('그룹 소속을 읽기만 했습니다.').action, 'record');
});

test('privilege reasons never echo account, command, arbitrary description or credentials', () => {
  const secret = fixtureRedactionMarker;
  const alert = structuredClone(fixture.alerts[0]);
  alert.rule.description += ` password=${secret}\n`;
  alert.data.srcuser = secret;
  assert.equal(decide(alert).action, 'block');
  assert.ok(!JSON.stringify(decide(alert)).includes(secret));
});
