# 케셰브_배주형 학생용 실행 설명서와 시스템 구성도

21단계 학생 작성 문서입니다. 13~20단계의 학생 화면과 기존 1~12단계·XDR 프로젝트를 보존한 상태를 설명합니다. 이번 단계에서는 실행 코드·UI·인증 설정을 변경하지 않습니다.

문서 대조 기준은 main의 20단계 코드 `6edbc7ae70efb11f2e3976aa8a50c6a34297d7cf`입니다. 로컬 `on-client/student/extension.mjs`와 이 커밋의 파일이 줄바꿈을 제외하고 일치하는 것을 확인했습니다. 이 번호는 문서 작성 기준이며, 21단계 제출에는 **이 문서가 포함된 새 커밋**을 사용합니다.

## 1. 목적과 범위

이 앱은 본인 계정·기기·세션, 선택한 업무 앱의 접근 판정, 본인의 보안 기록, AI 연결 점검·사건 설명·조치 처리 상태, 승인된 공개 패키지의 OSV 결과를 표시합니다. 학생 함수는 제공 호출부가 전달한 자료를 DOM으로 그립니다. 화면 표시만으로 실제 인증·접속·조치 효과를 만들지는 않습니다.

이 문서의 실행 대상은 **`on-client`의 로컬 앱 서버**입니다. 저장소 루트의 `src/`, `api/`, `public/`, `xdr/`는 기존 1~12단계·보너스 프로젝트이며 함께 보존합니다. 루트의 Vercel 배포와 로컬 서버 실행은 별도 경로입니다. 로컬 앱을 켠 것만으로 기존 Vercel 프로젝트를 재배포하거나 XDR 연습 파일을 실행하지 않습니다.

## 2. 필요 프로그램과 확인한 버전

| 항목 | 소스에 명시된 조건·용도 | 이번 작업 환경에서 확인한 사실 |
|---|---|---|
| Node.js | `on-client/package.json` 기준 24.19.0. 제공 실행 도구는 주 버전 22~24를 허용 | `node --version`: **v24.19.0**, win32/x64. 직접 서버 실행 확인 |
| Windows PowerShell | `tools/start-alekov.ps1` 실행 및 native 호스트의 Windows 경로 사용 | `powershell -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'`: **5.1.26100.9711**. 버전 조회만 실행 |
| PowerShell | 이 작업에서 파일·명령 확인에 사용한 셸 | **7.6.5**. 이 버전으로 Windows PowerShell용 native 호스트까지 검증한 것은 아님 |
| Git | 커밋·원격 조회, 선택한 커밋의 원문 묶음 생성 | `git --version`: **2.53.0.windows.3** |
| npm | `npm start`, `npm run demo`, `npm run check`는 package.json에 있는 대체 명령 | 이번 작업 셸에서 npm을 찾지 못해 실행하지 않음. 아래 절차는 Node 직접 실행 사용 |
| PC 브라우저 | 로컬 HTTP 화면과 키보드 조작에 필요 | 이번 21단계에서는 브라우저 종류·버전 및 화면 조작 미확인 |
| 앱 시작 틀 | `on-client/package.json`의 버전 | **0.2.11**. 도움정보 API의 component version **0.1.0**과는 별개 값 |

`on-client/package.json`에는 외부 npm 의존성과 설치 스크립트가 없으며, `on-client/package-lock.json`도 없습니다. 이 로컬 화면을 켜기 위한 `npm install` 단계는 없습니다. 루트 `package.json`은 Node.js >=22와 별도 의존성을 선언하고, 루트 `package-lock.json`의 lockfileVersion은 3입니다. 루트 의존성 재설치는 이번 단계에서 수행하지 않았습니다.

다른 PC에서는 Node.js와 Git 설치 및 PATH 등록을 먼저 확인합니다. 설치 후 PowerShell을 새로 열어 `node --version`, `git --version`을 실행합니다. 이 작업의 프로그램 경로가 다른 PC에도 존재한다고 가정하지 않습니다. macOS·Linux의 전체 동작, 다른 Node.js 버전, 모바일, Windows native 호스트의 운영 연결은 이번 작업에서 재현하지 않았습니다.

