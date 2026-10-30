import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createStudentView} from '../on-client/student/extension.mjs';
import {readStudentAppearance} from '../on-client/src/student-appearance-files.mjs';
import {appearanceView, appearanceCss, contrastRatio, APPEARANCE_FIXED_FOREGROUNDS} from '../on-client/src/student-appearance.mjs';
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
  removeAttribute(key) {delete this.attributes[key];}
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

const coreCard = (node, stage) => walk(node).find(element => element.getAttribute('data-core-feature') === String(stage));
test('꾸밈은 검증된 세 색만 사용하고 상태 의미 색과 글자 대비를 유지한다', async () => {
  const read = await readStudentAppearance(fileURLToPath(new URL('../on-client', import.meta.url)));
  const view = appearanceView(read);
  assert.equal(view.state, 'applied');
  const css = appearanceCss(view);
  assert.match(css, /:root\{--accent:/);
  assert.doesNotMatch(css, /--(?:allow|deny|challenge|unknown|focus|student)\s*:/);
  for (const background of [view.palette.background, view.palette.surface]) {
    for (const foreground of Object.values(APPEARANCE_FIXED_FOREGROUNDS)) assert.ok(contrastRatio(foreground,background) >= 4.5);
  }
});

test('로컬 꾸밈 stylesheet는 한 번만 연결하고 정적 웹에서는 요청하지 않는다', () => withDocument(document => {
  document.head = document.createElement('head');
  document.head.querySelector = () => document.head.children.find(node => node.getAttribute('rel') === 'stylesheet' && node.getAttribute('href') === '/student/appearance.css') || null;
  createStudentView(); createStudentView();
  assert.equal(document.head.children.length, 1);
  assert.equal(document.head.children[0].tagName, 'link');
  assert.equal(document.head.children[0].getAttribute('href'), '/student/appearance.css');
  document.head.children = []; document.documentElement = {dataset:{runtime:'web'}};
  createStudentView(); assert.equal(document.head.children.length, 0);
}));

test('점검 목록은 행·열 제목과 키보드 스크롤을 제공하고 갱신·실패 후에도 시각과 초점을 일치시킨다', () => withDocument(document => {
  const view = createStudentView({capabilities:{overviewSlot:true}}), node = view.renderOverview({});
  const table = walk(node).find(element => element.tagName === 'table' && element.getAttribute('aria-label') === '세 핵심 점검의 현재 상태와 최근 응답');
  assert.ok(table);
  assert.equal(walk(table).filter(element => element.tagName === 'th' && element.getAttribute('scope') === 'col').length, 4);
  assert.equal(walk(table).filter(element => element.tagName === 'th' && element.getAttribute('scope') === 'row').length, 3);
  assert.ok(walk(node).some(element => element.contains(table) && element.getAttribute('role') === 'region' && element.getAttribute('tabindex') === '0'));
  const card = coreCard(node,17);
  const time = walk(card).find(element => element.tagName === 'time');
  const details = walk(card).find(element => element.tagName === 'details');
  assert.notEqual(details.open, true);
  assert.equal(details.getAttribute('data-preserve-key'), 'core-details-ai');
  assert.equal(time.getAttribute('datetime'), null);
  view.renderAiConnection({status:'ok',data:{transportChecked:true,audienceAuthorization:'verified',modelCount:1},checkedAt:'2026-10-30T02:30:00.000Z'});
  assert.match(time.textContent,/11:30:00 KST/);
  assert.equal(time.getAttribute('datetime'), '2026-10-30T02:30:00.000Z');
  assert.match(walk(card).find(element => element.className === 'overview-card-note').textContent,/응답 모델 1개/);
  assert.match(details.textContent,/사건 설명을 실행한 것은 아닙니다/);
  const button = walk(card).find(element => element.tagName === 'button'); button.focus(); details.open = true;
  view.renderAiConnection({status:'error',error:{code:'AI_REQUEST_UNVERIFIED'},checkedAt:'2026-10-30T02:30:00.000Z'});
  assert.equal(time.textContent,'새 조회 결과 없음');
  assert.equal(time.getAttribute('datetime'), null); assert.equal(details.open, true);
  assert.match(card.textContent,/점검 실패/); assert.strictEqual(document.activeElement,button);
  view.renderAiConnection({status:'ok',mode:'demo',data:{transportChecked:true,audienceAuthorization:'test',modelCount:1},checkedAt:'2026-10-30T02:30:00.000Z'});
  assert.match(walk(card).find(element => element.className === 'overview-card-note').textContent,/예제 자료 · 실제 AI 연결 아님/);
  view.renderAiConnection({status:'loading'});
  assert.equal(time.textContent,'새 조회 결과 없음'); assert.equal(time.getAttribute('datetime'), null);
  assert.strictEqual(document.activeElement,button); assert.equal(details.open, true);
}));

test('선정한 세 기능을 먼저 표시하고 바로가기는 펼침·초점만 변경하며 요청하지 않는다', () => withDocument(document => {
  let requests = 0;
  const view = createStudentView({capabilities: {overviewSlot: true}, api: {get() {requests++;}}});
  const node = view.renderOverview({});
  assert.deepEqual(walk(node).filter(element => element.getAttribute('data-core-feature')).map(element => element.getAttribute('data-core-feature')), ['16','17','20']);
  for (const [stage, targetId] of [[16,'diag-load'],[17,'ai-check'],[20,'vulnerabilities-load']]) {
    const target = document.getElementById(targetId), details = document.createElement('details');
    target.parentElement = details;
    target.addEventListener('click', () => requests++);
    const button = walk(coreCard(node, stage)).find(element => element.tagName === 'button');
    button.listeners.click[0]();
    assert.equal(details.open, true); assert.strictEqual(document.activeElement, target);
  }
  assert.equal(requests, 0);
  assert.match(node.textContent, /기존 PC·Windows 관측과 보안 기록 보기/);
  assert.ok(walk(node).some(element => element.getAttribute('data-preserve-key') === 'previous-observations'));
}));

test('핵심 진단 요약은 실제 renderStatus 입력으로 갱신하며 실패 뒤 과거 성공을 지운다', () => withDocument(() => {
  const view = createStudentView({capabilities: {overviewSlot: true}}), node = view.renderOverview({});
  const card = coreCard(node,16), at = '2026-10-28T02:00:00.000Z';
  const input = {devices:{status:'idle'}, sessions:{status:'idle'}, notifications:[{resource:'me',code:'ENGINE_NOT_CONNECTED',message:'시험용 연결 없음'}], mode:'disconnected',
    diagnostics:{status:'ok',data:{requestId:'fixture-request',component:'on-client',version:'0.1.0',checkedAt:at,engine:{mode:'disconnected',code:'ENGINE_NOT_CONNECTED'}}}};
  view.renderStatus(input);
  assert.match(card.textContent,/진단 정보 조회됨/); assert.match(card.textContent,/알림 1건/);
  assert.match(card.textContent,/진단 조회 성공은 보안 엔진 연결 성공과 별개/);
  view.renderStatus({...input,diagnostics:{...input.diagnostics,status:'error',error:{message:'시험용 조회 실패'}}});
  assert.match(card.textContent,/진단 조회 실패/); assert.doesNotMatch(card.textContent,/진단 정보 조회됨|2026-10-28/);
  view.renderStatus({...input,diagnostics:{status:'loading'}}); assert.match(card.textContent,/진단 조회 중/);
  view.renderStatus({...input,diagnostics:{status:'idle'}}); assert.match(card.textContent,/진단 조회 전/);
}));

test('현재 화면은 진단 복사를 하나로 합치고 공통 버튼이 없는 환경은 기존 복사 기능을 유지한다', () => withDocument(document => {
  const input = {diagnostics:{status:'idle'}};
  document.elements['diag-copy'] = document.createElement('button');
  const shared = createStudentView({capabilities:{overviewSlot:true}}).renderStatus(input);
  assert.ok(!walk(shared).some(node => node.tagName === 'button' && node.textContent === '도움정보 복사'));
  const legacy = createStudentView().renderStatus(input);
  assert.ok(walk(legacy).some(node => node.tagName === 'button' && node.textContent === '도움정보 복사'));
  document.elements['diag-copy'] = document.createElement('div');
  const fallback = createStudentView({capabilities:{overviewSlot:true}}).renderStatus(input);
  assert.ok(walk(fallback).some(node => node.tagName === 'button' && node.textContent === '도움정보 복사'));
}));

test('AI 요약은 verified·시험·불완전 응답·실패·초기화를 구분하고 사건 설명 성공을 만들지 않는다', () => withDocument(() => {
  const view = createStudentView({capabilities: {overviewSlot: true}}), node = view.renderOverview({});
  const card = coreCard(node,17), data = {transportChecked:true,audienceAuthorization:'verified',modelCount:1};
  const input = {status:'ok',data,checkedAt:'2026-10-28T02:00:00.000Z'};
  view.renderAiConnection(input); assert.match(card.textContent,/응답 점검됨\(verified\)/); assert.equal(card.getAttribute('data-observation'),'observed');
  assert.match(card.textContent,/사건 설명을 실행한 것은 아닙니다/);
  view.renderAiConnection({...input,data:{...data,audienceAuthorization:'test'}});
  assert.match(card.textContent,/시험 연결 점검/); assert.notEqual(card.getAttribute('data-observation'),'observed');
  view.renderAiConnection({...input,data:{...data,modelCount:0}}); assert.match(card.textContent,/사용 가능한 모델 없음/);
  view.renderAiConnection({...input,data:{modelCount:1}}); assert.match(card.textContent,/결과 확인 불가/);
  view.renderAiConnection({...input,status:'error',error:{code:'AI_REQUEST_UNVERIFIED'}});
  assert.match(card.textContent,/점검 실패/); assert.doesNotMatch(card.textContent,/응답 점검됨|2026-10-28/);
  view.renderAiConnection({status:'idle'}); assert.match(card.textContent,/점검 전/);
}));

test('패키지 요약은 미설정·미조회·부분 실패·전체 결과와 재조회 실패를 구분한다', () => withDocument(() => {
  const view = createStudentView({capabilities: {overviewSlot: true}}), node = view.renderOverview({});
  const card = coreCard(node,20), at = '2026-10-28T02:00:00.000Z';
  const input = {status:'ok',data:{status:'not_configured',packages:[],checkedAt:at}};
  view.renderVulnerabilities({status:'loading'}); assert.match(card.textContent,/OSV 응답을 기다리는 중/); assert.doesNotMatch(card.textContent,/설정을 준비|허용 목록을 준비/);
  view.renderVulnerabilities(input); assert.match(card.textContent,/조회 준비 미완료/); assert.match(card.textContent,/PROJECT_NOT_CONFIGURED/);
  view.renderVulnerabilities({...input,data:{...input.data,status:'not_checked'}}); assert.match(card.textContent,/승인된 조회 대상 없음/);
  const complete = {status:'complete',checkedAt:at,packages:[{name:'fixture-public',version:'1.0.0',status:'none_found',source:'fixture',checkedAt:at,vulnerabilities:[]}]};
  const rendered = view.renderVulnerabilities({...input,data:complete,mode:'disconnected'}); assert.match(card.textContent,/패키지 조회 완료/); assert.match(card.textContent,/안전 보장이 아닙니다/);
  assert.match(rendered.textContent,/보안 엔진 연결 없음\(disconnected\).*OSV 공개 조회 결과는 아래에서 별도로/);
  const finding = {...complete.packages[0],status:'known_vulnerabilities',vulnerabilities:[{id:'OSV-FIXTURE-1',modified:at}]};
  view.renderVulnerabilities({...input,data:{...complete,packages:[finding]}});
  assert.match(walk(card).find(element => element.className === 'overview-card-note').textContent,/취약점 정보 수신 1개 패키지/);
  assert.notEqual(card.getAttribute('data-observation'),'observed');
  view.renderVulnerabilities({...input,data:{...complete,status:'partial',packages:[{...complete.packages[0],status:'unverifiable'}]}});
  assert.match(card.textContent,/일부 조회 확인 불가/); assert.notEqual(card.getAttribute('data-observation'),'observed');
  view.renderVulnerabilities({...input,status:'error',data:complete,error:{message:'시험용 조회 실패'}});
  assert.match(card.textContent,/패키지 조회 실패/); assert.doesNotMatch(card.textContent,/조회 완료|2026-10-28/);
  view.renderVulnerabilities({status:'idle'}); assert.match(card.textContent,/패키지 조회 전/);
}));

test('세 상태 요약은 관측·연결·예제를 구분하며 바로가기를 유지한다', () => withDocument(document => {
  let opened = 0;
  const view = createStudentView({actions: {openPc: () => opened++}, capabilities: {overviewSlot: true}});
  const node = view.renderOverview({identity: {status: 'error', mode: 'disconnected'}, events: {status: 'error'}});
  assert.equal(walk(node).filter(el => el.getAttribute('data-status-summary')).length, 3);
  assert.ok(!walk(node).some(el => String(el.className || '').split(/\s+/).includes('card')));
  for (const label of ['내 PC 실측','Windows 상태','보안 연결 현황','보안 엔진 미연결','측정 전','다음 할 일','최근 보안 기록']) assert.match(node.textContent, new RegExp(label));
  assert.doesNotMatch(node.textContent, /DDoS·API 남용 대응|방어 목표별/);
  const button = walk(node).find(el => el.tagName === 'button' && el.textContent === 'PC 상태 보기'); button.listeners.click[0](); assert.equal(opened, 1);
  assert.match(view.renderOverview({identity: {mode: 'demo'}}).textContent, /예제 · 실제 연결 아님/);
  assert.match(view.renderOverview({identity: {mode: 'connected'}, sdpCurrent: true, sdp: {status: 'connected', checkedAt: new Date().toISOString()}}).textContent, /세션 확인됨 · 차단 효과 미확인/);
  assert.doesNotMatch(view.renderOverview({identity: {mode: 'connected'}, sdpCurrent: false, sdp: {status: 'connected', checkedAt: new Date().toISOString()}}).textContent, /세션 확인됨/);
  assert.doesNotMatch(view.renderOverview({identity: {mode: 'connected'}, sdpCurrent: true, sdp: {status: 'connected', checkedAt: new Date(Date.now() - 120000).toISOString()}}).textContent, /세션 확인됨/);
}));

test('이전 학생 표시 계약에서도 요약을 유지하고 지원되지 않는 바로가기는 실행하지 않는다', () => withDocument(() => {
  const view = createStudentView();
  const node = view.renderIdentity({me: {status: 'error', mode: 'disconnected', error: {message: '시험용 미연결'}}, devices: {status: 'loading'}, sessions: {status: 'loading'}});
  assert.match(node.textContent, /보안 연결 현황/);
  assert.ok(walk(node).filter(el => el.tagName === 'button').every(button => button.disabled));
}));

test('C: 읽기 실패는 항목·이유·다음 행동과 null을 유지하고 정상 숫자로 대체하지 않는다', () => withDocument(() => {
  const at = new Date().toISOString();
  const ok = (key, value) => ({status: 'ok', value, unit: key === 'cpu' ? '%' : 'GiB', percent: value,
    ...(key === 'cpu' ? {} : {totalGiB: 100}), measuredAt: at, source: 'test fixture', scope: 'fixture'});
  const latest = {kind: 'measured', measuredAt: at, cpu: ok('cpu', 17), memory: ok('memory', 12),
    disk: {status: 'unavailable', value: null, unit: 'GiB', measuredAt: at, source: 'test fixture', reason: '시험용 C: 접근 거부'}};
  const data = {schema: 'keshev.pc-status.v1', kind: 'measured', intervalMs: 5000, retentionHours: 24, disk: 'C:', servedAt: at, storage: {status: 'ok', reason: ''}, latest, history: [latest]};
  const node = createStudentView().renderPcStatus({status: 'ok', data});
  assert.match(node.textContent, /C: 디스크 남은 공간 읽기 실패/); assert.match(node.textContent, /시험용 C: 접근 거부/); assert.match(node.textContent, /다음 할 일/);
  const cards = walk(node).filter(el => String(el.className || '').split(/\s+/).includes('pc-metric'));
  assert.ok(!walk(node).some(el => String(el.className || '').split(/\s+/).includes('card')));
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

test('학생 표시 지점·재조회 접근성 이름·새 제공 패키지 도구를 소스에서 확인한다', async () => {
  for (const id of ['student-overview','overview-query-status','pc-query-status','connection-query-status']) assert.ok(html.includes('id="' + id + '"'));
  for (const label of ['PC·Windows·연결과 보안 기록 다시 조회','내 PC 상태 다시 조회','연결과 기록 다시 조회']) assert.ok(html.includes('aria-label="' + label + '"'));
  assert.ok(html.indexOf('id="student-overview"') < html.indexOf('id="identity-user"'));
  assert.equal((html.match(/aria-atomic="true"/g) || []).length, 3);
  const packageInfo = JSON.parse(await readFile(new URL('../on-client/package.json', import.meta.url), 'utf8'));
  assert.equal(packageInfo.version, '0.2.21');
  assert.equal(packageInfo.scripts['package-app'], 'node tools/package-app.mjs');
  assert.ok((await readFile(new URL('../on-client/tools/package-app.mjs', import.meta.url), 'utf8')).length > 0);
  const appearance = JSON.parse(await readFile(new URL('../on-client/student/appearance.json', import.meta.url), 'utf8'));
  assert.equal(appearance.schema, 'alekov.student-appearance.v1');
  assert.deepEqual(Object.keys(appearance).sort(), ['palette','schema']);
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
test('상태 요약은 부분 실패·이전 자료·조회 중을 성공으로 바꾸지 않는다', () => withDocument(() => {
  const view=createStudentView({capabilities:{overviewSlot:true}}),pc=measuredPcData(),windows=connectionData();
  const read=(pcStatus,connectionStatus)=>view.renderOverview({pcStatus,connectionStatus,identity:{mode:'disconnected'},events:{status:'error'}});
  const card=(node,index)=>walk(node).filter(el=>el.getAttribute('data-status-summary'))[index];
  let node=read({status:'ok',data:pc},{status:'ok',data:windows});
  assert.match(card(node,0).textContent,/3개 지표 조회됨/);
  assert.equal(card(node,0).getAttribute('data-observation'),'observed');
  assert.match(card(node,1).textContent,/일부 영역 확인 불가/);
  assert.equal(card(node,1).getAttribute('data-observation'),'pending');
  assert.match(card(node,2).textContent,/보안 엔진 미연결/);
  node=read({status:'error',data:pc,error:{message:'시험용 조회 실패'}},{status:'error',data:windows});
  assert.match(card(node,0).textContent,/측정 요청 실패/);assert.equal(card(node,0).getAttribute('data-observation'),'pending');
  assert.match(card(node,1).textContent,/조회 요청 실패[\s\S]*이전 조회 자료/);
  node=read({status:'loading'},{status:'loading',data:windows});
  assert.match(card(node,0).textContent,/실측 조회 중/);assert.match(card(node,1).textContent,/Windows 조회 중[\s\S]*이전 조회 자료/);
  const old=structuredClone(pc);old.latest.measuredAt=new Date(Date.now()-120000).toISOString();
  node=read({status:'ok',data:old},{status:'ok',data:{...windows,checkedAt:new Date(Date.now()-120000).toISOString()}});
  assert.match(card(node,0).textContent,/이전 측정 기록/);assert.match(card(node,1).textContent,/이전 조회 기록/);
  const partial=structuredClone(pc);partial.latest.disk={...partial.latest.disk,status:'unavailable',value:null,reason:'시험용 C: 조회 실패'};
  node=read({status:'ok',data:partial},{status:'idle'});assert.match(card(node,0).textContent,/일부 지표 확인 불가[\s\S]*2\/3/);
  node=read({status:'error',environment:'web'},{status:'error'});assert.match(card(node,0).textContent,/로컬 앱에서 확인/);
}));
test('최근 기록은 받은 자료를 시각순으로 제한해 표시하고 실패·예제·빈 목록을 구분한다',()=>withDocument(()=>{
  const view=createStudentView({capabilities:{overviewSlot:true}}),events=Array.from({length:5},(_,i)=>({id:'event-'+i,appId:'library',at:new Date(Date.now()-i*1000).toISOString(),summary:'시험용 기록 '+i}));
  const input={status:'ok',mode:'connected',data:[...events].reverse()},before=JSON.stringify(input);
  const recent=node=>walk(node).find(el=>el.className==='overview-recent');
  let node=recent(view.renderOverview({events:input}));
  assert.equal(walk(node).filter(el=>el.tagName==='li').length,4);assert.ok(node.textContent.indexOf('기록 0')<node.textContent.indexOf('기록 1'));assert.doesNotMatch(node.textContent,/기록 4/);assert.equal(JSON.stringify(input),before);
  node=recent(view.renderOverview({events:{...input,status:'loading'}}));assert.match(node.textContent,/조회 중/);assert.doesNotMatch(node.textContent,/시험용 기록/);
  node=recent(view.renderOverview({events:{...input,status:'error'}}));assert.match(node.textContent,/연결이 없습니다/);assert.doesNotMatch(node.textContent,/시험용 기록/);
  assert.match(recent(view.renderOverview({events:{...input,data:[]}})).textContent,/받은 보안 기록이 없습니다/);
  assert.match(recent(view.renderOverview({events:{...input,mode:'demo'}})).textContent,/예제 기록 · 실제 연결 아님/);
}));
test('대시보드 그래프·디스크 막대는 전달된 실측 자료와 단위를 사용하고 설명 펼침과 초점을 유지한다', () => withDocument(document => {
  const pc = measuredPcData(), context = hostContext(document);
  context.studentData = () => ({pcStatus: {status: 'ok', data: pc}, connectionStatus: {status: 'ok', data: connectionData()}});
  context.controls.renderStudent('overview');
  const node = document.getElementById('student-overview');
  assert.ok(!walk(node).some(el => String(el.className || '').split(/\s+/).includes('card')));
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
