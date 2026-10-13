# 학생 판정기 요청·응답 계약 v1

`src/decider.mjs`의 `decide(request)`는 반 엔진이 신원, 기기, 경로를 확인한 뒤 전달한 요청만 받습니다. 브라우저가 보낸 사용자 번호·역할·기기 상태를 따로 믿거나 요청에 덧붙이지 마세요. 이 문서는 현재 `student-kit/sdp-core/decision-contract.mjs`의 `aleph.decision.v1` 계약을 설명합니다.

## 요청

요청은 아래 **18개 이름만** 포함합니다. 이름을 추가하거나 중첩 객체로 바꾸면 엔진이 거부합니다.

| 항목 | 뜻 |
|---|---|
| `schema` | 항상 `aleph.decision.v1` |
| `requestId` | 이번 요청의 UUID. 응답에 그대로 돌려줍니다. |
| `classId`, `projectId` | 운영 엔진이 확인한 반과 학생 프로젝트 |
| `subjectId` | 발급자·대상·반·프로젝트를 묶어 만든 가명 주체 ID. Supabase 사용자 번호와 직접 비교하지 않습니다. |
| `deviceId` | 확인된 기기의 16자리 소문자 16진수 ID. 개인키가 아닙니다. |
| `service`, `method`, `path`, `route` | 확인된 서비스와 요청 경로. `route`는 `GET /notes/:id`처럼 허용된 경로 모양입니다. |
| `queryLength`, `querySha256` | 쿼리 문자열의 길이와 SHA-256 지문. 원문 쿼리는 전달되지 않습니다. |
| `at` | 엔진이 만든 UTC ISO 시각. 판정 시각과 5초 넘게 차이 나면 거부됩니다. |
| `policyRevision` | 이번 요청에 적용된 정책 버전 |
| `deviceRegistered` | 기기 등록 여부. 실제 릴레이는 미등록 기기를 판정기보다 먼저 막습니다. `false`는 심판의 가상 요청에서만 올 수 있습니다. |
| `stepUp` | `{verified, authAgeSeconds}`. `verified`가 false이면 나이는 `null`입니다. true일 때 나이는 0~900초입니다. 이 값만 보고 재인증 확인 요청을 건너뛰지 않습니다. |
| `recentEvents` | 엔진이 제공한 최근 사건 배열. 최대 12건이며 각 항목은 `{kind, ageSeconds, count}`입니다. |
| `signals` | `{source, region, network, hour}`. 현재 실제 경로에서는 `source: "none"`, `region/network: "unknown"`입니다. `judge_fixture` 신호를 실제 위치 증거로 취급하지 않습니다. |

현재 계약에는 `request.identity`, `request.device`, `request.geo`, `request.role`, `request.device.approval`이 **없습니다**. 이 값을 브라우저 요청이나 코드의 임의 상수로 채우면 안 됩니다. 위치 이력·강사 역할·기기 승인 기능은 운영 엔진이 출처를 확인하고 별도 계약으로 제공한 뒤 사용할 수 있습니다.

## 8단계 자원 구역 구현

기존 18항목을 유지합니다. `service: notes`에서 메모와 공지는 서로 다른 경로와 자원 ID로 구분합니다. `deviceRegistered`가 true이고 deviceId 형식이 유효해야 하며 정확한 메서드·경로·route를 모두 대조합니다.

- `/notes` GET/POST: 최종 API가 검증된 계정의 소유자 범위만 사용하는 본인 목록·생성.
- `/notes/owners/:ownerId` GET/POST, `/notes/owners/:ownerId/:id` GET/PUT/DELETE: ownerId와 엔진 subjectId를 정확히 비교. 상세 id는 UUID만 허용.
- `/announcements` GET, `/announcements/:id` GET: 로그인 신원·기기 검사가 앞선 공지 읽기.
- 공지 POST/PUT: 현재 엔진에는 검증된 강사 권한이 없어 기본 거부. 브라우저 role·가상 출처·subjectId 이름으로 권한을 만들지 않음.
- 같은 경로의 `/api` 접두사도 지원하지만 실제로 일치하는 route만 허용. 알 수 없는 경로·메서드·서비스·인코딩·이동·중복 구분자는 거부.

쿼리는 원문이 제공되지 않으므로 엔진에서 0길이와 빈 문자열 SHA-256만 허용합니다. 최종 API에서만 단일 UUID id 선택 쿼리를 지원하며 기능이나 소유자 쿼리는 거부합니다. 이는 엔진의 쿼리 선택 지원을 의미하지 않습니다.

