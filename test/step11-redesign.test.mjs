import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createAccessGate } from '../public/access-state.js';
import { runReadChecks } from '../src/submission-read-check.mjs';
import config from '../aleph.config.json' with { type: 'json' };

const approved = { approved: true, state: 'approved' };
const pending = { approved: false, state: 'pending' };
const activeGate = () => { const gate = createAccessGate(); gate.lock('unverified'); return gate; };
test('access state: registration stays pending; only a fresh server approval check opens the room', () => {
  const gate = activeGate();
  const registration = gate.begin('register');
  assert.equal(gate.complete(registration.revision, pending).canRead, false);
  const check = gate.begin('check');
  assert.equal(check.canRead, false);
  assert.equal(gate.complete(check.revision, approved).canRead, true);
  assert.ok(Object.isFrozen(gate.snapshot()));
});
test('access state: logout, account change, offline and errors invalidate late approvals', () => {
  for (const state of ['signed_out', 'unverified', 'offline', 'error']) {
    const gate = activeGate();
    const check = gate.begin('check');
    gate.lock(state);
    assert.equal(gate.complete(check.revision, approved).canRead, false);
    assert.equal(gate.snapshot().state, state);
  }
});
test('access state: superseded checks and approval-looking registration replies cannot open', () => {
  const gate = activeGate();
  const old = gate.begin('check');
  const current = gate.begin('check');
  assert.equal(gate.complete(old.revision, approved).canRead, false);
  assert.equal(gate.complete(current.revision, approved).canRead, true);
  const registration = gate.begin('register');
  assert.equal(gate.complete(registration.revision, approved).canRead, false);
});
test('access state: missing, inconsistent and client badge/status counts never grant approval', () => {
  for (const reply of [null, {}, { approved: 'true', state: 'approved' }, { approved: false, state: 'approved' },
    { approved: true, state: 'pending' }, { installed: true, registeredCount: 1 }]) {
    const gate = activeGate();
    const check = gate.begin('check');
    assert.equal(gate.complete(check.revision, reply).canRead, false);
  }
});
test('access state: revoked replies lock the room; signed-out/offline devices cannot start a check', () => {
  const gate = activeGate();
  const check = gate.begin('check');
  assert.equal(gate.complete(check.revision, { approved: false, state: 'revoked' }).state, 'revoked');
  for (const state of ['signed_out', 'offline']) {
    gate.lock(state);
    assert.throws(() => gate.begin('check'), /unavailable/u);
  }
});

