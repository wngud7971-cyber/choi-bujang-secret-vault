// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
import { randomUUID } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import { decide, RULE_IDS } from './decider.mjs';
import { checkDecider } from '../scripts/decider-test.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { checkZones } from '../scripts/fixture-8.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detect } from './detect.mjs';
import { checkDetection } from '../scripts/detect-test.mjs';
import { fileURLToPath } from 'node:url';

async function runAppChecks(config, app, expectedCommit, options) {
  const checks = await runRecoveryChecks(config, app, expectedCommit, options);
  let passed = false;
  try {
    const testEnv = { ...process.env };
    delete testEnv.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, ['--test',
      ...['step11-device.test.mjs', 'auth-ui.test.mjs', 'step11-app.test.mjs']
        .map(name => fileURLToPath(new URL(`../test/${name}`, import.meta.url)))],
      { windowsHide: true, timeout: 30000, maxBuffer: 256 * 1024, env: testEnv });
    passed = /(?:ℹ|#) pass 23\b/u.test(stdout) && /(?:ℹ|#) fail 0\b/u.test(stdout);
  } catch { /* Never copy test operands, credentials, tokens or signature proofs into a bundle. */ }
  checks.push({ attackId: 'device_app_local_boundary',
    expected: '로컬 서명·DB·화면 시험: 승인 대기 차단, 승인 후 정상, 무서명·경로/본문 변경·재사용·회수 거부, 비밀 저장 금지',
    observed: passed ? '로컬 시험 23개 통과: 고정 API 등록·승인 확인, 실제 서명·임시 PostgreSQL·UI 모의 실행. 운영 인증기·기기 승인·공식 심판 호환 시험은 미실행'
      : '불일치: 11단계 로컬 시험 미통과. 운영 기기·공식 심판 판정 아님' });
  return checks;
}

