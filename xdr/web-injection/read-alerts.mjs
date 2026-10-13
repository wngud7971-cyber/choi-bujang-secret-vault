import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only these five fields leave the reader. Request URLs, headers and bodies
// remain in the original fixture and are never printed.
export function redact(value) {
  if (typeof value !== 'string') return '';
  let text = value;
  // Encoded credentials must be filtered just like ordinary text.
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = text.replace(/(?:%[a-f\d]{2})+/giu, part => {
      try { return decodeURIComponent(part); } catch { return '[REDACTED]'; }
    });
    if (decoded === text) break;
    text = decoded;
  }
  return text
    .replace(/-----BEGIN[^\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END[^\r\n]*PRIVATE KEY-----|$)/giu, '[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/giu, '[REDACTED]')
    .replace(/["']?(?:password|passwd|pwd|(?:access|refresh|id)[_-]?token|token|secret|api[_-]?key|authorization|cookie|session(?:[_-]?id)?|비밀번호|암호)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, '[REDACTED]')
    .replace(/\b(?:sb_(?:secret|publishable)_|sk-)[A-Za-z\d_-]+|\beyJ[A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+/gu, '[REDACTED]')
    .replace(/[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}|https?:\/\/\S+|[A-Za-z\d_+/=-]{32,}/giu, '[REDACTED]')
    .replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]/gu, ' ')
    .slice(0, 500);
}

export function readAlert(alert) {
  const timestamp = alert?.timestamp;
  const srcip = alert?.data?.srcip ?? alert?.srcip;
  const account = alert?.data?.srcuser ?? alert?.account;
  const level = alert?.rule?.level ?? alert?.level;
  return {
    timestamp: typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp))
      ? new Date(timestamp).toISOString() : null,
    srcip: typeof srcip === 'string' && isIP(srcip) ? srcip : null,
    // Preserve fictional classroom identifiers; pseudonymize other accounts.
    account: typeof account === 'string' && account.length > 0
      ? (/^(?:user\d{1,4}|account-[a-f\d]{12})$/u.test(account) ? account
        : `account-${createHash('sha256').update(account).digest('hex').slice(0, 12)}`) : null,
    level: Number.isInteger(level) && level >= 0 && level <= 16 ? level : 0,
    description: redact(alert?.rule?.description ?? alert?.description),
  };
}

export async function readAlerts(path = new URL('../fixtures/web-injection.json', import.meta.url)) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'web-injection'
    || !Array.isArray(fixture.alerts)) {
    throw new Error('경보 묶음 형식이 아닙니다.');
  }
  return fixture.alerts.map(readAlert);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { for (const row of await readAlerts()) console.log(JSON.stringify(row)); }
  catch { console.error('경보 읽기 실패'); process.exitCode = 1; }
}
