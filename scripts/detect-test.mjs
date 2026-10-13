import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectionFixtures } from './fixture-9.mjs';

// This is a practice contract, not a live engine assertion or judge score.
export async function checkDetection(detect) {
  if (typeof detect !== 'function') throw new TypeError('src/detect.mjs에서 detect 함수를 내보내야 합니다.');
  const results = [];
  for (const item of detectionFixtures()) {
    const actual = await detect(item.events);
    const passed = actual && typeof actual === 'object' && !Array.isArray(actual)
      && Object.keys(actual).sort().join(',') === Object.keys(item.expected).sort().join(',')
      && Object.entries(item.expected).every(([key, value]) => actual[key] === value);
    results.push({ name: item.name, group: item.group, passed: Boolean(passed) });
  }
  return results;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { detect } = await import('../src/detect.mjs');
    const results = await checkDetection(detect);
    for (const item of results) process.stdout.write(`${item.passed ? '통과' : '확인 필요'} · ${item.name}\n`);
    process.stdout.write('가상 사건 연습: 실제 접속 회수·재접속 차단·경과 시간·심판 통과는 미확인입니다.\n');
    if (results.some(item => !item.passed)) process.exitCode = 1;
  } catch {
    process.stderr.write('탐지 연습 첫 오류: 입력 형식 또는 탐지 실행을 확인하세요.\n');
    process.exitCode = 1;
  }
}
