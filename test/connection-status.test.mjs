import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import http from 'node:http';
import vm from 'node:vm';
import {readConnectionStatus, windowsReadScript} from '../on-client/src/connection-status.mjs';
import {validConnectionPayload, renderConnectionStatusView} from '../on-client/student/connection-status-view.mjs';
import {createOnServer} from '../on-client/src/server.mjs';
import {demoEngine} from '../on-client/src/engine.mjs';

// Documentation-only addresses; fixture values are never installed in the application.
const raw = {
  network: {status: 'ok', interfaces: [{name: '연습 어댑터', index: 1, type: 'ethernet', link: 'Up', virtual: false,
    configurationCode: null, addresses: [{address: '192.0.2.7', prefix: 24}], gateways: ['192.0.2.1'], dns: ['192.0.2.53']}]},
  firewall: {status: 'ok', profiles: [{name: 'Domain', enabled: 'True'}, {name: 'Private', enabled: 'False'}, {name: 'Public', enabled: 'True'}], active: ['Public'], activeCode: null},
  events: {status: 'ok', logs: [{name: 'System', status: 'ok', warnings: 3, errors: 1}, {name: 'Application', status: 'ok', warnings: 0, errors: 0}]},
};
const kindOf = script => script.includes('Get-NetAdapter') ? 'network' : script.includes('Get-NetFirewallProfile') ? 'firewall' : 'events';
const fixtureRead = overrides => readConnectionStatus({platform: 'win32', runner: async script => structuredClone({...raw, ...overrides}[kindOf(script)])});
const sdp = () => ({status: 'disconnected', reason: '예제 연결 상태 · 실제 SDP 미연결', code: 'DEMO_ONLY', source: 'test fixture', checkedAt: new Date().toISOString()});

test('네트워크·프로필별 방화벽·두 로그의 집계 기간과 출처를 별도로 투영한다', async () => {
  const data = {...await fixtureRead(), sdp: sdp()};
  assert.ok(validConnectionPayload(data));
  assert.equal(Date.parse(data.window.to) - Date.parse(data.window.from), 86400000);
  assert.equal(data.network.interfaces[0].configuration.addresses[0].address, '192.0.2.7');
  assert.equal(data.firewall.profiles[1].enabled, false);
  assert.deepEqual(data.firewall.active.names, ['Public']);
  assert.equal(data.events.logs[0].warnings, 3);
  assert.equal(data.events.logs[1].errors, 0);
  assert.equal(data.readOnly, true);
  for (const key of ['network','firewall','events']) assert.ok(data[key].source && Date.parse(data[key].checkedAt));
});
test('부분 접근 거부와 부정확한 결과를 0건이나 꺼짐으로 바꾸지 않는다', async () => {
  const network = structuredClone(raw.network); network.interfaces[0].configurationCode = 'ACCESS_DENIED';
  const events = structuredClone(raw.events); events.logs[0] = {name: 'System', status: 'unavailable', code: 'ACCESS_DENIED'};
  events.logs[1].errors = -1;
  const firewall = structuredClone(raw.firewall); firewall.profiles[0].enabled = 'NotConfigured'; firewall.activeCode = 'ACCESS_DENIED';
  const data = {...await fixtureRead({network, firewall, events}), sdp: sdp()};
  assert.ok(validConnectionPayload(data));
  assert.equal(data.network.status, 'ok');
  assert.equal(data.network.interfaces[0].configuration.status, 'unavailable');
  assert.equal(data.firewall.profiles[0].enabled, null);
  assert.equal(data.firewall.active.status, 'unavailable');
  for (const row of data.events.logs) {assert.equal(row.warnings, null); assert.equal(row.errors, null);}
});
test('실행 실패·시간 초과·잘못된 네트워크 자료는 이유만 반환하며 원문을 노출하지 않는다', async () => {
  const data = await readConnectionStatus({platform: 'win32', runner: async () => {throw Object.assign(Error('private diagnostics must not appear'), {code: 'QUERY_TIMEOUT'});}});
  for (const key of ['network','firewall','events']) {assert.equal(data[key].status, 'unavailable'); assert.equal(data[key].code, 'QUERY_TIMEOUT');}
  assert.ok(!JSON.stringify(data).includes('private diagnostics'));
  const network = structuredClone(raw.network); network.interfaces[0].addresses[0].address = 'not-an-address';
  assert.equal((await fixtureRead({network})).network.status, 'unavailable');
  let calls = 0;
  const other = await readConnectionStatus({platform: 'other', runner: () => {calls++;}});
  assert.equal(calls, 0); assert.equal(other.network.code, 'UNSUPPORTED_PLATFORM');
});
test('고정된 읽기 스크립트만 사용하며 24시간 필터·무결한 전체 집계·접근 실패 구분을 유지한다', () => {
  const to = new Date().toISOString(), from = new Date(Date.parse(to) - 86400000).toISOString();
  for (const kind of ['network','firewall','events']) {
    const script = windowsReadScript(kind, from, to);
    assert.doesNotMatch(script, /\b(?:Set|New|Remove|Clear|Enable|Disable|Restart|Start|Stop)-(?:Net\w*|Service|Process|EventLog)\b/i);
    assert.doesNotMatch(script, /\b(?:Out-File|Set-Content|Add-Content|Invoke-WebRequest|Invoke-RestMethod|Test-NetConnection)\b/i);
  }
  const script = windowsReadScript('events', from, to);
  assert.match(script, /Level=2,3; StartTime=\$begin; EndTime=\$end/);
  assert.match(script, /NoMatchingEventsFound/); assert.match(script, /-ListLog/);
  assert.doesNotMatch(script, /-MaxEvents|\.Message\b|-ComputerName|-Credential/);
  assert.throws(() => windowsReadScript('arbitrary-command', from, to));
  assert.throws(() => windowsReadScript('events', 'bad date', to));
});