async function runRecoveryChecks(config, app, expectedCommit, { offline = false } = {}) {
  const previous = await runDetectionChecks(config, app, expectedCommit, { offline });
  const local = previous.filter(item => /fixture|isolated|local_boundary/u.test(item.attackId));
  const results = previous.filter(item => !local.includes(item));
  results.push({ attackId: 'prior_stage1_9_local_checks',
    expected: '기존 기기·추가 확인·자원 구역·소유자 API·탐지·격리 실행의 로컬 가상 점검을 재실행',
    observed: `${local.length === 8 && local.every(item => item.observed.startsWith('로컬')) ? '로컬 기존 방어 점검 통과' : '불일치'}: ${local.length}개 실행 묶음; 실제 심판 판정 아님` });
  let summary;
  try {
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--experimental-vm-modules', fileURLToPath(new URL('../scripts/recovery-check.mjs', import.meta.url))],
      { windowsHide: true, timeout: 30000, maxBuffer: 8192 });
    summary = JSON.parse(stdout);
  } catch { /* Do not expose assertion operands, synthetic bodies or tokens. */ }
  for (const [attackId, names, expected] of [
    ['recovery_backup_validation_local', ['atomic_backup_and_readback', 'backup_hash_mismatch_stops',
      'missing_backup_stops', 'original_backup_not_replaced', 'private_backup_and_rpc_grants'],
    '실제 SQL의 비공개 사전 사본 검증·해시 불일치/누락 중단·원래 사본과 권한 보존'],
    ['recovery_single_note_local', ['tampered_note_restored', 'deleted_note_restored', 'repeat_restore_and_audit_preservation',
      'verified_b_owner_and_run_only', 'foreign_owner_id_reuse_stops', 'strict_single_target_and_no_role_spoof',
      'post_restore_prior_defenses', 'post_restore_real_api_zone_checks', 'safe_recovery_responses_and_logs'],
    '실제 복구 API·PostgreSQL에서 B 한 건의 변조/삭제 복원과 복구 직후 정상·금지 요청 재시험'],
    ['recovery_policy_restore_local', ['preview_without_mutation', 'policy_restore_preview_hash_and_boundaries'],
    '확인한 현재 해시가 맞을 때만 시험 정책 복원·B의 A 구역 거부·A 정상 유지·감사 기록 보존'],
  ]) {
    const ok = summary?.kind === 'local_postgresql_and_api' && summary.passed && summary.count === 16
      && names.every(name => summary.results?.some(item => item.name === name && item.passed));
    results.push({ attackId, expected: `로컬 가상 시험: ${expected}`,
      observed: `${ok ? '로컬 복구 시험 통과' : '불일치'}: ${names.length}개 시나리오; 임시 PostgreSQL·일시 서명 신원 사용, 운영 DB·심판 시험 아님` });
  }
  let anonymous = offline ? '미실행: 업로드·재배포 후 확인 예정' : '미확인: 요청 실패 또는 시간 초과';
  if (!offline) try {
    const response = await fetch(new URL('/api/restore', app), { method: 'POST', redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const data = await response.json().catch(() => null);
    anonymous = response.status === 401 && data?.error === 'LOGIN_REQUIRED' && Object.keys(data).length === 1
      ? 'HTTP 401: 무로그인 복구 요청은 자료·변경 없이 거부'
      : `불일치: HTTP ${response.status}, 새 복구 경로의 무로그인 거부 미확인`;
  } catch { /* No sensitive transport details. */ }
  results.push({ attackId: 'anonymous_recovery_post', expected: '배포된 POST /api/restore가 무로그인 복구 요청 거부', observed: anonymous },
    { attackId: 'recovery_storage_live', expected: '같은 학습 DB에 STEP10_DATABASE.sql 적용 후 비공개 백업과 복구 RPC 사용 가능',
      observed: '미실행: 로컬 PostgreSQL에서 SQL 실행은 확인했으나 운영 DB에 SQL 적용은 사용자가 직접 수행해야 함' },
    { attackId: 'recovery_live_b_restore', expected: '심판의 실제 B 메모 생성→백업 검증→변조/삭제→복구→기존 공격 재전송',
      observed: '미실행: 실제 시험 계정 B 토큰·메모·운영 DB 변경을 만들지 않음. 업로드·DB 설정·재배포 후 심판 판정 필요' });
  return results;
}

async function runDetectionChecks(config, app, expectedCommit, options) {
  const prior = await runZoneChecks(config, app, expectedCommit, options);
  const groups = [
    ['prior_device_and_step_up_fixtures', ['registered_device_fixture', 'unregistered_device_fixture',
      'compound_connection_fixture', 'verified_reconfirmation_fixture'], '기존 등록 기기·미등록 거부·복합 추가 확인·가상 재확인 허용'],
    ['prior_resource_zone_fixtures', ['own_zone_fixture', 'foreign_zone_fixture',
      'announcement_zone_fixture', 'unknown_route_and_query_fixture'], '기존 본인 구역·교차 구역 거부·공지 쓰기 거부·정확한 경로'],
  ];
  const grouped = new Set(groups.flatMap(([, names]) => names));
  const results = prior.filter(item => !grouped.has(item.attackId));
  for (const [attackId, names, expected] of groups) {
    const executed = prior.filter(item => names.includes(item.attackId));
    results.push({ attackId, expected: `로컬 가상 요청: ${expected}`,
      observed: `${executed.length === names.length && executed.every(item => item.observed.startsWith('로컬 가상 시험 통과')) ? '로컬 가상 시험 통과' : '불일치'}: ${executed.length}개 점검 묶음; 실제 심판 아님` });
  }
  const detection = await checkDetection(detect);
  for (const [group, expected] of [
    ['compound', '공식 세 항목 연습의 폭주 조회는 burst_read·subject 제안, 확장 복합 사건은 확인된 기기 한 개의 제안'],
    ['normal', '정상·지역 단독·평소 네트워크 폭주·확장 입력 정보 누락·미등록·브라우저 신호는 회수 제안 없음'],
    ['boundary', '120/121·10분 경계·시간 순서·사용자/기기 분리·중복 요청 처리'],
  ]) {
    const executed = detection.filter(item => item.group === group);
    results.push({ attackId: `detection_${group}_fixtures`, expected: `로컬 가상 사건: ${expected}`,
      observed: `${executed.length && executed.every(item => item.passed) ? '로컬 탐지 가상 시험 통과' : '불일치'}: ${executed.length}건; 실제 회수·심판 판정 아님` });
  }
  try {
    const runner = new URL('../scripts/detect-isolation-check.mjs', import.meta.url).href;
    const code = `const {checkDetectionIsolation}=await import(${JSON.stringify(runner)});process.stdout.write(JSON.stringify(await checkDetectionIsolation()));`;
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--experimental-vm-modules', '--input-type=module', '-e', code],
      { windowsHide: true, timeout: 15000, maxBuffer: 4096 });
    const summary = JSON.parse(stdout);
    results.push({ attackId: 'detection_isolated_execution', expected: '외부 모듈·파일·네트워크·타이머 없는 격리 환경에서 탐지 실행',
      observed: `${summary.passed && summary.count === detection.length ? '로컬 탐지 격리 가상 시험 통과' : '불일치'}: ${summary.count}건; 실제 심판 아님` });
  } catch {
    results.push({ attackId: 'detection_isolated_execution', expected: '외부 모듈 없는 격리 탐지 실행',
      observed: '불일치: 격리 실행 실패 또는 시간 초과; 원문·비밀값은 기록하지 않음' });
  }
  results.push(
    { attackId: 'revocation_followup_live', expected: '심판이 실제 회수 후 다음 요청·남은 세션 재접속·다른 자원 이동 거부와 정상 기기 유지 확인',
      observed: '미실행: 실제 회수·세션 무효화는 심판 담당. 로컬은 별도 propose_revocation 결과만 내며 회수 API·권한 변경 없음' },
    { attackId: 'revocation_elapsed_time_live', expected: '심판이 첫 의심 사건부터 탐지·기기 회수까지 경과 시간을 측정',
      observed: '미실행: 운영 사건 전달·회수 집행·시간 측정·확장 입력/기기 대상 응답의 심판 호환성은 재판정에서 확인' },
  );
  return results;
}

