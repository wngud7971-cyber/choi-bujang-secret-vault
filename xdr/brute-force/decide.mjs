import config from './patterns.mjs';
import { evidence } from './alert-fields.mjs';
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
  // Extracted rows have no MITRE metadata. An elevated failure summary still
  // needs review, but deterministic blocking requires authentication evidence.
  const signal = (auth && (failures || spraying)) || (failures && row.level > 3);
  const min = pattern.conditions;
  // The five-field reader omits the raw accounts list. Explicit repeated
  // spraying in a high-level summary is still evidence, not a missing list.
  const explicitSpray = spraying && min.allowExplicitRepeatedSpray
    && /같은 주소/u.test(text) && /여러 계정/u.test(text) && /연속|반복/u.test(text);
  const manyGuessingAccounts = guessing && failures && accountCount >= (min.minimumAccounts ?? Infinity);
  const minutes = /(\d+)분/u.exec(text);
  const withinWindow = !minutes || Number(minutes[1]) * 60 <= patterns['repeated-failures'].conditions.windowSeconds;
  const clear = Boolean(auth && signal && withinWindow && row.srcip && row.account && row.timestamp && row.level >= min.minimumLevel
    && (spraying ? accountCount >= min.minimumAccounts || explicitSpray : row.count >= min.minimumFailures || manyGuessingAccounts));
  const normal = !signal || (row.level <= 3 && row.count <= 1 && !spraying);
  const seconds = /(\d+)초/u.exec(text);
  return { row, pattern, clear, normal, accountCount,
    windowSeconds: minutes ? Number(minutes[1]) * 60 : seconds ? Number(seconds[1]) : null,
    successAfterFailures: /뒤(?:에)?\s*성공|그 뒤 성공/u.test(text),
    unusualSource: /평소와 다른/u.test(text), irregularIntervals: /고르지/u.test(text),
    passwordChange: /비밀번호 변경 화면/u.test(text), afterLockout: /잠금 뒤/u.test(text),
  };
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
  const usage = { reviewsRequested: 0, responsesReceived: 0, fallbackAlerts: 0 };
  const decide = async function decide(alert) {
    recent.push(alert);
    if (recent.length > 2048) recent.shift();
    // Never add summarized Wazuh counts together or count duplicate events twice.
    const match = matchPatterns(correlateAlert(alert, recent));
    if (match.normal) return result(0.1, '해당 없음');
    if (match.clear) return result(0.95, match.pattern.name);
    usage.reviewsRequested += 1;
    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    let timer;
    try {
      // Send only numbers and pattern identifiers, no original logs, accounts, IPs or passwords.
      const confidence = await Promise.race([
        Promise.resolve().then(() => jev({ schema: 'aleph.xdr.jev.v1', pattern: match.pattern.id,
          level: match.row.level, failures: match.row.count, accountCount: match.accountCount,
          windowSeconds: match.windowSeconds, successAfterFailures: match.successAfterFailures,
          unusualSource: match.unusualSource, irregularIntervals: match.irregularIntervals,
          passwordChange: match.passwordChange, afterLockout: match.afterLockout,
        }, { signal: controller?.signal })),
        new Promise((_, reject) => {
          if (typeof globalThis.setTimeout !== 'function') { reject(new Error('jev_timeout_unavailable')); return; }
          timer = globalThis.setTimeout(() => { controller?.abort(); reject(new Error('jev_timeout')); }, timeoutMs);
        }),
      ]);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('jev_invalid_response');
      usage.responsesReceived += 1;
      return result(confidence, match.pattern.name);
    } catch {
      usage.fallbackAlerts += 1;
      return result(0.5, match.pattern.name);
    } finally { if (typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(timer); }
  };
  decide.getReviewStats = () => ({ ...usage });
  return decide;
}

export const decide = createDecider();
