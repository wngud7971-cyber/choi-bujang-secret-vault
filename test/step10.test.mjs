import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRecovery } from '../scripts/recovery-check.mjs';

test('10단계: 실제 PostgreSQL 함수·서명 검증 API로 복구와 기존 방어를 재시험', async t => {
  const results = await checkRecovery();
  assert.equal(results.length, 16);
  for (const result of results) await t.test(result.name, () => assert.equal(result.passed, true));
});
