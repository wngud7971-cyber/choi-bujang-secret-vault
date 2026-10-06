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
    assert.equal(url.searchParams.get('select'), ['POST', 'DELETE'].includes(options.method) ? 'id' : 'id,title,content');
    if (options.method === 'GET' && !url.searchParams.has('id')) {
      assert.ok(url.searchParams.get('owner_id')?.startsWith('eq.'));
      assert.equal(url.searchParams.get('order'), 'created_at.asc,id.asc');
    }
    assert.equal(options.headers.apikey, testKey);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.redirect, 'error');
    databaseCalls++;
    return databaseResponse(url, options);
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
        assert.deepEqual(res.body, rows.map(({ id, title, content }) => ({ id, title, body: content })));
        assert.equal(JSON.stringify(res.body).includes(testKey), false);
      }
    });

    await t.test('unsupported route methods are rejected without contacting the database', async () => {
      const before = databaseCalls;
      const res = await call('Bearer ' + validToken, 'PUT');
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.get('allow'), 'GET, POST');
      assert.equal(databaseCalls, before);
    });

    await t.test('CRUD uses verified owner, exact bodies and paths, personal lists, and 404 after deletion', async () => {
      const userB = '33333333-3333-4333-8333-333333333333';
      const tokenB = await studentToken({ sub: userB });
      const noteId = '44444444-4444-4444-8444-444444444444';
      const rows = new Map([['legacy', { id: 'legacy', owner_id: null, title: 'Legacy fixture', content: 'Synthetic content' }]]);
      databaseResponse = async (url, options) => {
        const id = url.searchParams.get('id')?.slice(3);
        const owner = url.searchParams.get('owner_id')?.slice(3);
        if (options.method === 'POST') {
          const row = JSON.parse(options.body);
          assert.equal(row.owner_id, userId);
          assert.deepEqual(Object.keys(row).sort(), ['content', 'id', 'owner_id', 'position', 'title']);
          assert.equal(row.position, 0);
          if (rows.has(row.id)) return Response.json({ detail: testKey }, { status: 409 });
          rows.set(row.id, row);
          return Response.json([{ id: row.id }], { status: 201 });
        }
        if (options.method === 'PATCH') {
          assert.equal(owner, undefined, 'ownership checks on individual operations start in stage 4');
          const changes = JSON.parse(options.body);
          assert.deepEqual(Object.keys(changes).sort(), ['content', 'title']);
          if (!rows.has(id)) return Response.json([]);
          Object.assign(rows.get(id), changes);
          return Response.json([rows.get(id)]);
        }
        if (options.method === 'DELETE') {
          assert.equal(owner, undefined);
          if (!rows.has(id)) return Response.json([]);
          rows.delete(id);
          return Response.json([{ id }]);
        }
        return Response.json(id ? (rows.has(id) ? [rows.get(id)] : [])
          : [...rows.values()].filter(row => row.owner_id === owner));
      };
      const mutation = (method, body, url = '/api/notes', token = validToken) => call('Bearer ' + token, method, {
        url, body, headers: { 'content-type': 'application/json' },
      });
      assert.deepEqual((await call('Bearer ' + validToken)).body, []);
      const added = await mutation('POST', { id: noteId, title: 'Test A', body: 'Synthetic content',
        owner_id: userB, userId: userB, role: 'admin' });
      assert.equal(added.statusCode, 201);
      assert.deepEqual(added.body, { id: noteId });
      assert.equal(rows.get(noteId).owner_id, userId);
      const generated = await mutation('POST', { title: 'Generated ID', body: 'Synthetic content' });
      assert.equal(generated.statusCode, 201);
      assert.match(generated.body.id, /^[0-9a-f-]{36}$/u);
      assert.equal((await mutation('POST', { id: noteId, title: 'Duplicate', body: 'Synthetic content' })).statusCode, 409);
      const single = await call('Bearer ' + validToken, 'GET', { url: '/api/notes/' + noteId });
      assert.deepEqual(single.body, { id: noteId, title: 'Test A', body: 'Synthetic content' });
      const updated = await mutation('PUT', { title: 'Updated', body: 'New synthetic content', owner_id: userB }, '/api/notes/' + noteId);
      assert.deepEqual(updated.body, { id: noteId, title: 'Updated', body: 'New synthetic content' });
      const ownList = await call('Bearer ' + validToken, 'GET', { url: '/api/notes?userId=' + userB, query: { userId: userB } });
      assert.equal(ownList.body.length, 2);
      assert.ok(!ownList.body.some(row => row.id === 'legacy'));
      assert.deepEqual((await call('Bearer ' + tokenB)).body, []);
      // Required stage 3 limitation: B can access A's known individual URL.
      assert.equal((await call('Bearer ' + tokenB, 'GET', { url: '/api/notes/' + noteId })).statusCode, 200);
      assert.equal((await mutation('PUT', { title: 'B edited A', body: 'Synthetic content' }, '/api/notes/' + noteId, tokenB)).statusCode, 200);
      assert.equal(rows.get(noteId).owner_id, userId);
      assert.equal((await call('Bearer ' + tokenB, 'DELETE', { url: '/api/notes/' + noteId })).statusCode, 200);
      assert.equal((await call('Bearer ' + validToken, 'GET', { url: '/api/notes/' + noteId })).statusCode, 404);
      assert.equal((await mutation('PUT', { title: 'Missing', body: 'Synthetic content' }, '/api/notes/' + noteId)).statusCode, 404);
      assert.equal((await call('Bearer ' + validToken, 'DELETE', { url: '/api/notes/' + noteId })).statusCode, 404);
      assert.ok(rows.has('legacy'), 'legacy DB notes are preserved');
      const before = databaseCalls;
      assert.equal((await mutation('POST', { id: 'bad-id', title: 'Test', body: 'Synthetic content' })).statusCode, 400);
      assert.equal((await mutation('POST', { title: '', body: 'Synthetic content' })).statusCode, 400);
      assert.equal((await mutation('POST', { title: 'Test', body: '' })).statusCode, 400);
      assert.equal((await mutation('POST', '{invalid-json')).statusCode, 400);
      assert.equal((await call('Bearer ' + validToken, 'POST', { body: {} })).statusCode, 415);
      assert.equal((await call('Bearer ' + validToken, 'GET', { url: '/api/notes/not-a-uuid' })).statusCode, 400);
      assert.equal((await call('Bearer ' + validToken, 'GET', { url: '/api/notes/extra/path' })).statusCode, 404);
      for (const method of ['GET', 'PUT', 'DELETE']) {
        assert.equal((await call(undefined, method, { url: '/api/notes/' + noteId })).statusCode, 401);
      }
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
