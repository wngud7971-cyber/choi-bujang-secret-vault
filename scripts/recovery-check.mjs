import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SourceTextModule, createContext } from 'node:vm';
import config from '../aleph.config.json' with { type: 'json' };
import notes from '../api/notes.js';
import restore from '../api/restore.js';
import { contentHash } from '../src/note-recovery.mjs';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { detect } from '../src/detect.mjs';
import { createZtnaConnection } from '../src/ztna.mjs';
import { checkDecider } from './decider-test.mjs';
import { checkZones } from './fixture-8.mjs';
import { checkDetection } from './detect-test.mjs';
import { fixtureRequests } from './fixture-7.mjs';
import { checkResourceApis } from './zone-api-check.mjs';
import { loadPolicyPreview, policyHash, BACKUP_PATH, TEST_POLICY_PATH,
  MANIFEST_PATH, SOURCE_BASELINE_PATH } from '../src/policy-preview.mjs';
import { restoreTestPolicy } from '../src/policy-restore.mjs';

const root = resolve(import.meta.dirname, '..');

// Uses the real PostgreSQL SQL and actual API handlers, but only ephemeral local
// keys, in-memory test DB, and temporary policy files. No live network or DB.
export async function checkRecovery() {
  const db = await PGlite.create();
  const original = { fetch: globalThis.fetch, warn: console.warn,
    step: config.step,
    url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const results = [];
  const check = async (name, fn) => { await fn(); results.push({ name, passed: true }); };
  const logs = [];
  const users = { a: '11111111-1111-4111-8111-111111111111', b: '33333333-3333-4333-8333-333333333333' };
  const ids = { a: '44444444-4444-4444-8444-444444444444', b: '55555555-5555-4555-8555-555555555555',
    other: '66666666-6666-4666-8666-666666666666' };
  const run = '22222222-2222-4222-8222-222222222222';
  const title = 'Synthetic recovery fixture';
  const content = 'SYNTHETIC_RECOVERY_BODY_한글';
  const hash = contentHash(title, content);
  const key = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(key.publicKey), kid: 'recovery-check', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const token = (actor, overrides = {}, privateKey = key.privateKey) => new SignJWT({
    iss: config.judgeIssuer, aud: new URL(config.publicAppUrl).hostname, sub: users[actor],
    aleph_role: 'judge', aleph_identity: actor, aleph_run: run, iat: now, exp: now + 300, ...overrides,
  }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(privateKey);
  const tokens = { a: await token('a'), b: await token('b'),
    otherRun: await token('b', { aleph_run: '77777777-7777-4777-8777-777777777777' }),
    forged: await token('b', {}, (await generateKeyPair('ES256')).privateKey),
    student: await token('b', { iss: config.identityProvider.issuer,
      aud: config.identityProvider.audience, role: 'authenticated' }) };
  let databaseCalls = 0;
  const rpcNames = {
    create_training_note_with_backup: ['p_id', 'p_owner', 'p_run', 'p_title', 'p_content'],
    inspect_training_note_backup: ['p_id', 'p_owner', 'p_run'],
    restore_training_note: ['p_id', 'p_owner', 'p_run', 'p_expected_sha256'],
  };
  const call = async (handler, actor, method, url, body, extraHeaders = {}) => {
    const response = { statusCode: null, body: null, headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method, url, body, headers: {
      authorization: actor ? `Bearer ${tokens[actor]}` : undefined, 'content-type': 'application/json', ...extraHeaders,
    } }, response);
    return response;
  };
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const noteRow = async id => (await query('select * from public.training_notes where id=$1', [id]))[0];
  const auditCount = async () => Number((await query('select count(*) as count from public.training_note_recovery_audit'))[0].count);
  const sql = await readFile(resolve(root, 'docs/STEP10_DATABASE.sql'), 'utf8');
  try {
    // Stage 10 recovery fixture; current stage 11 API proof tests are separate.
    config.step = 10;
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.training_notes(id uuid primary key, owner_id uuid not null, title text not null,
        content text not null, position integer not null default 0, created_at timestamptz not null default now());
      alter table public.training_notes enable row level security;
      grant select, insert, update, delete on public.training_notes to service_role;`);
    await db.exec(sql);
    await db.query('insert into public.training_notes(id,owner_id,title,content) values($1,$2,$3,$4),($5,$6,$3,$4)',
      [ids.a, users.a, 'Synthetic unrelated note', 'Synthetic unrelated content', ids.other, users.b]);
    const unrelated = [await noteRow(ids.a), await noteRow(ids.other)];
    process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
    process.env.SUPABASE_SECRET_KEY = 'TEST_ONLY_RECOVERY_SERVER_KEY';
    console.warn = value => logs.push(value);
    globalThis.fetch = async (value, options) => {
      const url = new URL(String(value));
      if ([config.identityProvider.jwksUrl, `${config.judgeIssuer}/.well-known/jwks.json`].includes(url.href)) {
        return Response.json({ keys: [jwk] });
      }
      assert.equal(url.origin, process.env.SUPABASE_URL);
      assert.equal(options.headers.apikey, process.env.SUPABASE_SECRET_KEY);
      assert.equal(options.headers.Authorization, undefined);
      databaseCalls++;
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.slice('/rest/v1/rpc/'.length);
        const keys = rpcNames[name];
        assert.ok(keys, 'Only declared recovery RPCs may be called');
        const payload = JSON.parse(options.body);
        const data = await query(`select public.${name}(${keys.map((_, i) => `$${i + 1}`).join(',')}) as result`,
          keys.map(k => payload[k]));
        return Response.json(data[0].result);
      }
      assert.equal(url.pathname, '/rest/v1/training_notes');
      const id = url.searchParams.get('id')?.slice(3);
      const owner = url.searchParams.get('owner_id')?.slice(3);
      if (options.method === 'POST') {
        const p = JSON.parse(options.body);
        return Response.json(await query('insert into public.training_notes(id,owner_id,title,content,position) values($1,$2,$3,$4,$5) returning id',
          [p.id, p.owner_id, p.title, p.content, p.position]));
      }
      if (options.method === 'PATCH') {
        const p = JSON.parse(options.body);
        return Response.json(await query('update public.training_notes set title=$3,content=$4 where id=$1 and owner_id=$2 returning *',
          [id, owner, p.title, p.content]));
      }
      if (options.method === 'DELETE') return Response.json(await query('delete from public.training_notes where id=$1 and owner_id=$2 returning id', [id, owner]));
      return Response.json(await query('select * from public.training_notes where owner_id=$1 and ($2::uuid is null or id=$2)', [owner, id ?? null]));
    };
    await check('atomic_backup_and_readback', async () => {
      const created = await call(notes, 'b', 'POST', '/api/notes', { id: ids.b, title, body: content });
      assert.equal(created.statusCode, 201);
      assert.deepEqual(created.body, { id: ids.b });
      const saved = (await query('select * from public.training_note_recovery_backups where note_id=$1', [ids.b]))[0];
      assert.equal(saved.owner_id, users.b);
      assert.equal(saved.run_id, run);
      assert.equal(saved.content_sha256, hash);
      assert.equal(contentHash(saved.title, saved.content), hash);
      assert.equal(await auditCount(), 1);
    });
    await check('preview_without_mutation', async () => {
      const before = await auditCount();
      const result = await call(restore, 'b', 'POST', '/api/restore', { id: ids.b, preview: true });
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.restored, false);
      assert.equal(result.body.contentSha256, hash);
      assert.equal(await auditCount(), before);
    });
    const assertRestored = async () => {
      const result = await call(restore, 'b', 'POST', '/api/restore', { id: ids.b });
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.ownerId, users.b);
      assert.equal(result.body.contentSha256, hash);
      assert.equal(result.body.restored, true);
      const read = await call(notes, 'b', 'GET', `/api/notes/${ids.b}`);
      assert.equal(read.statusCode, 200);
      assert.deepEqual(read.body, { id: ids.b, title, body: content });
      assert.equal((await noteRow(ids.b)).owner_id, users.b);
    };
    await check('tampered_note_restored', async () => {
      await db.query('update public.training_notes set content=$2 where id=$1', [ids.b, 'Synthetic tampered content']);
      await assertRestored();
    });
    await check('deleted_note_restored', async () => {
      await db.query('delete from public.training_notes where id=$1', [ids.b]);
      await assertRestored();
    });
    await check('repeat_restore_and_audit_preservation', async () => {
      const before = await auditCount();
      await assertRestored();
      assert.equal(await auditCount(), before + 1);
      assert.deepEqual([await noteRow(ids.a), await noteRow(ids.other)], unrelated);
    });
    await check('verified_b_owner_and_run_only', async () => {
      const before = await auditCount();
      for (const [actor, expected] of [[null, 401], ['forged', 401], ['a', 403], ['student', 403], ['otherRun', 404]]) {
        assert.equal((await call(restore, actor, 'POST', '/api/restore', { id: ids.b })).statusCode, expected);
      }
      assert.equal((await call(restore, 'b', 'POST', '/api/restore', { id: ids.a })).statusCode, 404);
      assert.equal(await auditCount(), before);
    });
    await check('strict_single_target_and_no_role_spoof', async () => {
      const before = databaseCalls;
      for (const body of [{ ids: [ids.a, ids.b] }, { id: ids.b, owner_id: users.a },
        { id: ids.b, role: 'admin' }, { id: ids.b, noteId: ids.b }, { id: '../all' },
        { id: ids.b, preview: 'true' }]) {
        assert.equal((await call(restore, 'b', 'POST', '/api/restore', body)).statusCode, 400);
      }
      assert.equal((await call(restore, 'b', 'GET', '/api/restore', { id: ids.b })).statusCode, 405);
      assert.equal((await call(restore, 'b', 'POST', '/api/restore?owner_id=x', { id: ids.b })).statusCode, 400);
      assert.equal(databaseCalls, before);
    });
    await check('missing_backup_stops', async () => {
      const before = await auditCount();
      assert.equal((await call(restore, 'b', 'POST', '/api/restore', { id: ids.other })).statusCode, 404);
      assert.equal(await auditCount(), before);
    });
    await check('backup_hash_mismatch_stops', async () => {
      const before = await auditCount();
      await db.query('update public.training_note_recovery_backups set content=$2 where note_id=$1', [ids.b, 'Synthetic damaged backup']);
      assert.equal((await call(restore, 'b', 'POST', '/api/restore', { id: ids.b })).statusCode, 409);
      assert.equal(await auditCount(), before);
      await db.query('update public.training_note_recovery_backups set content=$2 where note_id=$1', [ids.b, content]);
    });
    await check('foreign_owner_id_reuse_stops', async () => {
      await db.query('delete from public.training_notes where id=$1', [ids.b]);
      await db.query('insert into public.training_notes(id,owner_id,title,content) values($1,$2,$3,$4)',
        [ids.b, users.a, 'Synthetic other owner', 'Synthetic collision']);
      const collision = await noteRow(ids.b);
      assert.equal((await call(restore, 'b', 'POST', '/api/restore', { id: ids.b })).statusCode, 409);
      assert.deepEqual(await noteRow(ids.b), collision);
      await db.query('delete from public.training_notes where id=$1', [ids.b]);
      await assertRestored();
    });
    await check('original_backup_not_replaced', async () => {
      assert.equal((await call(notes, 'b', 'POST', '/api/notes', { id: ids.b, title, body: 'Synthetic replacement' })).statusCode, 409);
      assert.equal((await query('select content_sha256 from public.training_note_recovery_backups where note_id=$1', [ids.b]))[0].content_sha256, hash);
    });
    await check('private_backup_and_rpc_grants', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const [permissions] = await query(`select has_table_privilege($1,'public.training_note_recovery_backups','SELECT,INSERT,UPDATE,DELETE') as direct,
          has_function_privilege($1,'public.restore_training_note(uuid,uuid,uuid,text)','EXECUTE') as restore`, [role]);
        assert.equal(permissions.direct, false);
        assert.equal(permissions.restore, role === 'service_role');
      }
      const before = await auditCount();
      await db.exec(sql);
      assert.equal(await auditCount(), before);
      assert.deepEqual([await noteRow(ids.a), await noteRow(ids.other)], unrelated);
    });
    await check('post_restore_prior_defenses', async () => {
      await assertRestored();
      assert.equal((await call(notes, 'a', 'GET', `/api/notes/${ids.a}`)).statusCode, 200);
      for (const method of ['GET', 'PUT', 'DELETE']) {
        assert.equal((await call(notes, 'b', method, `/api/notes/${ids.a}`, method === 'PUT' ? { title, body: content } : undefined)).statusCode, 404);
      }
      assert.equal((await call(notes, null, 'GET', '/api/notes')).statusCode, 401);
      assert.deepEqual(JSON.parse(await readFile(resolve(root, 'public/data.json'), 'utf8')), { notes: [] });
      assert.ok((await checkDecider({ decide, ruleIds: RULE_IDS })).every(x => x.passed));
      assert.ok((await checkZones(decide)).every(x => x.passed));
      assert.ok((await checkDetection(detect)).every(x => x.passed));
      const { normal } = fixtureRequests();
      for (const [moduleKey, ruleId] of [['brute-force', 'xdr.brute_force.deny'], ['web-injection', 'xdr.web_injection.deny']]) {
        const rule = { ruleId, action: 'deny', sourceIp: '192.0.2.55',
          startsAt: '2026-10-13T00:00:00.000Z', expiresAt: '2026-10-13T00:15:00.000Z', alertIds: ['recovery_fixture'],
          confidence: 0.9, attempts: 3, patternIds: ['sql-injection'] };
        const connection = createZtnaConnection({ rules: async () => ({ schema: 'aleph.xdr.deny-rules.v1', moduleKey, rules: [rule] }),
          clock: () => '2026-10-13T00:01:00.000Z' });
        assert.equal((await connection(normal, { socket: { remoteAddress: rule.sourceIp } })).decision, 'deny');
        assert.equal((await connection(normal, { socket: { remoteAddress: '192.0.2.56' } })).decision, 'allow');
      }
      assert.deepEqual([await noteRow(ids.a), await noteRow(ids.other)], unrelated);
    });
    await check('safe_recovery_responses_and_logs', async () => {
      assert.ok(logs.length > 0);
      for (const line of logs) {
        assert.ok(!line.includes(content) && !line.includes(title) && !line.includes(users.b));
        assert.ok(!line.includes('Bearer') && !line.includes('SERVER_KEY'));
      }
      assert.equal(JSON.stringify((await call(restore, 'b', 'POST', '/api/restore', { noteId: ids.b })).body).includes(content), false);
    });
    await check('policy_restore_preview_hash_and_boundaries', async () => {
      const directory = await mkdtemp(resolve(tmpdir(), 'aleph-recovery-policy-'));
      try {
        const baseline = await readFile(resolve(root, SOURCE_BASELINE_PATH));
        const current = Buffer.from(baseline.toString('utf8').replace('owner === subject', 'true'));
        for (const [relative, bytes] of [[MANIFEST_PATH, await readFile(resolve(root, MANIFEST_PATH))],
          [BACKUP_PATH, baseline], [TEST_POLICY_PATH, current], ['private/recovery/policy-audit.jsonl', 'existing-audit\n'],
          ['other-service/policy.json', 'other-service-sentinel']]) {
          await mkdir(dirname(resolve(directory, relative)), { recursive: true });
          await writeFile(resolve(directory, relative), bytes);
        }
        const sandboxDecider = async source => {
          const module = new SourceTextModule(source.toString('utf8'), { context: createContext({}) });
          await module.link(() => { throw new Error('No imports'); });
          await module.evaluate({ timeout: 100 });
          return module.namespace.decide;
        };
        assert.ok((await checkZones(await sandboxDecider(current))).some(x => !x.passed));
        const preview = await loadPolicyPreview(directory);
        assert.equal(preview.changed, true);
        await assert.rejects(restoreTestPolicy(directory, '0'.repeat(64)), { code: 'POLICY_PREVIEW_STALE' });
        assert.equal(policyHash(await readFile(resolve(directory, TEST_POLICY_PATH))), preview.target.sha256);
        const restored = await restoreTestPolicy(directory, preview.target.sha256);
        assert.equal(restored.restorePerformed, true);
        assert.deepEqual(await readFile(resolve(directory, TEST_POLICY_PATH)), baseline);
        assert.ok((await checkZones(await sandboxDecider(baseline))).every(x => x.passed));
        assert.match(await readFile(resolve(directory, 'private/recovery/policy-audit.jsonl'), 'utf8'), /^existing-audit\n/u);
        assert.equal(await readFile(resolve(directory, 'other-service/policy.json'), 'utf8'), 'other-service-sentinel');
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
    await check('post_restore_real_api_zone_checks', async () => {
      assert.ok((await checkResourceApis()).every(x => x.passed));
    });
    return results;
  } finally {
    config.step = original.step;
    globalThis.fetch = original.fetch;
    console.warn = original.warn;
    for (const [name, value] of [['SUPABASE_URL', original.url], ['SUPABASE_SECRET_KEY', original.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await db.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const results = await checkRecovery();
    console.log(JSON.stringify({ kind: 'local_postgresql_and_api', count: results.length,
      passed: results.every(x => x.passed), results }, null, 2));
  } catch {
    // Assertion operands could contain synthetic bodies or tokens. Keep CLI and
    // bundle output generic; node:test provides detailed diagnostics privately.
    console.error('로컬 복구 시험 실패: 운영 DB·자료에는 접근하지 않았습니다.');
    process.exitCode = 1;
  }
}
