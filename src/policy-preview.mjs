import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const BASELINE_COMMIT = '1b92fbab53958375a48cdd7ef0dc24890ebee77d';
export const POLICY_FILE = 'src/decider.mjs';
export const BASELINE_SHA256 = 'fe68d4c4e039466cea2bf739de7669692655f3da5422ce662c25575c312250a6';
export const BACKUP_PATH = 'private/recovery/baseline/decider.mjs';
export const TEST_POLICY_PATH = 'private/recovery/test-policy/decider.mjs';
export const MANIFEST_PATH = 'docs/STEP10_POLICY_BASELINE.json';
export const SOURCE_BASELINE_PATH = 'recovery/policy-baseline/decider.mjs';
const MAX_BYTES = 64 * 1024;
const MAX_LINES = 1000;

export const policyHash = bytes => createHash('sha256').update(bytes).digest('hex');

function fail(code) {
  // Do not echo file contents, arbitrary paths, or an underlying error message.
  throw Object.assign(new Error(code), { code });
}

export function verifyPolicyBackup(manifest, backup) {
  const verification = manifest?.verification;
  if (manifest?.schema !== 'aleph.policy-baseline.v1'
      || manifest.scope !== 'local_test' || manifest.service !== 'notes'
      || manifest.commit !== BASELINE_COMMIT || manifest.file !== POLICY_FILE
      || manifest.sha256 !== BASELINE_SHA256
      || verification?.kind !== 'local_regression'
      || verification.command !== 'node --experimental-vm-modules --test test/*.test.mjs'
      || verification.passed !== 145 || verification.failed !== 0
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(verification.verifiedAt ?? '')
      || !Number.isFinite(Date.parse(verification.verifiedAt))) fail('POLICY_BASELINE_INVALID');
  if (!Buffer.isBuffer(backup) || backup.length > MAX_BYTES
      || policyHash(backup) !== BASELINE_SHA256) fail('POLICY_BACKUP_INVALID');
}

export async function readPolicyFile(root, relative) {
  if (![BACKUP_PATH, TEST_POLICY_PATH, MANIFEST_PATH, SOURCE_BASELINE_PATH].includes(relative)) fail('POLICY_PATH_INVALID');
  // Fixed paths only. A directory/file link could otherwise leave the test area.
  let path = resolve(root);
  try {
    for (const part of relative.split('/')) {
      path = resolve(path, part);
      const info = await lstat(path);
      if (info.isSymbolicLink()) fail('POLICY_PATH_INVALID');
    }
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_BYTES) fail('POLICY_FILE_INVALID');
    const bytes = await readFile(path);
    if (bytes.length > MAX_BYTES) fail('POLICY_FILE_INVALID');
    return bytes;
  } catch (error) {
    if (error.code?.startsWith('POLICY_')) throw error;
    fail(error.code === 'ENOENT' ? 'POLICY_FILE_MISSING' : 'POLICY_FILE_UNREADABLE');
  }
}

// Return changed line ranges, never the untrusted policy text. LCS groups each
// independent edit so unchanged sections do not appear in the restore range.
function changedRanges(current, backup) {
  const lines = bytes => {
    const source = bytes.toString('utf8').replaceAll('\r\n', '\n');
    const result = source.split('\n');
    if (result.at(-1) === '') result.pop();
    return result;
  };
  const before = lines(current);
  const after = lines(backup);
  if (before.length > MAX_LINES || after.length > MAX_LINES) fail('POLICY_FILE_TOO_LARGE');
  const table = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j]
        ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const changes = [];
  let i = 0;
  let j = 0;
  let range;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      if (range) changes.push(range);
      range = undefined;
      i++;
      j++;
      continue;
    }
    range ??= { current: { start: i + 1, count: 0 }, backup: { start: j + 1, count: 0 } };
    if (j >= after.length || (i < before.length && table[i + 1][j] >= table[i][j + 1])) {
      range.current.count++;
      i++;
    } else {
      range.backup.count++;
      j++;
    }
  }
  if (range) changes.push(range);
  return changes;
}

export function previewPolicy({ manifest, backup, current }) {
  verifyPolicyBackup(manifest, backup);
  if (!Buffer.isBuffer(current) || current.length > MAX_BYTES) fail('POLICY_CURRENT_INVALID');
  const currentHash = policyHash(current);
  const changed = currentHash !== BASELINE_SHA256;
  const changes = changed ? changedRanges(current, backup) : [];
  return {
    schema: 'aleph.policy-preview.v1', scope: 'local_test', service: 'notes',
    baseline: { commit: BASELINE_COMMIT, file: POLICY_FILE, sha256: BASELINE_SHA256,
      verifiedAt: manifest.verification.verifiedAt, localTestsPassed: 145 },
    target: { file: TEST_POLICY_PATH, sha256: currentHash },
    backupFile: BACKUP_PATH,
    changed, changes,
    byteFormatChanged: changed && changes.length === 0,
    operation: 'preview_only',
    restorePerformed: false,
  };
}

export async function loadPolicyPreview(root) {
  const bytes = await readPolicyFile(root, MANIFEST_PATH);
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { fail('POLICY_BASELINE_INVALID'); }
  // Validate the backup before even reading the possibly corrupted test policy.
  const backup = await readPolicyFile(root, BACKUP_PATH);
  verifyPolicyBackup(manifest, backup);
  const current = await readPolicyFile(root, TEST_POLICY_PATH);
  return previewPolicy({ manifest, backup, current });
}
