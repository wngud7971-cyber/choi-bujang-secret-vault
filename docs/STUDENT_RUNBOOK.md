# 케셰브_배주형 · 21단계 검토 브랜치 실행 설명서

## 1. 검토 범위와 보존본

`codex/step21-review`는 13~20단계 로컬 앱과 21단계 학생 문서의 독립 검토본입니다. 같은 저장소 main의 `bf267891709fe562d3a10cb6d9bd85706b4482ee`에서 `on-client/` 전체를 그대로 가져옵니다. 기존 1~12단계·XDR 프로젝트와 테스트는 그 main 커밋에 보존되며 이 브랜치의 실행 파일이라고 설명하지 않습니다. 기본 엔진·인증·판정·취소·보안 검사·학생 표시 코드를 수정하지 않습니다.

전체 main 제출은 비밀정보 의심 검사에서 AI 검토 전 보류되었습니다. 로컬 검사는 실제 `.env`·개인키 파일이나 일반적인 서비스 키·JWT 형식 및 로컬 비밀값의 복사본을 발견하지 못했습니다. 다만 서버는 탐지 파일·규칙을 제공하지 않아 원인은 미확정입니다. 검토 범위를 실행 앱과 일치시키기 위해 분리하며, 실제 비밀값을 감추거나 검사 코드를 제거하지 않습니다. 분리만으로 통과하거나 차단이 해제됐다고 주장하지 않습니다.

## 2. 프로그램·버전·설치 조건

| 항목 | 실제 소스와 확인 내용 | 확인 한계 |
|---|---|---|
| Node.js | `on-client/package.json` 기준 24.19.0. 실제 v24.19.0, win32/x64 확인. 제공 실행 도구는 22~24 허용 | 다른 버전으로 전체 동작 미확인 |
| Windows PowerShell | 실제 버전 조회 5.1.26100.9711 | 제공 launcher의 실행·Ctrl+C는 직접 미확인 |
| 작업 셸 | PowerShell 7.6.5 | Windows native 호스트 운영 연결 증거는 아님 |
| Git | 실제 2.53.0.windows.3 | 공식 서버 판정과 별개 |
| npm | package.json에 start·demo·check 제공. 이번 작업 셸에서는 npm 실행 파일을 찾지 못함 | npm 명령은 실행하지 않음. 아래 절차는 Node 직접 실행 사용 |
| 앱 | `on-client/package.json` 버전 0.2.11 | 도움정보 component version 0.1.0과는 별개 값 |
| 브라우저 | PC 브라우저로 로컬 주소를 열어 사용 | 이번 검토에서 종류·버전·직접 UI 조작 미확인 |

Node.js와 Git이 없는 PC에서는 먼저 설치·PATH 등록 후 새 PowerShell에서 `node --version`, `git --version`을 확인합니다. 아래에 적은 현재 PC의 폴더가 다른 PC에도 있다고 가정하지 않습니다. 이 검토본의 `on-client/package.json`에는 외부 npm 의존성이 없고 package-lock.json도 없습니다. 앱 실행을 위한 npm install·npm ci 단계는 없습니다. main 보존본의 다른 프로젝트 의존성은 이 실행 절차에 포함하지 않습니다.

## 3. 실제 폴더와 실행 위치

현재 PC의 별도 검토 작업 폴더는 `C:\Users\82109\Documents\ChatGPT\hackert0n\step21-review`입니다. 전체 main 작업 폴더와 분리합니다. 다른 PC에서는 이 브랜치를 받은 자신의 폴더로 바꿉니다.

