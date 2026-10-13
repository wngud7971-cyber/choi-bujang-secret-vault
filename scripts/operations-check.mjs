import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runReadChecks } from '../src/submission-read-check.mjs';
import { stagePlan, officialPlan, summarize } from '../public/operations-model.js';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(resolve(root, 'aleph.config.json'), 'utf8'));
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const probes = [];
let deployedCommit = null;
let deployedStep = null;
await runReadChecks(config, { expectedCommit: commit, offline: process.argv.includes('--offline'),
  onObservation: row => probes.push(row),
  fetcher: async (url, options) => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    if (new URL(url).pathname === '/aleph.json') {
      try {
        const identity = await response.clone().json();
        if (/^[a-f0-9]{40}$/u.test(identity.commit ?? '')) deployedCommit = identity.commit;
        if (Number.isInteger(identity.step) && identity.step >= 1 && identity.step <= 12) deployedStep = identity.step;
      } catch { /* Invalid deployment identity is not evidence of this commit. */ }
    }
    return response;
  } });
const stageChecks = stagePlan().map(row => {
  const measured = probes.find(probe => probe.id === row.probeId);
  return measured ? { ...row, status: measured.status, httpStatus: measured.httpStatus,
    requestId: measured.requestId, checkedAt: measured.checkedAt, matchesExpected: measured.matchesExpected } : row;
});
const report = { schema: 'byteback.operations.v1', inspectedCommit: commit,
  recordedAt: new Date().toISOString(), publicAppUrl: config.publicAppUrl,
  deployedCommit, deployedStep, probes, stageChecks, officialChecks: officialPlan(),
  detection: { status: 'not_run', eventCount: null, reason: '운영 엔진 사건 조회 계약 미연결' },
  revocation: { status: 'not_run', revokedCount: null, reason: '운영 엔진 회수 결과 조회 계약 미연결' },
  recovery: { status: 'not_run', restoredCount: null, reason: '운영 복구 API 시험 미실행' } };
// Only allowlisted metadata is retained; never persist response bodies/headers.
writeFileSync(resolve(root, 'docs/STEP12_EVIDENCE.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ inspectedCommit: commit, deployedCommit, deployedStep,
  publicObservations: summarize(probes), stageChecks: summarize(stageChecks),
  official41: summarize(report.officialChecks) }, null, 2)}\n`);