## 3. 폴더와 작업 위치

현재 PC의 Git 최상위 폴더:

```text
C:\Users\82109\Documents\ChatGPT\hackert0n\choi-bujang-secret-vault
```

다른 PC에서는 자신의 저장소 폴더로 바꿉니다. 아래 상대 경로의 기준은 이 Git 최상위입니다.

```text
choi-bujang-secret-vault/
├─ README.md                       # 현재 학생 안내 + 보존한 앞 단계 기록
├─ docs/STUDENT_RUNBOOK.md          # 이 학생 문서
├─ package.json, package-lock.json # 기존 1~12단계 실행·빌드 의존성
├─ aleph.config.json, vercel.json   # 기존 과제·배포 설정, 이번 단계 변경 없음
├─ api/, src/, public/, xdr/        # 기존 접근 제어·자료실·XDR 코드
└─ on-client/
   ├─ package.json                 # 로컬 앱 실행 명령, 버전 0.2.11
   ├─ .env.example                 # 비밀값 없는 설정 견본, 자동 로드되지 않음
   ├─ README.md, docs/             # 제공 문서, 내용 보존
   ├─ public/index.html            # 제공 메뉴·버튼·표시 영역
   ├─ public/app.js                # 제공 요청·취소·세대 관리와 학생 함수 호출
   ├─ public/ai-connect.mjs        # 제공 계정 연결·AI 승인 UI 연결
   ├─ public/vulnerabilities-view.mjs # 제공 OSV 응답 검증·표시
   ├─ student/extension.mjs        # 13~20단계 학생 표시 함수
   ├─ student/engine-adapter.mjs   # 제공 엔진 연결 경계
   ├─ src/server.mjs               # 로컬 HTTP 서버
   ├─ src/engine.mjs, src/engine/   # 기본·demo 엔진 및 SDP 호스트
   ├─ src/connection/, src/ai/     # native 계정 연결·AI 권한·설명 경로
   ├─ src/actions/                 # 기존 서버의 조치 처리 경로
   ├─ src/vulnerabilities/         # lock·설치 메타데이터 및 OSV 대조
   └─ tools/start-alekov.ps1        # 제공 Windows 실행 도구
```

앱 실행은 `on-client`에서, Git 커밋과 원문 도구는 그 위의 **Git 최상위**에서 실행합니다. 두 폴더를 바꾸어 사용하면 상대 경로가 맞지 않습니다.

## 4. 시작·종료·재실행

### 4.1 새 PowerShell에서 기본 실행

기존 작업과 실행 중인 다른 프로그램을 보존합니다. 새 PowerShell 창을 열고 다음 순서로 실행합니다.

```powershell
Set-Location -LiteralPath 'C:\Users\82109\Documents\ChatGPT\hackert0n\choi-bujang-secret-vault\on-client'
node --version
node --check .\student\extension.mjs
node .\src\server.mjs
```

`node --check`는 성공 시 별도 출력 없이 끝나는 문법 검사입니다. 서버 명령은 창을 점유하며, 기본 포트의 시작 로그는 다음과 같습니다.

```text
케셰브 연결 확인: http://127.0.0.1:5189
```

브라우저에서 **http://127.0.0.1:5189/** 를 엽니다. 「보호 현황」「업무 앱」「보안 기록」과 학생 표시 영역이 있는 것이 화면의 예상 시작 신호입니다. 위 로그의 '연결 확인'은 실제 엔진·AI 연결 성공을 보증하지 않습니다. 설정 없는 기본 실행에서는 `disconnected` / `ENGINE_NOT_CONNECTED`가 예상되며, `/` HTTP 200과 실제 신원 조회 성공은 별도입니다.

