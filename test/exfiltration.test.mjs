import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule } from 'node:vm';
import { test } from 'node:test';
import { decide } from '../xdr/exfiltration/decide.mjs';
import { readAlert, readAlerts } from '../xdr/exfiltration/read-alerts.mjs';

const fixture = JSON.parse(await readFile(new URL('../xdr/fixtures/exfiltration.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../xdr/exfiltration/decide.mjs', import.meta.url), 'utf8');

test('exfiltration reader returns 30 five-field rows and redacts secret/account values', async () => {
  const rows = await readAlerts();
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row), ['timestamp','srcip','account','level','description']);
  const secret = 'fixture_sensitive_value';
  const row = readAlert({data:{srcuser:secret},rule:{description:`password=${secret}\nBearer ${secret} %74%6f%6b%65%6e%3d${secret}`}});
  assert.ok(!JSON.stringify(row).includes(secret));
  assert.match(row.account, /^account-[a-f\d]{12}$/u);
});

test('exfiltration uses evidence, independent of IDs, severity, order and prior calls', () => {
  const expected = [...Array(10).fill('block'), ...Array(10).fill('alert'), ...Array(10).fill('record')];
  fixture.alerts.forEach((alert,i) => {
    const before = JSON.stringify(alert);
    const result = decide({...alert,id:`unrelated-${i}`,rule:{...alert.rule,level:16,mitre:[]}});
    assert.equal(result.action, expected[i], alert.id);
    assert.deepEqual(Object.keys(result).sort(), ['action','confidence','reason']);
    assert.equal(result.action,result.confidence>=.85?'block':result.confidence>=.5?'alert':'record');
    for (const other of [...fixture.alerts].reverse()) decide(other);
    assert.deepEqual(decide(alert),result);
    assert.equal(JSON.stringify(alert),before);
  });
});

test('exfiltration exports only decide in a single-file offline empty sandbox', async () => {
  const module = new SourceTextModule(source,{context:createContext({}),importModuleDynamically(){throw new Error('external_access_disabled');}});
  assert.deepEqual(module.dependencySpecifiers,[]);
  assert.ok(!/\bimport\s*(?:\(|[\w{*])/u.test(source));
  await module.link(()=>{throw new Error('external_access_disabled');});
  await module.evaluate({timeout:1000});
  assert.deepEqual(Object.keys(module.namespace),['decide']);
  for (const alert of fixture.alerts) assert.deepEqual(JSON.parse(JSON.stringify(module.namespace.decide(alert))),decide(alert));
});

test('exfiltration inline patterns match documented one-line MITRE evidence', async () => {
  const inline = JSON.parse(source.match(/const PATTERNS = (\[[\s\S]*?\n\]);/u)[1]);
  assert.deepEqual(inline,JSON.parse(await readFile(new URL('../xdr/exfiltration/patterns.json',import.meta.url),'utf8')));
  for(const pattern of inline) assert.ok(pattern.name&&pattern.condition&&pattern.evidence&&!pattern.evidence.includes('\n')&&pattern.sources.length);
});

test('exfiltration single signals, malformed quantities, missing destinations and approved/failed work never block', () => {
  for (const input of [null,undefined,{},42,{rule:{level:16,mitre:['T1041','T1048']}}]) assert.equal(decide(input).action,'record');
  const attack = fixture.alerts[0];
  for (const bytes of [null,'','invalid','-1','Infinity','12.5','49999999',Number.MAX_SAFE_INTEGER+1]) {
    assert.notEqual(decide({...attack,data:{...attack.data,bytes}}).action,'block');
  }
  for (const files of [null,'invalid','3.5','99']) assert.notEqual(decide({...attack,data:{...attack.data,files}}).action,'block');
  for (const count of [null,'','invalid','4','5.5']) assert.notEqual(decide({...fixture.alerts[8],data:{...fixture.alerts[8].data,count}}).action,'block');
  assert.notEqual(decide({...attack,data:{...attack.data,dstip:undefined}}).action,'block');
  for (const suffix of ['실패했습니다.','취소됐습니다.','외부 전송은 없습니다.','승인된 백업입니다.','수업 예제입니다.']) {
    assert.notEqual(decide({...attack,rule:{...attack.rule,description:attack.rule.description+' '+suffix}}).action,'block');
  }
  assert.notEqual(decide({...attack,rule:{description:'처음 보는 목적지입니다.'}}).action,'block');
  assert.equal(decide({...attack,rule:{description:'승인된 자료실 백업이 끝났습니다.'}}).action,'record');
});

test('exfiltration reasons never echo secrets, destination or arbitrary text', () => {
  const alert = structuredClone(fixture.alerts[0]);
  const secret = 'fixture_sensitive_value';
  alert.rule.description += ` password=${secret}\n`;
  alert.data.srcuser = secret;
  const result = decide(alert);
  assert.equal(result.action,'block');
  assert.ok(!JSON.stringify(result).includes(secret)&&!result.reason.includes(alert.data.dstip)&&!result.reason.includes('\n'));
});
