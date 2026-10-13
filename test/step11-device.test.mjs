import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import { createDeviceService, enforceDeviceRequest, bodyHash, sha256 } from '../src/device-approval.mjs';
import notes from '../api/notes.js';
import deviceApi from '../api/device.js';
import legacyDeviceApi from '../api/device/[action].js';

const b64 = bytes => Buffer.from(bytes).toString('base64url');
const hashBytes = text => Buffer.from(sha256(text), 'hex');
const origin = new URL(config.publicAppUrl).origin;
const rpID = new URL(origin).hostname;
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const idBytes = randomBytes(32);
  const id = b64(idBytes);
  const cose = encodeCBOR(new Map([[1, 2], [3, -7], [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
  let counter = 0;
  return {
    id,
    registration(packet, flags = 0x45) {
      const clientDataJSON = b64(JSON.stringify({ type: 'webauthn.create', origin, challenge: packet.options.challenge }));
      const length = Buffer.alloc(2); length.writeUInt16BE(idBytes.length);
      const authData = Buffer.concat([hashBytes(rpID), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), length, idBytes, Buffer.from(cose)]);
      return { challengeId: packet.challengeId, credential: { id, rawId: id, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON, attestationObject: b64(encodeCBOR(new Map([
          ['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)],
        ]))) } } };
    },
    assertion(packet, options = {}) {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', origin: options.origin ?? origin,
        challenge: options.challenge ?? packet.options.challenge }));
      const count = Buffer.alloc(4); count.writeUInt32BE(++counter);
      const authData = Buffer.concat([hashBytes(options.rpID ?? rpID), Buffer.from([options.flags ?? 0x05]), count]);
      const signature = sign('sha256', Buffer.concat([authData, hashBytes(clientData)]), privateKey);
      return { challengeId: packet.challengeId, credential: { id, rawId: id, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) } } };
    },
  };
}
const recorder = () => ({ headers: {}, statusCode: 0, body: null,
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
  status(status) { this.statusCode = status; return this; }, json(body) { this.body = body; return this; }, end() {} });

