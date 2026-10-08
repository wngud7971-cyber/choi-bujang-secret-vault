// Official HTTP contract: https://docs.typesafe.ai/api
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const PATTERNS = new Set(['sql-injection', 'script-injection', 'path-traversal']);
const count = value => Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;

export async function askJev(summary, { signal, apiKey = globalThis.process?.env?.TYPESAFE_API_KEY,
  fetchImpl = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey !== apiKey.trim() || /[\r\n]/u.test(apiKey)
    || typeof fetchImpl !== 'function') throw new Error('jev_unconfigured');
  if (!Array.isArray(summary?.patterns) || summary.patterns.length === 0
    || summary.patterns.some(id => !PATTERNS.has(id))) throw new Error('jev_invalid_summary');
  // Build an allowlist, rather than forwarding caller-provided objects/text.
  const state = { candidatePatterns: [...new Set(summary.patterns)], ruleLevel: count(summary.level),
    attempts: count(summary.attempts), repeatedSource: summary.repeatedSource === true,
    sqlSyntax: summary.sqlSyntax === true, scriptTag: summary.scriptTag === true,
    repeatedParentSegments: summary.repeatedParentSegments === true,
    tutorialContext: summary.tutorialContext === true, deniedSignal: summary.deniedSignal === true,
    separatorOnly: summary.separatorOnly === true, successAfterAttempt: summary.successAfterAttempt === true,
    unusualLengthOnly: summary.unusualLengthOnly === true };
  const response = await fetchImpl(new URL(JEV_ENDPOINT), {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'jev-latest', state, questions: { web_injection: {
      type: 'noul',
      instructions: 'Is this web activity a malicious SQL injection, script injection, or path traversal attempt in the investigation context of MITRE ATT&CK T1190? Judge only the supplied facts. Candidate labels and high rule levels are hypotheses, not proof. A separator alone, a SQL/script course title, a long URL, a single quote, or an ordinary relative path is insufficient. Do not invent missing SQL syntax, tags, traversal, or repeated-source evidence. Tutorial context and an explicit absence of attack markers can be benign.',
      criteria: { true: 'Evidence supports a malicious injection or traversal attempt.',
        false: 'Benign web activity, tutorial terms, or insufficient evidence of malicious injection or traversal.' },
    } } }),
  });
  if (!response.ok) throw new Error('jev_unavailable');
  const result = await response.json();
  const answer = result?.answers?.web_injection;
  if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
    throw new Error('jev_invalid_response');
  }
  return answer.noul;
}
