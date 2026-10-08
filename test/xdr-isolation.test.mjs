import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import jsPatterns from '../xdr/brute-force/patterns.mjs';
import { validIp } from '../xdr/brute-force/alert-fields.mjs';
import { isIP } from 'node:net';

test('격리 실행용 JavaScript 패턴은 요구된 JSON 목록과 근거·기준이 같습니다', async () => {
  const jsonPatterns = JSON.parse(await readFile(new URL('../xdr/brute-force/patterns.json', import.meta.url), 'utf8'));
  assert.deepEqual(jsPatterns, jsonPatterns);
});

test('JSON·내장 모듈·npm import와 호스트 기능이 없는 VM에서도 decide가 경보 28건을 처리합니다', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--experimental-vm-modules', 'scripts/xdr-isolation-check.mjs'], {
      cwd: new URL('../', import.meta.url), windowsHide: true, timeout: 15000,
      env: { ...process.env, TYPESAFE_API_KEY: '' },
    });
  assert.deepEqual(JSON.parse(stdout), {
    importGuardsChecked: true,
    moduleFiles: ['xdr/brute-force/alert-fields.mjs', 'xdr/brute-force/decide.mjs',
      'xdr/brute-force/jev.mjs', 'xdr/brute-force/patterns.mjs'],
    counts: { block: 10, alert: 9, record: 9 }, normalBlocked: 0,
  });
});

test('순수 주소 검사는 IPv4·IPv6와 잘못된 주소를 구분합니다', () => {
  for (const value of ['192.0.2.1', '0.0.0.0', '255.255.255.255', '::', '::1', '2001:db8::1',
    '::ffff:192.0.2.1', '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:192.0.2.1',
    '', 'localhost', '999.1.1.1', '01.2.3.4', '1.2.3', ':1', '1:', '1::2::3', '2001:xyz::1',
    '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', ':::1', '192.0.2.1/24']) {
    assert.equal(validIp(value), Boolean(isIP(value)), value);
  }
});
