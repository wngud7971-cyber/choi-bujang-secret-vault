import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import config from '../aleph.config.json' with { type: 'json' };
import evidence from '../docs/STEP12_EVIDENCE.json' with { type: 'json' };
import baseline from '../docs/STEP10_POLICY_BASELINE.json' with { type: 'json' };
import { RULE_IDS } from '../src/decider.mjs';
import { DETECTION_RULE_IDS } from '../src/detect.mjs';
import { DEVICE_RULE_IDS, RECOVERY_RULE_IDS } from '../src/policy-rule-ids.mjs';
import { summarize } from '../public/operations-model.js';

export function operationsSnapshot() {
  const savedHash = createHash('sha256').update(readFileSync(new URL('../recovery/policy-baseline/decider.mjs', import.meta.url))).digest('hex');
  return { schema: evidence.schema, step: config.step, inspectedCommit: evidence.inspectedCommit,
    servingCommit: /^[a-f0-9]{40}$/u.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '') ? process.env.VERCEL_GIT_COMMIT_SHA : null,
    recordedAt: evidence.recordedAt, deployedCommit: evidence.deployedCommit, deployedStep: evidence.deployedStep,
    policy: { status: 'configured', rules: [...RULE_IDS], detectionRules: [...DETECTION_RULE_IDS],
      deviceRules: [...DEVICE_RULE_IDS], recoveryRules: [...RECOVERY_RULE_IDS] },
    detection: evidence.detection, revocation: evidence.revocation,
    recovery: { ...evidence.recovery, baselineCommit: baseline.commit, baselineSha256: baseline.sha256,
      copyMatchesBaseline: savedHash === baseline.sha256, scope: baseline.scope },
    probes: evidence.probes, stageChecks: evidence.stageChecks, officialChecks: evidence.officialChecks,
    counts: { probes: summarize(evidence.probes), stages: summarize(evidence.stageChecks), official: summarize(evidence.officialChecks) } };
}
export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.url !== '/api/operations' || Object.keys(request.query ?? {}).length) {
    return response.status(400).json({ error: 'INVALID_OPERATIONS_REQUEST' });
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  try { return response.status(200).json(operationsSnapshot()); }
  catch { return response.status(503).json({ error: 'OPERATIONS_EVIDENCE_UNAVAILABLE' }); }
}
