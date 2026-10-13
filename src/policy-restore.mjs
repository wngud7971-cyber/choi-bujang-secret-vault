import { appendFile, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { BACKUP_PATH, TEST_POLICY_PATH, BASELINE_SHA256, loadPolicyPreview,
  policyHash, readPolicyFile } from './policy-preview.mjs';

export async function restoreTestPolicy(root, expectedCurrentHash) {
  const stop = code => { throw Object.assign(new Error(code), { code }); };
  if (!/^[a-f0-9]{64}$/u.test(expectedCurrentHash ?? '')) stop('POLICY_CONFIRMATION_REQUIRED');
  const preview = await loadPolicyPreview(root);
  if (preview.target.sha256 !== expectedCurrentHash) stop('POLICY_PREVIEW_STALE');
  if (!preview.changed) return { ...preview, restored: false, alreadyAtBaseline: true };
  const auditPath = resolve(root, 'private/recovery/policy-audit.jsonl');
  try {
    const info = await lstat(auditPath);
    if (!info.isFile() || info.isSymbolicLink()) stop('POLICY_PATH_INVALID');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lockPath = resolve(root, 'private/recovery/.policy-restore.lock');
  let lock;
  const temporary = resolve(root, `private/recovery/test-policy/.restore-${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    try { lock = await open(lockPath, 'wx'); } catch { stop('POLICY_RESTORE_BUSY'); }
    const bytes = await readPolicyFile(root, BACKUP_PATH);
    const file = await open(temporary, 'wx');
    temporaryCreated = true;
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    if (policyHash(await readFile(temporary)) !== BASELINE_SHA256) stop('POLICY_BACKUP_INVALID');
    if (policyHash(await readPolicyFile(root, TEST_POLICY_PATH)) !== expectedCurrentHash) stop('POLICY_PREVIEW_STALE');
    const event = { event: 'test_policy_restore', service: 'notes', scope: 'local_test',
      baseline: preview.baseline.commit, beforeSha256: expectedCurrentHash, afterSha256: BASELINE_SHA256 };
    await appendFile(auditPath, `${JSON.stringify({ ...event, phase: 'prepared', at: new Date().toISOString() })}\n`);
    await rename(temporary, resolve(root, TEST_POLICY_PATH));
    temporaryCreated = false;
    if (policyHash(await readPolicyFile(root, TEST_POLICY_PATH)) !== BASELINE_SHA256) stop('POLICY_RESTORE_FAILED');
    await appendFile(auditPath, `${JSON.stringify({ ...event, phase: 'applied', at: new Date().toISOString() })}\n`);
    return { ...preview, operation: 'restore_test_policy', restorePerformed: true,
      restoredSha256: BASELINE_SHA256 };
  } finally {
    if (temporaryCreated) await unlink(temporary).catch(() => {});
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}
