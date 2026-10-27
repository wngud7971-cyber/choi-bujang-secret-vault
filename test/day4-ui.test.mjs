import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createStudentView} from '../on-client/student/extension.mjs';
import {renderPcStatusView, activatePcCharts} from '../on-client/student/pc-status-view.mjs';
import {renderConnectionStatusView, renderWindowsEventSummary} from '../on-client/student/connection-status-view.mjs';

// All data below is a test fixture. No Windows settings, network configuration or live server is changed.
class E {
  constructor(tag, document) {this.tagName = tag; this.ownerDocument = document; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.ownText = ''; this.disabled = false; this.value = '5';}
  set textContent(value) {this.ownText = String(value); this.children = [];}
  get textContent() {return this.ownText + this.children.map(x => x instanceof E ? x.textContent : x).join('\n');}
  get firstChild() {return this.children[0] || null;}
  appendChild(node) {this.children.push(node); return node;}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {if (this.ownerDocument.activeElement && this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null; this.children = nodes; this.ownText = '';}
  setAttribute(key, value) {this.attributes[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);}
  getAttribute(key) {return this.attributes[key] ?? null;}
  addEventListener(key, callback) {(this.listeners[key] ||= []).push(callback);}
  contains(node) {return this === node || this.children.some(child => child instanceof E && child.contains(node));}
  querySelectorAll(selector) {return walk(this).slice(1).filter(node => selector === '[data-focus-key]' ? node.getAttribute('data-focus-key') !== null : selector === 'details[data-preserve-key]' ? node.tagName === 'details' && node.getAttribute('data-preserve-key') !== null : selector === '[data-pc-plot]' ? node.getAttribute('data-pc-plot') !== null : selector === 'details.pc-help' ? node.tagName === 'details' && node.className === 'pc-help' : false);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  closest(selector) {return selector === '[data-pc-action="sample"]' && this.dataset.pcAction === 'sample' ? this : null;}
  matches(selector) {return selector === '[data-pc-range]' && this.dataset.pcRange != null;}
  focus() {this.ownerDocument.activeElement = this;}
}
const walk = node => [node, ...node.children.filter(x => x instanceof E).flatMap(walk)];
const fakeDocument = () => {
  const doc = {activeElement: null, elements: {}, tabs: [], listeners: {}, visibilityState: 'visible'};
  doc.createElement = tag => new E(tag, doc); doc.createElementNS = (_, tag) => new E(tag, doc);
  doc.getElementById = id => doc.elements[id] ||= doc.createElement('div');
  doc.querySelectorAll = selector => selector === '#nav [role="tab"]' ? doc.tabs : [];
  doc.addEventListener = (key, callback) => {(doc.listeners[key] ||= []).push(callback);};
  return doc;
};
const withDocument = async work => {
  const old = globalThis.document, document = fakeDocument(); globalThis.document = document;
  try {return await work(document);} finally {globalThis.document = old;}
};
const unavailable = (reason = '시험용 접근 거부') => ({status: 'unavailable', code: 'ACCESS_DENIED', reason});
const connectionData = () => {
  const to = new Date().toISOString(), from = new Date(Date.parse(to) - 86400000).toISOString();
  const observed = extra => ({kind: 'measured', checkedAt: to, source: 'test fixture', ...extra});
  return {schema: 'keshev.connection-status.v1', kind: 'measured', readOnly: true, checkedAt: to, window: {from, to, hours: 24},
    network: observed({...unavailable(), interfaces: []}),
    firewall: observed({status: 'ok', active: unavailable(), profiles: ['Domain','Private','Public'].map(name => ({name, ...unavailable(), enabled: null}))}),
    events: observed({status: 'ok', logs: ['System','Application'].map(name => ({name, ...unavailable(), warnings: null, errors: null}))}),
    sdp: {status: 'disconnected', checkedAt: to, source: 'test fixture', reason: '시험용 SDP 미설정'}};
};

test('핵심 세 목표는 방어 성공으로 가장하지 않으며 예제·SDP 세션·대응 효과를 구분한다', () => withDocument(document => {
  let opened = 0;
  const view = createStudentView({actions: {openPc: () => opened++}, capabilities: {overviewSlot: true}});
  const node = view.renderOverview({identity: {status: 'error', mode: 'disconnected'}, events: {status: 'error'}});
  assert.equal(walk(node).filter(el => el.className === 'card defense-card').length, 3);
  for (const label of ['제로트러스트 접근 통제','DDoS·API 남용 대응','계정 악용·자료 유출 대응','보안 엔진 미연결','방어 효과 미확인','다음 할 일']) assert.match(node.textContent, new RegExp(label));
  const button = walk(node).find(el => el.tagName === 'button' && el.textContent === 'PC 상태 보기'); button.listeners.click[0](); assert.equal(opened, 1);
  assert.match(view.renderOverview({identity: {mode: 'demo'}}).textContent, /예제 · 실제 연결 아님/);
  assert.match(view.renderOverview({identity: {mode: 'connected'}, sdpCurrent: true, sdp: {status: 'connected', checkedAt: new Date().toISOString()}}).textContent, /세션 확인됨 · 차단 효과 미확인/);
  assert.doesNotMatch(view.renderOverview({identity: {mode: 'connected'}, sdpCurrent: false, sdp: {status: 'connected', checkedAt: new Date().toISOString()}}).textContent, /세션 확인됨/);
  assert.doesNotMatch(view.renderOverview({identity: {mode: 'connected'}, sdpCurrent: true, sdp: {status: 'connected', checkedAt: new Date(Date.now() - 120000).toISOString()}}).textContent, /세션 확인됨/);
}));

test('이전 학생 표시 계약에서도 요약을 유지하고 지원되지 않는 바로가기는 실행하지 않는다', () => withDocument(() => {
  const view = createStudentView();
  const node = view.renderIdentity({me: {status: 'error', mode: 'disconnected', error: {message: '시험용 미연결'}}, devices: {status: 'loading'}, sessions: {status: 'loading'}});
  assert.match(node.textContent, /DDoS·API 남용 대응/);
  assert.ok(walk(node).filter(el => el.tagName === 'button').every(button => button.disabled));
}));

test('C: 읽기 실패는 항목·이유·다음 행동과 null을 유지하고 정상 숫자로 대체하지 않는다', () => withDocument(() => {
  const at = new Date().toISOString();
  const ok = (key, value) => ({status: 'ok', value, unit: key === 'cpu' ? '%' : 'GiB', percent: value,
    ...(key === 'cpu' ? {} : {totalGiB: 100}), measuredAt: at, source: 'test fixture', scope: 'fixture'});
  const latest = {kind: 'measured', measuredAt: at, cpu: ok('cpu', 17), memory: ok('memory', 12),
    disk: {status: 'unavailable', value: null, unit: 'GiB', measuredAt: at, source: 'test fixture', reason: '시험용 C: 접근 거부'}};
  const data = {schema: 'keshev.pc-status.v1', kind: 'measured', intervalMs: 5000, retentionHours: 24, disk: 'C:', servedAt: at, storage: {status: 'ok', reason: ''}, latest, history: [latest]};
  const node = renderPcStatusView({status: 'ok', data});
  assert.match(node.textContent, /C: 디스크 남은 공간 읽기 실패/); assert.match(node.textContent, /시험용 C: 접근 거부/); assert.match(node.textContent, /다음 할 일/);
  const cards = walk(node).filter(el => el.className === 'card pc-metric');
  assert.match(cards[0].textContent, /17.0/); assert.match(cards[2].textContent, /확인 불가/); assert.doesNotMatch(cards[2].textContent, /0.00 GiB/);
  assert.ok(walk(cards[2]).some(el => el.attributes.role === 'alert'));
  const error = renderPcStatusView({status: 'error', error: {stage: 'history', message: '시험용 복원 실패'}});
  assert.match(error.textContent, /PC 기록 복원 실패/); assert.match(error.textContent, /기록 파일은 삭제하지 마세요/);
}));

test('연결 부분 실패는 로그·프로필별 이유와 다음 행동을 표시하며 이전 결과를 새 정상으로 취급하지 않는다', () => withDocument(() => {
  const node = renderConnectionStatusView({status: 'ok', data: connectionData()});
  for (const text of ['네트워크 구성 확인 불가','현재 적용 방화벽 프로필 확인 불가','Windows System 집계 확인 불가','Windows Application 집계 확인 불가','다음 할 일','SDP 미연결','침해나 공격 탐지 결과가 아닙니다']) assert.ok(node.textContent.includes(text));
  for (const row of walk(node).filter(el => el.tagName === 'tr' && ['System','Application'].includes(el.children[0]?.textContent))) {
    assert.equal(row.children[1].textContent, '확인 불가'); assert.equal(row.children[2].textContent, '확인 불가');
  }
}));

const source = await readFile(new URL('../on-client/public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../on-client/public/index.html', import.meta.url), 'utf8');
function hostContext(document) {
  const state = {view: 'protection', errors: new Map(), ...Object.fromEntries(['me','apps','events','devices','sessions'].map(key => [key, {status: 'ok'}]))};
  const context = vm.createContext({document, Element: E, state, pcState: {status: 'ok', rangeMinutes: 5}, connectionReadState: {status: 'idle'},
    STUDENT_SLOTS: {overview: {slot: 'student-overview', fn: 'renderOverview'}, pcStatus: {slot: 'student-pc', fn: 'renderPcStatus'}, connectionStatus: {slot: 'student-connection', fn: 'renderConnectionStatus'}},
    studentLoadFailed: false, activatePcCharts, studentView: createStudentView({actions: {openPc: () => {}}, capabilities: {overviewSlot: true}}), studentData: () => ({}),
    $: id => document.getElementById(id), formatTime: value => value, setChildren: (target, ...nodes) => target.replaceChildren(...nodes),
    stateBox: (_, text) => {const node = document.createElement('p'); node.textContent = text; return node;}});
  vm.runInContext(source.slice(source.indexOf('// Stable controls'), source.indexOf('// Connection observations:')) + '\nglobalThis.controls={renderStudent,securityReadBusy};', context);
  return context;
}
test('대기 표시·재조회 버튼의 키보드 초점·완료/실패 안내는 실제 화면 연결 코드에서 유지된다', () => withDocument(document => {
  const context = hostContext(document), button = document.getElementById('pc-sample'); button.focus();
  context.pcState = {status: 'loading', manualPending: true, rangeMinutes: 5}; context.controls.renderStudent('pcStatus');
  assert.strictEqual(document.activeElement, button); assert.equal(button.disabled, false); assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(button.textContent, '새로 읽는 중…'); assert.match(document.getElementById('pc-query-status').textContent, /새로 읽는 중/);
  context.pcState = {status: 'ok', rangeMinutes: 5, lastManualAt: 'fixture time'}; context.controls.renderStudent('pcStatus');
  assert.strictEqual(document.activeElement, button); assert.equal(button.getAttribute('aria-disabled'), 'false'); assert.equal(button.textContent, '다시 조회');
  assert.match(document.getElementById('pc-query-status').textContent, /fixture time/);
  context.controls.renderStudent('overview');
  const before = document.getElementById('student-overview').querySelectorAll('[data-focus-key]')[0]; before.focus();
  context.controls.renderStudent('overview');
  const after = document.getElementById('student-overview').querySelectorAll('[data-focus-key]')[0];
  assert.notStrictEqual(before, after); assert.strictEqual(document.activeElement, after);
  context.connectionReadState = {status: 'error', error: {message: '시험용 요청 실패'}}; context.controls.renderStudent('connectionStatus');
  assert.match(document.getElementById('connection-query-status').textContent, /조회 실패/);
}));

test('실제 메뉴 키보드 처리와 클릭 연결은 대기 중 중복 요청을 막고 완료 후 재조회한다', () => withDocument(document => {
  for (const match of html.matchAll(/<button\b([^>]*role="tab"[^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const node = document.createElement('button'); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    document.elements[attrs.id] = node; document.tabs.push(node); document.getElementById(attrs['aria-controls']);
  }
  let pcCalls = 0, connectionCalls = 0, securityCalls = 0;
  const context = hostContext(document);
  Object.assign(context, {window: {addEventListener() {}}, PC_RANGES: [1,5,15,30,60,1440], syncPcPolling() {}, stopPcPolling() {}, cancelConnectionRead() {},
    updatePcStatus() {pcCalls++;}, updateConnectionStatus() {connectionCalls++;}, loadAll() {securityCalls++;},
    guardStaticArt() {}, renderNativeLogin() {}, renderAiConnect() {}, loadConnectModule() {}, renderAiConnection() {}, renderVulnerabilities() {}, renderAllStudent() {}, loadStudentModule() {}});
  const select = source.slice(source.indexOf('function selectView('), source.indexOf('// ---------- 보호 현황'));
  vm.runInContext(select + source.slice(source.indexOf('function init()')), context);
  const initialConnectionCalls = connectionCalls;
  const click = (id, event = {}) => document.getElementById(id).listeners.click[0](event);
  context.connectionReadState.status = 'loading'; click('connection-read'); assert.equal(connectionCalls, initialConnectionCalls);
  context.connectionReadState.status = 'ok'; click('connection-read'); assert.equal(connectionCalls, initialConnectionCalls + 1);
  const pcButton = document.getElementById('pc-sample'); pcButton.dataset.pcAction = 'sample';
  context.pcState.status = 'loading'; click('view-pc', {target: pcButton}); assert.equal(pcCalls, 0);
  context.pcState.status = 'ok'; click('view-pc', {target: pcButton}); assert.equal(pcCalls, 1);
  const before = securityCalls; context.state.me.status = 'loading'; click('overview-refresh'); assert.equal(securityCalls, before);
  context.state.me.status = 'ok'; click('overview-refresh'); assert.equal(securityCalls, before + 1);
  const counts = [pcCalls, connectionCalls, securityCalls];
  document.getElementById('overview-range').listeners.change[0]({target: {value: '15'}});
  assert.equal(context.pcState.rangeMinutes, 15); assert.deepEqual([pcCalls, connectionCalls, securityCalls], counts);
  let prevented = false; const first = document.tabs[0];
  first.listeners.keydown[0]({key: 'ArrowDown', preventDefault() {prevented = true;}});
  assert.ok(prevented); assert.strictEqual(document.activeElement, document.tabs[1]); assert.equal(context.state.view, 'pc');
  document.tabs[1].listeners.keydown[0]({key: 'End', preventDefault() {}}); assert.strictEqual(document.activeElement, document.tabs.at(-1));
  document.tabs.at(-1).listeners.keydown[0]({key: 'Home', preventDefault() {}}); assert.strictEqual(document.activeElement, first);
}));

test('학생 표시 지점·재조회 접근성 이름·설치형 미지원 사실을 소스에서 확인한다', async () => {
  for (const id of ['student-overview','overview-query-status','pc-query-status','connection-query-status']) assert.ok(html.includes('id="' + id + '"'));
  for (const label of ['PC·Windows·연결과 보안 기록 다시 조회','내 PC 상태 다시 조회','연결과 기록 다시 조회']) assert.ok(html.includes('aria-label="' + label + '"'));
  assert.ok(html.indexOf('id="student-overview"') < html.indexOf('id="identity-user"'));
  assert.equal((html.match(/aria-atomic="true"/g) || []).length, 3);
  const packageInfo = JSON.parse(await readFile(new URL('../on-client/package.json', import.meta.url), 'utf8'));
  assert.equal(packageInfo.scripts['package-app'], undefined);
  await assert.rejects(readFile(new URL('../on-client/student/appearance.json', import.meta.url)), {code: 'ENOENT'});
  assert.ok(!source.includes('appearance.json'));
});

const measuredPcData = () => {
  const now = Date.now(), sample = (at, cpu) => {
    const metric = (value, key) => ({status: 'ok', value, unit: key === 'cpu' ? '%' : 'GiB', percent: value, ...(key === 'cpu' ? {} : {totalGiB: 100}), measuredAt: at, source: 'test fixture', scope: 'fixture'});
    return {kind: 'measured', measuredAt: at, cpu: metric(cpu, 'cpu'), memory: metric(13, 'memory'), disk: metric(31, 'disk')};
  };
  const latest = sample(new Date(now).toISOString(), 27);
  return {schema: 'keshev.pc-status.v1', kind: 'measured', intervalMs: 5000, retentionHours: 24, disk: 'C:', servedAt: latest.measuredAt,
    storage: {status: 'ok', reason: ''}, latest, history: [sample(new Date(now - 5000).toISOString(), 17), latest]};
};
test('대시보드 그래프·디스크 막대는 전달된 실측 자료와 단위를 사용하고 설명 펼침과 초점을 유지한다', () => withDocument(document => {
  const pc = measuredPcData(), context = hostContext(document);
  context.studentData = () => ({pcStatus: {status: 'ok', data: pc}, connectionStatus: {status: 'ok', data: connectionData()}});
  context.controls.renderStudent('overview');
  const node = document.getElementById('student-overview');
  assert.match(node.textContent, /27.0/); assert.match(node.textContent, /31.00/); assert.match(node.textContent, /GiB/);
  const meter = walk(node).find(el => el.attributes.role === 'meter'); assert.equal(meter.attributes['aria-valuenow'], '31.0');
  const detail = node.querySelectorAll('details[data-preserve-key]').find(el => el.attributes['data-preserve-key'] === 'defense-02');
  detail.open = true; detail.children[0].focus();
  context.controls.renderStudent('overview');
  const after = node.querySelectorAll('details[data-preserve-key]').find(el => el.attributes['data-preserve-key'] === 'defense-02');
  assert.equal(after.open, true); assert.strictEqual(document.activeElement, after.children[0]);
  assert.equal(node.querySelectorAll('[data-pc-plot]').length, 2);
}));
test('Windows 비교 막대는 실제 0건과 확인 불가를 구분하고 실패 뒤 이전 기록임을 표시한다', () => withDocument(() => {
  const data = connectionData(); data.events.logs[0] = {name: 'System', status: 'ok', warnings: 0, errors: 3};
  const node = renderWindowsEventSummary({status: 'ok', data});
  const svgs = walk(node).filter(el => el.tagName === 'svg'); assert.equal(svgs.length, 2);
  assert.equal(svgs[0].children[0].attributes.width, '0'); assert.match(svgs[0].attributes['aria-label'], /System 경고 0건/);
  assert.ok(!svgs.some(el => el.attributes['aria-label'].includes('Application')));
  assert.match(node.textContent, /확인 불가/); assert.match(node.textContent, /침해 판정 아님/);
  assert.match(renderWindowsEventSummary({status: 'error', data, error: {message: '시험용 실패'}}).textContent, /이전 조회 기록/);
  const createSvg = document.createElementNS;
  try {
    document.createElementNS = undefined;
    const fallback = renderWindowsEventSummary({status: 'ok', data});
    assert.match(fallback.textContent, /그래프 표시 미지원/); assert.match(fallback.textContent, /3건/);
    assert.ok(!walk(fallback).some(el => el.tagName === 'svg'));
  } finally {document.createElementNS = createSvg;}
}));
test('그래프는 실제 폭으로 다시 그리고 긴 기록의 급등과 수집 공백을 보존하며 관찰자를 해제한다', () => withDocument(() => {
  const data = measuredPcData(), now = Date.parse(data.latest.measuredAt);
  data.history = Array.from({length: 900}, (_, i) => {
    const row = structuredClone(data.latest), at = new Date(now - (899 - i) * 5000 - (i < 300 ? 30000 : 0)).toISOString();
    row.measuredAt = at; for (const key of ['cpu','memory','disk']) row[key].measuredAt = at;
    row.cpu.value = row.cpu.percent = i === 450 ? 100 : 20; return row;
  }); data.latest = data.history.at(-1);
  const node = renderPcStatusView({status: 'ok', data, rangeMinutes: 1440});
  const plots = node.querySelectorAll('[data-pc-plot]'); let width = 380, observer;
  for (const plot of plots) plot.getBoundingClientRect = () => ({width});
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {constructor(callback) {this.callback = callback; this.observed = []; observer = this;}observe(node) {this.observed.push(node);}disconnect() {this.closed = true;}};
  try {
    const dispose = activatePcCharts(node); assert.equal(observer.observed.length, 3);
    width = 186; observer.callback(plots.map(target => ({target})));
    const cpu = plots[0].children[0]; assert.equal(cpu.attributes.viewBox, '0 0 186 190');
    const paths = walk(cpu).filter(el => el.tagName === 'path' && el.attributes.fill === 'none');
    assert.equal(paths.length, 2); assert.ok(paths.some(el => el.attributes.d.includes(',20.00')));
    for (const path of paths) assert.doesNotMatch(path.attributes.d, /NaN|Infinity/);
    dispose(); assert.equal(observer.closed, true);
  } finally {globalThis.ResizeObserver = previous;}
}));
