// Shared by the server and screen. Counts always derive from measured rows.
export function summarize(rows) {
  const measured = rows.filter(row => row.status === 'observed');
  return { total: rows.length, observed: measured.length,
    matched: measured.filter(row => row.matchesExpected === true).length,
    mismatched: measured.filter(row => row.matchesExpected === false).length,
    notRun: rows.length - measured.length };
}

const pairs = [
  ['공개 자료실 화면 열기', '공개 JSON에서 메모와 이전 표시가 없어야 함'],
  ['승인 기기의 본인 메모 조회 200', '무인증 메모 조회 401/403'],
  ['승인 기기의 본인 메모 생성 201', '위조 로그인 토큰 거부 401/403'],
  ['A의 본인 메모 조회·수정·삭제 허용', 'B의 A 메모 조회·수정·삭제 거부'],
  ['서버를 통한 본인 메모 조회 허용', '원본 DB 직접 조회 거부'],
  ['등록 기기 요청 허용', '미등록 기기 요청 거부'],
  ['정상 조건 및 검증된 추가 확인 요청 허용', '복합 위험 요청은 추가 확인 요구'],
  ['본인 구역 읽기·쓰기 허용', '다른 구역 및 공지 쓰기 거부'],
  ['정상 사건은 observe·정상 요청 허용', '탐지 후 회수된 신원의 재접속 거부'],
  ['B 한 건 복구 후 본인 조회 허용', '복구 뒤 타인 구역 조회 거부'],
  ['현재 승인 기기의 서명 요청 허용', '승인 쿼리로 승인 상태 변경 불가 400/401/403'],
];
const sources = { '1-normal': 'app_public_shell', '1-forbidden': 'public_static_note_read',
  '2-forbidden': 'anonymous_api_note_read', '3-forbidden': 'forged_login_token',
  '11-forbidden': 'device_client_approval_override' };
export function stagePlan() {
  return pairs.flatMap(([normal, forbidden], index) => [normal, forbidden].map((expected, position) => {
    const kind = position === 0 ? 'normal' : 'forbidden';
    const id = `${index + 1}-${kind}`;
    return { id, step: index + 1, kind, expected, probeId: sources[id] ?? null,
      status: 'not_run', httpStatus: null, requestId: null, checkedAt: null, matchesExpected: null };
  }));
}
export function officialPlan() {
  // The official case names/contracts were not supplied. Do not equate our
  // representative probes or local regressions with the judge's 41 cases.
  return Array.from({ length: 41 }, (_, index) => ({ id: `official-slot-${String(index + 1).padStart(2, '0')}`,
    expected: '공식 시험 이름·계약 확인 후 실행', status: 'not_run',
    requestId: null, checkedAt: null, matchesExpected: null }));
}
