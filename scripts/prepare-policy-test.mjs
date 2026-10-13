import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  BACKUP_PATH, TEST_POLICY_PATH, MANIFEST_PATH, SOURCE_BASELINE_PATH,
  readPolicyFile, verifyPolicyBackup,
} from '../src/policy-preview.mjs';

// Initialize only the isolated practice files, with exclusive creation. Never
// replace an existing backup, test policy, operational policy, or audit file.
try {
  if (process.argv.length !== 2) throw Object.assign(new Error(), { code: 'POLICY_ARGUMENT_INVALID' });
  const root = resolve(import.meta.dirname, '..');
  const manifest = JSON.parse((await readPolicyFile(root, MANIFEST_PATH)).toString('utf8'));
  // Ship the verified policy source so ZIP uploads need no local Git history.
  const backup = await readPolicyFile(root, SOURCE_BASELINE_PATH);
  verifyPolicyBackup(manifest, backup);
  // Check every existing parent before mkdir/write so links cannot redirect writes.
  for (const relative of [BACKUP_PATH, TEST_POLICY_PATH]) {
    let parent = root;
    for (const part of relative.split('/').slice(0, -1)) {
      parent = resolve(parent, part);
      try {
        const info = await lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw Object.assign(new Error(), { code: 'POLICY_PATH_INVALID' });
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  // An existing invalid backup must stop preparation, not be overwritten.
  let backupExists = false;
  try {
    const existing = await readPolicyFile(root, BACKUP_PATH);
    verifyPolicyBackup(manifest, existing);
    backupExists = true;
  } catch (error) {
    if (error.code !== 'POLICY_FILE_MISSING') throw error;
  }
  // Check the target before writing either file. Existing practice edits stay intact.
  let currentExists = false;
  try {
    await readPolicyFile(root, TEST_POLICY_PATH);
    currentExists = true;
  } catch (error) {
    if (error.code !== 'POLICY_FILE_MISSING') throw error;
  }
  for (const [relative, exists] of [[BACKUP_PATH, backupExists], [TEST_POLICY_PATH, currentExists]]) {
    if (exists) continue;
    const path = resolve(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, backup, { flag: 'wx' });
  }
  // Read back the physical copy; producing a file alone is not verification.
  verifyPolicyBackup(manifest, await readPolicyFile(root, BACKUP_PATH));
  console.log('9단계 최종 커밋의 정책 사본을 다시 읽어 검증했습니다. 기존 시험 파일은 보존합니다.');
  console.log('이 사본은 지금 준비한 로컬 시험 기준이며 과거 운영 백업의 존재를 증명하지 않습니다.');
} catch (error) {
  const code = /^POLICY_[A-Z_]+$/u.test(error.code ?? '') ? error.code : 'POLICY_PREPARATION_FAILED';
  process.stderr.write(`시험 정책 준비 중단: ${code}. 기존 파일은 덮어쓰지 않습니다.\n`);
  process.exitCode = 1;
}
