import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import vm from 'node:vm';
import {setTimeout as waitForSample} from 'node:timers/promises';
import {measurePc, createPcStatusService, isPcSample} from '../on-client/src/pc-status.mjs';
import {createOnServer} from '../on-client/src/server.mjs';
import {validPcPayload, validPcSample, mergePcHistory, pcDifference, pcSeries, renderPcStatusView} from '../on-client/student/pc-status-view.mjs';

const GIB = 1024 ** 3;
const metric = (value, key, at) => ({
  status: 'ok', value, unit: key === 'cpu' ? '%' : 'GiB', percent: key === 'cpu' ? value : value,
  ...(key === 'cpu' ? {} : {totalGiB: 100}), measuredAt: at, source: 'test fixture', scope: key,
});
const sample = (time, cpu = 25) => {
  const at = new Date(time).toISOString();
  return {kind: 'measured', measuredAt: at, cpu: metric(cpu, 'cpu', at),
    memory: metric(30, 'memory', at), disk: metric(50, 'disk', at)};
};
const unavailable = at => ({status: 'unavailable', value: null, unit: '%', measuredAt: at,
  source: 'test fixture', reason: '시험용 읽기 실패'});
const temporary = () => mkdtemp(join(tmpdir(), 'keshev-pc-test-'));
const deterministic = overrides => {
  let reads = 0;
  return measurePc({
    readCpu: () => [{times: reads++ ? {user: 900, nice: 0, sys: 0, idle: 1100, irq: 0}
      : {user: 200, nice: 0, sys: 0, idle: 800, irq: 0}}],
    totalmem: () => 16 * GIB, freemem: () => 4 * GIB, wait: async () => {},
    readDisk: async () => ({bsize: 4096n, frsize: 4096n, blocks: 104857600n, bavail: 10485760n}),
    diskPath: 'C:\\', ...overrides,
  });
};

test('CPU 구간 사용률과 메모리·디스크의 단위 및 일반 사용자 가용 공간 계산', async () => {
  const result = await deterministic();
  assert.equal(result.cpu.value, 70);
  assert.equal(result.memory.value, 12);
  assert.equal(result.memory.percent, 75);
  assert.equal(result.disk.value, 40);
  assert.equal(result.disk.percent, 10);
  assert.equal(result.disk.totalGiB, 400);
  assert.ok(isPcSample(result));
  assert.ok(validPcSample(result));
});

test('읽지 못한 값은 null과 이유로 남기고 정상 0으로 대체하지 않는다', async () => {
  const result = await deterministic({
    readCpu: () => [], totalmem: () => {throw Error('private details');},
    readDisk: async () => {throw Object.assign(Error('private disk path'), {code: 'EACCES'});},
  });
  for (const key of ['cpu', 'memory', 'disk']) {
    assert.equal(result[key].status, 'unavailable');
    assert.equal(result[key].value, null);
  }
  assert.match(result.disk.reason, /권한/);
  assert.ok(!JSON.stringify(result).includes('private'));
  const partial = await deterministic({readDisk: async () => {throw Error('unreadable');}});
  assert.equal(partial.cpu.status, 'ok');
  assert.equal(partial.memory.status, 'ok');
  assert.equal(partial.disk.status, 'unavailable');
  const unchanged = await deterministic({readCpu: () => [{times: {user: 0, nice: 0, sys: 0, idle: 0, irq: 0}}]});
  assert.equal(unchanged.cpu.status, 'unavailable');
});

