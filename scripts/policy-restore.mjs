import { resolve } from 'node:path';
import { loadPolicyPreview } from '../src/policy-preview.mjs';
import { restoreTestPolicy } from '../src/policy-restore.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--confirm')) {
    throw Object.assign(new Error(), { code: 'POLICY_ARGUMENT_INVALID' });
  }
  const root = resolve(import.meta.dirname, '..');
  const preview = await loadPolicyPreview(root);
  console.log(JSON.stringify(preview, null, 2));
  if (!args.length) console.log('복원 전 위 변경 범위를 확인하고 --confirm 뒤에 현재 시험 파일의 SHA-256을 넣으세요.');
  else console.log(JSON.stringify(await restoreTestPolicy(root, args[1]), null, 2));
} catch (error) {
  const code = /^POLICY_[A-Z_]+$/u.test(error.code ?? '') ? error.code : 'POLICY_RESTORE_FAILED';
  console.error(`시험 정책 복원 중단: ${code}`);
  process.exitCode = 1;
}
