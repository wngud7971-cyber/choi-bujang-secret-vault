import config from './patterns.json' with { type: 'json' };
import { evidence } from './read-alerts.mjs';
import { askJev } from './jev.mjs';

const patterns = Object.fromEntries(config.patterns.map(pattern => [pattern.id, pattern]));
const result = (confidence, reason) => ({ action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record', confidence, reason });

export function matchPatterns(alert) {
  const row = evidence(alert);
  const text = row.description;
  const failures = /실패/u.test(text);
  const auth = /로그인|비밀번호|계정|잠금/u.test(text) || row.technique;
  const spraying = /같은 비밀번호/u.test(text) && /계정/u.test(text);
  const accountNumber = /(?:계정\s*(\d+)개|계정\s*(\d+)\s*개)/u.exec(text);
  const accountCount = Math.max(row.accountCount, Number(accountNumber?.[1] ?? accountNumber?.[2] ?? 0));
  const guessing = /한 글자씩|바꿔|같은 간격/u.test(text);
  const pattern = spraying ? patterns['password-spraying'] : guessing ? patterns['password-guessing'] : patterns['repeated-failures'];
  const signal = auth && (failures || spraying);
  const min = pattern.conditions;
  const minutes = /(\d+)분/u.exec(text);
  const withinWindow = !minutes || Number(minutes[1]) * 60 <= patterns['repeated-failures'].conditions.windowSeconds;
  const clear = Boolean(signal && withinWindow && row.srcip && row.account && row.timestamp && row.level >= min.minimumLevel
    && (spraying ? accountCount >= min.minimumAccounts : row.count >= min.minimumFailures));
  const normal = !signal || (row.level <= 3 && row.count <= 1 && !spraying);
  return { row, pattern, clear, normal };
}

export function correlateAlert(alert, recent) {
  const row = evidence(alert);
  if (!row.srcip || !row.account || !row.timestamp || row.count > 1 || !/로그인.*실패/u.test(row.description)
    || /뒤에?\s*성공|그 뒤 성공/u.test(row.description)) return alert;
  const time = Date.parse(row.timestamp);
  const windowMs = patterns['repeated-failures'].conditions.windowSeconds * 1000;
  const identities = new Set();
  for (const item of recent) {
    const event = evidence(item);
    const age = time - Date.parse(event.timestamp);
    if (event.srcip === row.srcip && event.account === row.account && event.count <= 1
      && age >= 0 && age <= windowMs && /로그인.*실패/u.test(event.description)
      && !/뒤에?\s*성공|그 뒤 성공/u.test(event.description)) identities.add(`${event.id}|${event.timestamp}`);
  }
  if (identities.size < patterns['repeated-failures'].conditions.minimumFailures) return alert;
  return { ...alert, rule: { ...alert.rule, level: 10 }, data: { ...alert.data, count: String(identities.size) } };
}

export function createDecider({ jev = askJev, timeoutMs = 1500 } = {}) {
  const recent = [];
  return async function decide(alert) {
    recent.push(alert);
    if (recent.length > 2048) recent.shift();
    // Never add summarized Wazuh counts together or count duplicate events twice.
    const match = matchPatterns(correlateAlert(alert, recent));
    if (match.normal) return result(0.1, '해당 없음');
    if (match.clear) return result(0.95, match.pattern.name);
    const controller = new AbortController();
    let timer;
    try {
      // Send only numbers and pattern identifiers, no original logs, accounts, IPs or passwords.
      const confidence = await Promise.race([
        Promise.resolve().then(() => jev({ schema: 'aleph.xdr.jev.v1', pattern: match.pattern.id,
          level: match.row.level, failures: match.row.count, accountCount: match.row.accountCount,
        }, { signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('jev_timeout')); }, timeoutMs); }),
      ]);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('jev_invalid_response');
      return result(confidence, match.pattern.name);
    } catch {
      return result(0.5, match.pattern.name);
    } finally { clearTimeout(timer); }
  };
}

export const decide = createDecider();
export { afterRun } from './integrate.mjs';
