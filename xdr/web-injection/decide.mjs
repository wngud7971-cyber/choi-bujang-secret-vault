import { matchPatterns, POLICY, reviewSummary } from './signals.mjs';
import { askJev } from './jev.mjs';

const result = (confidence, reason) => ({
  action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record', confidence, reason,
});

export function createDecider({ jev = askJev, timeoutMs = 1500 } = {}) {
  const recent = [];
  const usage = { reviewsRequested: 0, responsesReceived: 0, fallbackAlerts: 0 };
  const decide = async function decide(alert) {
    const match = matchPatterns(alert);
    if (match.normal) return result(0.1, '해당 없음');
    let attempts = match.row.attempts;
    // Correlate only individual, unambiguous signatures from the same source.
    // Keep sanitized metadata, never original requests or accounts.
    if (match.matched.length && !match.signals.tutorialContext && !match.signals.deniedSignal
      && match.row.srcip && match.row.timestamp && attempts <= 1) {
      const at = Date.parse(match.row.timestamp);
      const ids = match.matched.map(p => p.id);
      const identity = match.row.id === 'unknown' ? `${match.row.timestamp}|${ids.join(',')}` : match.row.id;
      recent.push({ source: match.row.srcip, at, identity, ids });
      if (recent.length > 2048) recent.shift();
      const unique = new Set(recent.filter(item => item.source === match.row.srcip
        && at - item.at >= 0 && at - item.at <= POLICY.windowSeconds * 1000
        && item.ids.some(id => ids.includes(id))).map(item => item.identity));
      attempts = Math.max(attempts, unique.size);
    }
    const reason = match.candidates.map(p => p.name).join(' / ')
      + (match.matched.length ? '' : ' (후보·근거 미확정)');
    const correlatedClear = match.matched.length > 0 && !match.signals.tutorialContext && !match.signals.deniedSignal
      && Boolean(match.row.srcip && match.row.timestamp) && match.row.level >= POLICY.minimumLevel
      && attempts >= POLICY.minimumAttempts;
    if (match.clear || correlatedClear) return result(0.95, reason);

    usage.reviewsRequested += 1;
    let timer;
    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    try {
      if (typeof globalThis.setTimeout !== 'function') throw new Error('jev_timeout_unavailable');
      const confidence = await Promise.race([
        Promise.resolve().then(() => jev(reviewSummary(match, attempts), { signal: controller?.signal })),
        new Promise((_, reject) => {
          timer = globalThis.setTimeout(() => { controller?.abort(); reject(new Error('jev_timeout')); }, timeoutMs);
        }),
      ]);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('jev_invalid_response');
      usage.responsesReceived += 1;
      // Jev supplies review confidence, not authority to change an ambiguous
      // event into a source block or silently downgrade it to a record.
      return { action: 'alert', confidence, reason };
    } catch {
      usage.fallbackAlerts += 1;
      return result(0.5, reason);
    } finally {
      if (typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(timer);
    }
  };
  decide.getReviewStats = () => ({ ...usage });
  return decide;
}

export const decide = createDecider();
