import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule } from 'node:vm';
import { test } from 'node:test';
import handler, { operationsSnapshot } from '../src/operations.mjs';
import sharedHandler from '../api/ai.js';
import evidence from '../docs/STEP12_EVIDENCE.json' with { type: 'json' };
import config from '../aleph.config.json' with { type: 'json' };
import { summarize, stagePlan, officialPlan } from '../public/operations-model.js';
import { runReadChecks } from '../src/submission-read-check.mjs';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

test('shared public function handles both Vercel rewrite URL forms and preserves the AI stub', () => {
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  for (const request of [
    { method: 'GET', url: '/api/operations' },
    { method: 'GET', url: '/api/operations?__byteback_route=operations', query: { __byteback_route: 'operations' } },
    { method: 'GET', url: '/api/ai?__byteback_route=operations' },
    { method: 'GET', url: '/api/ai', query: { __byteback_route: 'operations' } },
  ]) {
    sharedHandler(request, response);
    assert.equal(response.code, 200);
    assert.equal(response.body.schema, 'byteback.operations.v1');
    assert.deepEqual(response.body.counts, operationsSnapshot().counts);
  }
  sharedHandler({ method: 'GET', url: '/api/ai' }, response);
  assert.equal(response.code, 501);
  assert.equal(response.body.error, 'AI_PROXY_NOT_IMPLEMENTED');
  sharedHandler({ method: 'POST', url: '/api/operations', body: { approved: true } }, response);
  assert.equal(response.code, 405);
  for (const url of ['/api/operations?approved=true', '/api/ai?__byteback_route=operations&approved=true']) {
    sharedHandler({ method: 'GET', url }, response);
    assert.equal(response.code, 400);
  }
});

test('operations API returns the same measured IDs/times as masked records; unknown engine states stay unknown', () => {
  const snapshot = operationsSnapshot();
  assert.equal(snapshot.step, 12);
  assert.deepEqual(snapshot.probes, evidence.probes);
  assert.deepEqual(snapshot.stageChecks, evidence.stageChecks);
  assert.deepEqual(snapshot.counts.probes, summarize(evidence.probes));
  assert.equal(snapshot.detection.eventCount, null);
  assert.equal(snapshot.revocation.revokedCount, null);
  assert.equal(snapshot.recovery.restoredCount, null);
  assert.equal(snapshot.recovery.copyMatchesBaseline, true);
  assert.equal(snapshot.counts.official.notRun, 41);
  const headers = new Map(); let status; let body;
  const response = { setHeader: (key, value) => headers.set(key, value), status: code => {
    status = code; return { json: value => { body = value; } };
  } };
  handler({ method: 'GET', url: '/api/operations' }, response);
  assert.equal(status, 200);
  assert.deepEqual(body, snapshot);
  assert.equal(headers.get('Cache-Control'), 'no-store');
  handler({ method: 'POST', url: '/api/operations', body: { approved: true } }, response);
  assert.equal(status, 405);
  handler({ method: 'GET', url: '/api/operations?approved=true' }, response);
  assert.equal(status, 400);
});

test('read-only observation stores server IDs/times but neither leaked body nor forged credentials', async () => {
  const observations = [];
  await runReadChecks(config, { expectedCommit: 'a'.repeat(40), onObservation: row => observations.push(row),
    fetcher: async () => new Response(JSON.stringify({ body: 'SYNTHETIC_BODY_DO_NOT_KEEP' }), {
      status: 401, headers: { 'x-vercel-id': 'icn1::test-request' },
    }) });
  assert.equal(observations.length, 17);
  assert.ok(observations.every(row => row.requestId === 'icn1::test-request' && row.checkedAt));
  assert.equal(observations.find(row => row.id === 'anonymous_api_note_read').matchesExpected, false);
  assert.doesNotMatch(JSON.stringify(observations), /SYNTHETIC_|Bearer|authorization/u);
  const offline = [];
  await runReadChecks(config, { offline: true, onObservation: row => offline.push(row),
    fetcher: async () => { throw new Error('must not call'); } });
  assert.equal(summarize(offline).notRun, 17);
  assert.ok(offline.every(row => row.checkedAt === null && row.requestId === null));
});

test('official 41 slots and every normal/forbidden pair start unexecuted; observed mismatch is never success', () => {
  assert.equal(stagePlan().length, 22);
  for (let step = 1; step <= 11; step++) assert.equal(stagePlan().filter(row => row.step === step).length, 2);
  assert.equal(summarize(officialPlan()).matched, 0);
  assert.equal(summarize(officialPlan()).notRun, 41);
  assert.deepEqual(summarize([{ status: 'observed', matchesExpected: false }, { status: 'not_run' }]),
    { total: 2, observed: 1, matched: 0, mismatched: 1, notRun: 1 });
});

test('decider reads only contract request names and returns five fields with listed rule IDs', () => {
  const names = new Set(['schema', 'requestId', 'classId', 'projectId', 'subjectId', 'deviceId',
    'service', 'method', 'path', 'route', 'queryLength', 'querySha256', 'at', 'policyRevision',
    'deviceRegistered', 'stepUp', 'recentEvents', 'signals']);
  for (const request of Object.values(fixtureRequests())) {
    const forbidden = new Proxy(request, { get(target, key) {
      if (!names.has(key)) throw new Error(`forbidden field ${String(key)}`);
      return target[key];
    } });
    const result = decide(forbidden);
    assert.deepEqual(Object.keys(result).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
    assert.equal(result.requestId, request.requestId);
    assert.ok(result.ruleIds.every(id => RULE_IDS.includes(id)));
  }
});

test('actual screen renders server counts and hides stale results on errors/offline', async () => {
  class Element {
    hidden = false; disabled = false; textContent = ''; children = []; listeners = {};
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
  }
  const elements = new Map(); const events = {};
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let failed = false;
  const context = createContext({ document: { getElementById: get, createElement: () => new Element() },
    window: { addEventListener: (event, callback) => { events[event] = callback; } },
    fetch: async () => { if (failed) throw new Error(); return { ok: true, json: async () => operationsSnapshot() }; } });
  const model = new SourceTextModule(await readFile(new URL('../public/operations-model.js', import.meta.url), 'utf8'), { context });
  await model.link(() => { throw new Error(); }); await model.evaluate();
  const screen = new SourceTextModule(await readFile(new URL('../public/operations.js', import.meta.url), 'utf8'), { context });
  await screen.link(() => model); await screen.evaluate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('room').hidden, false);
  assert.equal(get('stages').children.length, 22);
  assert.equal(get('official').children.length, 41);
  assert.match(get('official-count').textContent, /미실행 41/u);
  assert.match(get('probe-count').textContent, new RegExp(`실측 ${evidence.probes.length}`));
  failed = true; await get('refresh').listeners.click();
  assert.equal(get('room').hidden, true);
  assert.match(get('status').textContent, /읽지 못했습니다/u);
  events.offline(); assert.equal(get('room').hidden, true);
});
