import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule } from 'node:vm';
import { test } from 'node:test';
import { decide } from '../xdr/persistence/decide.mjs';
import { readAlert, readAlerts } from '../xdr/persistence/read-alerts.mjs';

const fixture = JSON.parse(await readFile(new URL('../xdr/fixtures/persistence.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../xdr/persistence/decide.mjs', import.meta.url), 'utf8');

test('persistence reader: 24 original alerts become 24 redacted five-field rows', async () => {
  const rows = await readAlerts();
  assert.equal(rows.length, 24);
  for (const row of rows) assert.deepEqual(Object.keys(row), ['timestamp', 'srcip', 'account', 'level', 'description']);
  const secret = 'fixture_sensitive_value';
  const row = readAlert({ timestamp: fixture.alerts[0].timestamp, data: { srcip: '192.0.2.205', srcuser: secret },
    rule: { level: 12, description: `password=${secret}\nBearer ${secret} %74%6f%6b%65%6e%3d${secret}` } });
  assert.match(row.account, /^account-[a-f\d]{12}$/u);
  assert.ok(!JSON.stringify(row).includes(secret));
  assert.ok(!row.description.includes('\n'));
});

test('persistence: clear, ambiguous and ordinary groups are independent of ID, order and state', () => {
  const expected = [...Array(8).fill('block'), ...Array(8).fill('alert'), ...Array(8).fill('record')];
  fixture.alerts.forEach((alert, i) => {
    const before = JSON.stringify(alert);
    const result = decide({ ...alert, id: `unrelated-${i}` });
    assert.equal(result.action, expected[i]);
    assert.deepEqual(Object.keys(result).sort(), ['action', 'confidence', 'reason']);
    assert.equal(result.action, result.confidence >= 0.85 ? 'block' : result.confidence >= 0.5 ? 'alert' : 'record');
    assert.ok(!result.reason.includes('\n') && !result.reason.includes(alert.data.srcip));
    for (const other of [...fixture.alerts].reverse()) decide(other);
    assert.deepEqual(decide(alert), result);
    assert.equal(JSON.stringify(alert), before);
  });
});

test('persistence: one file works without imports, host APIs, packages or internet', async () => {
  const context = createContext({});
  const module = new SourceTextModule(source, { context,
    importModuleDynamically() { throw new Error('external_access_disabled'); } });
  assert.deepEqual(module.dependencySpecifiers, []);
  assert.ok(!/\bimport\s*(?:\(|[\w{*])/u.test(source));
  await module.link(() => { throw new Error('external_access_disabled'); });
  await module.evaluate({ timeout: 1000 });
  assert.deepEqual(Object.keys(module.namespace), ['decide']);
  for (const alert of fixture.alerts) assert.deepEqual(JSON.parse(JSON.stringify(module.namespace.decide(alert))), decide(alert));
});

test('persistence: top-level patterns match JSON and each has one line of evidence', async () => {
  const patterns = JSON.parse(source.match(/const PATTERNS = (\[[\s\S]*?\n\]);/u)[1]);
  assert.deepEqual(patterns, JSON.parse(await readFile(new URL('../xdr/persistence/patterns.json', import.meta.url), 'utf8')));
  for (const p of patterns) assert.ok(p.name && p.condition && p.evidence && !p.evidence.includes('\n') && p.sources.length > 0);
});

test('persistence: severity and technique alone never block; missing or ordinary evidence is protected', () => {
  for (const input of [null, undefined, {}, 42, { rule: { level: 16, mitre: ['T1543','T1053'] } }]) {
    assert.equal(decide(input).action, 'record');
  }
  const attack = structuredClone(fixture.alerts[0]);
  assert.equal(decide({ ...attack, data: { ...attack.data, path: 'C:\\lab\\tool.exe' } }).action, 'alert');
  assert.equal(decide({ ...attack, rule: { ...attack.rule, description: '새 서비스가 임시 폴더에 있습니다. 서명은 아직 모릅니다.' } }).action, 'alert');
  assert.equal(decide({ ...attack, rule: { ...attack.rule, description: '서명 없는 파일입니다. 서비스 등록은 없습니다.' } }).action, 'alert');
  assert.equal(decide({ ...attack, rule: { ...attack.rule, description: '수업 예제: ' + attack.rule.description } }).action, 'alert');
  const signed = { ...attack, rule: { ...attack.rule, description: '처음 보는 서명된 서비스가 새로 등록됐습니다.' } };
  assert.equal(decide(signed).action, 'alert');
  const startup = structuredClone(fixture.alerts[2]);
  startup.data.path = 'C:\\lab\\tool.exe';
  assert.equal(decide(startup).action, 'alert');
  const repeat = structuredClone(fixture.alerts[3]);
  repeat.data.count = '1';
  assert.equal(decide(repeat).action, 'alert');
  for (const alert of fixture.alerts.slice(16)) assert.equal(decide({ ...alert, rule: { ...alert.rule, level: 16 } }).action, 'record');
});