const commit = 'a'.repeat(40);
function deploymentFetch(records, { stale = false, leak = false } = {}) {
  return async (url, options) => {
    records.push({ url: new URL(url), ...options });
    assert.ok(['GET', 'HEAD'].includes(options.method));
    assert.equal(options.cache, 'no-store');
    const path = new URL(url).pathname;
    if (path === '/aleph.json') return Response.json({ ...config, commit: stale ? 'b'.repeat(40) : commit });
    if (path === '/data.json') return Response.json({ notes: [] });
    if (path === '/') return new Response('manifest 기기 승인 · 승인 결과 확인');
    if (path === '/manifest.webmanifest') return Response.json({ start_url: '/', scope: '/', display: 'standalone' });
    if (options.method === 'HEAD') return new Response(null, { status: 200 });
    if (path === '/api/restore') return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    if (new URL(url).search === '?approved=true') return Response.json({ error: 'INVALID_DEVICE_REQUEST' }, { status: 400 });
    if (['/api/device', '/api/device/status'].includes(path)) return Response.json({ approved: false, state: 'signed_out' });
    return Response.json({ error: 'LOGIN_REQUIRED', ...(leak ? { notes: [{ content: 'DO_NOT_EMIT_RESPONSE_BODY' }] } : {}) }, { status: 401 });
  };
}
test('submission reads: observe 17 GET/HEAD requests and leave three authenticated/writing flows unexecuted', async () => {
  const records = [];
  const results = await runReadChecks(config, { expectedCommit: commit, fetcher: deploymentFetch(records) });
  assert.equal(records.length, 17);
  assert.equal(results.length, 20);
  assert.equal(results.filter(r => r.observed.startsWith('not_run')).length, 3);
  assert.deepEqual(results.slice(0, 17).map(r => r.observed),
    [200, 200, 401, 401, 401, 401, 401, 405, 200, 200, 200, 200, 200, 200, 200, 400, 200].map(status => `HTTP ${status}`));
  assert.ok(records.every(r => r.alephEvidence.caseId && r.alephEvidence.requestKey === 'read'));
  assert.ok(!JSON.stringify(results).includes('Bearer'));
});
test('submission reads: offline makes no requests; network exceptions do not become successes', async () => {
  let calls = 0;
  const failing = async () => { calls++; throw new Error('DO_NOT_EMIT_NETWORK_DETAILS'); };
  const offline = await runReadChecks(config, { offline: true, fetcher: failing });
  assert.equal(calls, 0);
  assert.ok(offline.every(r => r.observed.startsWith('not_run')));
  const failed = await runReadChecks(config, { fetcher: failing });
  assert.equal(calls, 17);
  assert.ok(failed.every(r => r.observed.startsWith('not_run')));
  assert.ok(!JSON.stringify(failed).includes('DO_NOT_EMIT'));
});
test('submission reads: stale deployment and data inside denial replies are reported without their bodies', async () => {
  const observations = [];
  const results = await runReadChecks(config, { expectedCommit: commit,
    fetcher: deploymentFetch([], { stale: true, leak: true }), onObservation: row => observations.push(row) });
  assert.equal(results[0].observed, 'HTTP 200');
  assert.equal(results.find(r => r.attackId === 'anonymous_api_note_read').observed, 'HTTP 401');
  assert.equal(observations[0].matchesExpected, false);
  assert.equal(observations.find(r => r.id === 'anonymous_api_note_read').matchesExpected, false);
  assert.ok(!JSON.stringify(results).includes('DO_NOT_EMIT_RESPONSE_BODY'));
});