기본 포트는 `ON_PORT` 미설정 시 5189입니다. 이전 셸 설정으로 다른 포트가 선택되었다면 서버 로그의 실제 포트와 브라우저 주소를 맞춥니다. 5189를 명시하려면 서버 실행 전에 `$env:ON_PORT = '5189'`를 지정합니다.

현재 PC에서 `node`를 찾지 못하지만 이 작업에 사용한 번들 런타임이 남아 있다면, 같은 `on-client` 폴더에서 다음 직접 경로로 실행할 수 있습니다. 다른 PC의 공통 설치 경로는 아닙니다.

```powershell
& 'C:\Users\82109\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\src\server.mjs
```

### 4.2 제공 실행 도구를 쓰는 대체 방법

동일한 `on-client` 폴더에서 다음 명령도 제공되어 있습니다. 실행 전에 Node.js 버전·폴더·포트를 확인합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1
```

예상 안내는 `케셰브가 켜졌습니다. 브라우저에서 http://127.0.0.1:5189/ 을 여세요.`와 `서버가 응답한 것만 확인했습니다. AI 연결 상태는 화면에서 따로 확인해 주세요.`입니다. 이 대체 명령은 소스로 대조했으며, 이번 21단계에서 도구를 통한 시작·Ctrl+C 종료를 직접 시험하지 않았습니다. 전역 실행 정책을 바꾸는 단계는 없습니다.

### 4.3 종료·재실행·포트 충돌

1. 직접 서버를 실행한 PowerShell 창에서 **Ctrl+C**를 누릅니다. 브라우저 탭을 닫는 것만으로 서버가 종료되지는 않습니다.
2. 새로고침 시 서버에 연결할 수 없는지 확인합니다. 이미 열린 정적 화면이 남을 수 있으므로 새 요청의 실패를 확인합니다.
3. 같은 폴더에서 `node .\src\server.mjs`를 다시 실행하고 로그의 주소를 엽니다.

포트 사용 중(`EADDRINUSE`)이면 다른 프로그램을 임의로 종료하지 않습니다. 실행할 서버에만 다른 포트를 지정합니다.

```powershell
$env:ON_PORT = '5190'
node .\src\server.mjs
```

이 경우 주소는 **http://127.0.0.1:5190/** 입니다. 서버를 종료한 뒤 현재 셸의 포트 지정만 해제하려면 `Remove-Item Env:ON_PORT`를 실행합니다. 제공 실행 도구의 대응 옵션은 `-Port 5190`입니다.

### 4.4 예제 자료로 화면을 확인할 때

기본 서버를 먼저 종료한 뒤, 같은 폴더에서 실행합니다.

```powershell
node .\src\server.mjs --demo
```

예상 로그는 `케셰브 예제: http://127.0.0.1:5189`이며, 포트를 지정했다면 해당 번호로 바뀝니다. 예제 사용자·기기·세션과 `event-01`이 제공됩니다. 「업무 앱」의 학습 자료실 접근 요청은 `allow`, 개발 저장소는 `deny`를 반환하는 예제 정책입니다. 예제 결과는 실제 계정 로그인·기기 보안 검증·운영 접근 허용 증거가 아닙니다. demo와 SDP 설정을 함께 주면 시작을 거절합니다.

## 5. 글로 쓴 구성도와 연결 경계

