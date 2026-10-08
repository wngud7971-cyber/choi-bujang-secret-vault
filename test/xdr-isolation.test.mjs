import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import jsPatterns from '../xdr/brute-force/patterns.mjs';

test('격리 실행용 JavaScript 패턴은 요구된 JSON 목록과 근거·기준이 같습니다', async () => {
  const jsonPatterns = JSON.parse(await readFile(new URL('../xdr/brute-force/patterns.json', import.meta.url), 'utf8'));
  assert.deepEqual(jsPatterns, jsonPatterns);
});

test('JSON import를 거부하는 VM에서도 공개 decide가 경보 28건을 처리합니다', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--experimental-vm-modules', 'scripts/xdr-isolation-check.mjs'], {
      cwd: new URL('../', import.meta.url), windowsHide: true, timeout: 15000,
      env: { ...process.env, TYPESAFE_API_KEY: '' },
    });
  assert.deepEqual(JSON.parse(stdout), {
    jsonImportGuardChecked: true, counts: { block: 10, alert: 9, record: 9 }, normalBlocked: 0,
  });
});
