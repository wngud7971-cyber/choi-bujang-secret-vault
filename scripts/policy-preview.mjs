import { resolve } from 'node:path';
import { loadPolicyPreview } from '../src/policy-preview.mjs';

try {
  if (process.argv.length !== 2) throw Object.assign(new Error(), { code: 'POLICY_ARGUMENT_INVALID' });
  const result = await loadPolicyPreview(resolve(import.meta.dirname, '..'));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const code = /^POLICY_[A-Z_]+$/u.test(error.code ?? '') ? error.code : 'POLICY_PREVIEW_FAILED';
  process.stderr.write(`정책 비교 중단: ${code}. 검증된 사본과 시험 파일을 확인하세요.\n`);
  process.exitCode = 1;
}
