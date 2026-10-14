import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { decide } from '../xdr/exfiltration/decide.mjs';
import { makeDenyRules, TTL_MS, EXFILTRATION_RULE_ID } from '../xdr/exfiltration/respond.mjs';
import { checkDestination, checkSource, loadAllDenyRules, RULE_ID } from '../src/xdr-policy.mjs';
import { createZtnaConnection } from '../src/ztna.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { runXdr } from '../scripts/xdr-run.mjs';

const root = new URL('../',import.meta.url);
const fixture = JSON.parse(await readFile(new URL('xdr/fixtures/exfiltration.json',root),'utf8'));
const decisionsFor = alerts => alerts.map(alert=>({alertId:alert.id,...decide(alert)}));

test('exfiltration rules expire at 15 minutes, match destinations only and never normal/ambiguous activity', () => {
  const doc=makeDenyRules(fixture.alerts,decisionsFor(fixture.alerts));
  assert.equal(doc.rules.length,10);
  for(const rule of doc.rules){
    assert.equal(rule.ruleId,EXFILTRATION_RULE_ID);
    assert.equal(Date.parse(rule.expiresAt)-Date.parse(rule.startsAt),TTL_MS);
    assert.ok(!Object.hasOwn(rule,'sourceIp'));
    const single={...doc,rules:[rule]};
    assert.ok(checkDestination(rule.destinationIp,rule.startsAt,single));
    assert.equal(checkDestination(rule.destinationIp,rule.expiresAt,single),null);
    assert.equal(checkDestination(rule.destinationIp,new Date(Date.parse(rule.startsAt)-1).toISOString(),single),null);
    assert.equal(checkSource(rule.destinationIp,rule.startsAt,single),null);
  }
  for(const alert of fixture.alerts.slice(10)) assert.equal(checkDestination(alert.data.dstip,alert.timestamp,doc),null);
});

test('exfiltration forged judgments, duplicates, invalid IDs/time/destination cannot install rules',()=>{
  const attack=fixture.alerts[0],good=decisionsFor([attack])[0];
  for(const change of [{confidence:.84},{confidence:NaN},{confidence:1.1},{action:'alert'},{reason:'arbitrary'},{alertId:'unknown'}]){
    assert.equal(makeDenyRules([attack],[{...good,...change}]).rules.length,0);
  }
  const normal=fixture.alerts[20];
  assert.equal(makeDenyRules([normal],[{...good,alertId:normal.id}]).rules.length,0);
  assert.equal(makeDenyRules([attack,attack],[good]).rules.length,0);
  assert.equal(makeDenyRules([attack],[good,good]).rules.length,0);
  for(const mutation of [{...attack,id:'unknown'},{...attack,timestamp:'invalid'},{...attack,data:{...attack.data,dstip:'localhost'}}]){
    assert.equal(makeDenyRules([mutation],decisionsFor([mutation])).rules.length,0);
  }
});

test('exfiltration shared destinations with normal/ambiguous traffic withhold block, including mapped IPv6',()=>{
  const attack=fixture.alerts[0];
  for(const candidate of [fixture.alerts[10],fixture.alerts[20]]) for(const delta of [-30000,0,30000]){
    const other=structuredClone(candidate);
    other.data.dstip=`::ffff:${attack.data.dstip}`;
    other.timestamp=new Date(Date.parse(attack.timestamp)+delta).toISOString();
    assert.equal(makeDenyRules([attack,other],decisionsFor([attack,other])).rules.length,0);
  }
});

test('exfiltration only server resolver supplies destinations; inbound source, headers, body and request claims cannot',async()=>{
  const attack=fixture.alerts[0], doc=makeDenyRules([attack],decisionsFor([attack]));
  const normal=fixtureRequests().normal;
  const connect=(resolveDestination,clock=()=>attack.timestamp)=>createZtnaConnection({rules:async()=>doc,clock,resolveDestination});
  const transport={socket:{remoteAddress:attack.data.srcip}};
  const denied=await connect(()=>attack.data.dstip)(normal,transport);
  assert.equal(denied.decision,'deny');
  assert.deepEqual(denied.ruleIds,[EXFILTRATION_RULE_ID]);
  assert.deepEqual(Object.keys(denied).sort(),['schema','requestId','decision','reasonCode','ruleIds'].sort());
  assert.ok(RULE_IDS.includes(EXFILTRATION_RULE_ID));
  const forged={socket:{remoteAddress:attack.data.dstip,localAddress:attack.data.dstip},dstip:attack.data.dstip,
    headers:{'x-destination-ip':attack.data.dstip},body:{dstip:attack.data.dstip}};
  assert.equal((await connect()(normal,forged)).decision,'allow');
  assert.equal((await connect()({...normal,dstip:attack.data.dstip},transport)).decision,'allow');
  assert.equal((await connect(()=>'192.0.2.10')(normal,transport)).decision,'allow');
  assert.equal((await connect(()=>attack.data.dstip,()=>doc.rules[0].expiresAt)(normal,transport)).decision,'allow');
  assert.equal((await connect(()=>'192.0.2.10')({...normal,deviceRegistered:false},transport)).decision,'deny');
  assert.equal((await connect(()=>'192.0.2.10')({...normal,path:'/notes',route:'GET /notes'},transport)).decision,'deny');
  await assert.rejects(connect(()=>{throw new Error('resolver_failed');})(normal,transport),/resolver_failed/u);
});