test('stage 11 real WebAuthn signatures, PostgreSQL approval and protected APIs', async t => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(await readFile(new URL('../docs/STEP11_DATABASE.sql', import.meta.url), 'utf8'));
  const rpc = async (name, record) => (await db.query(`select public.${name}($1::jsonb) as result`, [JSON.stringify(record)])).rows[0].result;
  const store = {
    list: async owner => (await db.query('select * from public.training_devices where owner_key = $1', [owner])).rows,
    challenge: async (id, owner) => (await db.query('select * from public.training_device_challenges where id=$1 and owner_key=$2', [id, owner])).rows[0],
    saveChallenge: record => rpc('issue_training_device_challenge', record),
    register: record => rpc('register_training_device', record),
    consume: record => rpc('consume_training_device_challenge', record),
  };
  const identity = { kind: 'judge', userId: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222', identity: 'a' };
  const authKey = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(authKey.publicKey), kid: 'device-fixture', alg: 'ES256' };
  const token = await new SignJWT({ aleph_role: 'judge', aleph_identity: 'a', aleph_run: identity.runId })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).setIssuer(config.judgeIssuer)
    .setAudience(rpID).setSubject(identity.userId).setIssuedAt().setExpirationTime('10 minutes').sign(authKey.privateKey);
  const authorization = `Bearer ${token}`;
  const service = createDeviceService({ config: { ...config, step: 11 }, store });
  const authenticatorA = authenticator();
  let requestId;
  const target = { kind: 'request', method: 'GET', path: '/api/notes', bodySha256: bodyHash(undefined) };
  const proof = async (body = target, options) => authenticatorA.assertion(await service.options(body, identity, authorization), options);
  const approve = state => db.query('select public.decide_training_device($1,$2) as result', [requestId, state]);

  await t.test('registration verifies a real credential and remains pending; public account status cannot approve this device', async () => {
    const packet = await service.registration(identity, authorization);
    const result = await service.finish(authenticatorA.registration(packet), identity, authorization);
    assert.equal(result.state, 'pending'); assert.equal(result.approved, false);
    requestId = result.requestId;
    assert.equal((await service.status(identity)).approved, false);
    await assert.rejects(service.options(target, identity, authorization), /DEVICE_NOT_REGISTERED/);
    const statusProof = authenticatorA.assertion(await service.options({ kind: 'status' }, identity, authorization));
    assert.deepEqual(await service.verify(statusProof, identity, authorization), { approved: false, state: 'pending' });
    await assert.rejects(service.finish(authenticatorA.registration(packet), identity, authorization), /CHALLENGE_EXPIRED/);
  });
  await t.test('operator approval enables only signed requests; signature replay is rejected', async () => {
    await approve('approved');
    assert.equal((await service.status(identity)).approved, false);
    const statusProof = authenticatorA.assertion(await service.options({ kind: 'status' }, identity, authorization));
    assert.deepEqual(await service.verify(statusProof, identity, authorization), { approved: true, state: 'approved' });
    const current = await proof();
    assert.equal((await service.protect(current, identity, authorization, target)).approved, true);
    await assert.rejects(service.protect(current, identity, authorization, target), /CHALLENGE_EXPIRED/);
  });
  await t.test('changing method, path or JSON values after signing is rejected', async () => {
    const current = await proof();
    await assert.rejects(service.protect(current, identity, authorization, { ...target, method: 'DELETE' }), /REQUEST_CHANGED/);
    await assert.rejects(service.protect(current, identity, authorization, { ...target, path: '/api/announcements' }), /REQUEST_CHANGED/);
    const update = { kind: 'request', method: 'PUT', path: '/api/notes/44444444-4444-4444-8444-444444444444',
      bodySha256: bodyHash({ title: 'Synthetic title', body: 'Synthetic original' }) };
    const updateProof = await proof(update);
    await assert.rejects(service.protect(updateProof, identity, authorization,
      { ...update, bodySha256: bodyHash({ title: 'Synthetic title', body: 'Synthetic changed' }) }), /REQUEST_CHANGED/);
    assert.equal((await service.protect(updateProof, identity, authorization, update)).approved, true);
  });
  await t.test('wrong token, account, origin, RP, UV flag or signature cannot authorize a request', async () => {
    const current = await proof();
    await assert.rejects(service.protect(current, identity, authorization + 'changed', target), /CHALLENGE_EXPIRED/);
    await assert.rejects(service.protect(current, { ...identity, userId: '33333333-3333-4333-8333-333333333333' }, authorization, target), /CHALLENGE_EXPIRED/);
    for (const options of [{ origin: 'https://other.example' }, { rpID: 'other.example' }, { flags: 0x01 }, { challenge: 'wrong_challenge' }, { flags: 0x0d }]) {
      await assert.rejects(service.protect(await proof(target, options), identity, authorization, target), /SIGNATURE_INVALID/);
    }
    const changed = await proof(); changed.credential.response.signature = b64(randomBytes(70));
    await assert.rejects(service.protect(changed, identity, authorization, target), /SIGNATURE_INVALID/);
    // Expiry uses the DB's persisted deadline, never a client clock or header.
    await db.query('update public.training_device_challenges set expires_at=now()-interval \'1 second\' where id=$1', [current.challengeId]);
    await assert.rejects(service.protect(current, identity, authorization, target), /CHALLENGE_EXPIRED/);
  });
  await t.test('synchronized credentials cannot register as one approved device', async () => {
    const other = authenticator();
    const packet = await service.registration(identity, authorization);
    await assert.rejects(service.finish(other.registration(packet, 0x4d), identity, authorization), /DEVICE_BOUND_AUTHENTICATOR_REQUIRED/);
  });
  // Clear rejected prompts to keep the bounded server challenge pool available.
  await db.query('update public.training_device_challenges set used=true where not used');
  await t.test('app roles cannot approve, mutate registrations, read audits or access tables directly', async () => {
    const rows = (await db.query(`select
      has_function_privilege('service_role','public.decide_training_device(text,text)','EXECUTE') as approval,
      has_table_privilege('service_role','public.training_devices','UPDATE') as writes,
      has_table_privilege('authenticated','public.training_devices','SELECT') as direct_read,
      has_table_privilege('anon','public.training_device_challenges','SELECT') as anonymous_read,
      has_table_privilege('service_role','public.training_device_audit','SELECT') as audit_read`)).rows[0];
    assert.ok(Object.values(rows).every(value => value === false));
    await db.exec('set role service_role');
    try { await assert.rejects(approve('approved'), /permission denied/); }
    finally { await db.exec('reset role'); }
  });

  await t.test('current notes API rejects unsigned and changed proofs before DB reads; a correctly signed owner request succeeds', async () => {
    // Reproduce the deployed dynamic URL form before any login/DB access.
    for (const action of ['status', 'register', 'finish', 'options', 'verify']) {
      for (const url of [`/api/device/${action}`, `/api/device/${action}?action=${action}`,
        `/api/device/[action]?action=${action}`, '/api/device/[action]']) {
        const response = recorder();
        await legacyDeviceApi({ method: action === 'status' ? 'GET' : 'POST', url, body: {},
          query: { action }, headers: { 'content-type': 'application/json' } }, response);
        assert.equal(response.statusCode, action === 'status' ? 200 : 401, url);
        if (action === 'status') assert.deepEqual(response.body, { approved: false, state: 'signed_out' });
        else assert.equal(response.body.error, 'LOGIN_REQUIRED');
      }
    }
    for (const url of ['/api/device/status?action=register', '/api/device/status?action=status&action=status',
      '/api/device/status?approved=true']) {
      const response = recorder();
      await legacyDeviceApi({ method: 'GET', url, headers: {} }, response);
      assert.equal(response.statusCode, 400);
    }
    const unknown = recorder();
    await legacyDeviceApi({ method: 'POST', url: '/api/device/approve', headers: {} }, unknown);
    assert.equal(unknown.statusCode, 404);
    for (const action of ['register', 'finish', 'options', 'verify']) {
      const response = recorder();
      await deviceApi({ method: 'POST', url: '/api/device', body: { action },
        headers: { 'content-type': 'application/json' } }, response);
      assert.equal(response.statusCode, 401);
    }
    for (const body of [{ action: 'approve' }, { action: 'register', approved: true },
      { action: 'register', ownerId: identity.userId }, { action: 'register', state: 'approved' },
      { action: 'status' }, {}]) {
      const response = recorder();
      await deviceApi({ method: 'POST', url: '/api/device', body,
        headers: { 'content-type': 'application/json' } }, response);
      assert.equal(response.statusCode, 400);
    }
    for (const url of ['/api/device?action=register', '/api/device?approved=true']) {
      const response = recorder();
      await deviceApi({ method: 'GET', url, headers: {} }, response);
      assert.equal(response.statusCode, 400);
    }
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SECRET_KEY;
    const originalStep = config.step;
    config.step = 11;
    process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
    process.env.SUPABASE_SECRET_KEY = 'TEST_ONLY_DEVICE_SERVER_KEY';
    let noteReads = 0;
    let revokeDuringConsume = false;
    globalThis.fetch = async (url, options = {}) => {
      const targetUrl = new URL(url);
      if (targetUrl.href === config.judgeIssuer + '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
      if (targetUrl.pathname === '/rest/v1/training_devices') {
        return Response.json(await store.list(targetUrl.searchParams.get('owner_key').slice(3)));
      }
      if (targetUrl.pathname === '/rest/v1/training_device_challenges') {
        const row = await store.challenge(targetUrl.searchParams.get('id').slice(3), targetUrl.searchParams.get('owner_key').slice(3));
        return Response.json(row ? [row] : []);
      }
      if (targetUrl.pathname.startsWith('/rest/v1/rpc/')) {
        const name = targetUrl.pathname.split('/').at(-1);
        assert.ok(['issue_training_device_challenge','register_training_device','consume_training_device_challenge'].includes(name));
        if (name === 'consume_training_device_challenge' && revokeDuringConsume) {
          revokeDuringConsume = false;
          await approve('revoked');
        }
        return Response.json(await rpc(name, JSON.parse(options.body).p_record));
      }
      if (targetUrl.pathname === '/rest/v1/training_notes') {
        noteReads++;
        assert.equal(targetUrl.searchParams.get('owner_id'), `eq.${identity.userId}`);
        return Response.json([{ id: '44444444-4444-4444-8444-444444444444', title: 'Synthetic title',
          content: 'Synthetic content', owner_id: identity.userId }]);
      }
      throw new Error('unexpected_test_network_target');
    };
    try {
      const call = async (url, proofValue) => {
        const response = recorder();
        await notes({ method: 'GET', url, headers: { authorization,
          ...(proofValue ? { 'x-byteback-device-proof': b64(JSON.stringify(proofValue)) } : {}) } }, response);
        return response;
      };
      assert.equal((await call('/api/notes')).statusCode, 403);
      assert.equal(noteReads, 0);
      const current = await proof();
      assert.equal((await call('/api/notes/44444444-4444-4444-8444-444444444444', current)).statusCode, 403);
      assert.equal(noteReads, 0);
      const allowed = await call('/api/notes', current);
      assert.equal(allowed.statusCode, 200);
      assert.equal(allowed.body[0].title, 'Synthetic title');
      assert.equal((await call('/api/notes', current)).statusCode, 403);
      assert.equal(noteReads, 1);
      const putBody = { title: 'Synthetic title', body: 'Synthetic original' };
      const putPath = '/api/notes/44444444-4444-4444-8444-444444444444';
      const putProof = await proof({ kind: 'request', method: 'PUT', path: putPath, bodySha256: bodyHash(putBody) });
      const putResponse = recorder();
      await notes({ method: 'PUT', url: putPath, body: { ...putBody, body: 'Synthetic changed' },
        headers: { authorization, 'content-type': 'application/json',
          'x-byteback-device-proof': b64(JSON.stringify(putProof)) } }, putResponse);
      assert.equal(putResponse.statusCode, 403);
      assert.equal(putResponse.body.error, 'DEVICE_REQUEST_CHANGED');
      assert.equal(noteReads, 1);
      const response = recorder();
      await deviceApi({ method: 'GET', url: '/api/device', headers: { authorization } }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.approved, false);
      const beforeRevocation = await proof();
      revokeDuringConsume = true;
      assert.equal((await call('/api/notes', beforeRevocation)).statusCode, 403);
      assert.equal(noteReads, 1);
      const unsigned = await enforceDeviceRequest({ method: 'GET', url: '/api/notes', headers: { authorization } },
        identity, { ...config, step: 11 }, new URL(process.env.SUPABASE_URL), process.env.SUPABASE_SECRET_KEY);
      assert.equal(unsigned.ok, false);
      assert.equal(noteReads, 1);
    } finally {
      config.step = originalStep;
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
    }
  });
  await t.test('revocation is checked again at the transaction boundary and preserves the audit', async () => {
    const status = authenticatorA.assertion(await service.options({ kind: 'status' }, identity, authorization));
    assert.deepEqual(await service.verify(status, identity, authorization), { approved: false, state: 'revoked' });
    await assert.rejects(service.options(target, identity, authorization), /DEVICE_NOT_REGISTERED/);
    const audit = (await db.query('select event from public.training_device_audit order by sequence')).rows.map(row => row.event);
    assert.deepEqual(audit, ['registration_pending', 'approved', 'revoked']);
  });
  await t.test('fixed HTTP API registers pending, verifies pending, then opens only after SQL operator approval', async () => {
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
    process.env.SUPABASE_SECRET_KEY = 'TEST_ONLY_DEVICE_SERVER_KEY';
    globalThis.fetch = async (url, options = {}) => {
      const incoming = new URL(url);
      if (incoming.href === config.judgeIssuer + '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
      if (incoming.pathname === '/rest/v1/training_devices') {
        return Response.json(await store.list(incoming.searchParams.get('owner_key').slice(3)));
      }
      if (incoming.pathname === '/rest/v1/training_device_challenges') {
        const row = await store.challenge(incoming.searchParams.get('id').slice(3), incoming.searchParams.get('owner_key').slice(3));
        return Response.json(row ? [row] : []);
      }
      const operation = incoming.pathname.split('/').at(-1);
      if (incoming.pathname.startsWith('/rest/v1/rpc/')
          && ['issue_training_device_challenge', 'register_training_device', 'consume_training_device_challenge'].includes(operation)) {
        return Response.json(await rpc(operation, JSON.parse(options.body).p_record));
      }
      throw new Error('unexpected_test_network_target');
    };
    try {
      const post = async body => {
        const response = recorder();
        await deviceApi({ method: 'POST', url: '/api/device', body,
          headers: { authorization, 'content-type': 'application/json' } }, response);
        return response;
      };
      const localDevice = authenticator();
      const registration = await post({ action: 'register' });
      assert.equal(registration.statusCode, 200);
      const pending = await post({ action: 'finish', ...localDevice.registration(registration.body) });
      assert.equal(pending.statusCode, 200);
      assert.equal(pending.body.approved, false);
      assert.equal(pending.body.state, 'pending');
      const check = async () => {
        const options = await post({ action: 'options', kind: 'status' });
        assert.equal(options.statusCode, 200);
        return post({ action: 'verify', ...localDevice.assertion(options.body) });
      };
      const unapproved = await check();
      assert.equal(unapproved.statusCode, 200);
      assert.equal(unapproved.body.approved, false);
      assert.equal((await post({ action: 'options', ...target })).statusCode, 403);
      await db.query('select public.decide_training_device($1,$2)', [pending.body.requestId, 'approved']);
      const approved = await check();
      assert.equal(approved.statusCode, 200);
      assert.deepEqual(approved.body, { approved: true, state: 'approved' });
      assert.equal((await post({ action: 'options', ...target })).statusCode, 200);
      const invalid = await post({ action: 'options', kind: 'status', approved: true });
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.body.error, 'INVALID_DEVICE_REQUEST');
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
    }
  });
});
