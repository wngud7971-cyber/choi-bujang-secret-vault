// Read-only observations; no test runner, DB, crypto, timer or subprocess.
const UUID = '00000000-0000-4000-8000-000000000001';
const denied = r => {
  const data = parse(r.text);
  return [401, 403].includes(r.status) && typeof data?.error === 'string'
    && !Object.hasOwn(data, 'notes') && !Object.hasOwn(data, 'content') && !Object.hasOwn(data, 'body');
};
const closedDevice = r => {
  const data = parse(r.text);
  return r.status === 200 && data?.approved === false && data.state === 'signed_out'
    && Object.keys(data).sort().join(',') === 'approved,state';
};
const bytes = text => {
  let size = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    size += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return size;
};
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
export async function runReadChecks(config, { expectedCommit, offline = false, fetcher = globalThis.fetch, onObservation } = {}) {
  const base = new URL(config.publicAppUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.port || base.search || base.hash
      || base.pathname !== '/' || !base.hostname.endsWith('.vercel.app')) throw new TypeError('invalid_deployment_url');
  const probes = [
    ['deployment_stage11_identity', '/aleph.json', 'GET', '배포 단계·저장소·현재 커밋 일치', {}, r => {
      const d = parse(r.text);
      return r.status === 200 && d?.step === config.step && d.repoUrl === config.repoUrl
        && d.publicAppUrl === config.publicAppUrl && d.commit === expectedCommit;
    }],
    ['public_static_note_read', '/data.json', 'GET', '공개 JSON의 메모와 1단계 표시 없음', {}, r => {
      const d = parse(r.text);
      return r.status === 200 && Array.isArray(d?.notes) && d.notes.length === 0 && !Object.hasOwn(d, 'sampleMarker');
    }],
    ['anonymous_api_note_read', '/api/notes', 'GET', '로그인 없는 메모 요청 거부', {}, denied],
    ['forged_login_token', '/api/notes', 'GET', '위조 로그인 요청 거부', { authorization: 'Bearer invalid' }, denied],
    ['query_identity_override', `/api/notes?userId=${UUID}&role=instructor`, 'GET', '쿼리 신원·권한으로 접근 불가', {}, denied],
    ['header_identity_override', '/api/notes', 'GET', '헤더 신원·권한으로 접근 불가', { 'x-user-id': UUID, 'x-role': 'instructor' }, denied],
    ['anonymous_announcement_read', '/api/announcements', 'GET', '로그인 없는 공지 접근 거부', {}, denied],
    ['restore_get_read', '/api/restore', 'GET', '읽기 요청으로 복구 실행 불가', {}, r => [401, 403, 405].includes(r.status)],
    ['app_public_shell', '/', 'GET', '기존 자료실 설치·승인 안내', {}, r => r.status === 200
      && /manifest/u.test(r.text) && /기기 승인/u.test(r.text) && /승인 결과 확인/u.test(r.text)],
    ['app_manifest', '/manifest.webmanifest', 'GET', '같은 자료실을 여는 설치 설정', {}, r => {
      const d = parse(r.text);
      return r.status === 200 && d?.start_url === '/' && d.scope === '/' && d.display === 'standalone';
    }],
    ['app_device_transport', '/device-client.js', 'HEAD', '기기 연결 파일 배포', {}, r => r.status === 200],
    ['app_access_state', '/access-state.js', 'HEAD', '새 승인 상태 파일 배포', {}, r => r.status === 200],
    ['app_offline_worker', '/sw.js', 'HEAD', '오프라인 처리 파일 배포', {}, r => r.status === 200],
    ['app_offline_guide', '/offline.html', 'HEAD', '공개 오프라인 안내 배포', {}, r => r.status === 200],
    ['device_anonymous_status', '/api/device', 'GET', '공개 상태는 승인 전이며 자료·기기 정보 없음', {}, closedDevice],
    ['device_client_approval_override', '/api/device?approved=true', 'GET', '브라우저 승인 값 거부', {}, r => [400, 401, 403].includes(r.status)],
    ['device_legacy_status', '/api/device/status', 'GET', '이전 기기 주소도 공개 승인 전 상태', {}, closedDevice],
  ];
  const output = [];
  for (const [attackId, path, method, expected, headers, ready] of probes) {
    const observation = { id: attackId, method, path, expected, status: 'not_run',
      httpStatus: null, responseBytes: null, requestId: null, checkedAt: null, matchesExpected: null };
    if (offline) {
      output.push({ attackId, expected, observed: 'not_run: offline; 공개 요청을 보내지 않음' });
      onObservation?.(observation);
      continue;
    }
    let result;
    try {
      const response = await fetcher(new URL(path, base), { method,
        headers: { accept: 'application/json', ...headers }, redirect: 'error', cache: 'no-store',
        alephEvidence: { caseId: attackId, requestKey: 'read' } });
      const text = method === 'HEAD' ? '' : await response.text();
      if (text.length > 262144) throw new Error('response_too_large');
      const matchesExpected = ready({ status: response.status, text });
      output.push({ attackId, expected, observed: `HTTP ${response.status}; bodyBytes=${bytes(text)}; jsonReady=${matchesExpected}; method=${method}` });
      const rawId = response.headers?.get('x-vercel-id');
      result = { ...observation, status: 'observed', httpStatus: response.status, responseBytes: bytes(text),
        requestId: typeof rawId === 'string' && /^[A-Za-z0-9:._=-]{1,160}$/u.test(rawId) ? rawId : null,
        checkedAt: onObservation ? new Date().toISOString() : null, matchesExpected };
    } catch { output.push({ attackId, expected, observed: `not_run: public_request_unavailable; method=${method}` }); }
    onObservation?.(result ?? observation);
  }
  output.push(
    { attackId: 'device_approved_runtime', expected: '현재 승인 기기의 정상 자료 요청', observed: 'not_run: 실제 승인 기기·로그인·운영 엔진 연결 시험 필요' },
    { attackId: 'device_signed_path_body_runtime', expected: '무서명·서명 후 경로/본문 변경 거부', observed: 'not_run: 동일 서명 계약의 운영 요청 시험 필요' },
    { attackId: 'recovery_authorized_runtime', expected: '시험 B의 지정한 메모 한 건 복구', observed: 'not_run: 운영 쓰기 요청은 제출 점검에서 실행하지 않음' },
  );
  return output;
}
