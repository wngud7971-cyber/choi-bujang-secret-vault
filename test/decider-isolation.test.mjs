import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

test('기기 판정은 import와 서버 기능 없는 격리 환경에서 실행됩니다', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--experimental-vm-modules', 'scripts/decider-isolation-check.mjs'], {
      cwd: new URL('../', import.meta.url), windowsHide: true, timeout: 15000,
    });
  const result = JSON.parse(stdout);
  assert.equal(result.isolatedLoad, 'passed');
  assert.equal(result.imports, 0);
  assert.equal(result.importGuardChecked, true);
  assert.deepEqual(result.results.map(item => [item.name, item.decision, item.reasonCode]), [
    ['registered', 'allow', 'approved'],
    ['unregistered', 'deny', 'device_not_registered'],
    ['missing', 'deny', 'device_not_registered'],
    ['null', 'deny', 'device_not_registered'],
    ['string', 'deny', 'device_not_registered'],
    ['number', 'deny', 'device_not_registered'],
  ]);
  assert.deepEqual(result.step7Results.map(item => [item.name, item.decision]), [
    ['compound', 'step_up'], ['verified_fixture', 'allow'],
    ['missing_signals', 'step_up'], ['unavailable', 'allow'],
  ]);
});
