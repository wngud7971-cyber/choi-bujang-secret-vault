import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import {
  BASELINE_COMMIT, POLICY_FILE, BASELINE_SHA256, BACKUP_PATH, TEST_POLICY_PATH,
  MANIFEST_PATH, SOURCE_BASELINE_PATH, loadPolicyPreview, policyHash, previewPolicy,
} from '../src/policy-preview.mjs';
import { makeFixtureValue } from './fixture-values.mjs';

const fixtureErrorMarker = makeFixtureValue();

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, MANIFEST_PATH), 'utf8'));
const backup = await readFile(resolve(root, SOURCE_BASELINE_PATH));

async function fixture(t, current = backup) {
  const path = await mkdtemp(resolve(tmpdir(), 'aleph-policy-preview-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  for (const [relative, bytes] of [
    [MANIFEST_PATH, JSON.stringify(manifest)], [BACKUP_PATH, backup], [TEST_POLICY_PATH, current],
  ]) {
    await mkdir(dirname(resolve(path, relative)), { recursive: true });
    await writeFile(resolve(path, relative), bytes);
  }
  return path;
}

test('10단계 기준 사본: 지정한 9단계 최종 커밋의 실제 바이트와 해시가 일치', () => {
  assert.equal(policyHash(backup), BASELINE_SHA256);
  const result = previewPolicy({ manifest, backup, current: backup });
  assert.equal(result.baseline.commit, BASELINE_COMMIT);
  assert.equal(result.changed, false);
  assert.deepEqual(result.changes, []);
  assert.equal(result.operation, 'preview_only');
  assert.equal(result.restorePerformed, false);
});

test('10단계 비교: 독립된 두 변경은 사이의 정상 정책을 포함하지 않는 별도 범위', () => {
  const source = backup.toString('utf8').replaceAll('\r\n', '\n').split('\n');
  const current = [...source];
  current[20] = '// synthetic-policy-edit-one';
  current[100] = '// synthetic-policy-edit-two';
  const result = previewPolicy({ manifest, backup, current: Buffer.from(current.join('\n')) });
  assert.equal(result.changed, true);
  assert.deepEqual(result.changes, [
    { current: { start: 21, count: 1 }, backup: { start: 21, count: 1 } },
    { current: { start: 101, count: 1 }, backup: { start: 101, count: 1 } },
  ]);
  assert.equal(result.target.file, TEST_POLICY_PATH);
});

test('10단계 비교: 삭제된 정책과 추가된 정책의 복원 범위를 구분', () => {
  const source = backup.toString('utf8').replaceAll('\r\n', '\n').split('\n');
  const deleted = [...source];
  deleted.splice(20, 1);
  const removal = previewPolicy({ manifest, backup, current: Buffer.from(deleted.join('\n')) });
  assert.deepEqual(removal.changes, [
    { current: { start: 21, count: 0 }, backup: { start: 21, count: 1 } },
  ]);
  const added = [...source];
  added.splice(20, 0, '// synthetic-extra-rule');
  const insertion = previewPolicy({ manifest, backup, current: Buffer.from(added.join('\n')) });
  assert.deepEqual(insertion.changes, [
    { current: { start: 21, count: 1 }, backup: { start: 21, count: 0 } },
  ]);
});

test('10단계 검증: 사본과 검증 기록을 함께 바꿔도 지정한 커밋 해시를 우회하지 못함', () => {
  const corrupted = Buffer.from('synthetic-corrupted-policy');
  assert.throws(() => previewPolicy({ manifest, backup: corrupted, current: backup }),
    { code: 'POLICY_BACKUP_INVALID' });
  assert.throws(() => previewPolicy({ manifest: { ...manifest, sha256: policyHash(corrupted) },
    backup: corrupted, current: backup }), { code: 'POLICY_BASELINE_INVALID' });
  assert.throws(() => previewPolicy({ manifest: { ...manifest, scope: 'production' },
    backup, current: backup }), { code: 'POLICY_BASELINE_INVALID' });
  assert.throws(() => previewPolicy({ manifest: { ...manifest,
    verification: { ...manifest.verification, failed: 1 } }, backup, current: backup }),
  { code: 'POLICY_BASELINE_INVALID' });
});

