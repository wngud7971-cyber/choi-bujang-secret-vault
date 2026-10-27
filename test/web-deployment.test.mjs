import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {renderPcStatusView} from '../on-client/student/pc-status-view.mjs';

const project = new URL('../', import.meta.url);
const appSource = await readFile(new URL('on-client/public/app.js', project), 'utf8');
const fixtureIdentity = {
  VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'fixture-student',
  VERCEL_GIT_REPO_SLUG: 'fixture-vault', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'fixture-vault.vercel.app',
};
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'keshev-web-test-'));
  await mkdir(join(path, 'scripts'));
  for (const file of ['scripts/build-public.mjs', 'scripts/deployment-identity.mjs', 'aleph.config.json', 'data.json']) {
    await cp(new URL(file, project), join(path, file));
  }
  await cp(new URL('public/', project), join(path, 'public'), {recursive: true});
  await mkdir(join(path, 'on-client'));
  for (const directory of ['public', 'student']) {
    await cp(new URL('on-client/' + directory + '/', project), join(path, 'on-client', directory), {recursive: true});
  }
  // Explicit test canaries, not real credentials or real PC records.
  await writeFile(join(path, '.env'), 'PRIVATE_TEST_CANARY=must_not_publish\n');
  await mkdir(join(path, 'on-client', '.local', 'pc-status'), {recursive: true});
  await writeFile(join(path, 'on-client', '.local', 'pc-status', 'history.jsonl'), 'PRIVATE_TEST_HISTORY_CANARY\n');
  return path;
}
function build(path, local = true) {
  return execFileSync(process.execPath, ['scripts/build-public.mjs', '--agent-web', ...(local ? ['--local'] : [])],
    {cwd: path, env: {...process.env, ...fixtureIdentity}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 15000});
}
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), prefix + entry.name + '/'));
    else result.push(prefix + entry.name);
  }
  return result.sort();
}

test('웹 빌드는 최신 UI·학생 모듈·이미지를 포함하고 원본 자료실과 개인 자료를 보존한다', async () => {
  const path = await fixture();
  const before = await readFile(join(path, 'public/index.html'));
  build(path);
  const output = join(path, 'web-build');
  const html = await readFile(join(output, 'index.html'), 'utf8');
  assert.match(html, /data-runtime="web"/);
  assert.match(html, /케셰브/); assert.match(html, /내 PC 상태/); assert.match(html, /연결과 기록/);
  assert.match(html, /웹 배포 화면 · PC 실측 미연결/); assert.match(html, /href="\/library\/"/);
  assert.deepEqual(await readFile(join(output, 'library/index.html')), before);
  assert.deepEqual(await readFile(join(path, 'public/index.html')), before);
  assert.match(await readFile(join(path, 'on-client/public/index.html'), 'utf8'), /data-runtime="local"/);
  for (const name of ['app.js', 'style.css', 'ai-connect.mjs', 'vulnerabilities-view.mjs',
    'student/extension.mjs', 'student/pc-status-view.mjs', 'student/connection-status-view.mjs',
    'assets/alekov/alekov-app-icon.webp', 'assets/alekov/alekov-ai-explain.webp']) {
    const original = name.startsWith('student/') ? name : 'public/' + name;
    assert.deepEqual(await readFile(join(output, name)), await readFile(join(path, 'on-client', original)), name);
  }
  for (const name of ['app-shell.js', 'device-client.js', 'access-state.js', 'operations.html', 'operations.js',
    'operations-model.js', 'operations.css', 'request-binding.js', 'manifest.webmanifest', 'sw.js', 'icons/app-192.png']) {
    assert.deepEqual(await readFile(join(output, name)), await readFile(join(path, 'public', name)), name);
  }
  const published = await files(output);
  assert.ok(published.every(name => !/(?:^|\/)(?:\.env|\.local|src|tools|node_modules|private|\.git)(?:[/.]|$)/.test(name)));
  assert.deepEqual(JSON.parse(await readFile(join(output, 'data.json'), 'utf8')), {notes: []});
  build(path); // Repeat builds overwrite only known outputs, without deleting originals.
  assert.deepEqual(await files(output), published);
});

test('실제 배포 식별자 경로와 기존 API 라우팅을 유지하고 승인되지 않은 잔여 파일이 있으면 배포 출력을 거부한다', async () => {
  const path = await fixture(); build(path, false);
  const identity = JSON.parse(await readFile(join(path, 'web-build/aleph.json'), 'utf8'));
  assert.equal(identity.commit, fixtureIdentity.VERCEL_GIT_COMMIT_SHA);
  const config = JSON.parse(await readFile(new URL('vercel.json', project), 'utf8'));
  assert.equal(config.outputDirectory, 'web-build'); assert.match(config.buildCommand, /--agent-web/);
  assert.deepEqual(config.rewrites, [{source: '/api/operations', destination: '/api/ai?__byteback_route=operations'}]);
  await writeFile(join(path, 'web-build', 'unexpected-private.txt'), 'PRIVATE_TEST_CANARY');
  let failure;
  try {build(path, false);} catch (error) {failure = error;}
  assert.ok(failure); assert.match(failure.stderr.toString(), /WEB_OUTPUT_UNEXPECTED_FILE/);
  assert.equal(await readFile(join(path, 'web-build/unexpected-private.txt'), 'utf8'), 'PRIVATE_TEST_CANARY');
});