```text
step21-review/                    # 이 브랜치의 Git 최상위
├─ README.md                      # 학생이 작성한 검토본 목적·실행 안내
├─ .gitignore                     # 실제 env 제외, 예제만 예외 허용
├─ docs/STUDENT_RUNBOOK.md         # 이 학생 문서
└─ on-client/
   ├─ package.json, .env.example  # 실행 계약·비밀값 없는 견본
   ├─ README.md, docs/            # 제공 문서, 변경하지 않음
   ├─ public/index.html          # 제공 메뉴·버튼·표시 영역
   ├─ public/app.js              # 제공 요청·취소·세대 관리·학생 호출
   ├─ public/ai-connect.mjs      # 제공 계정 연결·AI 승인 화면 연결
   ├─ public/vulnerabilities-view.mjs # OSV 응답 검증·제공 표시
   ├─ student/extension.mjs       # 13~20단계 학생 표시 구현
   ├─ student/engine-adapter.mjs  # 제공 엔진 연결 경계
   ├─ src/server.mjs              # 127.0.0.1 로컬 HTTP 서버
   ├─ src/engine.mjs, src/engine/ # 기본·demo·명시적 SDP 엔진
   ├─ src/connection/, src/ai/    # native 계정·AI 권한·설명
   ├─ src/actions/                # 기존 서버 조치 처리
   ├─ src/vulnerabilities/        # lock·설치 메타데이터·OSV 대조
   ├─ tools/                     # 제공 Windows 실행·연결 도구
   └─ vendor/                    # 제공 클라이언트 모듈
```

서버 실행은 `on-client`에서 합니다. Git 커밋·원문 전달 도구는 검토본의 Git 최상위에서 합니다. 이 브랜치에 루트 package.json·Vercel 설정·기존 XDR 실행 파일은 없으므로 루트에서 npm start나 Vercel 배포를 시도하지 않습니다.

## 4. 시작·정상 신호·종료·재실행

### 기본 실행

기존 main의 작업과 실행 중인 프로그램을 보존하고 새 PowerShell을 엽니다.

```powershell
Set-Location -LiteralPath 'C:\Users\82109\Documents\ChatGPT\hackert0n\step21-review\on-client'
node --version
node --check .\student\extension.mjs
node .\src\server.mjs
```

문법 검사는 성공 시 별도 출력 없이 끝납니다. 기본 시작 로그는 `케셰브 연결 확인: http://127.0.0.1:5189`입니다. 브라우저에서 **http://127.0.0.1:5189/** 를 엽니다. 「보호 현황」「업무 앱」「보안 기록」과 학생 표시 영역이 있는 것이 예상 화면입니다. 로그의 '연결 확인'과 HTTP 200은 실제 엔진·AI 연결 성공이 아닙니다. 개인 연결 설정이 없는 기본 실행은 disconnected·`ENGINE_NOT_CONNECTED`를 반환합니다.

Node를 찾지 못하면 설치·PATH를 먼저 확인합니다. 현재 PC에서 확인한 번들 Node 경로는 `C:\Users\82109\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`입니다. 해당 파일이 실제로 있을 때 같은 앱 폴더에서 다음 대체 명령을 사용할 수 있습니다.

```powershell
& 'C:\Users\82109\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\src\server.mjs
```

### 종료와 재실행

1. 서버를 실행한 창에서 Ctrl+C를 누릅니다. 브라우저 탭 닫기만으로 서버가 종료되지는 않습니다.
2. 새로고침·새 HTTP 요청의 연결 실패를 확인합니다. 이미 열린 정적 화면은 남을 수 있습니다.
3. 같은 앱 폴더에서 `node .\src\server.mjs`를 다시 실행하고 로그 주소를 엽니다.

기본 포트는 `ON_PORT` 미설정 시 5189입니다. 사용 중(`EADDRINUSE`)이면 기존 프로그램을 종료하지 않고 다음처럼 다른 포트를 지정합니다.

```powershell
$env:ON_PORT = '5190'
node .\src\server.mjs
```

이 경우 **http://127.0.0.1:5190/** 를 엽니다. 종료 후 현재 셸의 포트 지정만 해제하려면 `Remove-Item Env:ON_PORT`를 실행합니다. 브라우저와 로그의 실제 포트가 일치해야 합니다.

### 예제 실행과 제공 실행 도구

같은 포트의 기존 서버를 먼저 종료한 뒤 앱 폴더에서 실행합니다.

```powershell
node .\src\server.mjs --demo
```

시작 로그는 `케셰브 예제: http://127.0.0.1:5189`이며 ON_PORT 지정 시 번호가 바뀝니다. 연습 사용자·기기·세션과 event-01이 제공됩니다. 예제 학습 자료실은 allow, 개발 저장소는 deny를 반환합니다. 실제 계정·기기·운영 정책의 확인 결과가 아닙니다.

