import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import notes from '../api/notes.js';
import notices from '../api/announcements.js';

// Real API handlers with ephemeral signed identities and an in-memory DB.
// This is a LOCAL synthetic boundary test, never live DB or judge evidence.
export async function checkResourceApis() {
  const original = { fetch: globalThis.fetch, warn: console.warn,
    step: config.step,
    url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const key = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(key.publicKey), kid: 'zone-check', alg: 'ES256' };
  const users = { a: '11111111-1111-4111-8111-111111111111',
    b: '33333333-3333-4333-8333-333333333333', teacher: '99999999-9999-4999-8999-999999999999' };
  const ids = { a: '44444444-4444-4444-8444-444444444444',
    b: '55555555-5555-4555-8555-555555555555', notice: '88888888-8888-4888-8888-888888888888' };
  const rows = new Map(Object.entries(users).filter(([name]) => name !== 'teacher').map(([name, owner]) =>
    [ids[name], { id: ids[name], owner_id: owner, title: 'Synthetic fixture', content: 'Synthetic fixture' }]));
  let notice = { id: ids.notice, title: 'Synthetic fixture', content: 'Synthetic fixture' };
  let grantMode = 'normal';
  let writes = 0;
  let noteMode = 'normal';
  const audit = [];
  const results = [];
  const tokens = {};
  const now = Math.floor(Date.now() / 1000);
  for (const [name, userId] of Object.entries(users)) {
    tokens[name] = await new SignJWT({ iss: config.identityProvider.issuer,
      aud: config.identityProvider.audience, sub: userId, role: 'authenticated',
      app_metadata: {}, user_metadata: { role: 'teacher' }, iat: now, exp: now + 300 })
      .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(key.privateKey);
  }
  const grant = { issuer: config.identityProvider.issuer, subject_id: users.teacher,
    permission: 'announcement_editor' };
  process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_SECRET_KEY = 'TEST_ONLY_ZONE_SERVER_KEY';
  console.warn = message => audit.push(message);
  globalThis.fetch = async (value, options) => {
    const url = new URL(String(value));
    if (url.href === config.identityProvider.jwksUrl) return Response.json({ keys: [jwk] });
    assert.equal(url.origin, process.env.SUPABASE_URL);
    assert.equal(options.headers.apikey, process.env.SUPABASE_SECRET_KEY);
    if (url.pathname === '/rest/v1/training_notes') {
      const id = url.searchParams.get('id')?.slice(3);
      const owner = url.searchParams.get('owner_id')?.slice(3);
      if (noteMode === 'wrong_owner') return Response.json([rows.get(ids.b)]);
      const matches = [...rows.values()].filter(row => row.owner_id === owner && (!id || row.id === id));
      if (options.method === 'PATCH') {
        if (matches.length) { writes++; Object.assign(matches[0], JSON.parse(options.body)); }
      }
      return Response.json(matches);
    }
    if (url.pathname === '/rest/v1/training_resource_grants') {
      if (grantMode === 'unavailable') return Response.json({}, { status: 503 });
      if (grantMode === 'wrong_issuer') return Response.json([{ ...grant, issuer: config.judgeIssuer }]);
      if (grantMode === 'wrong_subject') return Response.json([{ ...grant, subject_id: users.b }]);
      return Response.json(url.searchParams.get('subject_id') === `eq.${users.teacher}` ? [grant] : []);
    }
    if (url.pathname === '/rest/v1/rpc/write_training_announcement') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.p_subject, users.teacher);
      assert.equal(payload.p_issuer, config.identityProvider.issuer);
      assert.equal(payload.p_id, ids.notice);
      if (grantMode === 'revoked_at_write') return Response.json({ status: 'forbidden' });
      writes++;
      notice = { id: payload.p_id, title: payload.p_title, content: payload.p_content };
      return Response.json({ status: 'written', ...notice });
    }
    if (url.pathname === '/rest/v1/training_announcements') return Response.json([notice]);
    throw new Error('Unexpected upstream path');
  };
  const call = async (handler, actor, method, url, body, extraHeaders = {}) => {
    const result = { statusCode: null, body: null, headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(status) { this.statusCode = status; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method, url, body, headers: { authorization: actor ? `Bearer ${tokens[actor]}` : undefined,
      'content-type': 'application/json', ...extraHeaders } }, result);
    return result;
  };
  const check = async (name, callback) => { await callback(); results.push({ name, passed: true }); };
  const patch = { title: 'Synthetic changed title', body: 'Synthetic changed content' };
  try {
    // Exercise the earlier owner/announcement boundary in isolation; stage 11
    // has separate real signature and current-handler integration tests.
    config.step = 10;
    await check('self_crud_and_resource_id', async () => {
      const list = await call(notes, 'a', 'GET', '/api/notes');
      assert.equal(list.statusCode, 200);
      assert.deepEqual(list.body.map(row => row.id), [ids.a]);
      const read = await call(notes, 'a', 'GET', `/api/notes/${ids.a}`);
      assert.equal(read.statusCode, 200);
      assert.equal(read.headers['X-Resource-ID'], `notes:${ids.a}`);
      assert.equal((await call(notes, 'a', 'PUT', `/api/notes/${ids.a}`, patch)).statusCode, 200);
      assert.equal((await call(notes, 'a', 'GET', `/api/notes/owners/${users.a}/${ids.a}`)).statusCode, 200);
      assert.equal((await call(notes, 'a', 'GET', `/api/notes?id=${ids.a}`)).statusCode, 200);
    });
    await check('cross_owner_read_write_and_list', async () => {
      const before = structuredClone(rows.get(ids.a));
      assert.equal((await call(notes, 'b', 'GET', `/api/notes/${ids.a}`)).statusCode, 404);
      assert.equal((await call(notes, 'b', 'PUT', `/api/notes/${ids.a}`, patch)).statusCode, 404);
      assert.equal((await call(notes, 'b', 'GET', `/api/notes/owners/${users.a}`)).statusCode, 404);
      assert.deepEqual(rows.get(ids.a), before);
      assert.deepEqual((await call(notes, 'b', 'GET', '/api/notes')).body.map(row => row.id), [ids.b]);
    });
    await check('query_and_header_spoof', async () => {
      for (const query of ['action=export', 'role=teacher', `owner_id=${users.a}`]) {
        assert.equal((await call(notes, 'b', 'GET', `/api/notes?${query}`)).statusCode, 400);
      }
      assert.equal((await call(notes, 'b', 'GET', `/api/notes/${ids.a}`, undefined,
        { 'x-user-id': users.a, 'x-role': 'teacher' })).statusCode, 404);
    });
    await check('wrong_upstream_owner', async () => {
      noteMode = 'wrong_owner';
      const result = await call(notes, 'a', 'GET', '/api/notes');
      assert.equal(result.statusCode, 502);
      assert.deepEqual(result.body, { error: 'NOTES_UNAVAILABLE' });
      noteMode = 'normal';
    });
    await check('student_notice_edit_and_spoof', async () => {
      const before = structuredClone(notice);
      for (const actor of ['a', 'b']) {
        const result = await call(notices, actor, 'PUT', `/api/announcements/${ids.notice}`,
          { ...patch, role: 'teacher', owner_id: users.teacher }, { 'x-role': 'teacher' });
        assert.equal(result.statusCode, 403);
        assert.deepEqual(result.body, { error: 'ANNOUNCEMENT_EDIT_FORBIDDEN' });
      }
      assert.deepEqual(notice, before);
      const read = await call(notices, 'a', 'GET', `/api/announcements/${ids.notice}`);
      assert.equal(read.statusCode, 200);
      assert.equal(read.headers['X-Resource-ID'], `announcements:${ids.notice}`);
    });
    await check('stored_instructor_edit', async () => {
      assert.equal((await call(notices, 'teacher', 'PUT', `/api/announcements/${ids.notice}`, patch)).statusCode, 200);
      assert.equal(notice.title, patch.title);
    });
    await check('grant_identity_binding_and_revocation', async () => {
      const before = writes;
      for (const mode of ['wrong_issuer', 'wrong_subject', 'unavailable', 'revoked_at_write']) {
        grantMode = mode;
        assert.equal((await call(notices, 'teacher', 'PUT', `/api/announcements/${ids.notice}`, patch)).statusCode, 403);
      }
      assert.equal(writes, before);
      grantMode = 'normal';
    });
    await check('invalid_targets_and_anonymous_denied', async () => {
      assert.equal((await call(notices, null, 'PUT', `/api/announcements/${ids.notice}`, patch)).statusCode, 401);
      for (const url of ['/api/announcements/export', '/api/announcements/../notes',
        `/api/announcements/${ids.notice}?role=teacher`]) {
        assert.equal((await call(notices, 'teacher', 'PUT', url, patch)).statusCode, 400);
      }
      assert.equal((await call(notices, 'teacher', 'PATCH', `/api/announcements/${ids.notice}`, patch)).statusCode, 405);
      assert.equal((await call(notices, 'teacher', 'PUT', `/api/announcements/${ids.notice}`, { ...patch, role: 'teacher' })).statusCode, 400);
    });
    await check('safe_denial_audit', async () => {
      assert.ok(audit.length > 0);
      for (const message of audit) {
        assert.deepEqual(Object.keys(JSON.parse(message)).sort(), ['event', 'method', 'reason', 'resource']);
        assert.ok(!Object.values(users).some(id => message.includes(id)));
        assert.ok(!message.includes('Bearer') && !message.includes('Synthetic') && !message.includes('SERVER_KEY'));
      }
    });
    return results;
  } finally {
    config.step = original.step;
    globalThis.fetch = original.fetch;
    console.warn = original.warn;
    for (const [envName, value] of [['SUPABASE_URL', original.url], ['SUPABASE_SECRET_KEY', original.key]]) {
      if (value === undefined) delete process.env[envName]; else process.env[envName] = value;
    }
  }
}
