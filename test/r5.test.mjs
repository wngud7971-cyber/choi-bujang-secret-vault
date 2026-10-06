import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 1,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
};
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity uses Vercel Git and deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, config), {
    schema: 'aleph.defense.deployment.v1',
    step: 1,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
  assert.equal(deploymentIdentity(env, { ...config, step: 2 }).step, 2);
  assert.ok(!Object.hasOwn(deploymentIdentity(env, { ...config, step: 2 }), 'sampleMarker'));
  assert.equal(deploymentIdentity(env, { ...config, step: 3 }).step, 3);
  assert.ok(!Object.hasOwn(deploymentIdentity(env, { ...config, step: 3 }), 'sampleMarker'));
  assert.equal(deploymentIdentity(env, { ...config, step: 4 }).step, 4);
  assert.ok(!Object.hasOwn(deploymentIdentity(env, { ...config, step: 4 }), 'sampleMarker'));
  assert.throws(() => deploymentIdentity(env, { ...config, step: 5 }));
});

test('first attack check reads public data.json without credentials', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let options;
  try {
    globalThis.fetch = async (url, init) => {
      requestUrl = String(url);
      options = init;
      return new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const [result] = await runAttackChecks(config);
    assert.equal(requestUrl, 'https://student-defense.vercel.app/data.json');
    assert.equal(options.redirect, 'error');
    assert.match(result.observed, /확인 표시가 보임/u);
    globalThis.fetch = async () => new Response('<html>not the data</html>', { status: 200 });
    const [failed] = await runAttackChecks(config);
    assert.match(failed.observed, /보이지 않음/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stage 2 checks static removal, public API weakness and POST rejection without recording bodies', async () => {
  const originalFetch = globalThis.fetch;
  const bodySentinel = 'DO_NOT_INCLUDE_RESPONSE_BODY';
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(init.headers, undefined);
      if (url.pathname === '/data.json') {
        return Response.json({ notes: [] });
      }
      if (init.method === 'POST') return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
      return Response.json({ notes: Array.from({ length: 4 }, (_, i) => ({
        id: String(i), title: bodySentinel, content: bodySentinel,
      })) });
    };
    const checks = await runAttackChecks({ ...config, step: 2 });
    assert.equal(checks.length, 3);
    assert.match(checks[0].observed, /메모 0건/u);
    assert.match(checks[1].observed, /방문자 인증 미구현/u);
    assert.match(checks[2].observed, /HTTP 405/u);
    assert.ok(!JSON.stringify(checks).includes(bodySentinel));
    const cleanFetch = globalThis.fetch;
    for (const markedData of [
      { sampleMarker: config.sampleMarker, notes: [] },
      { notes: [], nested: { marker: config.sampleMarker } },
    ]) {
      globalThis.fetch = async (url, init) => url.pathname === '/data.json'
        ? Response.json(markedData) : cleanFetch(url, init);
      const marked = await runAttackChecks({ ...config, step: 2 });
      assert.match(marked[0].observed, /^불일치/u);
    }
    globalThis.fetch = async () => { throw new Error(bodySentinel); };
    const failures = await runAttackChecks({ ...config, step: 2 });
    assert.ok(failures.every(check => check.observed.startsWith('미확인')));
    assert.ok(!JSON.stringify(failures).includes(bodySentinel));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stage 4 distinguishes deployment mismatch and unexecuted ownership checks from anonymous probe results', async () => {
  const originalFetch = globalThis.fetch;
  const stage4 = { ...config, step: 4, repoUrl: 'https://github.com/student-a/aleph-defense',
    identityProvider: { issuer: 'https://training-project.supabase.co/auth/v1', audience: 'authenticated' } };
  const expectedCommit = 'a'.repeat(40);
  let identity = { schema: 'aleph.defense.deployment.v1', step: 4,
    repoUrl: stage4.repoUrl, commit: expectedCommit };
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ path: url.pathname, method: init.method, body: init.body });
      if (url.pathname === '/data.json') return Response.json({ notes: [] });
      if (url.pathname === '/aleph.json') return Response.json(identity);
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const checks = await runAttackChecks(stage4, { expectedCommit });
    assert.equal(calls.length, 8);
    assert.equal(checks.length, 16);
    const find = id => checks.find(check => check.attackId === id);
    assert.match(find('deployment_stage4_identity').observed, /커밋과 배포 식별 정보 일치/u);
    for (const id of ['valid_account_crud', 'foreign_owner_note_read', 'foreign_owner_note_edit',
      'foreign_owner_note_delete', 'note_owner_change', 'anonymous_direct_data_api']) {
      assert.match(find(id).observed, /미실행/u);
    }
    assert.match(find('anonymous_direct_data_api').observed, /authenticated 역할 직접 접근은 점수에서 제외/u);
    const put = calls.find(call => call.method === 'PUT');
    assert.deepEqual(Object.keys(JSON.parse(put.body)).sort(), ['body', 'title']);
    assert.ok(!JSON.stringify(checks).includes('Synthetic self-check'));
    assert.ok(!JSON.stringify(checks).includes('Bearer '));
    for (const mismatch of [
      { ...identity, step: 3 }, { ...identity, commit: 'b'.repeat(40) },
      { ...identity, repoUrl: 123 },
    ]) {
      identity = mismatch;
      const results = await runAttackChecks(stage4, { expectedCommit });
      assert.match(results.find(check => check.attackId === 'deployment_stage4_identity').observed, /^불일치/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stage 3 records actual anonymous rejection probes separately from unexecuted issuer and account checks', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ path: url.pathname, method: init.method, hasAuthorization: Boolean(init.headers?.Authorization) });
      return url.pathname === '/data.json' ? Response.json({ notes: [] })
        : Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const checks = await runAttackChecks({ ...config, step: 3,
      identityProvider: { issuer: 'https://training-project.supabase.co/auth/v1', audience: 'authenticated' } });
    assert.equal(calls.length, 7);
    assert.equal(checks.length, 10);
    assert.match(checks[0].observed, /HTTP 200/u);
    assert.ok(checks.slice(1, 7).every(check => check.observed.startsWith('HTTP 401')));
    assert.ok(checks.slice(7).every(check => check.observed.includes('미실행')));
    assert.equal(calls.filter(call => call.hasAuthorization).length, 1);
    assert.deepEqual(calls.filter(call => call.path !== '/data.json').map(call => call.method),
      ['GET', 'POST', 'GET', 'PUT', 'DELETE', 'GET']);
    assert.ok(!JSON.stringify(checks).includes('Bearer '));
    assert.ok(!JSON.stringify(checks).includes('Synthetic self-check'));
    globalThis.fetch = async () => { throw new Error('DO_NOT_INCLUDE_RESPONSE_BODY'); };
    const failures = await runAttackChecks({ ...config, step: 3,
      identityProvider: { issuer: 'https://training-project.supabase.co/auth/v1', audience: 'authenticated' } });
    assert.ok(failures.slice(0, 7).every(check => check.observed.startsWith('미확인')));
    assert.ok(!JSON.stringify(failures).includes('DO_NOT_INCLUDE_RESPONSE_BODY'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