제공 Windows 실행 도구를 쓰는 대체 명령은 다음과 같습니다. Node 버전·폴더·포트와 HTTP 응답을 확인하며 무언가를 설치하지 않습니다. 이 도구 자체를 통한 실행·수동 Ctrl+C는 이번 작업에서 미확인입니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1
```

도구의 예상 안내는 `케셰브가 켜졌습니다. 브라우저에서 http://127.0.0.1:5189/ 을 여세요.`와 `서버가 응답한 것만 확인했습니다. AI 연결 상태는 화면에서 따로 확인해 주세요.`입니다. `-Port 5190`, `-Demo` 옵션이 있으며 demo와 SDP 설정을 함께 쓰는 것은 거절합니다.

## 5. 글 구성도와 설정 경계

```text
PC 브라우저 http://127.0.0.1:5189/
  public/index.html → public/app.js (+ ai-connect.mjs)
       │                    └→ student/extension.mjs → 학생 DOM
       │ 같은 출처 HTTP /api/*       검증된 상태·자료만 전달
       ▼
on-client/src/server.mjs (127.0.0.1에만 바인딩)
  ├─ /api/me, /api/apps, /api/events, /api/devices, /api/sessions, /api/access
  │    └→ src/engine.mjs
  │         ├→ 기본: disconnected / --demo: 합성 예제
  │         └→ 명시적 SDP 설정 → student/engine-adapter.mjs
  │              └→ src/engine/sdp-host.mjs → 기존 접근 제어·XDR 시스템
  ├─ /api/native-login/*, /api/ai/connect/*, /api/ai/check, /api/ai/explain
  │    └→ src/connection/ + src/ai/ → 계정 확인 포털 / AI 게이트웨이
  ├─ /api/actions/prepare, /api/actions/execute, /api/actions/result
  │    └→ src/actions/ → 승인된 기존 서버 처리 → 원천 효과 관측
  └─ /api/vulnerabilities
       └→ project-scan.mjs → 승인된 프로젝트의 lock·설치 메타데이터
            └→ osv.mjs → OSV (승인된 공개 패키지만)
```

접근 요청은 POST `/api/access`입니다. 제공 `public/app.js`의 `snapshot`·`studentData`가 입력을 만들고 `renderStudent`·`setChildren`이 새 표시로 교체합니다. 요청·취소·오래된 응답 차단은 제공 호출부의 책임입니다. 학생 함수는 자동 재요청·인증·집행을 하지 않습니다.

| 연결 | 실제 코드·설정 계약 | 범위·미확인 사항 |
|---|---|---|
| 접근 제어·XDR | 서버의 `--sdp-host-config`, adapter와 `src/engine/sdp-host*.mjs` | 담당자가 준비한 개인 설정·인증서로 본인 범위만 조회. main의 XDR 파일을 로컬 앱이 자동 실행하는 구조가 아님. 운영 연결 미확인 |
| 계정 연결·AI 앱 승인 | `--native-host-config`, `src/connection/`, `src/ai/` | 계정 연결과 AI 앱 승인은 별도. 공개 포털 origin은 `https://aleph-omega.vercel.app` |
| AI 게이트웨이 | `src/ai/connection.mjs` 등. 공개 origin `https://ai-classroom-gateway-production.up.railway.app` | 설정·모델 목록·연결 점검·사건 설명 실행을 구분. 실제 유료 모델 요청 미실행 |
| 실제 조치 | `src/actions/`, `--alekov-actions`와 `--alekov-actions-config` | 기본 비활성화. native·SDP·기존 DB·정책 필요. 제공 launcher에는 활성화 옵션이 없음. 이번 작업에서 집행하지 않음 |
| OSV | `ON_PROJECT_DIRECTORY`, `ON_APPROVED_PUBLIC_PACKAGES`와 `src/vulnerabilities/` | 공개 endpoint `https://api.osv.dev/v1/querybatch`. 담당자가 프로젝트·공개 승인 목록 준비. 미설정·미조회·실패를 취약점 없음으로 판단하지 않음 |

[설정 견본](../on-client/.env.example)은 포트·어댑터 경로·모델 이름·빈 프로젝트 경로·빈 공개 패키지 목록만 담습니다. 기본 Node 명령은 `.env`·견본을 자동으로 읽지 않습니다. 개인 설정·인증서·개인키·토큰은 프로젝트·Git·ZIP 밖에 둡니다. 실제 운영 주소·비밀값은 문서에 쓰지 않습니다. 제공 launcher는 비밀로 보이는 환경변수를 제거해 자식 서버를 시작합니다.