test('submission evidence uses only HTTP status exposed by a masked response; diagnostics never become response claims', async () => {
  const observations = [];
  const results = await runReadChecks(config, { expectedCommit: commit, onObservation: row => observations.push(row),
    fetcher: async () => new Response('{}', { status: 202 }) });
  assert.equal(results.length, 20);
  assert.ok(results.slice(0, 17).every(row => row.observed === 'HTTP 202'));
  assert.ok(results.slice(17).every(row => row.observed.startsWith('not_run:')));
  assert.doesNotMatch(JSON.stringify(results), /bodyBytes|jsonReady|method=|matchesExpected|checkedAt|responseBytes/u);
  assert.ok(observations.every(row => row.matchesExpected === false));
});
test('submission isolation: no Node imports, local programs, DB, authenticator or timers in the stage 11 path', async () => {
  const records = [];
  const context = createContext({ URL, fetch: deploymentFetch(records) });
  const files = new Map();
  async function load(url) {
    if (files.has(url.href)) return files.get(url.href);
    const source = await readFile(url, 'utf8');
    const module = new SourceTextModule(source, { context, identifier: url.href,
      importModuleDynamically() { throw new Error('dynamic_import_not_allowed'); } });
    files.set(url.href, module);
    await module.link((specifier, parent) => {
      if (specifier !== './submission-read-check.mjs') throw new Error('external_import_not_allowed');
      return load(new URL(specifier, parent.identifier));
    });
    return module;
  }
  const entry = await load(new URL('../src/attack-check.mjs', import.meta.url));
  await entry.evaluate({ timeout: 1000 });
  const result = await entry.namespace.runAttackChecks(config, { expectedCommit: commit });
  assert.equal(result.length, 20);
  assert.equal(records.length, 17);
  assert.equal(files.size, 2);
});
test('access isolation: the approval logic executes without browser, server or imported capabilities', async () => {
  const source = await readFile(new URL('../public/access-state.js', import.meta.url), 'utf8');
  const module = new SourceTextModule(source, { context: createContext({}) });
  await module.link(() => { throw new Error('import_not_allowed'); });
  await module.evaluate({ timeout: 1000 });
  const gate = module.namespace.createAccessGate();
  gate.lock('unverified');
  const attempt = gate.begin('check');
  assert.equal(gate.complete(attempt.revision, approved).canRead, true);
});
test('whole submission isolation: the actual bundle script finishes with git-read-only subprocesses and no server packages', async () => {
  const root = resolve(import.meta.dirname, '..');
  const requests = [];
  const gitReads = [];
  const sourceFiles = new Map();
  const written = new Map();
  const messages = [];
  const allowedSources = new Set(['scripts/bundle.mjs', 'src/decider.mjs', 'src/detect.mjs',
    'src/policy-rule-ids.mjs', 'src/attack-check.mjs', 'src/submission-read-check.mjs']);
  const mockProcess = { env: {}, argv: [], stdout: { write: text => messages.push(text) },
    stderr: { write: text => messages.push(text) } };
  const context = createContext({ URL, fetch: deploymentFetch(requests), process: mockProcess });
  const hostModules = {
    'node:child_process': {
      execFileSync(command, args) {
        assert.equal(command, 'git');
        assert.deepEqual(Array.from(args.slice(0, 2)), ['-C', root]);
        const operation = args.slice(2).join(' ');
        gitReads.push(operation);
        if (operation.startsWith('status ')) return '';
        if (operation.startsWith('rev-parse ')) return commit;
        if (operation.startsWith('config ') || operation === 'remote get-url origin') return config.repoUrl;
        if (operation.startsWith('diff-tree ')) return 'public/access-state.js\nsrc/attack-check.mjs';
        if (operation === 'show HEAD:aleph.config.json') return JSON.stringify(config);
        throw new Error('unapproved_git_operation');
      },
    },
    'node:fs': {
      mkdirSync() {},
      readFileSync(path) {
        assert.equal(path, join(root, 'bundle-notes.json'));
        return JSON.stringify({ explanation: '실제 읽기 관측과 미실행 구분을 위한 격리 모의 시험입니다.', blockedAt: null });
      },
      writeFileSync(path, data) { written.set(path, data); },
    },
    'node:path': { join, resolve },
    'node:url': { pathToFileURL },
  };
  async function load(specifier, parent) {
    if (Object.hasOwn(hostModules, specifier)) {
      if (sourceFiles.has(specifier)) return sourceFiles.get(specifier);
      const values = hostModules[specifier];
      const module = new SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context, identifier: specifier });
      sourceFiles.set(specifier, module);
      await module.link(() => { throw new Error('host_import_not_allowed'); });
      return module;
    }
    if (specifier.startsWith('node:') || (!specifier.startsWith('.') && !specifier.startsWith('file:'))) {
      throw new Error('server_package_not_allowed');
    }
    const url = new URL(specifier, parent);
    const relative = fileURLToPath(url).slice(root.length + 1).replaceAll('\\', '/');
    assert.ok(allowedSources.has(relative), relative);
    if (sourceFiles.has(url.href)) return sourceFiles.get(url.href);
    const source = await readFile(url, 'utf8');
    const module = new SourceTextModule(source, { context, identifier: url.href,
      initializeImportMeta(meta) { meta.url = url.href; meta.dirname = resolve(fileURLToPath(url), '..'); },
      async importModuleDynamically(child, parentModule) {
        const dependency = await load(child, parentModule.identifier);
        if (dependency.status === 'linked') await dependency.evaluate({ timeout: 1000 });
        return dependency;
      } });
    sourceFiles.set(url.href, module);
    await module.link((child, parentModule) => load(child, parentModule.identifier));
    return module;
  }
  const script = await load(pathToFileURL(join(root, 'scripts/bundle.mjs')).href);
  await script.evaluate({ timeout: 3000 });
  assert.notEqual(mockProcess.exitCode, 1, messages.join('\n'));
  const bundle = JSON.parse(written.get(join(root, 'artifacts', 'submission.json')));
  assert.equal(bundle.step, config.step);
  assert.equal(bundle.commit, commit);
  assert.equal(bundle.policyRules.length, 14);
  assert.equal(bundle.attackAttempts.length, 20);
  assert.equal(requests.length, 17);
  assert.ok(gitReads.length > 0);
  assert.ok([...sourceFiles.keys()].every(key => !key.includes('legacy-attack-check') && !key.includes('device-approval')));
});
