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
  assert.throws(() => deploymentIdentity(env, { ...config, step: 4 }));
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
