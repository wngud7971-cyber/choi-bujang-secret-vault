# 케셰브 · 안내만 보고 따라 하는 실행 안내 한 장

2026-10-27 · 최종 과제 5일차 · Windows 일반 사용자용 · 설치형 앱이 아닌 로컬 웹 앱

## 1. 준비

다른 사람의 Windows PC 또는 **같은 PC의 다른 폴더/사용자 계정**에서 따라 할 수 있다. 기존 프로젝트는 그대로 둔다. **Node.js 24.22.1 LTS**와 Git을 준비하고 새 PowerShell을 연다. [Node.js 공식 다운로드](https://nodejs.org/en/download), [Git 공식 다운로드](https://git-scm.com/downloads). 관리자 PowerShell, Workbench, AI·SDP 계정 설정, 방화벽 변경은 필요 없다. 일반 권한으로 프로그램을 준비할 수 없으면 권한을 높이지 말고 오류를 기록한다.

```powershell
node --version
git --version
```

Node 기대 출력은 `v24.22.1`. 제공 시작 틀의 `on-client/package.json`에는 이전 검수 버전 `24.19.0`이 남아 있으나, 이번 실행·관련 검사 30개는 **24.22.1**로 확인했다. 다른 버전은 이번 재현의 확인 대상이 아니다. 명령을 찾지 못하면 4절을 먼저 확인한다. 이 로컬 앱에는 외부 npm 의존성이 없어 **npm install을 실행하지 않는다**.

## 2. 내려받고 실행

문서 같은 쓰기 가능한 위치에서 PowerShell을 열고 아래를 **한 줄씩 한 번만** 실행한다. `keshev-day5`는 아직 없는 폴더여야 한다. 기존 프로젝트나 제출 폴더에 덮어쓰지 않는다. `PS C:\...>` 같은 프롬프트 문구는 명령에 포함하지 않는다.

```powershell
git clone --branch codex/step22-main --single-branch https://github.com/wngud7971-cyber/choi-bujang-secret-vault.git keshev-day5
Set-Location -LiteralPath .\keshev-day5
git rev-parse HEAD
node .\on-client\src\server.mjs
```

표시된 40자리 커밋을 기록하고 전달받은 커밋과 비교한다. 명령이 실행 중인 PowerShell은 그대로 두고 **이 PC의** 브라우저에서 <http://127.0.0.1:5189/>를 연다. `127.0.0.1`은 실행한 PC 자신을 뜻한다. 시작 로그의 ‘연결 확인’은 보안 엔진 연결 성공을 뜻하지 않는다.

## 3. 화면 확인 순서

| 순서 | 누를 곳 · 확인할 결과 |
|---|---|
| ① | **보호 현황 → 내 PC 상태**: 이 PC의 CPU(%), 메모리(GiB), C: 남은 공간(GiB) 또는 항목별 ‘확인 불가’와 이유. 값의 출처·잰 시각·단위와 직전 비교를 확인한다. 두 화면이 보이는 동안 5초마다 갱신하며 다른 메뉴·숨김에서는 중지한다. |
| ② | **연결과 기록 → 다시 조회**: 읽는 중 표시 후 네트워크·프로필별 방화벽·최근 24시간 System/Application 경고·오류 건수 또는 이유가 있는 ‘확인 불가’. 조회 시각을 확인한다. Windows 건수는 침해·공격 탐지 결과가 아니다. |
| ③ | **보호 현황**: 기본 실행의 ‘보안 엔진 미연결’·‘SDP 미연결’과 방어 효과 미확인을 확인한다. PC 조회 성공은 SDP·AI 연결이나 제로트러스트·DDoS·자료 유출 방어 성공이 아니다. |
| ④ | Tab/Shift+Tab으로 버튼, 메뉴에 도착한 뒤 위·아래 방향키로 메뉴 이동, Enter/Space로 버튼을 실행한다. 다시 조회 후 성공한 항목의 시각이 갱신되는지 확인한다. |

PC 관측값은 **실행한 PC의 실측**이며 개발 PC의 값을 전달하지 않는다. 기본 명령은 예제 모드가 아니다. 예제(demo) 표시는 설명용 자료이며 실제 보안 결과가 아니다. 조회 실패를 예제·정상 0으로 대신하지 않는다. 실측 기록은 이 폴더의 `on-client/.local/pc-status/history.jsonl`에 최근 24시간분을 저장하며 Git에 포함하지 않는다. 재실행 시 남은 기록을 불러오고, 측정하지 않은 시간은 채우지 않는다.

## 4. 종료·재실행·오류 확인

- 종료: 서버를 켠 PowerShell에서 **Ctrl+C**. 같은 폴더에서 `node .\on-client\src\server.mjs`로 다시 켠다.
- 안전한 실패 확인: ‘연결과 기록’을 열어 둔 채 이 앱 서버만 Ctrl+C로 종료한다. 페이지 자체를 새로고침하지 않고 **다시 조회**를 눌러 실패 항목·이유·다음 행동과 이전 자료 표시를 확인한다. 서버를 다시 켜고 다시 조회하여 복구한다. 다른 프로그램·서비스·보안 설정은 변경하지 않는다.
- ‘git’ 또는 ‘node’를 찾을 수 없음: 명령 이름을 찾는 경로(PATH) 또는 프로그램 준비 단계 문제이며 앱 코드 오류가 아니다. 프로그램이 있어도 PowerShell에서 못 찾을 수 있다. 실제 실행 파일의 경로를 작은따옴표로 감싸고 앞에 `&`를 붙여 실행한다. **아래 경로가 존재하는 현재 개발 PC에서만** 대체 명령을 쓸 수 있다. 다른 PC에 이 경로가 있다고 가정하지 않는다.
- 폴더가 이미 있음 / 서버 파일 없음: 기존 폴더는 지우지 말고 위치와 오류를 기록한다. 내려받은 폴더 최상위에 `on-client/src/server.mjs`가 있는지 확인한다.
- `EADDRINUSE`: 다른 앱을 종료하지 않는다. 이 PowerShell에서 `$env:ON_PORT = '5190'`을 한 번 실행한 뒤 서버를 켜고 <http://127.0.0.1:5190/>를 연다. 이후에도 서버 로그의 주소를 따른다.
- 권한 부족·읽기 실패: ‘확인 불가’와 이유를 기록한다. 관리자 실행·방화벽 해제·로그 설정 변경으로 해결하지 않는다. 비밀번호·키·인증서·실제 IP/계정 정보는 오류 공유 전에 가린다.

현재 개발 PC에서 Git·Node 명령을 못 찾을 때의 대체 실행이다. PowerShell에서 원하는 상위 폴더를 연 뒤 한 줄씩 실행한다. 폴더가 이미 있으면 다시 clone하지 않는다. 설치·영구 PATH 변경은 하지 않는다.

```powershell
$gitExe = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$nodeExe = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $gitExe clone --branch codex/step22-main --single-branch https://github.com/wngud7971-cyber/choi-bujang-secret-vault.git keshev-day5
Set-Location -LiteralPath .\keshev-day5
& $gitExe rev-parse HEAD
& $nodeExe .\on-client\src\server.mjs
```

위 대체 실행으로 시작했다면 종료 후 재실행도 같은 폴더에서 `& $nodeExe .\on-client\src\server.mjs`를 쓴다. 다른 PowerShell 창에서는 변수 두 줄을 다시 실행한다.

## 5. 따라 실행한 사람이 남길 결과

`커밋 / 날짜·시각(KST) / Windows·Node 버전 / 시작·재조회·종료·재실행 결과 / 막힌 단계와 가린 오류 / 수정 후 재실행 결과`를 기록한다. 막힘이 없으면 ‘막힘 없음’, 아직 실행하지 않은 항목은 ‘미확인’으로 남긴다. 같은 PC의 별도 폴더 검사와 다른 사람·다른 PC의 실행은 구분한다. **공식 대체 방법인 같은 PC의 새 폴더 재현도 가능하며, 선택한 환경의 실행·오류 보완·재실행 결과를 확인한 뒤 5일차를 마무리한다.**

**2026-10-27 사용자 확인:** 같은 Windows PC의 `Documents/keshev-day5-self-check`에 GitHub 작업 브랜치의 `58e21b5` 버전을 내려받았다. 처음에는 PowerShell이 `git` 명령을 찾지 못했고, 도구가 확인한 Git 2.53.0.windows.3·Node 24.22.1 실행 파일의 전체 경로를 사용한 뒤 앱이 정상으로 열렸다고 사용자가 보고했다. 이어 PC 값·측정 시각 갱신, 연결과 기록의 다시 조회, Ctrl+C 종료 후 재실행과 기록 유지 **세 가지를 모두 확인했다고 응답했다**. 명령 경로를 모르는 문제를 이 안내에 반영했으며 앱 코드는 바꾸지 않았다. 이는 같은 PC의 새 폴더 재현으로 5일차 확인을 마친 기록이다. 다른 사람·다른 PC의 시험, 모든 방어 연결 또는 설치형 검증으로 확대하지 않는다.