```text
PC 브라우저 http://127.0.0.1:5189/
  public/index.html → public/app.js (+ ai-connect.mjs)
       │                    │ 응답을 검증·상태화한 뒤 학생 함수 호출
       │                    └→ student/extension.mjs → 학생 DOM 표시
       │ 같은 출처 HTTP /api/*
       ▼
로컬 앱 서버 on-client/src/server.mjs (127.0.0.1에만 바인딩)
  ├─ /api/me, /api/apps, /api/events, /api/devices, /api/sessions, /api/access
  │    └→ src/engine.mjs
  │         ├→ 기본: disconnected / demo 옵션: 합성 예제
  │         └→ 명시적 SDP 설정 시 student/engine-adapter.mjs
  │              └→ src/engine/sdp-host.mjs → 기존 접근 제어·XDR 시스템
  │                   본인 범위 신원·앱·판정·지원되는 기록 조회
  ├─ /api/native-login/*, /api/ai/connect/*, /api/ai/check, /api/ai/explain
  │    └→ src/connection/ + src/ai/ → 계정 확인 포털 / AI 게이트웨이
  ├─ /api/actions/prepare, /api/actions/execute, /api/actions/result
  │    └→ src/actions/ → 승인된 기존 서버 처리 → 원천 효과 관측
  └─ /api/vulnerabilities
       └→ src/vulnerabilities/project-scan.mjs
            승인된 프로젝트의 package-lock.json + 설치 메타데이터
            └→ osv.mjs → OSV 공개 취약점 조회 (승인된 공개 패키지만)

저장소 루트 src/ztna.mjs, src/decider.mjs, src/detect.mjs, xdr/
  = 보존한 기존 프로젝트. on-client 시작만으로 직접 import·운영 연결되지 않음.
```

앱 목록은 GET `/api/apps`, 판정은 POST `/api/access`입니다. `public/app.js`의 `studentData`·`snapshot`이 함수별 입력을 만들고, `renderStudent`·`setChildren`이 새 DOM으로 교체합니다. 요청·취소·오래된 응답 차단은 제공 호출부의 책임이며 학생 함수는 서버를 자동 재호출하지 않습니다.

| 연결·설정 | 실제 소스 경계와 공개 주소 | 현재 지원 범위·주의 |
|---|---|---|
| 기본 로컬 HTTP | `src/server.mjs`, `ON_PORT` 기본 5189 | 시작·정적 파일 응답과 운영 연결은 별개 |
| 접근 제어·XDR 조회 | `--sdp-host-config` → `src/engine/sdp-host-config.mjs`·`sdp-host.mjs` → adapter | 담당자가 준비한 개인 설정·인증서 필요. 미지원 조회는 오류이며 빈 성공으로 바꾸지 않음. 운영 주소는 개인 설정에 있어 문서에 복사하지 않음 |
| 계정 확인·AI 앱 승인 | `--native-host-config` → `src/connection/native-context.mjs`·`manager.mjs` | 계정 연결과 AI 앱 승인은 별도. 포털 공개 origin: `https://aleph-omega.vercel.app` |
| AI 게이트웨이 | `src/ai/connection.mjs`·`service.mjs` 등 | 소스의 공개 origin: `https://ai-classroom-gateway-production.up.railway.app`. 주소 존재·설정 존재만으로 모델 응답 성공을 판단하지 않음 |
| 실제 조치 처리 | `src/actions/`, 서버 CLI의 `--alekov-actions`와 `--alekov-actions-config` | 기본 비활성화. native·SDP 설정과 담당자가 준비한 기존 DB·정책이 필요. 제공 실행 도구에는 조치 활성화 옵션이 없음. 이번 단계에서 활성화·집행하지 않음 |
| OSV | `ON_PROJECT_DIRECTORY`, `ON_APPROVED_PUBLIC_PACKAGES` → scanner → `https://api.osv.dev/v1/querybatch` | 승인 목록은 JSON 배열. 대상 경로·공개 조회 허용 목록은 담당자가 준비. 프로젝트 미설정이면 `not_configured`, 승인 대상 없으면 `not_checked`. 이번 작업에서 외부 조회하지 않음 |

비밀값 없는 실제 설정 견본은 [on-client/.env.example](../on-client/.env.example)입니다. 포트·어댑터 경로·모델 이름·빈 프로젝트 경로·빈 공개 패키지 목록만 있으며 자격정보는 없습니다. 실제 값이 필요한 개인 설정과 분리합니다. `.gitignore`는 이 예제 파일만 예외로 허용하고 실제 `.env`와 나머지 `.env.*`는 계속 제외합니다.

