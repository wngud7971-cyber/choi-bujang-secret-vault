import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { createZtnaConnection } from '../src/ztna.mjs';
import { checkDecider } from '../scripts/decider-test.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

test('6단계 계약: 등록 기기는 허용하고 미등록 기기는 거부합니다', async () => {
  const results = await checkDecider({ decide, ruleIds: RULE_IDS });
  assert.equal(results.length, 2);
  assert.ok(results.every(item => item.passed));
});

test('기기 등록 값이 없거나 참이 아닌 값이면 허용하지 않습니다', async () => {
  const request = fixtureRequests().normal;
  for (const deviceRegistered of [false, undefined, null, 'true', 1]) {
    const response = await decide({ ...request, deviceRegistered });
    assert.equal(response.decision, 'deny');
    assert.equal(response.reasonCode, 'device_not_registered');
    assert.deepEqual(response.ruleIds, ['device_registered']);
    assert.deepEqual(Object.keys(response).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  }
});

test('XDR 규칙 읽기 실패도 미등록 기기의 기본 거부를 풀지 않습니다', async () => {
  const connected = createZtnaConnection({ rules: async () => { throw new Error('unavailable'); } });
  const request = fixtureRequests().normal;
  const transport = { socket: { remoteAddress: '192.0.2.60' } };
  assert.equal((await connected(request, transport)).decision, 'allow');
  assert.equal((await connected({ ...request, deviceRegistered: false }, transport)).decision, 'deny');
});