function requestContext(runtime) {
  let calls = 0;
  const context = vm.createContext({document: {documentElement: {dataset: {runtime}}}, AbortController,
    setTimeout, clearTimeout, REQUEST_TIMEOUT_MS: 1000,
    fetch: async () => {calls++; return {ok: true, json: async () => ({ok: true, meta: {mode: 'disconnected', checkedAt: null}, data: {fixture: true}})};},
  });
  const start = appSource.indexOf('function normalizeMeta(');
  const end = appSource.indexOf('// AI requests', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(appSource.slice(start, end) + '\nglobalThis.callRequest=request;', context);
  return {context, calls: () => calls};
}
test('웹 화면의 조회·AI·조치 요청은 이전 자료실 API나 localhost에 보내지 않고 미연결로 남긴다', async () => {
  const {context, calls} = requestContext('web');
  for (const path of ['/api/me', '/api/apps', '/api/pc-status', '/api/pc-status/sample', '/api/connection-status/read', '/api/ai/check', '/api/actions/prepare']) {
    const result = await context.callRequest(path, {method: 'POST', body: {}});
    assert.equal(result.ok, false); assert.equal(result.error.code, 'LOCAL_AGENT_NOT_CONNECTED');
    assert.equal(result.meta.checkedAt, null); assert.equal(result.meta.mode, 'unknown');
  }
  assert.equal(calls(), 0);
  const connect = appSource.slice(appSource.indexOf('async function loadConnectModule()'), appSource.indexOf('async function showConnectHelp'));
  assert.ok(connect.indexOf("runtime === 'web'") < connect.indexOf("await import('/ai-connect.mjs')"));
});
test('로컬 화면은 기존 서버 요청을 계속 사용한다', async () => {
  const {context, calls} = requestContext('local');
  const result = await context.callRequest('/api/pc-status');
  assert.equal(result.ok, true); assert.equal(result.data.fixture, true); assert.equal(calls(), 1);
});

test('웹 PC 갱신은 기존 자료도 버리고 측정·저장·자동 반복을 시작하지 않는다', async () => {
  let requests = 0, scheduled = 0;
  const context = vm.createContext({document: {visibilityState: 'visible'}, state: {view: 'pc'},
    pcState: {environment: 'web', data: {latest: {fixture: true}}, paused: false}, pcSequence: 0, pcTimer: null, pcController: null,
    clearTimeout: () => {}, setTimeout: () => {scheduled++;}, renderStudent: () => {}, request: () => {requests++;},
  });
  const start = appSource.indexOf('// PC-only polling.'), end = appSource.indexOf('function renderAllStudent()', start);
  vm.runInContext(appSource.slice(start, end) + '\nglobalThis.updatePc=updatePcStatus;', context);
  await context.updatePc({manual: true});
  assert.equal(context.pcState.status, 'unavailable'); assert.equal(context.pcState.data, null);
  assert.equal(context.pcState.paused, true); assert.equal(context.pcState.recording, false);
  assert.equal(requests, 0); assert.equal(scheduled, 0);
});

test('웹 카드에는 확인 불가·단위·측정 시각 없음만 표시하고 숫자·실측 그래프를 만들지 않는다', () => {
  class E {
    constructor(tag) {this.tag = tag; this.children = []; this.ownText = '';}
    set textContent(value) {this.ownText = String(value);}
    get textContent() {return this.ownText + this.children.map(node => node.textContent).join('\n');}
    appendChild(node) {this.children.push(node);}
  }
  const previous = globalThis.document;
  globalThis.document = {createElement: tag => new E(tag), createElementNS: () => {throw Error('web must not draw measured charts');}};
  try {
    const node = renderPcStatusView({environment: 'web', recording: true, data: {latest: {cpu: {value: 12345}}}});
    assert.match(node.textContent, /CPU 사용률/); assert.match(node.textContent, /메모리 사용량/); assert.match(node.textContent, /C: 디스크 남은 공간/);
    assert.equal(node.textContent.match(/확인 불가/g).length, 3);
    assert.equal(node.textContent.match(/측정 시각: 없음/g).length, 3);
    assert.doesNotMatch(node.textContent, /12345|실측 자동 갱신 중|마지막 실제 측정/);
  } finally {globalThis.document = previous;}
});