제공 연결 계약은 [SDP_HOST_CONNECTION.md](../on-client/docs/SDP_HOST_CONNECTION.md), [AI_SETUP_GUIDE.md](../on-client/docs/AI_SETUP_GUIDE.md)를 참고합니다. 제공 문서에는 과거 버전 안내나 다른 환경의 검수 기록이 있으며, 그것을 이 학생의 운영 성공 기록으로 옮기지 않습니다. 21단계 제출 방법은 현재 과제 화면과 이 문서 마지막 절을 따릅니다.

## 6. 학생 함수와 제공 코드의 경계

학생 함수의 실제 파일은 모두 `on-client/student/extension.mjs`입니다. `createStudentView()`가 아래 표시 함수를 반환합니다. 이 표는 코드 대조 결과이며 실제 운영 성공 기록이 아닙니다.

| 단계·학생 함수 | 받는 자료·구현한 표시 | 제공 코드의 책임 |
|---|---|---|
| 13 `renderIdentity` | `{me, devices, sessions}`의 사용자·기기·세션, 한국어 상태와 원래 코드, 요청 실패 | 서버 조회·범위 검증과 새 결과 전달 |
| 14 `renderDecision` | `{status, mode, data?, error?, appId}`, data의 appId·decision·reason·checkedAt. allow·deny·challenge·unknown과 요청 실패 구분 | 선택한 앱의 접근 요청·판정 검증. allow는 실제 앱 접속 성공 보증이 아님 |
| 15 `renderEvents` | `{status, mode, data?, error?}`, 기록 종류·업무 앱·접속 상태 필터, 사건 상세의 근거·규칙·상태 | 본인 범위 보안 기록 조회. 필터는 받은 기록에 적용하며 운영자 전체 목록 조회가 아님 |
| 16 `renderStatus` | `{devices, sessions, notifications, diagnostics, mode}`, loading·빈 목록·오류, 진단 정보 중 지정된 여섯 항목 복사 | 새 조회·도움정보 로드. 기기·세션 오류를 빈 목록으로 바꾸지 않음 |
| 17 `renderAiConnection` | `{status, mode, data?, error?, checkedAt, explanationAccepted}`, 연결 점검·권한·실패 상태와 다음 안내 | 실제 계정 연결·AI 승인·모델 점검. 점검과 사건 설명 실행은 별개 |
| 18 `renderExplanation` | `{event, explanation, checkedAt}`, 사건 ID·근거 ID·규칙·상태·제안의 대응 확인 후 참고 설명 | 현재 계정·사건의 연결 검증과 AI 요청. AI 설명은 사실 확정이나 조치 실행이 아님 |
| 19 `renderAction` | `{status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error}`, 준비·진행·거절·실패·불명·효과 관측 구분 | 사람의 별도 확인, 티켓 관리·서버 집행·원천 결과 조회. 학생 함수는 집행하지 않음 |
| 20 `renderVulnerabilities` | `{status, mode, data?, error?}`, 전체·패키지별 상태, 정확한 version·source·checkedAt, lock 정보, 취약점 id·modified와 일부 실패 시 ID 보존 | lock·설치 메타데이터 대조, 승인된 공개 조회, `normalizeScan` 응답 검사, 취소·재조회·오래된 응답 차단 |

학생 DOM은 `createElement`·`textContent`로 작성하고 상태를 글자로 구분합니다. 제공 메뉴는 Tab으로 현재 탭에 들어간 뒤 위·아래 방향키로 이동하는 구조이며 모든 메뉴가 Tab 순서에 동시에 들어가는 방식은 아닙니다. 자세한 경계는 [IMPLEMENTATION_CONTRACT.md](../on-client/docs/IMPLEMENTATION_CONTRACT.md)를 참고합니다.

## 7. 확인 기록과 미확인 항목