test('exfiltration rejects altered rule scores, techniques, patterns and lifetime',()=>{
  const attack=fixture.alerts[0],doc=makeDenyRules([attack],decisionsFor([attack]));
  for(const change of [{confidence:.84},{confidence:1.1},{action:'alert'},{technique:'T1041'},{patternIds:[]},
    {patternIds:['unknown']},{patternIds:['toString']},{alertIds:[]},{alertIds:['unknown']},{sourceIp:attack.data.srcip},
    {expiresAt:new Date(Date.parse(attack.timestamp)+TTL_MS+1).toISOString()}]){
    assert.equal(checkDestination(attack.data.dstip,attack.timestamp,{...doc,rules:[{...doc.rules[0],...change}]}),null);
  }
});

test('exfiltration concurrent destination context stays isolated and existing source rules keep priority',async()=>{
  const attack=fixture.alerts[0],doc=makeDenyRules([attack],decisionsFor([attack]));
  const normal=fixtureRequests().normal;
  const resolved=new WeakMap();
  const blocked={},allowed={}; resolved.set(blocked,attack.data.dstip);resolved.set(allowed,'192.0.2.10');
  const connected=createZtnaConnection({rules:async()=>doc,clock:()=>attack.timestamp,resolveDestination:async(_,transport)=>resolved.get(transport)});
  const outcomes=await Promise.all([connected(normal,blocked),connected(normal,allowed)]);
  assert.deepEqual(outcomes.map(out=>out.decision),['deny','allow']);
  const prior=JSON.parse(await readFile(new URL('xdr/brute-force/deny-rules.json',root),'utf8'));
  const previous=createZtnaConnection({rules:async()=>[prior,doc],clock:()=>prior.rules[0].startsAt,resolveDestination:()=>attack.data.dstip});
  assert.deepEqual((await previous(normal,{socket:{remoteAddress:prior.rules[0].sourceIp}})).ruleIds,[RULE_ID]);
  const docs=await loadAllDenyRules([new URL('xdr/exfiltration/missing.json',root),new URL('xdr/brute-force/deny-rules.json',root)]);
  assert.deepEqual(docs,[prior]);
  assert.equal((await loadAllDenyRules()).length,6);
});

test('exfiltration reruns preserve prior modules, inputs and log prefix; 10 attacks denied and 10 normals allowed',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'exfiltration-integration-'));
  try{
    await cp(new URL('xdr',root),join(dir,'xdr'),{recursive:true});
    await mkdir(join(dir,'src'),{recursive:true});
    for(const file of ['decider.mjs','xdr-policy.mjs','ztna.mjs']) await cp(new URL(`src/${file}`,root),join(dir,'src',file));
    const preserved=['fixtures/exfiltration.json',...['brute-force','web-injection','known-cve','persistence','privilege'].flatMap(key=>[`${key}/deny-rules.json`,`${key}/result.json`])];
    const before=await Promise.all(preserved.map(file=>readFile(join(dir,'xdr',file))));
    const beforeLog=await readFile(join(dir,'xdr/alerts.log'),'utf8');
    const first=await runXdr({root:dir,moduleKey:'exfiltration'});
    const firstRules=await readFile(join(dir,'xdr/exfiltration/deny-rules.json'));
    assert.deepEqual(first,await runXdr({root:dir,moduleKey:'exfiltration'}));
    assert.deepEqual(first.counts,{block:10,alert:10,record:10});
    assert.deepEqual(await readFile(join(dir,'xdr/exfiltration/deny-rules.json')),firstRules);
    for(const [i,file] of preserved.entries()) assert.deepEqual(await readFile(join(dir,'xdr',file)),before[i]);
    const v=JSON.parse(await readFile(join(dir,'xdr/exfiltration/verification.json'),'utf8'));
    assert.equal(v.clearAttacksDenied,10);assert.equal(v.clearExfiltrationRulesMatched,10);assert.equal(v.normalAllowed,10);
    assert.equal(v.normalBlocked+v.normalDenied+v.ambiguousDenied,0);assert.equal(v.liveEnforcement,'not_run');
    const log=await readFile(join(dir,'xdr/alerts.log'),'utf8');assert.ok(log.startsWith(beforeLog));
    const lines=log.slice(beforeLog.length).trim().split('\n').map(JSON.parse);assert.equal(lines.length,40);
    for(const line of lines){
      assert.deepEqual(Object.keys(line),['timestamp','alertId','action','confidence','reason']);
      assert.ok(!line.reason.includes('203.0.113.')&&!line.reason.includes('user01'));
    }
  }finally{
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.match(basename(dir),/^exfiltration-integration-/u);
    await rm(dir,{recursive:true,force:true});
  }
});
