import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, createContext } from 'node:vm';
import { fixtureRequests } from './fixture-7.mjs';

// A local compatibility check, not the actual judge or a security sandbox.
// The decision receives only the verified request and no host capabilities.
const context = createContext({});
const entry = new URL('../src/decider.mjs', import.meta.url);
const rejectImport = () => { throw new Error('Decision imports are disabled'); };
const control = new SourceTextModule("import 'node:async_hooks';", { context });
await assert.rejects(control.link(rejectImport), /Decision imports are disabled/u);

const loaded = new SourceTextModule(await readFile(entry, 'utf8'), {
  context, identifier: entry.href, importModuleDynamically: rejectImport,
});
await loaded.link(rejectImport);
await loaded.evaluate({ timeout: 1000 });
assert.ok(Array.isArray(loaded.namespace.RULE_IDS));
assert.ok(loaded.namespace.RULE_IDS.includes('device_registered'));
const normal = fixtureRequests().normal;
const results = [];
for (const [name, deviceRegistered] of [
  ['registered', true], ['unregistered', false], ['missing', undefined],
  ['null', null], ['string', 'true'], ['number', 1],
]) {
  const request = { ...normal, deviceRegistered };
  if (name === 'missing') delete request.deviceRegistered;
  const response = await loaded.namespace.decide(request);
  assert.equal(response.schema, 'aleph.decision.v1');
  assert.equal(response.requestId, request.requestId);
  assert.equal(Object.keys(response).sort().join(','), 'decision,reasonCode,requestId,ruleIds,schema');
  assert.equal(response.decision, deviceRegistered === true ? 'allow' : 'deny');
  assert.equal(response.reasonCode, deviceRegistered === true ? 'approved' : 'device_not_registered');
  assert.equal(response.ruleIds.length, 1);
  assert.equal(response.ruleIds[0], 'device_registered');
  results.push({ name, decision: response.decision, reasonCode: response.reasonCode });
}
const { suspicious } = fixtureRequests();
const step7Results = [];
for (const [name, request, expected] of [
  ['compound', suspicious, 'step_up'],
  ['verified_fixture', { ...suspicious, stepUp: { verified: true, authAgeSeconds: 0 } }, 'allow'],
  ['missing_signals', { ...normal, signals: undefined }, 'step_up'],
  ['unavailable', { ...normal, signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 } }, 'allow'],
]) {
  const response = await loaded.namespace.decide(request);
  assert.equal(response.decision, expected);
  assert.equal(response.requestId, request.requestId);
  assert.equal(Object.keys(response).sort().join(','), 'decision,reasonCode,requestId,ruleIds,schema');
  step7Results.push({ name, decision: response.decision, reasonCode: response.reasonCode });
}
process.stdout.write(`${JSON.stringify({ isolatedLoad: 'passed', imports: 0,
  importGuardChecked: true, results, step7Results })}\n`);
