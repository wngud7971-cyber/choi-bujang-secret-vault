import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { decide } from '../xdr/persistence/decide.mjs';
import { makeDenyRules, TTL_MS, PERSISTENCE_RULE_ID } from '../xdr/persistence/respond.mjs';
import { checkSource, loadAllDenyRules, RULE_ID } from '../src/xdr-policy.mjs';
import { createZtnaConnection } from '../src/ztna.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { runXdr } from '../scripts/xdr-run.mjs';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('xdr/fixtures/persistence.json', root), 'utf8'));
const decisionsFor = alerts => alerts.map(alert => ({ alertId: alert.id, ...decide(alert) }));

test('persistence deny rules require evidence, expire at 15 minutes and never match normal/ambiguous sources', () => {
  const doc = makeDenyRules(fixture.alerts, decisionsFor(fixture.alerts));
  assert.equal(doc.rules.length, 8);
  for (const rule of doc.rules) {
    assert.equal(rule.ruleId, PERSISTENCE_RULE_ID);
    assert.equal(Date.parse(rule.expiresAt) - Date.parse(rule.startsAt), TTL_MS);
    assert.ok(['T1543','T1053','T1547.001'].includes(rule.technique));
    assert.equal(rule.alertIds.length, 1);
    assert.equal(rule.patternIds.length, 1);
    const single = { ...doc, rules: [rule] };
    assert.ok(checkSource(rule.sourceIp, rule.startsAt, single));
    assert.equal(checkSource(rule.sourceIp, rule.expiresAt, single), null);
    assert.equal(checkSource(rule.sourceIp, new Date(Date.parse(rule.startsAt)-1).toISOString(), single), null);
  }
  for (const alert of fixture.alerts.slice(8)) assert.equal(checkSource(alert.data.srcip, alert.timestamp, doc), null);
});

test('persistence: forged decisions, duplicates, bad IDs, bad time/address cannot install a deny', () => {
  const attack = fixture.alerts[0];
  const good = decisionsFor([attack])[0];
  for (const mutation of [{ confidence: 0.84 }, { confidence: NaN }, { confidence: 1.1 },
    { action: 'alert' }, { reason: 'arbitrary' }, { alertId: 'unknown' }]) {
    assert.equal(makeDenyRules([attack], [{ ...good, ...mutation }]).rules.length, 0);
  }
  const normal = fixture.alerts[16];
  assert.equal(makeDenyRules([normal], [{ alertId: normal.id, action: 'block', confidence: 0.95, reason: good.reason }]).rules.length, 0);
  assert.equal(makeDenyRules([attack, attack], [good]).rules.length, 0);
  assert.equal(makeDenyRules([attack], [good, good]).rules.length, 0);
  for (const mutation of [{ ...attack, id: 'unknown' }, { ...attack, timestamp: 'invalid' },
    { ...attack, data: { ...attack.data, srcip: 'localhost' } }]) {
    assert.equal(makeDenyRules([mutation], decisionsFor([mutation])).rules.length, 0);
  }
});

test('persistence: shared normal/ambiguous IPv4 and mapped IPv6 sources withhold a blanket deny', () => {
  const attack = fixture.alerts[0];
  for (const candidate of [fixture.alerts[8], fixture.alerts[16]]) {
    for (const delta of [-30_000, 0, 30_000]) {
      const other = structuredClone(candidate);
      other.data.srcip = `::ffff:${attack.data.srcip}`;
      other.timestamp = new Date(Date.parse(attack.timestamp) + delta).toISOString();
      assert.equal(makeDenyRules([attack, other], decisionsFor([attack, other])).rules.length, 0);
    }
  }
});

test('persistence: transport source isolation preserves base rules, ignores client claims and expires', async () => {
  const attack = fixture.alerts[0];
  const doc = makeDenyRules([attack], decisionsFor([attack]));
  const normal = fixtureRequests().normal;
  const connected = createZtnaConnection({ rules: async () => doc, clock: () => attack.timestamp });
  const denied = await connected(normal, { socket: { remoteAddress: attack.data.srcip } });
  assert.deepEqual(denied.ruleIds, [PERSISTENCE_RULE_ID]);
  assert.equal(denied.decision, 'deny');
  assert.ok(RULE_IDS.includes(PERSISTENCE_RULE_ID));
  const allowed = await connected(normal, { socket: { remoteAddress: '192.0.2.205' },
    headers: { 'x-forwarded-for': attack.data.srcip }, body: { srcip: attack.data.srcip } });
  assert.equal(allowed.decision, 'allow');
  const expired = createZtnaConnection({ rules: async () => doc, clock: () => doc.rules[0].expiresAt });
  assert.equal((await expired(normal, { socket: { remoteAddress: attack.data.srcip } })).decision, 'allow');
  assert.equal((await expired({ ...normal, deviceRegistered: false }, { socket: { remoteAddress: attack.data.srcip } })).decision, 'deny');
});

