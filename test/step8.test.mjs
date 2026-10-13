import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, createContext } from 'node:vm';
import { decide } from '../src/decider.mjs';
import { checkZones, zoneFixtures } from '../scripts/fixture-8.mjs';
import { parseResourceTarget } from '../src/resource-path.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

test('8단계: 본인 조회·수정·목록은 허용하고 교차 소유자와 학생 공지 수정은 거부', async () => {
  const results = await checkZones(decide);
  assert.equal(results.length, 16);
  assert.ok(results.every(result => result.passed), JSON.stringify(results));
});

test('8단계: 경로·메서드·서비스·기기·주체의 모호한 조합과 위조 역할을 거부', () => {
  const request = zoneFixtures()[0].request;
  for (const changes of [
    { path: '/notes/owners/another_learner/' + request.path.split('/').at(-1), role: 'teacher' },
    { path: request.path + '/export' }, { path: request.path + '/' },
    { path: request.path.replace('owners/', 'owners/%2f') },
    { path: '/notes/owners/learner_fixture/../export' },
    { path: request.path + '?action=export' }, { path: request.path + '#export' },
    { route: 'GET /notes/:id' }, { method: 'PATCH' }, { method: 'get' },
    { service: 'admin' }, { deviceId: undefined }, { subjectId: undefined },
    { subjectId: 'another_learner', role: 'teacher', identity: { role: 'teacher' } },
    { queryLength: 1 }, { querySha256: 'a'.repeat(64) },
  ]) assert.equal(decide({ ...request, ...changes }).decision, 'deny', JSON.stringify(changes));
  const notice = zoneFixtures().find(item => item.name === 'student_notice_edit').request;
  assert.equal(decide({ ...notice, role: 'teacher', body: { role: 'teacher' },
    headers: { 'x-role': 'teacher' } }).decision, 'deny');
  assert.equal(decide({ ...request, deviceRegistered: false }).reasonCode, 'device_not_registered');
});

test('8단계: import 없는 엔진 격리 실행에서도 실제 구역 규칙을 실행', async () => {
  const module = new SourceTextModule(await readFile(new URL('../src/decider.mjs', import.meta.url), 'utf8'),
    { context: createContext({}) });
  await module.link(() => { throw new Error('imports forbidden'); });
  await module.evaluate({ timeout: 1000 });
  assert.ok((await checkZones(module.namespace.decide)).every(result => result.passed));
});

test('8단계 API 경로: 기능 쿼리·이중 ID·인코딩·이동·export를 거부하고 자원 종류를 구분', () => {
  const id = '44444444-4444-4444-8444-444444444444';
  assert.equal(parseResourceTarget(`/api/notes/${id}`, 'notes').resourceId, `notes:${id}`);
  assert.equal(parseResourceTarget(`/api/announcements/${id}`, 'announcements').resourceId, `announcements:${id}`);
  assert.equal(parseResourceTarget(`/api/notes?id=${id}`, 'notes').id, id);
  for (const path of [
    '/api/notes?export=true', '/api/notes?role=teacher', '/api/notes?owner_id=' + id,
    `/api/notes?id=${id}&id=${id}`, `/api/notes/${id}?id=${id}`,
    '/api/notes/export', '/api/notes/%65xport', '/api/notes/../announcements',
    '//api/notes', '/api/notes/' + id + '/export', '/api/notes?%69d=' + id,
  ]) assert.ok(parseResourceTarget(path, 'notes').error, path);
});

test('8단계 제출: 20개 제한과 실제·가상·미실행 구분을 유지하고 본문을 기록하지 않음', async () => {
  const oldFetch = globalThis.fetch;
  const config = { step: 8, publicAppUrl: 'https://student-defense.vercel.app',
    repoUrl: 'https://github.com/student-a/aleph-defense', sampleMarker: 'SAMPLE_NOTE_1',
    originalApiUrl: 'https://training-project.supabase.co/rest/v1/training_notes',
    allowedRoutes: ['GET /api/notes'] };
  const expectedCommit = 'a'.repeat(40);
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(options.body, undefined);
      assert.equal(options.headers, undefined);
      if (url.pathname === '/') return new Response('<html>DO_NOT_RECORD_THIS_BODY</html>');
      if (url.pathname === '/data.json') return Response.json({ notes: [] });
      if (url.pathname === '/aleph.json') return Response.json({ schema: 'aleph.defense.deployment.v1',
        step: 8, repoUrl: config.repoUrl, commit: expectedCommit, originalApiUrl: config.originalApiUrl,
        allowedRoutes: config.allowedRoutes });
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const results = await runAttackChecks(config, { expectedCommit });
    assert.equal(calls, 6);
    assert.equal(results.length, 20);
    assert.equal(new Set(results.map(result => result.attackId)).size, 20);
    assert.match(results.find(result => result.attackId === 'resource_api_local_boundary').observed, /^로컬 API 가상 시험 통과/u);
    for (const id of ['resource_api_live_accounts', 'engine_resource_routing_live']) {
      assert.match(results.find(result => result.attackId === id).observed, /^미실행/u);
    }
    assert.ok(!JSON.stringify(results).includes('DO_NOT_RECORD_THIS_BODY'));
    calls = 0;
    const offline = await runAttackChecks(config, { expectedCommit, offline: true });
    assert.equal(calls, 0, 'offline packaging must never request the deployed app');
    assert.equal(offline.length, 20);
    for (const result of offline.filter(item => /^(public_|anonymous_|deployment_)/u.test(item.attackId))) {
      assert.match(result.observed, /^미실행/u);
    }
  } finally { globalThis.fetch = oldFetch; }
});