async function runZoneChecks(config, app, expectedCommit, { offline = false } = {}) {
  const prior = await runDeviceChecks(config, app, expectedCommit, { offline });
  const zones = await checkZones(decide);
  // Keep the v2 submission's 20-item limit, grouping related executed requests.
  const groups = [
    ['own_zone_fixture', ['self_note_read', 'self_note_edit', 'self_note_list', 'legacy_note_read', 'legacy_note_edit'], '본인 메모 조회·수정·본인 구역 목록과 기존 단건 경로 허용'],
    ['foreign_zone_fixture', ['foreign_note_read', 'foreign_note_edit', 'foreign_note_list'], '다른 사용자 메모 조회·수정·목록 거부'],
    ['announcement_zone_fixture', ['student_notice_edit', 'authenticated_notice_read', 'announcement_post', 'announcement_patch', 'announcement_delete'], '공지의 모든 쓰기 거부·로그인 공지 조회 허용'],
    ['unknown_route_and_query_fixture', ['unknown_resource_path', 'query_operation_switch', 'aggregate_note_list'], '알 수 없는 경로·기능 쿼리·소유자 없는 전체 목록 거부'],
  ];
  const results = groups.map(([attackId, names, expected]) => {
    const executed = zones.filter(result => names.includes(result.name));
    return { attackId, expected: `로컬 가상 요청: ${expected}`,
      observed: `${executed.length === names.length && executed.every(item => item.passed) ? '로컬 가상 시험 통과' : '불일치'}: ${executed.length}건 실행; 실제 심판 판정 아님` };
  });
  try {
    // Separate process: ephemeral JWKS and in-memory DB never affect live probes.
    const runner = new URL('../scripts/zone-api-check.mjs', import.meta.url).href;
    const code = `const {checkResourceApis}=await import(${JSON.stringify(runner)});const r=await checkResourceApis();process.stdout.write(JSON.stringify({count:r.length,passed:r.every(x=>x.passed)}));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code],
      { windowsHide: true, timeout: 15000, maxBuffer: 4096 });
    const summary = JSON.parse(stdout);
    results.push({ attackId: 'resource_api_local_boundary', expected: '실제 API 핸들러의 본인 정상·교차 소유자·학생 사칭·정상 강사·권한 회수 거부 확인',
      observed: `${summary.passed && summary.count === 9 ? '로컬 API 가상 시험 통과' : '불일치'}: ${summary.count}개 시나리오; 메모리 DB와 일시 서명 신원 사용, 운영 DB·심판 시험 아님` });
  } catch {
    results.push({ attackId: 'resource_api_local_boundary', expected: '실제 API 핸들러의 소유자·강사 권한 검증',
      observed: '불일치: 로컬 API 가상 시험 실패 또는 시간 초과; 원문·토큰은 기록하지 않음' });
  }
  const id = randomUUID();
  for (const [attackId, path, method] of [
    ['anonymous_announcement_read', `/api/announcements/${id}`, 'GET'],
    ['anonymous_announcement_edit', `/api/announcements/${id}`, 'PUT'],
  ]) {
    let observed = offline ? '미실행: 사용자가 수정 ZIP을 업로드·재배포한 뒤 직접 확인 예정' : '미확인: 요청 실패 또는 시간 초과';
    if (!offline) try {
      const response = await fetch(new URL(path, app), { method,
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const data = await response.json().catch(() => null);
      observed = response.status === 401 && data?.error === 'LOGIN_REQUIRED'
        && Object.keys(data).length === 1 ? 'HTTP 401: 자료 없이 무로그인 공지 요청 거부'
        : `불일치: HTTP ${response.status}, 무로그인 공지 거부 미확인`;
    } catch { /* No response bodies or transport details in the submission. */ }
    results.push({ attackId, expected: '실제 배포 API가 무로그인 공지 요청을 HTTP 401로 거부', observed });
  }
  results.push({ attackId: 'resource_api_live_accounts', expected: '배포 후 실제 A/B 본인 정상·교차 구역 거부와 저장된 강사 공지 수정 확인',
    observed: '미실행: 실제 계정 토큰과 DB 변경을 자동 생성하지 않음. 운영 DB 설정·강사 권한·엔진 주체 연결은 별도 확인 필요' });
  results.push({ attackId: 'engine_resource_routing_live', expected: '실제 엔진에서 기존 정상 단건 허용·전체 목록과 공지 모든 쓰기 거부',
    observed: '미실행: 수정본의 운영 엔진 재판정은 사용자 업로드 뒤 확인. API의 저장된 강사 정상 수정과 엔진의 공지 쓰기 거부를 구분' });
  return [...prior, ...results];
}

// Stages 6/7 exercise the engine contract locally, without creating signing keys.
// Transport authentication and device/subject binding remain the engine's job.
async function runDeviceChecks(config, app, expectedCommit, { offline = false } = {}) {
  const localResults = await checkDecider({ decide, ruleIds: RULE_IDS, includeStepUp: config.step >= 7 });
  const { deviceRegistered: omitted, ...missingRequest } = fixtureRequests().normal;
  const missing = await decide(missingRequest);
  const missingPassed = missing?.schema === 'aleph.decision.v1'
    && missing.requestId === missingRequest.requestId
    && Object.keys(missing).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema'
    && missing.decision === 'deny' && missing.reasonCode === 'device_not_registered'
    && Array.isArray(missing.ruleIds) && missing.ruleIds.includes('device_registered');
  const request = async path => {
    if (offline) return { status: 0, data: null };
    try {
      const response = await fetch(new URL(path, app), {
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      });
      const data = path === '/' ? await response.text() : await response.json().catch(() => null);
      return { status: response.status, data };
    } catch { return { status: 0, data: null }; }
  };
  const [page, publicData, anonymous, deployment] = await Promise.all(
    ['/', '/data.json', '/api/notes', '/aleph.json'].map(request),
  );
  const failed = offline ? '미실행: 사용자 직접 업로드·재배포 후 확인 예정' : '미확인: 요청 실패 또는 시간 초과';
  const safePage = page.status === 200 && typeof page.data === 'string'
    && !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/u.test(page.data)
    && !page.data.includes(config.sampleMarker);
  const empty = publicData.status === 200 && Array.isArray(publicData.data?.notes)
    && publicData.data.notes.length === 0 && !Object.hasOwn(publicData.data, 'sampleMarker')
    && !JSON.stringify(publicData.data).includes(config.sampleMarker);
  const rejected = anonymous.status === 401 && anonymous.data?.error === 'LOGIN_REQUIRED'
    && Object.keys(anonymous.data).length === 1;
  const matchingDeployment = deployment.status === 200
    && deployment.data?.schema === 'aleph.defense.deployment.v1' && deployment.data.step === config.step
    && deployment.data.repoUrl === config.repoUrl && deployment.data.commit === expectedCommit
    && deployment.data.originalApiUrl === config.originalApiUrl
    && JSON.stringify(deployment.data.allowedRoutes) === JSON.stringify(config.allowedRoutes)
    && (config.step < 10 || deployment.data.restoreRoute === config.restoreRoute);
  const step7Checks = [];
  if (config.step === 7) {
    const { normal } = fixtureRequests();
    const fixtures = [
      ['region_only_fixture', { ...normal, signals: { ...normal.signals, region: 'foreign' } }, 'allow'],
      ['missing_connection_signals_fixture', { ...normal, signals: undefined }, 'step_up'],
      ['untrusted_connection_signals_fixture', { ...normal,
        signals: { ...normal.signals, source: 'browser' } }, 'step_up'],
      ['forged_client_headers_fixture', { ...normal, signals: undefined,
        headers: { 'x-aleph-signals': JSON.stringify(normal.signals), 'x-step-up-verified': 'true' } }, 'step_up'],
    ];
    for (const [attackId, input, expected] of fixtures) {
      const output = await decide(input);
      step7Checks.push({ attackId, expected: `로컬 가상 요청: ${expected}; 브라우저 헤더를 신뢰하지 않고 지역만으로 차단하지 않음`,
        observed: `${output?.decision === expected ? '로컬 가상 시험 통과' : '불일치'}: ${output?.decision}·${output?.reasonCode}; 실제 심판 판정 아님` });
    }
    step7Checks.push(
      { attackId: 'step_up_before_relogin_data', expected: '계약이 준비된 실제 엔진에서 추가 확인 전 자료를 반환하지 않아야 함',
        observed: '미실행: 같은 주체의 새 로그인 시각을 확인하는 엔진 계약·운영 연결이 제공되지 않음. 가상 step_up 판정만 시험' },
      { attackId: 'step_up_after_relogin_request', expected: '엔진이 요청 이후 새 로그인을 검증한 뒤 새 자료 요청을 다시 판정',
        observed: '미실행: 새 로그인 시각·추가 확인 요청의 결합 계약이 없음. 가상 재확인 판정을 실제 재로그인 검증으로 대신하지 않음' },
    );
  }
  const fixtureIds = ['registered_device_fixture', 'unregistered_device_fixture',
    'compound_connection_fixture', 'verified_reconfirmation_fixture'];
  const fixtureExpected = ['로컬 가상 요청: 등록 기기는 allow·approved',
    '로컬 가상 요청: 미등록 기기는 deny·device_not_registered',
    '로컬 가상 요청: 복합 이상 접속은 step_up·step_up_required',
    '로컬 가상 요청: 엔진의 유효한 재확인 상태가 있는 복합 사건은 allow·approved; 실제 재로그인 시험 아님'];
  return [
    ...localResults.map((result, index) => ({
      attackId: fixtureIds[index],
      expected: fixtureExpected[index],
      observed: `${result.passed ? '로컬 가상 시험 통과' : '불일치'}: ${result.decision}·${result.reasonCode}; 실제 심판 판정 아님`,
    })),
    { attackId: 'missing_device_registration_fixture',
      expected: '로컬 가상 요청: deviceRegistered가 없으면 deny·device_not_registered',
      observed: `${missingPassed ? '로컬 가상 시험 통과' : '불일치'}: ${missing?.decision}·${missing?.reasonCode}; 실제 심판 판정 아님` },
    { attackId: 'mtls_without_client_certificate', expected: '실제 릴레이가 클라이언트 인증서 없는 mTLS 요청을 거부',
      observed: '미실행: 실제 릴레이 공격은 심판이 수행하며 로컬 판정기 시험으로 대신하지 않음' },
    { attackId: 'device_subject_mismatch', expected: '실제 엔진이 등록 기기와 다른 사용자 토큰의 조합을 거부',
      observed: '미실행: 기기·사용자 결합 검증은 운영 엔진과 심판이 수행하며 사용자 토큰을 생성하지 않음' },
    { attackId: 'public_static_note_read', expected: '공개 JSON에 메모와 1단계 확인 표시가 없어야 함',
      observed: publicData.status === 0 ? failed : empty ? 'HTTP 200: 공개 메모 0건과 확인 표시 제거 확인'
        : `불일치: HTTP ${publicData.status}, 공개 자료 제거 미확인` },
    { attackId: 'anonymous_api_note_read', expected: '유효한 로그인 없이 메모를 반환하지 않고 HTTP 401로 거부',
      observed: anonymous.status === 0 ? failed : rejected ? 'HTTP 401: 자료 없이 무로그인 조회 거부'
        : `불일치: HTTP ${anonymous.status}, 인증 거부 계약 미확인` },
    { attackId: 'public_browser_secret_scan', expected: '기존 화면이 열리고 공개 HTML에 키·JWT·시드 표식이 없어야 함',
      observed: page.status === 0 ? failed : safePage ? 'HTTP 200: 기존 화면 응답과 비밀값 패턴 미검출 확인'
        : `불일치: HTTP ${page.status}, 공개 HTML 점검 실패` },
    { attackId: `deployment_stage${config.step}_identity`, expected: '배포 식별 JSON의 단계·저장소·커밋·원본 API·허용 경로가 저장점과 일치',
      observed: deployment.status === 0 ? failed : matchingDeployment
        ? `HTTP 200: ${config.step}단계 저장점과 배포 식별 정보 일치`
        : `불일치: HTTP ${deployment.status}, ${config.step}단계 저장점 배포 일치 미확인` },
    ...step7Checks,
  ];
}

export async function runAttackChecks(config, { expectedCommit, publicDataApiKey = process.env.SUPABASE_PUBLISHABLE_KEY, offline = false } = {}) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  if (config.step === 11) return runAppChecks(config, app, expectedCommit, { offline });
  if (config.step === 10) return runRecoveryChecks(config, app, expectedCommit, { offline });
  if (config.step === 9) return runDetectionChecks(config, app, expectedCommit, { offline });
  if (config.step === 8) return runZoneChecks(config, app, expectedCommit, { offline });
  if (config.step >= 6) return runDeviceChecks(config, app, expectedCommit, { offline });
  if (config.step >= 3) {
    const probeId = randomUUID();
    const notePath = `/api/notes/${probeId}`;
    const request = async (path, method = 'GET', authorization) => {
      try {
        const headers = {};
        if (authorization) headers.Authorization = authorization;
        const writes = ['POST', 'PUT'].includes(method);
        if (writes) headers['Content-Type'] = 'application/json';
        const response = await fetch(new URL(path, app), {
          method, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
          body: writes ? JSON.stringify({ ...(method === 'POST' ? { id: probeId } : {}), title: 'Self-check fixture', body: 'Synthetic self-check' }) : undefined,
        });
        let data = null;
        try { data = await response.json(); } catch { /* Do not record raw responses. */ }
        return { status: response.status, data };
      } catch {
        return { status: 0, data: null };
      }
    };
    // A new, untrusted signing key is generated in memory solely to test rejection.
    // This is not a real user, judge credential, or issuer-issued expired token.
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'self-check-untrusted-key' })
      .setIssuer(config.identityProvider.issuer).setAudience(config.identityProvider.audience)
      .setSubject(randomUUID()).setIssuedAt().setExpirationTime('5 minutes').sign(privateKey);
    const probes = [
      ['anonymous_api_note_read', '/api/notes', 'GET'],
      ['anonymous_api_note_add', '/api/notes', 'POST'],
      ['anonymous_api_single_note_read', notePath, 'GET'],
      ['anonymous_api_note_edit', notePath, 'PUT'],
      ['anonymous_api_note_delete', notePath, 'DELETE'],
      ['forged_signature_api_note_read', '/api/notes', 'GET', `Bearer ${forged}`],
    ];
    const results = await Promise.all([
      request('/data.json'), ...probes.map(([, path, method, authorization]) => request(path, method, authorization)),
      ...(config.step >= 4 ? [request('/aleph.json')] : []),
    ]);
    const staticResult = results[0];
    const empty = staticResult.status === 200 && Array.isArray(staticResult.data?.notes)
      && staticResult.data.notes.length === 0 && !Object.hasOwn(staticResult.data, 'sampleMarker')
      && !JSON.stringify(staticResult.data).includes(config.sampleMarker);
    const failed = '미확인: 요청 실패 또는 시간 초과';
    const stage5Checks = [];
    if (config.step === 5) {
      const original = new URL(config.originalApiUrl);
      if (original.protocol !== 'https:' || original.username || original.password
          || original.search || original.hash
          || original.origin !== new URL(config.identityProvider.issuer).origin
          || original.pathname !== '/rest/v1/training_notes') {
        throw new Error('원본 자료 API 주소는 학습 테이블의 쿼리 없는 HTTPS 경로여야 합니다.');
      }
      // Optional public key exists only in server-side environment or test memory.
      // Never recover removed keys from source/history or read a server secret.
      const publicKey = typeof publicDataApiKey === 'string'
        && /^sb_publishable_[A-Za-z0-9_-]+$/u.test(publicDataApiKey) ? publicDataApiKey : null;
      let direct = '미실행: 화면에서 공개 키를 제거했고 서버 점검용 공개 키는 설정하지 않음';
      if (publicKey) {
        try {
          const response = await fetch(original, {
            headers: { apikey: publicKey, Accept: 'application/json' },
            redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
          });
          const data = await response.json().catch(() => null);
          direct = [401, 403].includes(response.status) && data?.code === '42501'
            ? `HTTP ${response.status}: publishable 키 직접 조회를 권한 오류로 거부, 메모 반환 없음`
            : `불일치: HTTP ${response.status}, 원본 권한 거부 미확인`;
        } catch { direct = failed; }
      }
      stage5Checks.push({ attackId: 'publishable_direct_data_api',
        expected: '브라우저 publishable 키만으로 원본 메모를 조회하면 권한 오류로 거부 (심판 anon 키 시험과 별도)',
        observed: direct });
      try {
        const response = await fetch(new URL('/', app), {
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        const page = await response.text();
        const forbidden = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/u;
        stage5Checks.push({ attackId: 'public_browser_secret_scan',
          expected: '배포된 HTML과 인라인 코드에 공개 키·서버 키·개인키·JWT·시드 표식이 없어야 함',
          observed: response.status === 200 && !forbidden.test(page) && !page.includes(config.sampleMarker)
            ? 'HTTP 200: 배포 HTML·인라인 코드에서 공개 키·서버 키·개인키·JWT·시드 표식 패턴 미검출'
            : `불일치: HTTP ${response.status}, 공개 HTML 점검 실패` });
        stage5Checks.push({ attackId: 'first_page_security_header',
          expected: '첫 화면 응답에 X-Content-Type-Options: nosniff 또는 Content-Security-Policy가 있어야 함',
          observed: response.status === 200 && (response.headers.get('x-content-type-options') === 'nosniff'
              || Boolean(response.headers.get('content-security-policy')))
            ? 'HTTP 200: 첫 화면 보안 헤더 확인' : `불일치: HTTP ${response.status}, 첫 화면 보안 헤더 미확인` });
      } catch {
        stage5Checks.push({ attackId: 'public_browser_secret_scan',
          expected: '배포된 HTML과 인라인 코드에 공개 키·서버 키·개인키·JWT·시드 표식이 없어야 함', observed: failed });
        stage5Checks.push({ attackId: 'first_page_security_header',
          expected: '첫 화면 응답에 보안 헤더가 있어야 함', observed: failed });
      }
      stage5Checks.push({ attackId: 'deployment_allowed_routes',
        expected: '배포 aleph.json에 현재 허용 메모 경로가 기록돼 있어야 함',
        observed: results[7].status === 0 ? failed
          : results[7].status === 200 && Array.isArray(results[7].data?.allowedRoutes)
            && results[7].data.allowedRoutes.length > 0
            && JSON.stringify(results[7].data.allowedRoutes) === JSON.stringify(config.allowedRoutes)
            ? 'HTTP 200: 허용 경로 설정과 배포 JSON 일치'
            : `불일치: HTTP ${results[7].status}, 배포 허용 경로 미확인` });
    }
    return [
      { attackId: 'public_static_note_read', expected: '공개 JSON에 메모와 1단계 확인 표시가 없어야 함',
        observed: staticResult.status === 0 ? failed : empty
          ? 'HTTP 200: 공개 메모 0건과 1단계 확인 표시 제거 확인'
          : `불일치: HTTP ${staticResult.status}, 공개 자료 제거 미확인` },
      ...probes.map(([attackId, , method], index) => {
        const result = results[index + 1];
        const rejected = result.status === 401 && result.data?.error === 'LOGIN_REQUIRED'
          && Object.keys(result.data).length === 1;
        return { attackId, expected: `${method}: 유효한 로그인 없이 자료를 반환하거나 변경하지 않고 HTTP 401로 거부`,
          observed: result.status === 0 ? failed : rejected ? `HTTP 401: ${method} 요청을 자료 없이 거부`
            : `불일치: HTTP ${result.status}, 인증 거부 계약 미확인` };
      }),
      { attackId: 'valid_account_crud', expected: config.step >= 4
        ? 'A/B가 각자 본인 메모만 읽기·추가·수정·삭제할 수 있어야 함'
        : '정상 A 계정의 메모 추가·수정·삭제가 유지되어야 함',
        observed: '도구 시험 미실행: 실제 계정 토큰을 사용하지 않음. 사용자 화면 확인은 설명에 별도 기록' },
      { attackId: 'expired_issuer_token', expected: '실제 발급자가 서명한 만료 토큰을 HTTP 401로 거부',
        observed: '미실행: 실제 발급자의 만료 토큰을 사용하지 않음. 로컬 가상 시험은 운영 판정이 아님' },
      { attackId: 'wrong_audience_issuer_token', expected: '실제 발급자가 다른 서비스용으로 서명한 토큰을 HTTP 401로 거부',
        observed: '미실행: 실제 발급자의 다른 대상 토큰을 사용하지 않음. 로컬 가상 시험은 운영 판정이 아님' },
      ...(config.step >= 4 ? [
        { attackId: `deployment_stage${config.step}_identity`, expected: `배포 식별 JSON의 단계·저장소·커밋이 ${config.step}단계 저장점과 일치해야 함`,
          observed: results[7].status === 0 ? failed
            : results[7].status === 200 && results[7].data?.schema === 'aleph.defense.deployment.v1'
              && results[7].data.step === config.step && typeof results[7].data.repoUrl === 'string'
              && results[7].data.repoUrl.toLowerCase() === config.repoUrl.toLowerCase()
              && typeof expectedCommit === 'string' && /^[a-f0-9]{40}$/u.test(expectedCommit)
              && results[7].data.commit === expectedCommit
              ? `HTTP 200: ${config.step}단계 저장점 커밋과 배포 식별 정보 일치`
              : `불일치: HTTP ${results[7].status}, ${config.step}단계 저장점 배포 일치 미확인` },
        { attackId: 'foreign_owner_note_read', expected: '학생 시험 신원이 심판 소유 메모와 상대 계정 메모를 읽으면 HTTP 404로 거부',
          observed: '미실행: 실제 학생·심판 신원을 사용한 교차 소유자 조회를 보내지 않음' },
        { attackId: 'foreign_owner_note_edit', expected: '학생 시험 신원이 심판 소유 메모와 상대 계정 메모를 수정하면 HTTP 404로 거부',
          observed: '미실행: 실제 학생·심판 신원을 사용한 교차 소유자 수정을 보내지 않음' },
        { attackId: 'foreign_owner_note_delete', expected: 'B가 A 메모를 삭제하면 HTTP 404로 거부하고 A 메모를 보존',
          observed: '미실행: 실제 A/B 계정으로 상대 메모 삭제 요청을 보내지 않음' },
        { attackId: 'note_owner_change', expected: 'PUT 본문에 owner_id를 넣으면 HTTP 400으로 거부하고 기존 소유자를 유지',
          observed: '미실행: 실제 로그인 신원으로 소유자 변경 요청을 보내지 않음' },
        { attackId: 'anonymous_direct_data_api', expected: 'anon 키만 사용하는 직접 Data API는 메모 접근을 거부',
          observed: '미실행: 실제 anon 키로 직접 Data API 요청을 보내지 않음. authenticated 역할 직접 접근은 점수에서 제외' },
      ] : []),
      ...stage5Checks,
    ];
  }
  if (config.step === 2) {
    const request = async (path, method = 'GET') => {
      try {
        const response = await fetch(new URL(path, app), {
          method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        let data = null;
        try { data = await response.json(); } catch { /* An invalid body is not success. */ }
        return { status: response.status, data };
      } catch {
        return { status: 0, data: null };
      }
    };
    const [staticResult, apiResult, postResult] = await Promise.all([
      request('/data.json'), request('/api/notes'), request('/api/notes', 'POST'),
    ]);
    const empty = staticResult.status === 200
      && Array.isArray(staticResult.data?.notes) && staticResult.data.notes.length === 0
      && !Object.hasOwn(staticResult.data, 'sampleMarker')
      && !JSON.stringify(staticResult.data).includes(config.sampleMarker);
    const notes = apiResult.data?.notes;
    const count = Array.isArray(notes) ? notes.length : null;
    const validApi = apiResult.status === 200 && count === 4
      && notes.every(note => typeof note?.id === 'string'
        && typeof note.title === 'string' && typeof note.content === 'string');
    const failedRequest = '미확인: 요청 실패 또는 시간 초과';
    return [
      { attackId: 'public_static_note_read', expected: '공개 data.json에 메모와 1단계 확인 표시가 없어야 함',
        observed: staticResult.status === 0 ? failedRequest : empty
          ? 'HTTP 200: 공개 JSON의 메모 0건과 1단계 확인 표시 제거 확인'
          : `불일치: HTTP ${staticResult.status}, 메모·1단계 확인 표시 제거를 확인하지 못함` },
      { attackId: 'anonymous_api_note_read', expected: '2단계의 남은 약점: 비로그인 API에서 가상 메모 4건을 읽을 수 있음',
        observed: apiResult.status === 0 ? failedRequest : validApi
          ? 'HTTP 200: 비로그인 API가 메모 4건 반환, 방문자 인증 미구현'
          : `불일치: HTTP ${apiResult.status}, 메모 ${count ?? '미확인'}건` },
      { attackId: 'unsupported_api_method', expected: '자료 API의 POST 요청은 HTTP 405로 거부',
        observed: postResult.status === 0 ? failedRequest : postResult.status === 405
          ? 'HTTP 405: POST 요청 거부 확인'
          : `불일치: POST 응답 HTTP ${postResult.status}` },
    ];
  }
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}