test('persistence: invalid technique/pattern, out-of-range score and bad lifetime are rejected', () => {
  const attack = fixture.alerts[0];
  const doc = makeDenyRules([attack], decisionsFor([attack]));
  for (const mutation of [{ confidence: 0.84 }, { confidence: 1.1 }, { action: 'alert' },
    { technique: 'T1053' }, { patternIds: [] }, { patternIds: ['unknown'] }, { patternIds: ['toString'] },
    { alertIds: [] }, { alertIds: ['unknown'] }, { expiresAt: new Date(Date.parse(attack.timestamp) + TTL_MS + 1).toISOString() }]) {
    assert.equal(checkSource(attack.data.srcip, attack.timestamp, { ...doc, rules: [{ ...doc.rules[0], ...mutation }] }), null);
  }
});

test('persistence: previous modules keep priority and optional document failure leaves existing rules intact', async () => {
  const existing = JSON.parse(await readFile(new URL('xdr/brute-force/deny-rules.json', root), 'utf8'));
  const attack = { ...fixture.alerts[0], data: { ...fixture.alerts[0].data, srcip: existing.rules[0].sourceIp }, timestamp: existing.rules[0].startsAt };
  const doc = makeDenyRules([attack], decisionsFor([attack]));
  const connected = createZtnaConnection({ rules: async () => [existing, doc], clock: () => attack.timestamp });
  assert.deepEqual((await connected(fixtureRequests().normal, { socket: { remoteAddress: attack.data.srcip } })).ruleIds, [RULE_ID]);
  const docs = await loadAllDenyRules([new URL('xdr/brute-force/deny-rules.json', root), new URL('xdr/persistence/missing.json', root)]);
  assert.deepEqual(docs, [existing]);
  assert.equal((await loadAllDenyRules()).length, 4);
});

test('persistence: rerun is deterministic, preserves inputs and previous rules, appends redacted alerts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'persistence-integration-'));
  try {
    await cp(new URL('xdr', root), join(dir, 'xdr'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    for (const file of ['decider.mjs', 'xdr-policy.mjs', 'ztna.mjs']) await cp(new URL(`src/${file}`, root), join(dir, 'src', file));
    const preserved = ['fixtures/persistence.json', 'brute-force/deny-rules.json', 'web-injection/deny-rules.json', 'known-cve/deny-rules.json'];
    const before = await Promise.all(preserved.map(file => readFile(join(dir, 'xdr', file))));
    const beforeLog = await readFile(join(dir, 'xdr', 'alerts.log'), 'utf8');
    const first = await runXdr({ root: dir, moduleKey: 'persistence' });
    const firstRules = await readFile(join(dir, 'xdr/persistence/deny-rules.json'));
    const second = await runXdr({ root: dir, moduleKey: 'persistence' });
    assert.deepEqual(first.counts, { block: 8, alert: 8, record: 8 });
    assert.deepEqual(first, second);
    assert.deepEqual(await readFile(join(dir, 'xdr/persistence/deny-rules.json')), firstRules);
    for (const [i, file] of preserved.entries()) assert.deepEqual(await readFile(join(dir, 'xdr', file)), before[i]);
    const verification = JSON.parse(await readFile(join(dir, 'xdr/persistence/verification.json'), 'utf8'));
    assert.equal(verification.clearAttacksDenied, 8);
    assert.equal(verification.clearPersistenceRulesMatched, 8);
    assert.equal(verification.normalAllowed, 8);
    assert.equal(verification.normalBlocked + verification.normalDenied + verification.ambiguousDenied, 0);
    assert.equal(verification.expiresAfterSeconds, 900);
    assert.equal(verification.liveEnforcement, 'not_run');
    const log = await readFile(join(dir, 'xdr/alerts.log'), 'utf8');
    assert.ok(log.startsWith(beforeLog));
    const lines = log.slice(beforeLog.length).trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 32);
    for (const line of lines) {
      assert.deepEqual(Object.keys(line), ['timestamp', 'alertId', 'action', 'confidence', 'reason']);
      assert.match(line.alertId, /^ps-/u);
      assert.ok(!line.reason.includes('C:\\') && !line.reason.includes('203.0.113.') && !line.reason.includes('user01'));
    }
  } finally {
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.match(basename(target), /^persistence-integration-/u);
    await rm(target, { recursive: true, force: true });
  }
});
