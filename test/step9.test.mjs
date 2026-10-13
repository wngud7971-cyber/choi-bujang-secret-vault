import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detect, normalizeDetectionEvent, normalizeDetectionEvents } from '../src/detect.mjs';
import { reads, proposal, detectionFixtures } from '../scripts/fixture-9.mjs';
import { checkDetectionIsolation } from '../scripts/detect-isolation-check.mjs';
import { decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

for (const fixture of detectionFixtures()) test(`9단계 탐지: ${fixture.name}`, () => {
  const before = JSON.stringify(fixture.events);
  assert.deepEqual(detect(fixture.events), fixture.expected);
  assert.equal(JSON.stringify(fixture.events), before, 'input remains unchanged');
});

test('9단계 입력: 비밀값·실명·본문·경로·주소·헤더·접근자를 읽거나 반환하지 않음', () => {
  const events = reads(121);
  for (const event of events) {
    for (const key of ['body', 'token', 'realName', 'headers', 'path', 'ip']) {
      Object.defineProperty(event, key, { enumerable: true, get() { throw new Error('secret_field_read'); } });
    }
    Object.defineProperty(event.signals, 'region', { enumerable: true, get() { throw new Error('region_read'); } });
    event.identity = { sub: event.subjectId, name: 'SECRET_NAME_SENTINEL' };
  }
  const safe = normalizeDetectionEvents(events);
  assert.equal(safe.length, 121);
  assert.ok(!JSON.stringify(safe).includes('SECRET_NAME_SENTINEL'));
  assert.deepEqual(Object.keys(safe[0]).sort(),
    ['at', 'subjectId', 'deviceId', 'deviceRegistered', 'method', 'decision', 'requestId', 'classId', 'projectId', 'signals'].sort());
  assert.deepEqual(detect(events), proposal());
});

test('9단계 입력: 잘못된 시각·식별자·판정·부분 구역과 충돌 신원은 회수 근거에서 제외', () => {
  const event = reads(1)[0];
  const invalid = [null, [], 'invalid',
    { ...event, at: '2026-02-30T00:00:00.000Z' }, { ...event, at: '2026-10-01T00:00:00+09:00' },
    { ...event, subjectId: 'name@example.invalid' }, { ...event, decision: 'approved' },
    { ...event, identity: { sub: 'different_fixture' } }, { ...event, classId: undefined },
    { ...event, requestId: 'not_a_uuid' }, Object.create(event),
  ];
  for (const value of invalid) assert.equal(normalizeDetectionEvent(value), null);
  for (const deviceId of [undefined, null, '', 'A'.repeat(16), 'a'.repeat(15), {}]) {
    assert.deepEqual(detect(reads(200).map(item => ({ ...item, deviceId }))), { action: 'observe' });
  }
  assert.deepEqual(detect([...invalid, ...reads(120)]), { action: 'observe' });
  assert.throws(() => detect(null), { name: 'TypeError', message: 'invalid_detection_events' });
});

test('9단계 입력: 허용 항목의 접근자·상속 값도 확인된 증거로 취급하지 않음', () => {
  const event = reads(1)[0];
  Object.defineProperty(event, 'subjectId', { get() { throw new Error('must_not_run'); } });
  assert.equal(normalizeDetectionEvent(event), null);
  const events = reads(200).map(item => ({ ...item, signals: Object.create(item.signals) }));
  assert.deepEqual(detect(events), { action: 'observe' });
});

test('9단계 분리: 반·프로젝트·기기·시간창·호출을 넘어서 사건을 합산하지 않음', () => {
  for (const changes of [{ classId: 'other_class' }, { projectId: 'other_project' }]) {
    assert.deepEqual(detect([...reads(100), ...reads(100, { requestOffset: 1000 }).map(event =>
      ({ ...event, ...changes }))]), { action: 'observe' });
  }
  assert.deepEqual(detect(reads(100)), { action: 'observe' });
  assert.deepEqual(detect(reads(100, { requestOffset: 1000 })), { action: 'observe' });
  assert.deepEqual(detect(reads(121)), proposal());
  assert.deepEqual(detect([]), { action: 'observe' });
});

test('9단계 중복: 같은 요청 ID의 충돌 복사본은 입력 순서와 무관하게 제외', () => {
  const events = reads(121);
  const conflict = { ...events[0], deviceId: 'bbbbbbbbbbbbbbbb' };
  for (const batch of [[...events, conflict], [conflict, ...events], [...events, conflict].reverse()]) {
    assert.deepEqual(detect(batch), { action: 'observe' });
  }
  assert.deepEqual(detect([...events, { ...events[0], token: 'SECRET_IGNORED_SENTINEL' }]), proposal());
});

test('9단계 결정: 가장 먼저 임계치를 넘은 기기 한 개만 제안하고 정상 판정 형식을 보존', () => {
  const early = reads(121, { deviceId: 'cccccccccccccccc', intervalMs: 1000, requestOffset: 1000 });
  assert.deepEqual(detect([...reads(121), ...early]), proposal('learner_fixture', 'cccccccccccccccc'));
  const { normal } = fixtureRequests();
  const before = decide(normal);
  detect(reads(121));
  assert.deepEqual(decide(normal), before);
  assert.equal(before.decision, 'allow');
  assert.equal(Object.keys(before).sort().join(','), 'decision,reasonCode,requestId,ruleIds,schema');
});

test('9단계 격리: 외부 모듈·서버·파일·네트워크 없이 가상 탐지 실행', async () => {
  assert.deepEqual(await checkDetectionIsolation(), { count: 22, passed: true });
});

test('9단계 제출: 20개 점검 제한·기존 방어·운영 미실행과 offline 무접속을 보존', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = () => { calls++; throw new Error('offline_must_not_fetch'); };
    const checks = await runAttackChecks({ step: 9, publicAppUrl: 'https://student-defense.vercel.app',
      repoUrl: 'https://github.com/student-a/aleph-defense', sampleMarker: 'SAMPLE_NOTE_1' },
    { expectedCommit: 'a'.repeat(40), offline: true });
    assert.equal(calls, 0);
    assert.equal(checks.length, 20);
    assert.equal(new Set(checks.map(item => item.attackId)).size, 20);
    for (const item of checks) {
      assert.equal(Object.keys(item).sort().join(','), 'attackId,expected,observed');
      assert.ok(item.expected.length <= 300 && item.observed.length <= 300);
      assert.ok(!item.observed.startsWith('불일치'), item.attackId);
    }
    for (const id of ['revocation_followup_live', 'revocation_elapsed_time_live',
      'resource_api_live_accounts', 'engine_resource_routing_live']) {
      assert.match(checks.find(item => item.attackId === id).observed, /^미실행/u);
    }
    assert.match(checks.find(item => item.attackId === 'resource_api_local_boundary').observed, /^로컬 API 가상 시험 통과/u);
    assert.match(checks.find(item => item.attackId === 'detection_isolated_execution').observed, /^로컬 탐지 격리 가상 시험 통과/u);
  } finally { globalThis.fetch = previousFetch; }
});
