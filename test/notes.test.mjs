import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import handler from '../api/notes.js';

function responseRecorder() {
  return {
    headers: new Map(), statusCode: null, body: null,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('stage 3 authenticates before querying notes and keeps server secrets private', async t => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  const oldConsole = { log: console.log, warn: console.warn, error: console.error };
  const logs = [];
  const testKey = 'TEST_ONLY_SERVER_KEY';
  const student = await generateKeyPair('ES256');
  const judge = await generateKeyPair('ES256');
  const attacker = await generateKeyPair('ES256');
  const studentJwk = { ...await exportJWK(student.publicKey), kid: 'student-test-key', alg: 'ES256' };
  const judgeJwk = { ...await exportJWK(judge.publicKey), kid: 'judge-test-key', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const userId = '11111111-1111-4111-8111-111111111111';
  const studentClaims = {
    iss: config.identityProvider.issuer, aud: config.identityProvider.audience,
    sub: userId, role: 'authenticated', iat: now, exp: now + 300,
  };
  const studentToken = (claims = {}, key = student.privateKey) =>
    new SignJWT({ ...studentClaims, ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: studentJwk.kid }).sign(key);
  const validToken = await studentToken();
  const validJudgeToken = await new SignJWT({
    iss: config.judgeIssuer, aud: new URL(config.publicAppUrl).hostname,
    sub: userId, iat: now, exp: now + 300,
    aleph_role: 'judge', aleph_identity: 'a',
    aleph_run: '22222222-2222-4222-8222-222222222222',
  }).setProtectedHeader({ alg: 'ES256', kid: judgeJwk.kid }).sign(judge.privateKey);
  let databaseCalls = 0;
  let databaseResponse;
  const fakeFetch = async (value, options) => {
    const url = new URL(value instanceof Request ? value.url : String(value));
    if (url.href === config.identityProvider.jwksUrl) return Response.json({ keys: [studentJwk] });
    if (url.href === config.judgeIssuer + '/.well-known/jwks.json') return Response.json({ keys: [judgeJwk] });
    assert.equal(url.origin, new URL(config.identityProvider.issuer).origin);
    assert.equal(url.pathname, '/rest/v1/training_notes');
    assert.equal(url.searchParams.get('select'), 'id,title,content');
    assert.equal(url.searchParams.get('order'), 'position.asc,id.asc');
    assert.equal(options.headers.apikey, testKey);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.redirect, 'error');
    databaseCalls++;
    return databaseResponse();
  };
  const call = async (authorization, method = 'GET', extra = {}) => {
    const res = responseRecorder();
    await handler({ ...extra, method, headers: { ...extra.headers, authorization } }, res);
    return res;
  };
  for (const name of Object.keys(oldConsole)) console[name] = (...args) => logs.push(args);
  process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_SECRET_KEY = testKey;
  globalThis.fetch = fakeFetch;
  try {
    await t.test('missing, malformed, forged, expired and wrong-service tokens return 401 without notes or DB access', async () => {
      const invalid = [undefined, '', 'Bearer not-a-token', ['Bearer duplicate'],
        'Bearer ' + await studentToken({}, attacker.privateKey),
        'Bearer ' + await studentToken({ exp: now - 60 }),
        'Bearer ' + await studentToken({ aud: 'another-service' }),
        'Bearer ' + await studentToken({ iss: 'https://other-project.supabase.co/auth/v1' }),
        'Bearer ' + await studentToken({ role: 'service_role' }),
      ];
      for (const authorization of invalid) {
        const before = databaseCalls;
        const res = await call(authorization, 'GET', {
          query: { userId, role: 'authenticated' }, body: { userId, role: 'authenticated' },
          headers: { 'x-user-id': userId, 'x-role': 'authenticated' },
        });
        assert.equal(res.statusCode, 401);
        assert.deepEqual(res.body, { error: 'LOGIN_REQUIRED' });
        assert.equal(res.headers.get('www-authenticate'), 'Bearer');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(databaseCalls, before);
      }
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const before = databaseCalls;
        assert.equal((await call(undefined, method)).statusCode, 401);
        assert.equal(databaseCalls, before);
      }
    });

    await t.test('verified student and operator test identities can read, excluding upstream extra fields', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        id: String(i + 1), title: 'Test card ' + (i + 1), content: 'Test content ' + (i + 1),
        owner_id: 'TEST_OWNER', secret: testKey,
      }));
      databaseResponse = async () => Response.json(rows);
      for (const token of [validToken, validJudgeToken]) {
        const before = databaseCalls;
        const res = await call('Bearer ' + token);
        assert.equal(res.statusCode, 200);
        assert.equal(databaseCalls, before + 1);
        assert.deepEqual(res.body.notes, rows.map(({ id, title, content }) => ({ id, title, content })));
        assert.equal(JSON.stringify(res.body).includes(testKey), false);
      }
    });

    await t.test('authenticated POST is unsupported without contacting the database', async () => {
      const before = databaseCalls;
      const res = await call('Bearer ' + validToken, 'POST');
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.get('allow'), 'GET');
      assert.equal(databaseCalls, before);
    });

    await t.test('missing key and mismatched project fail closed', async () => {
      const before = databaseCalls;
      delete process.env.SUPABASE_SECRET_KEY;
      assert.equal((await call('Bearer ' + validToken)).statusCode, 503);
      process.env.SUPABASE_SECRET_KEY = testKey;
      process.env.SUPABASE_URL = 'https://other-project.supabase.co';
      assert.equal((await call('Bearer ' + validToken)).statusCode, 503);
      process.env.SUPABASE_URL = 'http://learning-project.supabase.co';
      assert.equal((await call('Bearer ' + validToken)).statusCode, 503);
      process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
      assert.equal(databaseCalls, before);
    });

    await t.test('upstream errors, invalid data and exceptions never expose details', async () => {
      const scenarios = [
        async () => Response.json({ error: testKey }, { status: 401 }),
        async () => Response.json({ secret: testKey }),
        async () => Response.json([{ id: '1', title: 'Test', content: null }]),
        async () => new Response('invalid JSON'),
        async () => { throw new Error('request failed with ' + testKey); },
      ];
      for (const scenario of scenarios) {
        databaseResponse = scenario;
        const res = await call('Bearer ' + validToken);
        assert.equal(res.statusCode, 502);
        assert.deepEqual(res.body, { error: 'NOTES_UNAVAILABLE' });
        assert.equal(res.headers.get('cache-control'), 'no-store');
      }
    });
    assert.deepEqual(logs, []);
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of Object.keys(oldConsole)) console[name] = oldConsole[name];
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldKey;
  }
});
