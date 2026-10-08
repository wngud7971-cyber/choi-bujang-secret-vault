// Official TypeSafe System One HTTP contract: https://docs.typesafe.ai/api
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const PATTERNS = new Set(['repeated-failures', 'password-spraying', 'password-guessing']);
const count = value => Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;

export async function askJev(summary, { signal, apiKey = process.env.TYPESAFE_API_KEY,
  fetchImpl = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey !== apiKey.trim() || /[\r\n]/u.test(apiKey)) {
    throw new Error('jev_unconfigured');
  }
  if (!PATTERNS.has(summary?.pattern)) throw new Error('jev_invalid_summary');
  // Allowlist the state. Do not transmit alert text, addresses, accounts or
  // arbitrary properties supplied by a caller.
  const state = {
    pattern: summary.pattern, ruleLevel: count(summary.level),
    failedAttempts: count(summary.failures), affectedAccounts: count(summary.accountCount),
    windowSeconds: count(summary.windowSeconds),
    successAfterFailures: summary.successAfterFailures === true,
    unusualSource: summary.unusualSource === true,
    irregularIntervals: summary.irregularIntervals === true,
    passwordChange: summary.passwordChange === true,
    afterLockout: summary.afterLockout === true,
  };
  const response = await fetchImpl(new URL(JEV_ENDPOINT), {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'jev-latest', state,
      questions: { brute_force: {
        type: 'noul',
        instructions: 'Is this authentication activity a malicious online brute-force or password-spraying attempt under MITRE ATT&CK T1110? Judge the supplied facts. A pattern label is a hypothesis, not proof. A few failures followed by success, password-change mistakes, or a lockout retry can be benign. Do not assume missing timing or account evidence.',
        criteria: {
          true: 'Repeated systematic password guessing or spraying with evidence of malicious authentication attempts.',
          false: 'Benign authentication mistakes, ordinary password changes, or insufficient evidence of an attack.',
        },
      } },
    }),
  });
  if (!response.ok) throw new Error('jev_unavailable');
  const result = await response.json();
  const answer = result?.answers?.brute_force;
  if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
    throw new Error('jev_invalid_response');
  }
  // Probability that the attack proposition is true, not certainty in a benign label.
  return answer.noul;
}
