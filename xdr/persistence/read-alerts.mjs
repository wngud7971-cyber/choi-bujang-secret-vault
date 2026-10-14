import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAlert } from '../web-injection/read-alerts.mjs';

// Inspection only: reuse the established five-field redaction and pseudonyms.
export { readAlert };
export async function readAlerts(path = new URL('../fixtures/persistence.json', import.meta.url)) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'persistence'
    || !Array.isArray(fixture.alerts)) throw new Error('경보 묶음 형식이 아닙니다.');
  return fixture.alerts.map(readAlert);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { for (const row of await readAlerts()) console.log(JSON.stringify(row)); }
  catch { console.error('경보 읽기 실패'); process.exitCode = 1; }
}
