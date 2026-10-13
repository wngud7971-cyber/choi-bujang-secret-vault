import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkResourceApis } from '../scripts/zone-api-check.mjs';

test('8단계 직접 API: 소유자 경계·학생 사칭·정상 강사 수정·권한 회수·안전한 거부 기록', async () => {
  const results = await checkResourceApis();
  assert.equal(results.length, 9);
  assert.ok(results.every(result => result.passed));
});