기본 Node 실행은 `.env`나 `.env.example`을 자동으로 읽지 않습니다. `package.json`의 start 명령에도 env-file 옵션이 없습니다. 제공 실행 도구는 비밀로 보이는 환경변수를 제거해 자식 서버를 실행합니다. 파일을 복사하는 것만으로 엔진·AI 연결이 켜진다고 안내하지 않습니다.

개인 설정 파일·인증서·개인키·토큰은 프로젝트·Git·업로드 ZIP 밖에 둡니다. 값 자체를 문서나 명령 인자로 적지 않습니다. 연결이 필요한 경우 담당자가 안내한 기존 설정 경로만 사용하며, 이번 기본·demo 재현에는 해당 설정을 사용하지 않았습니다. 설정 계약은 제공 문서 [SDP_HOST_CONNECTION.md](../on-client/docs/SDP_HOST_CONNECTION.md), [AI_SETUP_GUIDE.md](../on-client/docs/AI_SETUP_GUIDE.md)를 참고합니다.

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

| 구분 | 실제 확인 내용 | 판단의 한계 |
|---|---|---|
| 이번 코드 대조 | 최신 main의 학생 파일 일치, package·lock·서버 CLI·버튼·함수·연결 경로 확인. 학생 파일과 서버 문법 검사 정상 | 코드를 읽은 사실이며 모든 기능의 실행 성공을 뜻하지 않음 |
| 이번 로컬 서버 실행 | 2026-10-23 07:31 UTC, Node v24.19.0, 임시 포트 **51090**. `node src/server.mjs`로 `/`·`/app.js`·`/student/extension.mjs`·`/vulnerabilities-view.mjs` HTTP 200. `/api/me`는 HTTP 503·`ENGINE_NOT_CONNECTED`·disconnected | 환경변수를 제한한 별도 자식 프로세스에서 HTTP로 확인. 브라우저 UI·운영 엔진 성공은 미확인 |
| 이번 demo 서버 실행 | 같은 포트에서 `node src/server.mjs --demo` 재실행. 신원 HTTP 200·demo, 예제 library=allow·repository=deny, event-01 반환 | 합성 자료. 실제 계정·기기·정책의 결과가 아님 |
| 이번 거절 경로 실행 | 두 모드에서 Origin 없는 POST `/api/access`는 HTTP 403·`ORIGIN_REJECTED` | HTTP 출처 검사 확인. 운영 접근 차단·기기 격리를 실행한 것이 아님 |
| 이번 OSV 미설정 경로 | 두 모드 모두 `/api/vulnerabilities` HTTP 200·`not_configured` | 외부 OSV 조회·승인 목록 변경 없음. 취약점 없음으로 해석하지 않음 |
| 이번 종료·재실행 | 도구가 시작한 자식 서버만 종료, 해당 포트의 새 연결 실패와 같은 포트 재실행 확인 | 자동 프로세스 종료로 확인. 새 사용자 PowerShell의 Ctrl+C·브라우저 직접 재현은 미확인 |
| 앞 단계 모의 점검 | 20단계 작업에서 표시·부분 결과 보존·해시 교체·실패 회복·취소 후 늦은 응답 차단 등 13개 모의 점검 통과 | 모의 DOM·모의 전송 사용. 운영 OSV·브라우저 확인을 대신하지 않음. 이번 문서 작업에서 재실행하지 않음 |
| 사용자가 앞서 보고한 화면 | demo의 허용·거부, 보안 기록 상세, 서버 연결 실패, 도움정보 복사·실패 시 비활성화 | 앞 단계 당시 사용자 보고이며 이번 실행 환경의 직접 관찰이 아님 |
| 공식 단계 결과 | 사용자가 13~20단계 통과를 보고함. 최초 21단계 제출은 비밀정보 의심 검사에서 AI 전송 전 보류됨 | 21단계 학생 코드 불합격 판정이 아니라 확인 불가. 재검토 통과는 아직 확인하지 않음 |
| 아직 확인하지 않은 범위 | 새 PowerShell에서 문서 전체 따라 하기, 실제 브라우저·키보드 조작, 운영 SDP/native·AI 승인·유료 모델 응답·원천 조치 효과·실제 OSV 조회·새 Vercel 배포 | 전부 미확인. 지원 환경이나 성공 사례로 주장하지 않음 |

