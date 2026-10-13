# 9단계 탐지 입력과 별도 결과 · 로컬 연습 규격

## 제공된 규격과 이번 확장의 구분

공식 시작 틀은 `{ at, method, identity: { sub } }` 세 값만 전달하며, 같은 가명 사용자의 10분 내 GET 120건 초과에 `{ action: 'propose_revocation', reasonCode: 'burst_read', subject }`를 요구합니다. 2026-10-13에 [공식 원본 계약](https://github.com/ChoiTimo/aleph-defense-starter/blob/main/docs/DETECT_EVENTS.md)과 [공식 연습 6개](https://github.com/ChoiTimo/aleph-defense-starter/blob/main/scripts/detect-test.mjs)를 다시 확인했습니다. 이 형식에는 기기·네트워크가 없으므로 새로운 필드를 요구하거나 가짜 기기 ID를 만들어 반환하지 않습니다.

첫 구현은 이 공식 사건을 모두 `observe`로 바꾸어 원본 121건·200건 연습과 충돌했습니다. 공개 커밋 `c6482086d73c`의 첫 심판은 45/100과 `S09_NO_PROPOSAL`을 반환했고 다른 세 조건은 통과했습니다. 공개 탐지 코드가 로컬 첫 구현과 같음을 확인했습니다. 이번 수정은 이 사건 형식을 별도 호환 모드로 복원합니다. 실제 심판의 사건 원문이 공개되지는 않았으므로 원본 연습 통과를 실제 재판정 통과라고 표시하지 않습니다.

기기 정보가 있는 아래 확장은 기존 `docs/DECIDER_REQUEST.md`의 가명 사용자·기기·등록 상태·가상 네트워크 항목을 재사용하는 **학생의 로컬 사건 규격**입니다. 이 확장의 실제 운영 입력/응답 계약은 미확인입니다. 실제 `decide(request)`의 요청 18항목·응답 5항목을 추가하거나 수정하지 않습니다.

## 사건

공식 연습 형식:

```js
{ at: '2026-10-01T00:00:00.000Z', method: 'GET', identity: { sub: 'learner_fixture' } }
```

기기 정보를 가진 확장 형식:

```js
{
  at: '2026-10-01T00:00:00.000Z',
  requestId: '00000000-0000-4000-8000-000000000001',
  classId: 'class_fixture', projectId: 'project_fixture',
  subjectId: 'learner_fixture', deviceId: 'aaaaaaaaaaaaaaaa',
  deviceRegistered: true, method: 'GET', decision: 'allow',
  signals: { source: 'judge_fixture', network: 'unusual' }
}
```

- `subjectId`는 1~160자리 영문·숫자·밑줄·하이픈의 가명입니다. 이전 `identity.sub`와 동시에 있으면 서로 같아야 합니다. 실제 DB 사용자 번호와 임의로 연결하지 않습니다.
- `deviceId`는 확인된 16자리 소문자 16진수입니다. `deviceRegistered`가 정확히 true일 때만 대상이 될 수 있습니다. 기기 개인키는 읽지 않습니다.
- `signals.source: judge_fixture`와 `network: unusual`을 가진 조회만 복합 규칙에 셉니다. `usual`, `none/unknown`, 누락, 브라우저 출처는 회수 근거가 아닙니다. 지역·IP·시각대는 읽지 않습니다.
- `decision`은 `allow`, `deny`, `step_up` 중 하나이며 없으면 null로 정리합니다. 거부된 조회 시도도 횟수에 포함하지만 기존 접속 판정을 바꾸지 않습니다.
- `at`는 유효한 UTC ISO 시각입니다. 사건 시각만 사용하며 현재 실행 시각으로 오래된 사건을 최신으로 바꾸지 않습니다.
- 선택적인 `requestId`가 있으면 UUID여야 합니다. 같은 ID는 한 번만 세며 안전한 항목이 다른 충돌 복사본은 해당 ID 전체를 제외합니다. ID가 없으면 각 배열 원소를 엔진이 전달한 별도 사건으로 봅니다.
- `classId`·`projectId`는 둘 다 없거나 둘 다 유효한 가명이어야 합니다. 서로 다른 반·프로젝트·사용자·기기의 횟수는 합치지 않습니다.

`normalizeDetectionEvent`는 허용 항목의 자체 데이터 속성만 새 객체로 옮깁니다. 정리된 객체의 `contract`는 원본 형식이면 `legacy`, 확장 항목이 하나라도 있으면 `device`입니다. 확장 항목이 undefined·null·접근자이거나 잘못된 값이어도 공식 연습 모드로 내려가지 않습니다. 토큰·본문·실명·헤더·원문 경로·주소·역할·지역·추가 요약은 읽거나 복사하거나 로그에 출력하지 않습니다. 상속 값과 접근자 속성은 증거로 읽지 않습니다. 잘못된 개별 사건은 제외하며 배열이 아닌 입력은 원문 없는 `invalid_detection_events` 오류입니다.

이 함수는 브라우저 요청을 인증하지 않습니다. 호출자는 운영 엔진이나 심판이 확인한 사건만 전달해야 합니다. `source` 문자열 자체는 인증 수단이 아니며 탐지용 공개 API를 만들지 않습니다.

## 탐지 기준과 결과

`detect(events)`는 사건을 시간순으로 정리합니다. 공식 연습 형식에서는 **같은 가명 사용자의 GET이 어느 10분 구간에서든 120건을 초과**하면 원본 계약대로 별도 제안을 반환합니다. 기기 정보를 가진 확장 형식에서는 이전과 같이 **같은 반·프로젝트·사용자·등록 기기의 낯선 네트워크 GET 120건 초과**가 모두 맞아야 제안합니다. 두 형식의 횟수는 서로 합산하지 않습니다. 10분의 양 끝을 포함하며 정확히 120건은 제안하지 않습니다.

```js
// 공식 연습의 기존 응답 — 기기 정보가 없으므로 임의 deviceId를 추가하지 않음
{ action: 'propose_revocation', reasonCode: 'burst_read', subject: 'learner_fixture' }
// 기기가 확인된 확장 사건의 응답 — 기기 한 개만 지정
{ action: 'propose_revocation', reasonCode: 'burst_read',
  subject: 'learner_fixture', deviceId: 'aaaaaaaaaaaaaaaa' }
// 그 밖에는
{ action: 'observe' }
```

가장 먼저 임계치를 넘는 대상 하나만 반환합니다. 확장 사건은 확인된 기기 한 개를 지정하고 다른 정상 기기에는 제안하지 않습니다. 공식 연습의 subject 제안에는 기기 대상 정보가 없으며 이 모양을 실제 사용자 전체 회수로 집행하는 API를 만들지 않습니다. 공식 subject 제안과 실제 기기 한 개의 연결·집행 범위는 심판 확인 대상입니다. 같은 시각은 가명 사용자·기기 순서로 결정합니다. 자원 경로로 나누지 않으므로 다른 자원으로 이동해도 해당 기기의 조회만 합산합니다. 이 결과에는 접속 허용·거부 응답의 필드를 추가하지 않습니다.

규칙 이름은 `detection.compound_burst_read`입니다. 반환 이유 `burst_read`는 기존 탐지 연습의 이름이며 실제 엔진 등록·집행 가능 여부는 심판 확인 대상입니다. 회수 API, 세션 무효화, 기기 등록부 변경, 회수 상태 저장은 구현하지 않습니다. 호출 사이에 사건이나 권한을 저장하지 않으므로 엔진이 필요한 10분 사건 배열을 전달해야 합니다.

## 확인

`npm run detect:test`는 공식 원본의 6개 사건과 기존 기기별 정상·복합·120/121·10분 경계·중복·순서 역전·자원 이동 등 27개 가상 사건 묶음을 확인합니다. `npm run test:9`는 비밀 항목 미열람·잘못된 입력·충돌 ID·기존 판정 보존·격리 실행·형식 간 합산 방지·잘못된 확장 입력의 우회 방지·제출 점검도 확인합니다. npm이 없는 현재 작업 환경에서는 동일 파일을 `node scripts/detect-test.mjs`와 `node --experimental-vm-modules --test test/step9.test.mjs`로 실행합니다.

실제 사건 전달, 회수된 신원의 다음 요청, 남은 탈취 세션 재접속, 다른 자원 이동 거부, 정상 기기 유지 및 첫 의심 사건부터 회수까지 경과 시간은 **심판이 확인**합니다. 로컬 시험 통과를 실제 회수·차단·시간 측정·심판 판정으로 기록하지 않습니다.
