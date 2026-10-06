import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'data.json');
const output = resolve(root, 'public', 'data.json');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (config.step !== 1 && config.step !== 2) {
  throw new Error('현재 빌드는 1·2단계를 지원합니다. 해당 단계의 자료 보호 구현을 확인하세요.');
}
const data = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(data.notes)) {
  throw new Error('실습용 공개 자료 형식을 확인하세요. 실제 학생 자료를 넣으면 안 됩니다.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
if (config.step === 1) {
  await copyFile(source, output);
  console.log('실습용 공개 자료를 public/data.json에 복사했습니다.');
} else {
  if (data.notes.length !== 0) {
    throw new Error('2단계에서는 원본 data.json에도 메모 본문을 남기면 안 됩니다.');
  }
  await writeFile(output, `${JSON.stringify({ sampleMarker: config.sampleMarker, notes: [] }, null, 2)}\n`, 'utf8');
  console.log('메모가 없는 public/data.json을 생성했습니다. 자료는 /api/notes에서 읽습니다.');
}
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
