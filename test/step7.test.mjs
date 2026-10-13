import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, RULE_IDS, inspectConnectionInput } from '../src/decider.mjs';
import { checkDecider } from '../scripts/decider-test.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { createZtnaConnection } from '../src/ztna.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

test('7단계 입력: 가상 사건과 실제 정보 없음의 출처를 구분합니다', () => {
  const { normal } = fixtureRequests();
  const inspected = inspectConnectionInput(normal);
  assert.equal(inspected.source, 'judge_fixture');
  assert.equal(inspected.complete, true);
  const unavailable = inspectConnectionInput({ ...normal,
    signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 } });
  assert.deepEqual(unavailable, { source: 'none', region: null, network: null,
    hour: 14, recentEvents: null, complete: true });
});

test('7단계 입력: 누락·형식 오류·출처 불명확을 정상값으로 채우지 않습니다', () => {
  const { normal } = fixtureRequests();
  for (const signals of [undefined, null, [], {}, { ...normal.signals, source: 'browser' },
    { ...normal.signals, source: undefined }, Object.create(normal.signals)]) {
    const inspected = inspectConnectionInput({ ...normal, signals });
    assert.equal(inspected.complete, false);
    assert.equal(inspected.source, 'untrusted');
    assert.equal(inspected.region, null);
    assert.equal(inspected.network, null);
    assert.equal(inspected.hour, null);
  }
  for (const key of ['region', 'network', 'hour']) {
    const signals = { ...normal.signals };
    delete signals[key];
    const inspected = inspectConnectionInput({ ...normal, signals });
    assert.equal(inspected[key], null);
    assert.equal(inspected.complete, false);
  }
  for (const hour of ['3', -1, 24, 3.5, NaN, Infinity]) {
    assert.equal(inspectConnectionInput({ ...normal, signals: { ...normal.signals, hour } }).hour, null);
  }
  for (const recentEvents of [undefined, null, {}, Array(1), Array(13).fill({ kind: 'risk_signal',
    ageSeconds: 60, count: 20 }), [{ kind: 'risk_signal', ageSeconds: '60', count: 20 }],
    [{ kind: 'risk_signal', ageSeconds: 60, count: -1 }]]) {
    const inspected = inspectConnectionInput({ ...normal, recentEvents });
    assert.equal(inspected.recentEvents, null);
    assert.equal(inspected.complete, false);
  }
});

test('7단계 입력: 클라이언트 헤더를 엔진의 접속 정보로 승격하지 않습니다', async () => {
  const { normal, suspicious } = fixtureRequests();
  const request = { ...normal, signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 },
    headers: { 'x-aleph-signals': JSON.stringify(suspicious.signals) }, body: suspicious };
  const before = JSON.stringify(request);
  const connected = createZtnaConnection({ rules: async () => [] });
  const output = await connected(request, { socket: { remoteAddress: '192.0.2.60' },
    headers: { 'x-aleph-signals': JSON.stringify(suspicious.signals),
      'x-region': 'foreign', 'x-network': 'unusual', 'x-hour': '3' } });
  assert.equal(output.decision, 'allow');
  assert.equal(inspectConnectionInput(request).source, 'none');
  assert.equal(JSON.stringify(request), before);
});

test('7단계 규칙: 정상 허용·복합 사건 추가 확인과 다섯 항목 응답을 유지합니다', async () => {
  const results = await checkDecider({ decide, ruleIds: RULE_IDS });
  assert.equal(results.length, 4);
  assert.ok(results.every(result => result.passed));
  const { suspicious } = fixtureRequests();
  const output = decide(suspicious);
  assert.equal(output.reasonCode, 'step_up_required');
  assert.deepEqual(output.ruleIds, ['step_up_required']);
  assert.deepEqual(Object.keys(output).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.equal(decide({ ...suspicious, deviceRegistered: false }).reasonCode, 'device_not_registered');
});

test('7단계 규칙: 지역 하나와 불완전한 조합은 정상 사용자를 영구 차단하지 않습니다', () => {
  const { normal, suspicious } = fixtureRequests();
  for (const input of [
    { ...normal, signals: { ...normal.signals, region: 'foreign' } },
    { ...suspicious, signals: { ...suspicious.signals, hour: 6 } },
    { ...suspicious, signals: { ...suspicious.signals, network: 'usual' } },
    { ...suspicious, recentEvents: [] },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 19 }] },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 301, count: 20 }] },
    { ...suspicious, recentEvents: [{ kind: 'ordinary_read', ageSeconds: 60, count: 20 }] },
  ]) assert.equal(decide(input).decision, 'allow');
  for (const region of ['local', 'foreign']) {
    assert.equal(decide({ ...suspicious, signals: { ...suspicious.signals, region } }).decision, 'step_up');
  }
  assert.equal(decide({ ...suspicious, signals: { ...suspicious.signals, hour: 5 },
    recentEvents: [{ kind: 'risk_signal', ageSeconds: 300, count: 20 }] }).decision, 'step_up');
  assert.equal(decide(normal).decision, 'allow');
});

