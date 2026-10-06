// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
import { randomUUID } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';

export async function runAttackChecks(config) {
  if (![1, 2, 3].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
  if (config.step === 3) {
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
          body: writes ? JSON.stringify({ id: probeId, title: 'Self-check fixture', body: 'Synthetic self-check' }) : undefined,
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
    ]);
    const staticResult = results[0];
    const empty = staticResult.status === 200 && Array.isArray(staticResult.data?.notes)
      && staticResult.data.notes.length === 0 && !Object.hasOwn(staticResult.data, 'sampleMarker')
      && !JSON.stringify(staticResult.data).includes(config.sampleMarker);
    const failed = '미확인: 요청 실패 또는 시간 초과';
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
      { attackId: 'valid_account_crud', expected: '정상 A 계정의 메모 추가·수정·삭제가 유지되어야 함',
        observed: '도구 시험 미실행: 실제 계정 토큰을 사용하지 않음. 사용자 화면 확인은 설명에 별도 기록' },
      { attackId: 'expired_issuer_token', expected: '실제 발급자가 서명한 만료 토큰을 HTTP 401로 거부',
        observed: '미실행: 실제 발급자의 만료 토큰을 사용하지 않음. 로컬 가상 시험은 운영 판정이 아님' },
      { attackId: 'wrong_audience_issuer_token', expected: '실제 발급자가 다른 서비스용으로 서명한 토큰을 HTTP 401로 거부',
        observed: '미실행: 실제 발급자의 다른 대상 토큰을 사용하지 않음. 로컬 가상 시험은 운영 판정이 아님' },
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
