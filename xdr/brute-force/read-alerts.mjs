import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function redact(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\u0000-\u001f]/gu, ' ')
    .replace(/\bBearer\s+\S+|-----BEGIN[\s\S]*?PRIVATE KEY-----[\s\S]*?-----END[\s\S]*?PRIVATE KEY-----/giu, '[REDACTED]')
    .replace(/\b(?:sb_(?:secret|publishable)_|sk-)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .replace(/["']?(?:password|passwd|pwd|token|secret|api[_-]?key|authorization|비밀번호|암호)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/\S+|[A-Za-z0-9_+/=-]{32,}/giu, '[REDACTED]')
    .slice(0, 500);
}

export function safeId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/iu.test(value)
    && redact(value) === value ? value : 'unknown';
}

export function readAlert(alert) {
  // Accept the original Wazuh event and this reader's five-field output.
  const candidate = alert?.data?.srcuser ?? alert?.account;
  const account = typeof candidate === 'string' ? candidate : '';
  const sourceIp = alert?.data?.srcip ?? alert?.srcip;
  const level = alert?.rule?.level ?? alert?.level;
  return {
    timestamp: Number.isFinite(Date.parse(alert?.timestamp)) ? new Date(alert.timestamp).toISOString() : null,
    srcip: typeof sourceIp === 'string' && isIP(sourceIp) ? sourceIp : null,
    account: /^(?:user\d{1,4}|account-[a-f0-9]{12})$/u.test(account) ? account : account
      ? `account-${createHash('sha256').update(account).digest('hex').slice(0, 12)}` : null,
    level: Number.isInteger(level) && level >= 0 && level <= 16 ? level : 0,
    description: redact(alert?.rule?.description ?? alert?.description),
  };
}

// Extra numeric evidence stays inside the analyzer, never in the five-field output.
export function evidence(alert) {
  const row = readAlert(alert);
  const count = /^(?:0|[1-9]\d{0,6})$/u.test(String(alert?.data?.count ?? '')) ? Number(alert.data.count)
    : Number(/실패[^\d]{0,12}(\d{1,7})\s*건/u.exec(row.description)?.[1] ?? 0);
  const accounts = typeof alert?.data?.accounts === 'string' ? alert.data.accounts.split(',') : [];
  return { ...row, id: safeId(alert?.id), count,
    accountCount: new Set(accounts.filter(value => /^user\d{1,4}$/u.test(value))).size,
    technique: Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.some(value => /^T1110(?:\.00[1-4])?$/u.test(value)),
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
