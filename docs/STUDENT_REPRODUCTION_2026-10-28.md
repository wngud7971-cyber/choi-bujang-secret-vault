# 케셰브 · 22단계 main 재현 기록 (2026-10-28)

## 1. 재현 대상과 최종 문서 커밋의 관계

| 항목 | 이번 회차의 실제 값 |
|---|---|
| 저장소 | https://github.com/wngud7971-cyber/choi-bujang-secret-vault |
| 제출 브랜치 | **main**. 별도 축소 브랜치를 만들지 않음 |
| 재현한 코드 커밋 | **`03aee7a2710faa8b1a19037f454e77f7570f10cd`** |
| 재현한 on-client Git tree | **`8c1294beb48d7b6bbc94a399ca94107b3f705fa7`** |
| 학생 릴리스 | **0.22.0-validation.2 · 검증 중** |
| 시작 틀 / 진단 구성요소 | package.json **0.2.11** / 도움정보 **0.1.0**. 운영 안내의 0.2.21 업데이트는 이번 회차에 적용하지 않음 |
| 재현 폴더 | 원래 Git 작업 폴더 밖의 새 `verification/step22-main-20261028-03aee7a` |
| 원본 보존 | 원래 폴더의 미커밋 기능 작업·개인 설정·데이터는 유지. 재현 폴더에는 커밋된 원문만 checkout |
| 21단계 결과 | 사용자가 이 커밋의 **main 제출 통과**를 보고함. 이 보고를 새 환경의 운영 연결 성공으로 해석하지 않음 |
| 문서 추가 후 제출본 | 위 커밋을 부모로 하는 문서 변경 커밋. 변경 파일은 아래 다섯 문서뿐이며, 실행 코드·설정·lock·의존성은 변경하지 않음 |

이번에 변경하는 문서는 `README.md`, `docs/STUDENT_RUNBOOK.md`, `docs/STUDENT_REPRODUCTION.md`, 이 문서, `docs/STUDENT_RELEASE.json`이다. 최종 제출 해시는 commit·push 이후 `git rev-parse HEAD`로 확인한다. 자기 자신을 포함하는 문서에 미래 해시를 만들어 넣지 않는다. 재현 대상과 문서 추가 커밋의 해시가 다르다는 이유만으로 다른 코드의 실행 결과를 섞은 것은 아니다. 제출본의 on-client tree가 위 값과 같은지, 재현 이후의 변경이 이 다섯 문서뿐인지 대조한다.

10월 24일의 기록은 [기존 재현 문서](STUDENT_REPRODUCTION.md)에 보존한다. 그 회차의 성공 수치·실행 환경·과거 커밋을 이번 회차의 실행 결과로 합산하지 않는다. 새 문서가 포함된 최종 커밋 자체를 다시 실행했다는 주장은 하지 않는다.

## 2. 환경·원문·설치 확인

이번 회차는 AI 도구가 **같은 Windows PC의 새 폴더**에서 실행한 기록이다. 학생이 다른 PC에서 직접 수행한 재현이나 서버 운영자의 실행 검증으로 표현하지 않는다.

| 항목 | 확인 결과 | 확인 방법 |
|---|---|---|
| 런타임 | Node.js **v24.22.1**, win32/x64 | 실제 실행 런타임 조회 |
| 선언된 Node 버전 | on-client/package.json의 **24.19.0** | 원문 대조. 이번에 이 버전으로 재실행한 것은 아님 |
| 실행 도구 조건 | Node 주 버전 22~24 허용 | start-alekov.ps1 대조. v24.22.1에서는 기준 버전 차이 안내 후 실행됨 |
| 셸 | PowerShell **7.6.5**, Windows PowerShell **5.1.26100.9711** | 버전 조회. 실행 도구는 Windows PowerShell로 실제 실행 |
| Git | **2.53.0.windows.3** | git --version |
| 브라우저 | ChatGPT 앱 내 브라우저 | 실제 화면 조작. 정확한 브라우저 엔진 버전은 미확인 |
| 기본 로컬 앱 설치 | **추가 npm 설치 없음** | on-client/package.json에 외부 npm 의존성·설치 스크립트가 없으며, 자체 lock 없음. node_modules 없는 새 clone에서 실제 시작 |
| 저장소 루트 | package.json·package-lock.json 및 기존 의존성 보존 | 루트의 빌드·자료실 API용 의존성은 로컬 on-client 실행과 구분. 이번 회차에 npm ci·Vercel 재배포는 미실행 |
| 비밀 설정 | 실제 .env·Vault·인증서·개인 설정 복사 없음 | Git 원문만 clone. .env.example은 비밀값 없는 견본이며 자동 로드되지 않음 |

