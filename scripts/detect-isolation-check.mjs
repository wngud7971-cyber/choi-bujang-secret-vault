import { readFile } from 'node:fs/promises';
import { SourceTextModule, createContext } from 'node:vm';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDetection } from './detect-test.mjs';

export async function checkDetectionIsolation() {
  const module = new SourceTextModule(await readFile(new URL('../src/detect.mjs', import.meta.url), 'utf8'),
    { context: createContext({}) });
  await module.link(() => { throw new Error('detection_import_forbidden'); });
  await module.evaluate({ timeout: 1000 });
  const results = await checkDetection(module.namespace.detect);
  return { count: results.length, passed: results.every(result => result.passed) };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await checkDetectionIsolation();
    process.stdout.write(`탐지 격리 가상 시험 ${result.passed ? '통과' : '실패'}: ${result.count}건; 실제 심판 아님\n`);
    if (!result.passed) process.exitCode = 1;
  } catch {
    process.stderr.write('탐지 격리 가상 시험 실패: 외부 모듈·서버 기능 없이 실행되는지 확인하세요.\n');
    process.exitCode = 1;
  }
}