| 구분 | 실제 근거 | 한계 |
|---|---|---|
| 코드 대조 | main의 on-client 전체를 가져오며 학생 표시·제공 서버·화면·설정 견본을 그대로 보존 | 아래 분리본 실행 확인과 구분 |
| 이전 전체 프로젝트의 로컬 실행 | 2026-10-23 07:31 UTC, 임시 포트 51090. 기본·demo HTTP 응답, 기본 ENGINE_NOT_CONNECTED, demo allow·deny·event-01, OSV not_configured, Origin 없는 POST 거절, 종료 후 같은 포트 재실행 확인 | 전체 프로젝트에서의 기록. 분리본 실행 결과로 바꾸어 쓰지 않음 |
| 이전 20단계 모의 점검 | 표시·부분 ID 보존·해시 교체·오류 회복·취소 후 늦은 응답 차단 등 13개 통과 | 모의 DOM·전송. 운영 OSV와 실제 브라우저 확인이 아님. 이번에 재실행하지 않음 |
| 사용자 보고 | 13~20단계 통과와 앞 단계 demo 화면 결과 | 서버 통과 기록을 이번 작업에서 별도 조회하지 않음 |
| 분리본 실행 | 아직 확인 전이며 확인하면 이 행을 갱신 | 코드 대조만으로 새 실행 성공을 주장하지 않음 |
| 미확인 | 새 사용자 PowerShell의 전체 따라 하기·수동 Ctrl+C, 브라우저·키보드 직접 조작, 운영 SDP/native·AI 승인·유료 모델 응답·원천 조치 효과·실제 OSV 조회, 다른 OS | 모두 미확인. 21단계 공식 통과와 비밀정보 검사 해제도 아직 미확인 |

직접 확인은 먼저 새 PowerShell에서 4절의 기본 실행을 따라 하고 로그 주소의 「보호 현황」을 여는 것부터 진행합니다. 다음 확인은 실제 경로·버튼 이름을 대조하는 것입니다. 기존 main 작업을 덮어쓰거나 정책·인증 정보를 바꾸지 않습니다.

## 8. 장애별 확인·복구 순서

| 증상·코드 | 확인 순서 | 복구·정상/거절 기준 |
|---|---|---|
| `node` 또는 `git`를 찾을 수 없음 | 현재 폴더와 `Get-Command node`, `Get-Command git` 확인 → 버전 확인 | 설치·PATH 등록 후 새 창. 현재 PC 번들 Node 대체 경로는 4.1절 참고. 오류 상태에서 실행했다고 기록하지 않음 |
| `Cannot find module`·파일 경로 오류 | `Get-Location` → `on-client/src/server.mjs` 존재 여부 | `on-client`로 이동 후 4.1절 재실행. 새 폴더 구조를 만들거나 기존 파일을 덮어쓰지 않음 |
| `EADDRINUSE`·포트 사용 중 | 시작 로그·선택한 `ON_PORT` 확인 | 4.3절의 다른 포트로 실행. 기존 프로세스 임의 종료 금지 |
| `NETWORK_ERROR`·로컬 서버 연결 실패 | 서버 창이 살아 있는지 → 로그 주소와 브라우저 포트 → 기본 GET 응답 확인 | 서버 재실행 후 「다시 불러오기」를 직접 누름. 실패는 빈 목록·접근 허용이 아님 |
| `ENGINE_NOT_CONNECTED` | 기본/demo/SDP 중 어떤 실행인지 → 담당자 제공 설정 유무 확인 | 기본 실행에서 예상되는 연결 없음. 제공 설정이 준비된 경우에만 담당자 안내로 연결. 정책·학생 판정 코드를 고쳐 성공으로 표시하지 않음 |
| `NATIVE_HOST_DISABLED` | 「계정 연결 시작」 결과 → 시작할 때 native 설정을 지정했는지 확인 | 담당자가 계정 연결 기능을 준비해야 함. 코드에 키를 넣거나 사용자 값을 임의 생성하지 않음 |
| `AI_REQUEST_UNVERIFIED`, `ON_AI_PROVISIONING_PENDING` 등 | 「연결 도움정보 보기」 또는 「도움정보 불러오기」 → 계정 연결 → 별도 AI 앱 승인 상태 확인 | 원문 오류·비밀값 대신 가린 도움정보로 담당자 확인. 원인이 해결되면 사용자가 직접 점검. AI 점검 실패와 사건 설명 실패·과제 판정을 구분 |
| `HOST_REJECTED`·`ORIGIN_REJECTED` | 로그의 localhost 주소·포트와 열린 화면 주소 확인 | 같은 로컬 화면의 버튼으로 요청. 출처 검사를 해제하지 않음. Origin 없는 POST는 거절되는 것이 정상 |
| 기록 0건과 조회 실패 | 정상 응답의 빈 배열인지, status=error인지 먼저 구분 | 정상 빈 기록은 없음으로, 실패는 오류로 표시. 실패 시 기존 상세를 현재 결과로 남기지 않고 직접 재조회 |
| `not_configured`·`not_checked`·`unverifiable` | 「설치 패키지 조회」의 전체 상태 → 프로젝트 설정·공개 승인 목록·lock 확인 가능 여부를 담당자와 확인 | 미설정·미조회·확인 불가를 구분. 취약점을 만들려고 버전을 낮추거나 허용 목록을 임의 변경하지 않음 |
| OSV 조회 `partial`·error·취소·시간 초과 | 전체 상태와 패키지 상태·출처·시각 확인 | 받은 ID는 보존하되 완료로 표시하지 않음. 취소·오류 시 이전 표 제거. 「설치 패키지 조회」를 직접 눌러 재조회하며 늦은 응답을 현재 결과로 재사용하지 않음 |
| 조치 미지원·`unknown`·`pending` | 서버가 실제로 지원하는 조치인지 → 사건·대상·receipt와 현재 결과 확인 | ACK·준비 완료는 효과 성공이 아님. 필요 시 「원천 결과만 재조회」. 「조치 화면 취소」는 이미 집행한 효과를 복구하지 않음. 이번 단계에서 집행 시험하지 않음 |

