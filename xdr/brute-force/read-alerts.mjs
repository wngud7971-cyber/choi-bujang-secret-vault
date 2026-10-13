import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fields } from './alert-fields.mjs';
export { redact, safeId, evidence } from './alert-fields.mjs';

export function readAlert(alert) {
  const row = fields(alert);
  const account = row.account ?? '';
  return { ...row,
    account: /^(?:user\d{1,4}|account-[a-f0-9]{12})$/u.test(account) ? account : account
      ? `account-${createHash('sha256').update(account).digest('hex').slice(0, 12)}` : null,
  };
}

export async function readAlerts(path = new URL('../fixtures/brute-force.json', import.meta.url)) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'brute-force' || !Array.isArray(fixture.alerts)) {
    throw new Error('경보 묶음 형식이 아닙니다.');
  }
  return fixture.alerts.map(readAlert);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { for (const row of await readAlerts()) console.log(JSON.stringify(row)); }
  catch { console.error('경보 읽기 실패'); process.exitCode = 1; }
}