로컬 서버를 켠 뒤 **보호 현황**의 제공 영역과 학생 영역을 함께 봅니다. 추가 직접 확인은 하나씩 진행합니다. 첫 확인은 새 PowerShell에서 4.1절을 따라 실행하고 표시된 주소를 여는 것입니다. 이후 버튼·경로가 맞는지 대조하고, 확인하지 못한 항목은 위 표에 미확인으로 남깁니다.

### 7.1 제출 전 비밀정보 검사와 확인 불가 피드백

최초 21단계 제출 커밋 `de08e484b55e4f0137f7f4a36499aec6dfa1b78e`에 대해, 사용자가 전달한 서버 피드백은 "비밀정보로 의심되는 내용이 있어 AI에 전송하지 않았습니다"입니다. 대상 파일·줄·탐지 규칙은 제공되지 않았습니다. 따라서 실제 유출이나 오탐 중 어느 쪽이라고 확정하지 않습니다.

| 로컬에서 직접 확인한 범위 | 결과·한계 |
|---|---|
| 해당 커밋에 기록된 236개 파일의 경로 | `.env`·`.env.*` 파일과 PEM·PFX·P12·개인키 확장자 파일 없음. 당시 예제 파일도 제출에 없었음 |
| 커밋 파일 본문의 일반적인 서비스 키·JWT·완전한 개인키 블록 형식 | 해당 검색 규칙에서 발견 0건. 모든 비밀정보를 찾아낸다는 보장은 아님 |
| 로컬 `.env`의 비밀 항목 값과 제출 커밋의 본문 비교 | 일치 파일 0건. 값은 화면·보고서·문서에 출력하지 않음 |
| 일반적인 비밀 변수명과 문자열 할당 형태 | 테스트 자료·비밀값 차단 규칙·권한 안내 문구도 후보로 분류됨. 서버가 이 부분을 지목한 것인지는 미확인 |

이번 반영은 실제 비밀값 없는 `.env.example`을 제출할 수 있도록 하고, 제외 규칙과 검사 범위를 문서화한 것입니다. 제공 코드의 비밀값 차단 검사·인증 검사·테스트를 제거하거나 탐지 문자열을 쪼개 숨기지 않습니다. 로컬 실제 `.env`·개인 설정·출력 원문 JSON은 업로드 ZIP에 넣지 않습니다. `.gitignore`는 새 파일의 추가를 제어할 뿐, 이미 커밋한 비밀값이나 과거 기록을 자동으로 지우지는 않습니다.

새 커밋에서도 같은 보류가 나오면 값 자체가 아닌 대상 파일·줄·탐지 분류를 운영자에게 요청합니다. 실제 비밀값 노출이 확인된 경우에는 해당 값의 발급처에서 폐기·재발급하고 현재 제출본에서 제외해야 합니다. 이번 로컬 검사만으로 계정 자격을 임의 폐기하거나 기존 Git 기록을 변경하지 않았습니다.

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

## 9. 21단계 커밋과 원문 제출

최초 문서 제출에 더해 이번 피드백 반영은 루트 `README.md`, 이 문서, 루트 `.gitignore`, 비밀값 없는 `on-client/.env.example` 네 파일입니다. 이전 학생 구현은 같은 저장소에 보존합니다. GitHub 웹 업로드를 사용할 경우 ZIP을 풀어 **main의 동일 경로 네 파일을 한 번의 업로드 커밋**에 반영합니다. 점으로 시작하는 두 파일도 포함합니다. 추천 메시지는 `Clarify step 21 source hygiene and config example`입니다.