최종 API의 ownerId는 DB 사용자 UUID이며 엔진 가명 subjectId와 다릅니다. 둘의 운영 연결은 제공된 계약에서 확인되지 않았습니다. 최종 API는 기존 주소에서 DB의 저장된 소유자 조건을 독립적으로 검사합니다. 운영 엔진의 namespace와 기존 API의 UUID를 연결한 척하지 않습니다. 강사 권한은 기존 DB의 서버 전용 발급자·계정별 grant로 검사하며 API의 강사 허용을 엔진 허용으로 보고하지 않습니다.

구역 거부는 기존 사용 코드 `starter_not_ready`와 `resource.exact_route`, `resource.note_owner`, `resource.announcement_editor` 규칙 이름으로 구별합니다. 기존 미등록 기기·XDR·7단계 추가 확인 규칙을 유지합니다.

## 응답

`decide(request)`는 다음 **5개 이름만** 담은 객체를 반환합니다.

```js
{
  schema: 'aleph.decision.v1',
  requestId: request.requestId,
  decision: 'allow', // 'allow' | 'deny' | 'step_up'
  reasonCode: 'approved',
  ruleIds: ['my_verified_rule'],
}
```

`reasonCode`는 운영 등록부의 `allowedReasonCodes`에 있는 소문자 코드여야 합니다. 거부와 추가 확인에는 적어도 하나의 규칙 이름이 필요합니다. 응답이 늦거나 형식·요청 ID·이유 코드가 맞지 않으면 엔진은 접근을 허용하지 않습니다. 학생 코드가 `allow`를 반환해도 엔진의 앞선 신원·기기·경로 검사를 되돌릴 수 없습니다.

`step_up`은 엔진에 추가 본인 확인을 요청하는 결정입니다. 단순 `deny`는 재인증 화면으로 이어지지 않습니다. 기존 7단계의 로컬 연습은 `npm run fixture:7`로 정상 요청과 복합 이상 요청 두 건을 비교합니다. 이 연습은 심판 판정이나 실제 학생 접속 증거가 아닙니다.

## 구현 전 확인

### 7단계 로컬 구현과 운영 연결 상태

기존 18항목 요청·5항목 응답을 유지합니다. `judge_fixture`는 엔진이 넘긴 가상 사건만 뜻하며 브라우저 헤더·본문에서 만들거나 실제 위치 증거로 쓰지 않습니다. `none`과 `unknown`은 정보 없음으로 보존합니다. 필수 입력 누락·잘못된 형식·알 수 없는 출처는 정상값으로 채우지 않고 추가 확인으로 보냅니다.

제공된 `scripts/fixture-7.mjs`의 `risk_signal` 사건 기준으로, 0~5시·`network: unusual`·최근 300초 안 `count >= 20`이 모두 맞으면 `step_up`·`step_up_required`입니다. 지역 하나만으로는 차단하지 않습니다. 이유 코드와 규칙 이름은 기존 `scripts/decider-test.mjs`의 7단계 연습 이름을 사용합니다. 운영 등록부 자체는 이 저장소에 없어 실제 등록 상태는 미확인입니다.

가상 사건(`source: judge_fixture`)에서는 엔진이 넘긴 `stepUp.verified === true`와 정수 `authAgeSeconds` 0~900초가 함께 유효하면 재확인 완료로 판정해 `allow`·`approved`를 반환합니다. 미확인·누락·잘못된 형식·범위 밖 값은 복합 사건의 `step_up`을 유지합니다. 이 가상 상태로 미등록 기기·불완전한 접속 입력·기존 XDR 거부를 우회하지 않습니다. 클라이언트 헤더나 본문에서 값을 읽지 않습니다.

현재 제공된 `stepUp: {verified, authAgeSeconds}`만으로는 실제 같은 주체의 로그인 시각이 추가 확인 요청 이후인지 검증할 수 없습니다. 확인 요청과 새 로그인을 묶는 계약·엔진 호출·자료 차단 연결이 제공되지 않았으므로 실제 재로그인 전 자료 차단과 새 로그인 후 새 요청 허용은 미실행입니다. 가상 판정기의 재확인 허용과 실제 자료 반환 검증을 구분합니다. 운영 계약이 제공되면 서버가 검증한 새 로그인 뒤 새 요청을 다시 판정해야 합니다. 토큰 발급 시각이나 브라우저 재로그인 표시로 대신하지 않습니다.

1. 규칙이 참일 때만 허용하고 나머지는 거부하거나 추가 확인을 요구합니다.
2. 새로운 `reasonCode`를 쓰려면 운영 등록부와 같은 버전에서 허용 코드가 등록돼야 합니다.
3. 실제 학생 계정, 토큰, 기기 개인키, 자료 본문을 판정 요청·로그·제출 묶음에 넣지 않습니다.
4. 시작 틀의 기본 `decide()`는 모든 요청을 거부합니다. 로컬 연습이 처음에 실패하는 것은 구현 전 상태를 보여 줍니다.