test('7단계 규칙: 필수 정보 누락과 위조 출처가 정상 허용으로 우회하지 않습니다', () => {
  const { normal, suspicious } = fixtureRequests();
  for (const signals of [undefined, null, {}, { ...normal.signals, source: 'browser' },
    { ...normal.signals, region: undefined }, { ...normal.signals, network: undefined },
    { ...normal.signals, hour: '14' }, { ...normal.signals, source: 'none' }]) {
    assert.equal(decide({ ...normal, signals }).decision, 'step_up');
  }
  assert.equal(decide({ ...normal, recentEvents: undefined }).decision, 'step_up');
  const connectedHeaders = { 'x-step-up-verified': 'true', 'x-auth-age-seconds': '0' };
  for (const stepUp of [undefined, null, { verified: false, authAgeSeconds: 60 },
    { verified: true, authAgeSeconds: null }, { verified: true, authAgeSeconds: -1 },
    { verified: true, authAgeSeconds: 901 }, { verified: true, authAgeSeconds: 0.5 },
    { verified: true, authAgeSeconds: Infinity }, { verified: true, authAgeSeconds: '60' },
    { verified: 'true', authAgeSeconds: 60 }, Object.create({ verified: true, authAgeSeconds: 60 })]) {
    assert.equal(decide({ ...suspicious, stepUp, headers: connectedHeaders }).decision, 'step_up');
  }
});

test('7단계 재확인: 유효한 엔진 가상 상태만 허용하고 기기·입력 검사를 우회하지 않습니다', () => {
  const { suspicious } = fixtureRequests();
  for (const authAgeSeconds of [0, 60, 900]) {
    const request = { ...suspicious, stepUp: { verified: true, authAgeSeconds } };
    assert.equal(decide(request).decision, 'allow');
    assert.equal(decide(request).reasonCode, 'approved');
    assert.equal(decide({ ...request, deviceRegistered: false }).decision, 'deny');
    assert.equal(decide({ ...request, signals: undefined }).decision, 'step_up');
    assert.equal(decide({ ...request, signals: { ...request.signals, source: 'browser' } }).decision, 'step_up');
  }
});

test('7단계 연결: 정상 헤더로 복합 사건을 덮어쓰지 않으며 XDR 거부가 우선합니다', async () => {
  const { normal, suspicious } = fixtureRequests();
  const connected = createZtnaConnection({ rules: async () => [] });
  const output = await connected(suspicious, { socket: { remoteAddress: '192.0.2.60' },
    headers: { 'x-aleph-signals': JSON.stringify(normal.signals), 'x-step-up-verified': 'true' } });
  assert.equal(output.decision, 'step_up');
  const now = Date.parse('2026-10-13T00:00:00Z');
  const blocked = createZtnaConnection({ clock: () => new Date(now).toISOString(),
    rules: async () => ({ schema: 'aleph.xdr.deny-rules.v1', moduleKey: 'brute-force', rules: [{
      ruleId: 'xdr.brute_force.deny', action: 'deny', sourceIp: '192.0.2.60', alertIds: ['fixture7'],
      startsAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
    }] }) });
  const denied = await blocked(suspicious, { socket: { remoteAddress: '192.0.2.60' } });
  assert.equal(denied.decision, 'deny');
  const confirmedButBlocked = await blocked({ ...suspicious,
    stepUp: { verified: true, authAgeSeconds: 60 } }, { socket: { remoteAddress: '192.0.2.60' } });
  assert.equal(confirmedButBlocked.decision, 'deny');
});

test('7단계 제출 점검: 가상 결과·배포 불일치·재로그인 미실행을 구분하고 자료를 기록하지 않습니다', async () => {
  const originalFetch = globalThis.fetch;
  const sentinel = 'DO_NOT_RECORD_BODY';
  const config = { step: 7, publicAppUrl: 'https://student-defense.vercel.app',
    repoUrl: 'https://github.com/student-a/aleph-defense', sampleMarker: 'SAMPLE_NOTE_1',
    originalApiUrl: 'https://training-project.supabase.co/rest/v1/training_notes',
    allowedRoutes: ['GET /api/notes'] };
  const expectedCommit = 'a'.repeat(40);
  let step = 7;
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(init.body, undefined);
      assert.equal(init.headers, undefined);
      if (url.pathname === '/') return new Response(`<html>${sentinel}</html>`);
      if (url.pathname === '/data.json') return Response.json({ notes: [] });
      if (url.pathname === '/aleph.json') return Response.json({ schema: 'aleph.defense.deployment.v1',
        step, repoUrl: config.repoUrl, commit: expectedCommit, originalApiUrl: config.originalApiUrl,
        allowedRoutes: config.allowedRoutes });
      return Response.json({ error: 'LOGIN_REQUIRED' }, { status: 401 });
    };
    const results = await runAttackChecks(config, { expectedCommit });
    assert.equal(calls, 4);
    assert.equal(results.length, 17);
    assert.equal(new Set(results.map(result => result.attackId)).size, 17);
    const find = id => results.find(result => result.attackId === id);
    assert.match(find('compound_connection_fixture').observed, /시험 통과: step_up/u);
    assert.match(find('verified_reconfirmation_fixture').observed, /시험 통과: allow/u);
    assert.match(find('region_only_fixture').observed, /시험 통과: allow/u);
    assert.match(find('forged_client_headers_fixture').observed, /시험 통과: step_up/u);
    for (const id of ['step_up_before_relogin_data', 'step_up_after_relogin_request']) {
      assert.match(find(id).observed, /^미실행/u);
    }
    assert.match(find('deployment_stage7_identity').observed, /배포 식별 정보 일치/u);
    assert.ok(!JSON.stringify(results).includes(sentinel));
    assert.ok(!JSON.stringify(results).includes('Bearer '));
    step = 6;
    const stale = await runAttackChecks(config, { expectedCommit });
    assert.match(stale.find(result => result.attackId === 'deployment_stage7_identity').observed, /^불일치/u);
  } finally { globalThis.fetch = originalFetch; }
});