제출 저장소 주소는 `https://github.com/wngud7971-cyber/choi-bujang-secret-vault`입니다. 새 커밋에 이 문서·README와 기존 학생 코드가 함께 있는지 확인하고, 실제 생성된 **40자리 커밋**을 과제 화면에 직접 입력합니다. 13~20단계용 Workbench 「포털 제출 준비」를 21단계 지원으로 가정하지 않습니다. 제공 시작 안내에 21·22단계 방식이 미정이라고 적힌 부분은 이번 공식 과제 화면의 직접 입력·원문 전달 안내를 기준으로 따릅니다.

공개 저장소의 커밋을 서버가 읽을 수 있다면 JSON은 선택 사항입니다. 비공개 커밋은 저장소를 공개로 바꾸지 않고, **해당 단계 화면에서 받은 최신 원문 전달 도구**로 원문을 준비합니다. 이 PC에 기존 도구 경로가 존재하는 것은 확인했지만, 현재 포털의 최신 배포본과 같은 버전인지는 미확인입니다.

아래는 GitHub 웹 업로드 **이후** 이 PC에서 새 main을 선택하는 명령입니다. 현재 로컬 HEAD는 이전 작업 브랜치이므로 HEAD를 21단계 커밋으로 간주하지 않습니다. fetch는 작업 파일을 덮어쓰지 않습니다.

```powershell
Set-Location -LiteralPath 'C:\Users\82109\Documents\ChatGPT\hackert0n\choi-bujang-secret-vault'
git fetch origin main
$submitCommit = (git rev-parse origin/main).Trim()
git show --stat --oneline $submitCommit
git ls-tree -r --name-only $submitCommit -- README.md docs/STUDENT_RUNBOOK.md .gitignore on-client/.env.example on-client/student/extension.mjs
```

`$submitCommit`이 GitHub의 제출 대상 커밋인지 직접 대조합니다. 그 사이 다른 main 커밋이 생겼다면 GitHub에서 선택한 실제 40자리 값을 사용합니다. 다른 브랜치로 전환하거나 미커밋 작업을 삭제할 필요는 없습니다.

비공개 원문이 필요한 경우에만 다음을 실행합니다. 도구를 다시 받았다면 `$sourceTool`을 새 실제 파일 경로로 바꿉니다. 먼저 `Test-Path -LiteralPath $sourceTool`이 True인지 확인합니다. 출력 디렉터리는 Git 프로젝트 밖이며, 기존 파일 덮어쓰기를 피하려고 매번 새 이름을 만듭니다.

```powershell
$sourceTool = 'C:\Users\82109\Documents\ChatGPT\hackert0n\submission-tools\alekov-source-tool\student-source-cli.mjs'
Test-Path -LiteralPath $sourceTool
$outputDir = 'C:\Users\82109\Documents\ChatGPT\hackert0n\submission-files\step21-source'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$outputFile = Join-Path $outputDir ('alekov-source-' + $submitCommit + '-' + [guid]::NewGuid().ToString('N') + '.json')
node $sourceTool --commit $submitCommit --output $outputFile
```

이 명령은 선택한 커밋의 원문을 묶으며 미커밋 수정은 포함하지 않습니다. 학생 코드 실행·업로드·단계 제출도 하지 않습니다. Git 또는 Node가 PATH에 없다면 앞 절에서 경로를 먼저 준비합니다. 최초 21단계 문서 커밋은 확인했지만, 이번 피드백 수정이 포함된 새 커밋은 아직 없어 그 커밋의 JSON 생성·업로드·재제출은 실행하지 않았습니다.

JSON이 만들어지면 같은 단계의 「비공개 저장소 원문 묶음」에서 선택하고 저장소·커밋·단계를 대조한 뒤 제출합니다. 원문 전달만 실패했을 때는 기존 접수를 유지하고 「원문만 다시 보내기」를 사용합니다. 전달 완료와 AI 검토 통과는 별개이며, 서버가 명령을 실행해 새 환경을 재현한 판정도 아닙니다.
