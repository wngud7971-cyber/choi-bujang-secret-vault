// Pure event interpretation: no files, Node builtins or packages.
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

const ipv4 = value => value.split('.').length === 4 && value.split('.').every(part =>
  /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) <= 255);

export function validIp(value) {
  if (typeof value !== 'string') return false;
  if (ipv4(value)) return true;
  if (!/^[a-f\d:.]+$/iu.test(value) || !value.includes(':')) return false;
  const sides = value.split('::');
  if (sides.length > 2) return false;
  const units = side => {
    if (!side) return 0;
    let count = 0;
    for (const part of side.split(':')) {
      if (/^[a-f\d]{1,4}$/iu.test(part)) count += 1;
      else if (ipv4(part) && value.endsWith(part)) count += 2;
      else return NaN;
    }
    return count;
  };
  const count = sides.reduce((sum, side) => sum + units(side), 0);
  return Number.isFinite(count) && (sides.length === 2 ? count < 8 : count === 8);
}

// Account identifiers stay inside correlation. The public reader pseudonymizes
// them; neither accounts nor source addresses are passed to Jev or stored logs.
export function fields(alert) {
  const candidate = alert?.data?.srcuser ?? alert?.account;
  const sourceIp = alert?.data?.srcip ?? alert?.srcip;
  const level = alert?.rule?.level ?? alert?.level;
  return {
    timestamp: Number.isFinite(Date.parse(alert?.timestamp)) ? new Date(alert.timestamp).toISOString() : null,
    srcip: validIp(sourceIp) ? sourceIp : null,
    account: typeof candidate === 'string' && candidate.length > 0 ? candidate : null,
    level: Number.isInteger(level) && level >= 0 && level <= 16 ? level : 0,
    description: redact(alert?.rule?.description ?? alert?.description),
  };
}

export function evidence(alert) {
  const row = fields(alert);
  const count = /^(?:0|[1-9]\d{0,6})$/u.test(String(alert?.data?.count ?? '')) ? Number(alert.data.count)
    : Number(/실패[^\d]{0,12}(\d{1,7})\s*건/u.exec(row.description)?.[1] ?? 0);
  const accounts = typeof alert?.data?.accounts === 'string' ? alert.data.accounts.split(',') : [];
  return { ...row, id: safeId(alert?.id), count,
    accountCount: new Set(accounts.filter(value => /^user\d{1,4}$/u.test(value))).size,
    technique: Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.some(value => /^T1110(?:\.00[1-4])?$/u.test(value)),
  };
}
