import assert from 'node:assert/strict';
import { test } from 'node:test';
import config from '../aleph.config.json' with { type: 'json' };
import { runAttackChecks } from '../src/attack-check.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { decide } from '../src/decider.mjs';

test('10단계 제출: 20개 이내·실행한 로컬 복구 결과·운영 미실행·offline 무접속', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = () => { calls++; throw new Error('offline_must_not_fetch'); };
    const checks = await runAttackChecks({ ...config, step: 10 }, { expectedCommit: 'a'.repeat(40), offline: true });
    assert.equal(calls, 0);
    assert.equal(checks.length, 19);
    assert.equal(new Set(checks.map(x => x.attackId)).size, 19);
    for (const result of checks) {
      assert.equal(Object.keys(result).sort().join(','), 'attackId,expected,observed');
      assert.ok(result.expected.length <= 300 && result.observed.length <= 300);
      assert.ok(!result.observed.startsWith('불일치'), result.attackId);
    }
    for (const id of ['recovery_backup_validation_local', 'recovery_single_note_local', 'recovery_policy_restore_local']) {
      assert.match(checks.find(x => x.attackId === id).observed, /^로컬 복구 시험 통과/u);
    }
    for (const id of ['recovery_storage_live', 'recovery_live_b_restore', 'revocation_followup_live']) {
      assert.match(checks.find(x => x.attackId === id).observed, /^미실행/u);
    }
  } finally { globalThis.fetch = original; }
});

test('10단계 엔진 복구 경로: 정확한 POST만 기존 기기·추가 확인 검사를 거쳐 최종 API로 전달', () => {
  const { normal } = fixtureRequests();
  const request = { ...normal, path: '/api/restore', route: 'POST /api/restore', method: 'POST' };
  assert.equal(decide(request).decision, 'allow');
  assert.equal(decide({ ...request, deviceRegistered: false }).decision, 'deny');
  assert.equal(decide({ ...request, signals: undefined }).decision, 'step_up');
  for (const changes of [{ method: 'GET', route: 'GET /api/restore' },
    { path: '/api/restore/all' }, { path: '/api/restore?id=x' }, { route: 'POST /notes/:id' }]) {
    assert.equal(decide({ ...request, ...changes }).decision, 'deny');
  }
});

test('11단계 offline 제출은 로컬 시험이나 네트워크를 실행하지 않고 20개 미실행을 기록한다', async () => {
  const checks = await runAttackChecks({ ...config, step: 11 }, { expectedCommit: 'a'.repeat(40), offline: true });
  assert.equal(checks.length, 20);
  assert.ok(checks.every(item => item.observed.startsWith('not_run')));
  assert.ok(checks.some(item => item.attackId === 'device_signed_path_body_runtime'));
});
