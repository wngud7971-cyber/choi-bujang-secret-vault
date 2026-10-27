import { copyFile, mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'data.json');
const output = resolve(root, 'public', 'data.json');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(config.step)) {
  throw new Error('현재 빌드는 1~12단계를 지원합니다. 해당 단계의 자료 보호 구현을 확인하세요.');
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
    throw new Error('2단계부터는 원본 data.json에도 메모 본문을 남기면 안 됩니다.');
  }
  await writeFile(output, `${JSON.stringify({ notes: [] }, null, 2)}\n`, 'utf8');
  console.log('메모와 1단계 확인 표시가 없는 public/data.json을 생성했습니다. 자료는 /api/notes에서 읽습니다.');
}
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}

// Web output only. This is not the course's package-app/approved desktop host.
// Keep the original public files and API functions in place for past work.
if (process.argv.includes('--agent-web')) {
  const destination = resolve(root, 'web-build');
  const legacy = ['access-state.js', 'app-shell.js', 'device-client.js', 'manifest.webmanifest',
    'offline.html', 'operations-model.js', 'operations.css', 'operations.html', 'operations.js',
    'request-binding.js', 'sw.js', 'icons/app-192.png', 'icons/app-512.png', 'data.json',
    ...(!process.argv.includes('--local') ? ['aleph.json'] : [])];
  const client = ['public/index.html', 'public/app.js', 'public/style.css', 'public/ai-connect.mjs',
    'public/vulnerabilities-view.mjs', 'student/extension.mjs', 'student/pc-status-view.mjs',
    'student/connection-status-view.mjs', ...['alekov-ai-explain', 'alekov-app-icon',
      'alekov-connect-approval', 'alekov-connection-unknown', 'alekov-empty-records']
      .map(name => `public/assets/alekov/${name}.webp`)];
  const entries = [
    ...legacy.map(name => [resolve(root, 'public', name), name]),
    [resolve(root, 'public/index.html'), 'library/index.html'],
    ...client.map(name => [resolve(root, 'on-client', name), name.replace(/^public\//, '')]),
  ];
  const allowed = new Set(entries.map(([, name]) => name));
  async function checkOutput(directory, prefix = '') {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error('WEB_OUTPUT_LINK_REJECTED');
      if (entry.isDirectory()) {
        if (![...allowed].some(path => path.startsWith(name + '/'))) throw Error('WEB_OUTPUT_UNEXPECTED_FILE');
        await checkOutput(resolve(directory, entry.name), name + '/');
      } else if (!entry.isFile() || !allowed.has(name)) throw Error('WEB_OUTPUT_UNEXPECTED_FILE');
    }
  }
  async function directory(path) {
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('WEB_OUTPUT_LINK_REJECTED');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(path);
    }
  }
  await directory(destination);
  await checkOutput(destination);
  for (const [sourcePath, name] of entries) {
    const info = await lstat(sourcePath);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('WEB_SOURCE_LINK_REJECTED');
    let parent = destination;
    for (const part of name.split('/').slice(0, -1)) {
      parent = resolve(parent, part); await directory(parent);
    }
    const target = resolve(destination, name);
    if (name === 'index.html') {
      const html = await readFile(sourcePath, 'utf8');
      if (!html.includes('<html lang="ko" data-runtime="local">')) throw Error('WEB_RUNTIME_MARKER_MISSING');
      await writeFile(target, html.replace('<html lang="ko" data-runtime="local">', '<html lang="ko" data-runtime="web">'), 'utf8');
    } else await copyFile(sourcePath, target);
  }
  console.log('최신 케셰브 웹 화면: web-build · 기존 자료실: /library/ · PC 실측 미연결');
}