class E {
  constructor(tag) {this.tagName = tag; this.children = []; this.attributes = {}; this.ownText = '';}
  set textContent(x) {this.ownText = String(x); this.children = [];}
  get textContent() {return this.ownText + this.children.map(c => c.textContent).join('\n');}
  appendChild(c) {this.children.push(c); return c;}
  setAttribute(k, v) {this.attributes[k] = String(v);}
}
const walk = node => [node, ...node.children.flatMap(walk)];
test('표시는 침해 판정과 분리하고 조회 불가·SDP 미연결·과거 기록을 그대로 알린다', async () => {
  const previous = globalThis.document; globalThis.document = {createElement: tag => new E(tag)};
  try {
    const data = {...await fixtureRead({events: {status: 'ok', logs: [{name: 'System', status: 'unavailable', code: 'ACCESS_DENIED'}, raw.events.logs[1]]}}), sdp: sdp()};
    const view = renderConnectionStatusView({status: 'ok', data});
    assert.match(view.textContent, /침해나 공격 탐지 결과가 아닙니다/);
    assert.match(view.textContent, /SDP 미연결/); assert.match(view.textContent, /확인 불가/);
    const system = walk(view).find(e => e.tagName === 'tr' && e.children[0]?.textContent === 'System');
    assert.equal(system.children[1].textContent, '확인 불가');
    assert.equal(system.children[2].textContent, '확인 불가');
    assert.match(view.textContent, /출처/); assert.match(view.textContent, /조회 시각/); assert.match(view.textContent, /KST/);
    assert.match(renderConnectionStatusView({status: 'error', data, error: {message: '요청 실패'}}).textContent, /이전 자료를 현재 결과로 표시하지 않습니다/);
    const bad = structuredClone(data); bad.events.logs[0].warnings = 0; assert.equal(validConnectionPayload(bad), false);
    assert.match(renderConnectionStatusView().textContent, /검증된 조회 결과가 없습니다/);
  } finally {globalThis.document = previous;}
});