test('10단계 비교: 시험 정책의 임의 본문을 실행하거나 출력하지 않음', () => {
  const secret = fixtureErrorMarker;
  const current = Buffer.from(`throw new Error('${secret}');\n`);
  const result = previewPolicy({ manifest, backup, current });
  assert.equal(result.changed, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('throw new Error'), false);
});

test('10단계 비교: 줄바꿈만 달라져도 해시 차이를 숨기지 않음', () => {
  const normal = backup.toString('utf8').replaceAll('\r\n', '\n');
  const current = Buffer.from(backup.includes(Buffer.from('\r\n'))
    ? normal : normal.replaceAll('\n', '\r\n'));
  const result = previewPolicy({ manifest, backup, current });
  assert.equal(result.changed, true);
  assert.equal(result.byteFormatChanged, true);
  assert.deepEqual(result.changes, []);
});

test('10단계 비교: 사본 누락·손상·잘못된 검증 기록은 차이 없이 중단', async t => {
  const path = await fixture(t);
  await rm(resolve(path, BACKUP_PATH));
  await assert.rejects(loadPolicyPreview(path), { code: 'POLICY_FILE_MISSING' });
  await writeFile(resolve(path, BACKUP_PATH), 'corrupted');
  await assert.rejects(loadPolicyPreview(path), { code: 'POLICY_BACKUP_INVALID' });
  await writeFile(resolve(path, MANIFEST_PATH), '{bad json');
  await assert.rejects(loadPolicyPreview(path), { code: 'POLICY_BASELINE_INVALID' });
});

test('10단계 비교: 시험 정책·다른 서비스·감사 기록의 실제 파일을 수정하지 않음', async t => {
  const current = Buffer.from(`${backup.toString('utf8')}\n// synthetic-test-edit\n`);
  const path = await fixture(t, current);
  const sentinels = ['src/decider.mjs', 'other-service/policy.json', 'xdr/alerts.log'];
  for (const relative of sentinels) {
    await mkdir(dirname(resolve(path, relative)), { recursive: true });
    await writeFile(resolve(path, relative), `sentinel:${relative}`);
  }
  const result = await loadPolicyPreview(path);
  assert.equal(result.changed, true);
  assert.deepEqual(await readFile(resolve(path, BACKUP_PATH)), backup);
  assert.deepEqual(await readFile(resolve(path, TEST_POLICY_PATH)), current);
  for (const relative of sentinels) {
    assert.equal(await readFile(resolve(path, relative), 'utf8'), `sentinel:${relative}`);
  }
});

test('10단계 비교: 시험 폴더 밖을 가리키는 디렉터리 연결은 거부', async t => {
  const path = await fixture(t);
  const outside = await mkdtemp(resolve(tmpdir(), 'aleph-policy-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(resolve(outside, 'decider.mjs'), backup);
  await rm(resolve(path, 'private/recovery/test-policy'), { recursive: true });
  await symlink(outside, resolve(path, 'private/recovery/test-policy'), 'junction');
  await assert.rejects(loadPolicyPreview(path), { code: 'POLICY_PATH_INVALID' });
});

test('10단계 비교: 파일 크기와 행 수 제한을 넘으면 중단', () => {
  assert.throws(() => previewPolicy({ manifest, backup, current: Buffer.alloc(65537) }),
    { code: 'POLICY_CURRENT_INVALID' });
  assert.throws(() => previewPolicy({ manifest, backup, current: Buffer.from('x\n'.repeat(1001)) }),
    { code: 'POLICY_FILE_TOO_LARGE' });
});