기본 도움정보에서 지정된 여섯 항목은 requestId·component·version·checkedAt·engine.mode·engine.code입니다. 내용을 직접 확인한 뒤 「확인했으며 복사합니다」 또는 학생 「도움정보 복사」를 사용합니다. 도움정보를 아직 불러오지 않았거나 조회에 실패하면 복사 비활성화가 예상됩니다. 전체 설정·인증서·토큰·비밀번호·스택은 문의에 붙이지 않습니다.

## 9. 검토 브랜치 커밋과 원문 제출

저장소 주소는 `https://github.com/wngud7971-cyber/choi-bujang-secret-vault`입니다. 21단계 과제 화면에 저장소와 **이 검토 브랜치의 실제 40자리 커밋**을 직접 입력합니다. main에 병합할 필요는 없습니다. 서버는 지정 커밋의 원문을 읽으며 새 환경에서 실행해 판정하지 않습니다. 검토본의 실제 통과는 서버 결과로 확인합니다.

현재 검토 폴더에서 다음으로 실제 브랜치와 커밋을 확인합니다.

```powershell
Set-Location -LiteralPath 'C:\Users\82109\Documents\ChatGPT\hackert0n\step21-review'
git status --short
git branch --show-current
git rev-parse HEAD
```

기대 브랜치는 `codex/step21-review`입니다. 21·22단계는 Workbench의 13~20단계용 「포털 제출 준비」 지원으로 가정하지 않습니다. 공개 커밋을 서버가 읽을 수 있다면 JSON은 선택 사항입니다. 비공개 원문이 필요한 경우 해당 단계 화면에서 받은 최신 도구를 프로젝트 밖에 풀고, 같은 커밋으로 원문을 준비합니다. 기존 도구 경로는 아래와 같으나 포털 최신 배포본과 같은 버전인지는 미확인입니다.

```powershell
$submitCommit = (git rev-parse HEAD).Trim()
$sourceTool = 'C:\Users\82109\Documents\ChatGPT\hackert0n\submission-tools\alekov-source-tool\student-source-cli.mjs'
Test-Path -LiteralPath $sourceTool
$outputDir = 'C:\Users\82109\Documents\ChatGPT\hackert0n\submission-files\step21-review-source'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$outputFile = Join-Path $outputDir ('alekov-source-' + $submitCommit + '-' + [guid]::NewGuid().ToString('N') + '.json')
node $sourceTool --commit $submitCommit --output $outputFile
```

도구는 커밋된 원문만 묶으며 학생 코드 실행·업로드·제출은 하지 않습니다. 도구를 다시 받았다면 실제 경로를 바꿉니다. 출력은 프로젝트 밖의 새 파일이어야 합니다. JSON을 같은 단계에서 선택하고 저장소·커밋·단계를 확인합니다. 원문 전달만 실패했으면 기존 접수를 유지하고 「원문만 다시 보내기」를 사용합니다. 원문 전달 성공과 공식 통과는 별개입니다.