실제로는 원래 로컬 저장소를 대상으로 `git clone --no-hardlinks --no-checkout`을 수행하고 위 40자리 커밋을 detached HEAD로 checkout했다. 이 clone의 origin은 로컬 원본 경로다. 제출 저장소는 위 GitHub 주소이며, 원격 주소를 로컬 clone의 origin과 혼동하지 않는다. 시작 전 `git status --short`는 빈 결과였다. 문법 검사 `node --check on-client/student/extension.mjs`, `node --check on-client/src/server.mjs`도 성공했다.

다른 사람이 같은 원문을 받는 절차는 다음과 같다. **기존 저장소 밖의 부모 폴더**에서 새 PowerShell을 연다. `keshev-step22-20261028`이 이미 있으면 삭제하지 말고 다른 새 폴더 이름을 선택한다.

```powershell
node --version
git --version
git clone --no-checkout --single-branch --branch main https://github.com/wngud7971-cyber/choi-bujang-secret-vault.git keshev-step22-20261028
if ($LASTEXITCODE -ne 0) { throw 'clone 실패. 기존 폴더를 보존하고 연결 상태를 확인하세요.' }
Set-Location -LiteralPath .\keshev-step22-20261028
git checkout --detach 03aee7a2710faa8b1a19037f454e77f7570f10cd
if ($LASTEXITCODE -ne 0) { throw '재현 대상 커밋을 확인하지 못했습니다.' }
git rev-parse HEAD
git rev-parse HEAD:on-client
git status --short
```

위 원격 clone 명령은 이동 가능한 안내다. 이번에 직접 실행한 clone은 로컬 원본을 사용했다. 최종 문서까지 받으려면 `git checkout --detach` 뒤에 제출 화면의 **최종 문서 커밋**을 사용한다. 두 경우의 실행 앱 tree는 위 값과 같아야 한다.

## 3. 시작·브라우저·종료·재실행

새 clone의 Git 최상위에서 다음을 실행한다. 기존 서버와 저장하지 않은 작업을 보존한다.

```powershell
Set-Location -LiteralPath .\on-client
node --check .\student\extension.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1
```

기본 주소는 **http://127.0.0.1:5189/** 이다. 정상 시작 신호는 `케셰브가 켜졌습니다. 브라우저에서 ... 을 여세요.`와 서버 응답 확인 안내다. Node 버전 차이 안내와 실제 연결 성공은 구분한다. 포트가 사용 중이면 다른 프로그램을 종료하지 말고 `-Port 5197`처럼 비어 있는 포트를 지정한다.