test('실제 화면 제어는 화면당 1회 요청하고 실패를 재시도하지 않으며 이탈 후 늦은 응답을 버린다', async () => {
  const source = await readFile(new URL('../on-client/public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('// Connection observations:'), end = source.indexOf('// PC-only polling.', start);
  assert.ok(start > 0 && end > start);
  const data = {...await fixtureRead(), sdp: sdp()}, requests = [], context = vm.createContext({
    state: {view: 'connections'}, connectionReadState: {status: 'idle', data: null, error: null}, connectionSequence: 0, connectionReadController: null,
    AbortController, validConnectionPayload, renderStudent: () => {}, request: async (path, options) => {requests.push({path, options}); return {ok: true, data};},
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.controls={updateConnectionStatus,cancelConnectionRead};', context);
  await context.controls.updateConnectionStatus(); assert.equal(requests.length, 1); assert.equal(context.connectionReadState.status, 'ok');
  context.request = async () => ({ok: false, error: {message: '조회 실패'}});
  await context.controls.updateConnectionStatus(); assert.equal(context.connectionReadState.status, 'error');
  assert.strictEqual(context.connectionReadState.data, data);
  let finish;
  context.request = () => new Promise(resolve => {finish = resolve;});
  const pending = context.controls.updateConnectionStatus();
  context.state.view = 'pc'; context.controls.cancelConnectionRead();
  finish({ok: true, data: {...data, checkedAt: new Date(Date.now() + 1000).toISOString()}}); await pending;
  assert.strictEqual(context.connectionReadState.data, data);
  await context.controls.updateConnectionStatus(); assert.equal(requests.length, 1);
});

const request = (port, path, {method = 'GET', body, origin = true} = {}) => new Promise((resolve, reject) => {
  const req = http.request({host: '127.0.0.1', port, path, method, headers: {...(body !== undefined ? {'content-type': 'application/json'} : {}),
    ...(origin ? {origin: 'http://127.0.0.1:' + port} : {})}}, res => {
    let data = ''; res.setEncoding('utf8'); res.on('data', chunk => data += chunk); res.on('end', () => resolve({status: res.statusCode, data}));
  });
  req.on('error', reject); req.setTimeout(4000, () => req.destroy(Error('test timeout')));
  req.end(body === undefined ? undefined : JSON.stringify(body));
});
test('로컬 조회 API는 PC 성공과 미설정·예제·검증되지 않은 SDP 어댑터를 분리한다', async () => {
  for (const engine of [undefined, demoEngine(), {evidenceMode: 'connected', projectId: 'fixture-project'}]) {
    let calls = 0;
    const server = createOnServer({...(engine ? {engine} : {}), connectionStatusReader: async () => {calls++; return fixtureRead();}});
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port;
    try {
      const output = await request(port, '/api/connection-status/read', {method: 'POST', body: {}});
      assert.equal(output.status, 200);
      const json = JSON.parse(output.data); assert.ok(validConnectionPayload(json.data));
      assert.equal(json.data.network.status, 'ok');
      assert.equal(json.data.sdp.status, engine?.evidenceMode === 'connected' ? 'unavailable' : 'disconnected');
      assert.notEqual(json.data.sdp.status, 'connected'); assert.equal(calls, 1);
      assert.equal((await request(port, '/student/connection-status-view.mjs')).status, 200);
      assert.equal((await request(port, '/api/connection-status/read')).status, 405);
      assert.equal((await request(port, '/api/connection-status/read', {method: 'POST', body: {command: 'not allowed'}})).status, 400);
      assert.equal((await request(port, '/api/connection-status/read', {method: 'POST', body: {}, origin: false})).status, 403);
      assert.equal(calls, 1);
    } finally {await new Promise(resolve => server.close(resolve));}
  }
});
test('실제 Windows 일반 권한 조회 결과의 형식·시각을 확인하며 네트워크 주소·이벤트 본문을 출력하지 않는다', async t => {
  const data = await readConnectionStatus();
  assert.ok(validConnectionPayload({...data, sdp: sdp()}));
  const summary = Object.fromEntries(['network','firewall','events'].map(key => [key, {status: data[key].status, code: data[key].code || null}]));
  if (data.events.status === 'ok') summary.events.logs = data.events.logs.map(row => ({name: row.name, status: row.status, code: row.code || null, warnings: row.warnings, errors: row.errors}));
  t.diagnostic(JSON.stringify({kind: data.kind, checkedAt: data.checkedAt, readOnly: data.readOnly, ...summary}));
});