test('동시 조회와 5초 이내 재조회가 중복 기록을 만들지 않고 재생성한 서비스가 복원한다', async () => {
  const directory = await temporary(); let time = Date.now(), calls = 0;
  const options = {directory, clock: () => new Date(time), measure: async () => {calls++; return sample(time);}};
  const service = createPcStatusService(options);
  await Promise.all([service.sample(), service.sample(), service.sample()]);
  assert.equal(calls, 1);
  assert.equal((await service.history()).history.length, 1);
  time += 4999;
  await service.sample(); assert.equal(calls, 1);
  time++;
  await service.sample(); assert.equal(calls, 2);
  const reopened = await createPcStatusService(options).history();
  assert.equal(reopened.storage.status, 'ok');
  assert.equal(reopened.history.length, 2);
  assert.equal(reopened.latest.measuredAt, new Date(time).toISOString());
  assert.ok(validPcPayload(reopened, true));
});

test('24시간 밖 기록과 미래 기록은 숨기고 다음 저장에서 만료 기록을 정리한다', async () => {
  const directory = await temporary(); let time = Date.now();
  const service = createPcStatusService({directory, clock: () => new Date(time), measure: async () => sample(time)});
  await service.sample();
  time += 86400001;
  assert.equal((await service.history()).history.length, 0);
  await service.sample();
  const lines = (await readFile(join(directory, 'history.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).measuredAt, new Date(time).toISOString());
  const visible = mergePcHistory([sample(time - 86400001), sample(time - 5000), sample(time + 6000)], null, time);
  assert.equal(visible.length, 1);
});

test('1초 걸리는 실제 측정도 5초 주기마다 새 기록을 만들어 10초 간격으로 늘어나지 않는다', async () => {
  const directory = await temporary(), base = Date.now(); let time = base, calls = 0;
  const options = {directory, clock: () => new Date(time),
    measure: async () => {calls++; time += 1000; return sample(time);}};
  const service = createPcStatusService(options);
  const first = await service.sample();
  time = base + 5000;
  const second = await service.sample();
  assert.equal(calls, 2);
  assert.equal(Date.parse(second.latest.measuredAt) - Date.parse(first.latest.measuredAt), 5000);
  assert.equal(Date.parse(second.nextSampleAt), base + 10000);
  const reopened = createPcStatusService(options);
  time = base + 7500; await reopened.sample();
  assert.equal(calls, 2);
  time = base + 10000;
  const third = await reopened.sample();
  assert.equal(calls, 3);
  assert.equal(Date.parse(third.latest.measuredAt) - Date.parse(second.latest.measuredAt), 5000);
});

test('손상된 기록 파일을 덮어쓰거나 예제 자료로 대체하지 않는다', async () => {
  const directory = await temporary(), file = join(directory, 'history.jsonl');
  const original = '{"not":"a complete record"';
  await writeFile(file, original);
  const service = createPcStatusService({directory, measure: async () => sample(Date.now())});
  const data = await service.sample();
  assert.equal(data.storage.status, 'unavailable');
  assert.ok(data.latest);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('과거 기록과 직전 증감은 단위·범위를 검증하고 미측정 구간의 선을 끊는다', () => {
  const now = Date.now(), rows = [sample(now - 40000), sample(now - 35000), sample(now - 5000), sample(now)];
  assert.equal(pcSeries(rows, 'cpu', 5, now).length, 2);
  assert.equal(pcSeries([sample(now - 10000), sample(now)], 'cpu', 5, now).length, 2);
  rows[1].cpu = unavailable(rows[1].measuredAt);
  assert.equal(pcSeries(rows, 'cpu', 5, now)[0].length, 1);
  const before = sample(now - 5000, 0), after = sample(now, 5);
  assert.match(pcDifference(after, before, 'cpu'), /5.00 %p 증가/);
  assert.match(pcDifference(after, null, 'memory'), /비교 불가/);
  before.memory.totalGiB = 200;
  assert.match(pcDifference(after, before, 'memory'), /측정 범위/);
  assert.match(pcDifference(sample(now, 0), sample(now - 5000, 0), 'cpu'), /변화 없음/);
});

class Element {
  constructor(tag) {this.tagName = tag; this.children = []; this.attributes = {}; this.ownText = '';}
  set textContent(value) {this.ownText = String(value); this.children = [];}
  get textContent() {return this.ownText + this.children.map(node => node.textContent).join('\n');}
  appendChild(node) {this.children.push(node); return node;}
  setAttribute(key, value) {this.attributes[key] = String(value);}
}
const walk = node => [node, ...node.children.flatMap(walk)];
test('모의 DOM은 실측 출처·시각·단위와 실패 이유를 표시하고 과거 기록을 새 측정으로 가장하지 않는다', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag)};
  try {
    const now = Date.now(), latest = sample(now);
    latest.cpu = unavailable(latest.measuredAt);
    const data = {schema: 'keshev.pc-status.v1', kind: 'measured', intervalMs: 5000, retentionHours: 24,
      disk: 'C:', servedAt: new Date(now).toISOString(), storage: {status: 'ok', reason: ''},
      latest, history: [sample(now - 5000), latest]};
    const node = renderPcStatusView({status: 'ok', data, rangeMinutes: 5, recording: true});
    assert.match(node.textContent, /실측 자동 갱신/);
    assert.match(node.textContent, /시험용 읽기 실패/);
    assert.match(node.textContent, /GiB/);
    assert.match(node.textContent, /잰 시각/);
    assert.match(node.textContent, /출처/);
    // A failed current CPU reading must retain the earlier real CPU graph.
    assert.equal(walk(node).filter(el => el.tagName === 'svg').length, 4); // CPU/memory/disk trends plus a disk-space meter.
    const failed = renderPcStatusView({status: 'error', data, error: {message: '시험 요청 실패'}, paused: true});
    assert.match(failed.textContent, /이전 기록을 새 측정으로 표시하지 않습니다/);
    assert.match(failed.textContent, /과거 기록/);
    assert.match(renderPcStatusView({status: 'idle'}).textContent, /검증된 PC 측정 자료가 없습니다/);
    const invalid = structuredClone(data); invalid.latest.memory.value = -1;
    assert.equal(validPcPayload(invalid, true), false);
  } finally {globalThis.document = previousDocument;}
});

test('최근 실측의 재조회 대기는 과거 기록과 구분하고 실패·15초 초과 때는 과거 경고를 유지한다', () => {
  const previousDocument = globalThis.document, previousNow = Date.now;
  const now = Date.UTC(2026, 9, 27, 0, 1, 34);
  globalThis.document = {createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag)};
  Date.now = () => now;
  try {
    const payload = age => {
      const latest = sample(now - age * 1000);
      return {schema: 'keshev.pc-status.v1', kind: 'measured', intervalMs: 5000, retentionHours: 24,
        disk: 'C:', servedAt: new Date(now).toISOString(), storage: {status: 'ok', reason: ''},
        latest, history: [sample(now - (age + 5) * 1000), latest]};
    };
    for (const compact of [false, true]) {
      const data = payload(4), measuredAt = data.latest.measuredAt;
      const loading = renderPcStatusView({status: 'loading', data, recording: true, compact});
      assert.match(loading.textContent, /4초 전 · 새 측정 조회 중 · 마지막 실측값 표시/);
      assert.doesNotMatch(loading.textContent, /과거 기록/);
      assert.equal(walk(loading).filter(node => node.ownText.includes('마지막 실제 측정:')).length, 1);
      assert.ok(loading.children.some(node => node.ownText.includes('새 측정 조회 중')));
      assert.equal(data.latest.measuredAt, measuredAt); // Pending requests must not refresh the sample timestamp.
      for (const status of ['ok', 'loading']) {
        assert.doesNotMatch(renderPcStatusView({status, data: payload(15), compact}).textContent, /과거 기록/);
        const old = renderPcStatusView({status, data: payload(16), compact});
        assert.match(old.textContent, /16초 전 · 과거 기록/);
        assert.doesNotMatch(old.textContent, /새 측정 조회 중 · 마지막 실측값 표시/);
      }
      const failed = renderPcStatusView({status: 'error', data, error: {message: '시험 요청 실패'}, paused: true, compact});
      assert.match(failed.textContent, /4초 전 · 과거 기록/);
      assert.match(failed.textContent, /시험 요청 실패/);
      assert.match(failed.textContent, /다음 할 일/);
      const recovered = renderPcStatusView({status: 'ok', data: payload(0), recording: true, compact});
      assert.doesNotMatch(recovered.textContent, /과거 기록|새 측정 조회 중|시험 요청 실패/);
    }
  } finally {globalThis.document = previousDocument; Date.now = previousNow;}
});

const request = (port, path, {method = 'GET', body, origin = true, headers = {}} = {}) => new Promise((resolve, reject) => {
  const req = http.request({host: '127.0.0.1', port, path, method, headers: {
    ...(body !== undefined ? {'content-type': 'application/json'} : {}),
    ...(method === 'POST' && origin ? {origin: 'http://127.0.0.1:' + port} : {}), ...headers,
  }}, res => {
    let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk);
    res.on('end', () => resolve({status: res.statusCode, text}));
  });
  req.on('error', reject); req.setTimeout(3000, () => req.destroy(Error('test timeout')));
  req.end(body === undefined ? undefined : JSON.stringify(body));
});
test('실제 화면 제어 코드가 화면 이탈·숨김·실패 때 폴링을 멈추고 늦은 응답을 버린다', async () => {
  const source = await readFile(new URL('../on-client/public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('// PC-only polling.');
  const end = source.indexOf('function renderAllStudent()', start);
  assert.ok(start > 0 && end > start);
  const now = Date.now(), timers = [], requests = [];
  const data = {schema: 'keshev.pc-status.v1', kind: 'measured', intervalMs: 5000, retentionHours: 24,
    disk: 'C:', servedAt: new Date(now).toISOString(), storage: {status: 'ok', reason: ''},
    latest: sample(now), history: [sample(now)], nextSampleAt: new Date(now + 5000).toISOString()};
  class FixedDate extends Date {static now() {return now;}}
  const context = vm.createContext({
    state: {view: 'pc'}, document: {visibilityState: 'visible'}, AbortController, Date: FixedDate,
    pcState: {status: 'idle', data: null, error: null, rangeMinutes: 5, recording: false, paused: false},
    pcSequence: 0, pcTimer: null, pcController: null, pcHistoryLoaded: false,
    validPcPayload, mergePcHistory, performance: {now: () => 0}, renderStudent: () => {},
    clearTimeout: timer => {if (timer) timer.cancelled = true;},
    setTimeout: (fn, ms) => {const timer = {fn, ms, cancelled: false}; timers.push(timer); return timer;},
    request: async (path, options) => {requests.push({path, options}); return {ok: true, data: structuredClone(data)};},
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.pcTest = {updatePcStatus, syncPcPolling};', context);
  await context.pcTest.updatePcStatus();
  assert.equal(requests.length, 2);
  assert.equal(timers.at(-1).ms, 5050);
  assert.equal(context.pcState.status, 'ok');
  context.state.view = 'protection';
  await context.pcTest.updatePcStatus();
  assert.equal(requests.length, 3);
  assert.ok(requests.every(row => row.path.startsWith('/api/pc-status'))); // Windows observations never join the five-second loop.
  context.state.view = 'apps'; context.pcTest.syncPcPolling();
  assert.equal(timers.at(-1).cancelled, true);
  assert.equal(context.pcState.recording, false);
  context.state.view = 'pc'; context.document.visibilityState = 'hidden';
  context.pcTest.syncPcPolling(); assert.equal(requests.length, 3);
  context.document.visibilityState = 'visible';
  context.request = async () => ({ok: false});
  await context.pcTest.updatePcStatus({manual: true});
  assert.equal(context.pcState.paused, true);
  assert.equal(context.pcState.status, 'error');
  const timerCount = timers.length;
  context.pcTest.syncPcPolling(); assert.equal(timers.length, timerCount);
  const original = context.pcState.data.latest.measuredAt;
  let finish;
  context.pcHistoryLoaded = true;
  context.request = (_, options) => {
    assert.equal(options.signal.aborted, false);
    return new Promise(resolve => {finish = resolve;});
  };
  const pending = context.pcTest.updatePcStatus({manual: true});
  context.state.view = 'apps'; context.pcTest.syncPcPolling();
  finish({ok: true, data: {...data, latest: sample(now + 1000, 99)}});
  await pending;
  assert.equal(context.pcState.data.latest.measuredAt, original);
  assert.equal(timers.length, timerCount);
});

test('로컬 API는 실측·미연결을 구분하고 외부 출처·임의 경로·잘못된 요청을 거부한다', async () => {
  const directory = await temporary(), service = createPcStatusService({directory, measure: async () => sample(Date.now())});
  const server = createOnServer({pcStatusService: service});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  try {
    assert.equal((await request(port, '/')).status, 200);
    assert.equal((await request(port, '/student/pc-status-view.mjs')).status, 200);
    const before = JSON.parse((await request(port, '/api/pc-status')).text);
    assert.equal(before.data.latest, null);
    assert.equal(before.meta.mode, 'disconnected');
    assert.equal((await request(port, '/api/pc-status/sample', {method: 'POST', body: {}, origin: false})).status, 403);
    assert.equal((await request(port, '/api/pc-status/sample', {method: 'POST', body: {path: 'C:\\private'}})).status, 400);
    assert.equal((await request(port, '/api/pc-status/sample')).status, 405);
    assert.equal((await request(port, '/api/pc-status?path=C:')).status, 400);
    assert.equal((await request(port, '/api/pc-status', {headers: {'sec-fetch-site': 'cross-site'}})).status, 403);
    const response = await request(port, '/api/pc-status/sample', {method: 'POST', body: {}});
    assert.equal(response.status, 200);
    const measured = JSON.parse(response.text);
    assert.equal(measured.meta.mode, 'disconnected');
    assert.equal(measured.data.kind, 'measured');
    assert.ok(validPcPayload(measured.data));
    const history = JSON.parse((await request(port, '/api/pc-status')).text);
    assert.equal(history.data.history.length, 1);
    assert.equal((await request(port, '/api/me')).status, 503);
    assert.equal((await request(port, '/.local/pc-status/history.jsonl')).status, 404);
    assert.equal((await lstat(join(directory, 'history.jsonl'))).isFile(), true);
  } finally {await new Promise(resolve => server.close(resolve));}
});

test('실제 PC에서 일반 OS API를 호출해 출처와 측정 시각이 있는 자료를 얻는다', async t => {
  const directory = await temporary(), service = createPcStatusService({directory});
  const first = await service.sample(), data = first.latest;
  assert.ok(isPcSample(data));
  assert.ok(validPcSample(data));
  assert.equal(data.memory.status, 'ok');
  assert.ok(data.memory.totalGiB > 0);
  await waitForSample(Math.max(0, Date.parse(first.nextSampleAt) - Date.now() + 75));
  const second = await service.sample();
  assert.notEqual(second.latest.measuredAt, data.measuredAt);
  assert.equal((await createPcStatusService({directory}).history()).history.length, 2);
  const actualIntervalMs = Date.parse(second.latest.measuredAt) - Date.parse(data.measuredAt);
  t.diagnostic(JSON.stringify({kind: data.kind, measuredAt: data.measuredAt,
    nextMeasuredAt: second.latest.measuredAt, actualIntervalMs, historyRestored: 2,
    cpu: {status: data.cpu.status, value: data.cpu.value, unit: data.cpu.unit},
    memory: {status: data.memory.status, value: data.memory.value, unit: data.memory.unit},
    disk: {status: data.disk.status, value: data.disk.value, unit: data.disk.unit}}));
});