이번 실제 실행은 기존 서버와 충돌하지 않도록 다음 두 명령을 사용했다. 도구가 실행한 자식 프로세스만 나중에 종료했으며, 사용자 본인의 Ctrl+C 수행으로 기록하지 않는다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1 -Port 5197 -Background
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1 -Port 5198 -Demo -Background
```

| 순서 | 실제 관찰 | 시각 (2026-10-28 KST) |
|---|---|---|
| 원문·모의 표시 | 새 clone의 정확한 HEAD·app tree, 학생 표시 함수의 모의 DOM 8개와 21단계 파일 존재 점검 1개 완료 | **10:40:42~10:40:43** |
| 로컬 HTTP | 임시 포트 **57841**에서 기본·demo 서버 실행, 정적 파일 200, 진단 200, 기본 me=503/ENGINE_NOT_CONNECTED, demo me=200, OSV=not_configured | **10:41:30** |
| 정상/거절 경계 | demo library=allow, repository=deny. Origin 없는 접근 POST는 **403**으로 거절 | **10:41:30** |
| 기본 브라우저 | 5197의 보호 현황·보안 엔진 미연결, 업무 앱의 요청 전 안내, 아래 방향키로 보안 기록 선택 확인 | **10:47 전후** |
| 예제 브라우저 | 5198의 demo 표시, 연습 사용자·기기 unknown·세션 active 확인 | **10:50:44** |
| 앱 판정 | library의 접근 허용(allow)·사유·시각 확인. Tab으로 repository 버튼 이동 후 Enter로 접근 거부(deny)·사유·시각 갱신 확인 | **10:50:56 / 10:51:02** |
| 사건 상세·필터 | event-01의 e-01·rule-01·denied/active/unknown 확인. 업무 앱 필터를 repository로 바꾸면 기존 상세가 닫힘 | **10:51 전후** |
| 종료 후 실패 | 이번에 시작한 demo 서버만 종료 후 「다시 불러오기」. NETWORK_ERROR의 로컬 연결 실패와 이전 사건·상세 제거 확인 | **10:51~10:52** |
| 진단 | 기본 서버에서 「연결 진단 도움정보」→「도움정보 불러오기」. 조회 전 복사 비활성화, 조회 후 활성화. 실제 클립보드 복사는 누르지 않음 | **10:52:25** |
| 같은 포트 재실행 | demo를 같은 명령·5198로 재실행 후 「다시 불러오기」. event-01의 1건 표시가 돌아오고 이전 상세·필터 선택을 최신 결과로 재사용하지 않음 | **10:52:52** |

HTTP 검사는 Node 직접 실행으로 기본·demo 프로세스를 번갈아 시작하고 종료한 자동 검사다. 실행 도구와 브라우저 검사는 그 뒤 별도로 수행했다. 일반 사용자의 전경 실행 종료는 해당 서버 창의 **Ctrl+C**, 재실행은 같은 실행 도구 명령이다. 이번 회차에서 전경 Ctrl+C는 미확인이다. 앱의 보안 검사를 끄거나 정책·인증 설정을 바꾸지 않았다.

실행 제한 안에서 로컬 접속이 되지 않았던 첫 시도는 시작 실패로 남겼다. 같은 원문·같은 검사 명령을 로컬 실행 권한이 허용된 환경에서 다시 실행했을 때 위 응답을 확인했다. 이를 앱 소스 수정이나 계정 연결 성공으로 기록하지 않는다.

## 4. 13~21단계별 결과와 근거

아래 결과는 전부 **03aee7a2710faa8b1a19037f454e77f7570f10cd** 회차다. 모의 DOM 검사는 실제 `createStudentView()`의 표시 함수를 호출하되 가상 DOM·자료를 사용했으며 외부 fetch를 금지했다. 과거 공식 통과 결과를 이번 실행의 성공 수치에 더하지 않는다.

| 단계 / 실제 함수·문서 | 확인한 결과·종류 | 확인 시각 KST | 미확인·제한 |
|---|---|---|---|
| 13 / renderIdentity | 모의 표시의 신원·원래 코드, 실제 demo 신원·unknown/active와 기본 조회 실패 | 10:40 / 10:50 | 실제 계정·기기 검증 아님 |
| 14 / renderDecision | 모의 allow/deny/challenge/unknown·요청 실패 구분. 실제 demo allow/deny와 키보드 요청·이유·시각 갱신 | 10:40 / 10:41 / 10:50~10:51 | challenge/unknown 실제 서버 결과·실제 앱 접속 미확인 |
| 15 / renderEvents | 모의 필터 0건·오류 시 상세 제거. 실제 사건 상세·필터 변경·서버 정지 후 제거·재실행 후 복구 | 10:40 / 10:51~10:52 | 운영 XDR 경보 조회 미확인 |
| 16 / renderStatus | 모의 loading/empty/error·알림·진단 복사 제한. 로컬 진단 HTTP와 제공 화면의 복사 활성화 조건 | 10:40 / 10:41 / 10:52 | 학생 복사 버튼의 실제 클립보드 기록·과거 전체 세션 조회 미실행 |
| 17 / renderAiConnection | 모의 시험 연결·점검 실패, 사건 설명 미실행 안내 | 10:40 | 계정 승인·AI 앱 승인·실제 모델 요청 미실행 |
| 18 / renderExplanation | 모의 근거 ID·규칙 대응과 없는 근거 거절 | 10:40 | 유료 AI 설명 요청·실제 모델 응답 미실행 |
| 19 / renderAction | 모의 ACK/pending·unknown·effectApplied 구분. 브라우저의 미실행과 집행 버튼 비활성화 | 10:40 / 10:51 | **공식 안내상 실제 집행 연결 미준비**. 조치 준비·실집행·효과 관측 미실행 |
| 20 / renderVulnerabilities | 모의 정확한 버전·출처·시각·부분 ID 보존·오류 후 이전 표시 제거. 로컬 서버 not_configured | 10:40 / 10:41 | 외부 OSV 조회·패키지 승인 목록 변경 미실행 |
| 21 / README·STUDENT_RUNBOOK | 실행 진입점·의존성·설정 견본 대조, 새 clone의 Node·실행 도구·HTTP·브라우저·종료/재실행 | 10:40~10:52 | 새 PC·다른 OS·전경 Ctrl+C 미확인. 21단계 main 통과는 사용자 보고 |

정확한 모의 보고서 완료 시각은 `2026-10-28T01:40:43.226Z`, HTTP 보고서 완료는 `2026-10-28T01:41:30.447Z`이다. 도구 원시 기록은 Git 프로젝트 밖 `submission-files/step22-20261028-03aee7a-mocks.json`, `submission-files/step22-20261028-03aee7a-http.json`에 남겼다. 그 파일이 없는 다른 PC에서도 위 표의 대상 커밋·절차·관찰값을 읽을 수 있도록 주요 근거를 이 문서에 기록했다. 이 두 로컬 파일을 제출 필수 조건으로 추가하지 않는다.

## 5. 현재 구성·데이터 보존·복원

현재 원문에는 앞 단계의 표시 함수 외에 PC 관측·연결 상태 보기와 Vercel 웹 빌드가 포함돼 있다. 브라우저는 `on-client/public/app.js`를 실행하고, 로컬 서버 `on-client/src/server.mjs`에 요청한다. 신원·업무 앱·기록은 engine/adapter, AI는 connection/ai, 조치는 actions, OSV는 vulnerabilities 모듈이 담당한다. PC 관측은 `src/pc-status.mjs`, 읽기 전용 Windows 정보는 `src/connection-status.mjs` 경로다. 여기서 src는 **on-client 내부**를 뜻한다.

| 대상 | 보존·백업 | 복원 방법과 제한 |
|---|---|---|
| 전체 원문·기록 | main과 Git 기록에 기존 1~20·XDR 보존. 원래 미커밋 기능 작업은 이번 문서 커밋에 포함하지 않음 | 새 빈 폴더에 실제 커밋을 clone. 기존 폴더에 새 ZIP을 덮어쓰거나 reset으로 작업을 지우지 않음 |
| 현재 화면·선택·필터 | 메모리 상태. 영구 데이터 백업으로 취급하지 않음 | 최신 서버 재조회로 다시 구성. 이번에 서버 정지 후 이전 표시 제거와 재실행 복구 확인 |
| PC 관측 기록 | `on-client/.local/pc-status/history.jsonl`. Git 제외. 원래 PC 기록은 재현 폴더로 복사하지 않음 | 별도 보호된 보관이 필요하면 자기 서버를 종료한 뒤 해당 폴더를 별도 백업. 동일 PC의 같은 형식으로 복원 후 시각을 대조. 이번에 실제 파일 백업·복원은 미실행. 다른 PC 과거값을 현재 실측으로 해석하지 않음 |
| 원천 사용자·메모·기기·세션·XDR 자료 | 기존 DB·접근 제어 시스템의 승인된 보존 정책. clone에 실제 DB를 복사하지 않음 | 원천 운영자의 백업·복원 절차 필요. 소스 clone만으로 사용자 데이터·권한은 복원되지 않음 |
| SQLite 조치 감사 이력 | 담당자가 승인한 DB 일관성·감사 보존 절차. 기본 실행은 조치 연결 비활성화 | pending/unknown 및 원천 효과 대조 필요. 감사 기록 삭제·자동 재집행 금지. 이번 DB 백업·복원·집행 미실행 |
| 계정 연결 registry·Vault·개인 설정 | Git·문서·일반 ZIP에서 제외. 실제 .env 대신 값 없는 .env.example만 원문에 포함 | Windows 사용자에 결속된 Vault를 다른 PC로 무작정 복사하지 않음. 공식 재승인·재연결 필요. 실제 이전 미실행 |
| 빌드 산출물 | web-build·node_modules 등은 제외 규칙 유지 | 루트 lock과 빌드 절차로 별도 재생성. 이번 회차는 루트 의존성 설치·Vercel 배포·운영 주소 검사 미실행 |

demo의 신원·판정·사건은 합성 자료다. 현재 앱은 demo에서도 별도의 **실제 PC 읽기**를 할 수 있으므로 PC 관측까지 모두 예제라고 적지 않는다. CPU·메모리·C:의 측정 시각과 표시 존재는 브라우저에서 보았지만 수치·장치명·주소·원시 Windows 로그를 제출 문서로 옮기지 않는다. 로컬 읽기 성공은 침해 없음이나 방어 효과 증명이 아니다.

## 6. 남은 범위와 제출

- 이번 릴리스는 **검증 중인 버전**이다. 22단계 AI 원문 통과는 실제 운영 인증·v1.0 인증·서버 실행 검증이 아니다.
- 0.2.21 업데이트, native 계정 연결, AI 승인·모델 요청, 실제 보안 조치, 외부 OSV, 원천 DB 복원은 이번에 수행하지 않았다. 기본 연결 없음은 이러한 성공의 대체 증거가 아니다.
- 다른 OS·다른 PC·설치형 앱은 미확인이다. 현재 원문은 시작 틀 0.2.11이므로 새 안내의 자동 계정 준비 기능이 이미 적용됐다고 쓰지 않는다. 업데이트가 필요하면 공식 보존 도구의 미리보기로 충돌부터 확인하며, 기능 수정 중인 제공 파일을 강제 덮어쓰지 않는다.
- GitHub에 문서를 commit·push한 뒤 **저장소 주소와 최종 40자리 커밋**으로 22단계에 제출한다. 최신 운영 안내상 제출을 위해 업데이트 도구나 package-app을 실행할 필요는 없다. 원문 JSON·파일 첨부는 선택 사항이며 이번에 만들거나 제출하지 않았다.
- 서버 상태·AI 판정은 사용자가 제출 후 확인한다. 이 문서는 로컬 도구 실행·브라우저 관찰·사용자 보고·미확인 사항을 구분한 인수인계이며 공식 판정 결과를 만들어 내지 않는다.

문서 추가 후 동일 앱인지 확인하는 명령은 최종 커밋이 있는 Git 최상위에서 실행한다.

```powershell
git rev-parse HEAD
git rev-parse HEAD:on-client
git diff --name-only 03aee7a2710faa8b1a19037f454e77f7570f10cd HEAD
```

app tree는 1절의 값과 같고 변경 목록은 1절의 다섯 문서뿐이어야 한다. 실제 실행 파일이 달라졌다면 이 회차의 성공을 그대로 사용하지 말고 새 대상 커밋으로 다시 재현한다.
