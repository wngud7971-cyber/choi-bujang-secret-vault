# 케셰브 사용 안내

Windows에서 실행합니다. PowerShell과 Node.js 22~24가 필요합니다. 이 PC에서 확인한 버전은 Node.js 24.22.1, 시작 틀은 0.2.21입니다.

## 1. 앱 켜기

이미 앱이 켜져 있으면 아래 명령을 다시 실행하지 말고 **http://127.0.0.1:5197/** 로 들어가세요. 화면이 예전 모습이면 Ctrl+F5를 누릅니다.

새로 켤 때는 PowerShell을 열고 **아래 명령 상자 안의 다섯 줄을 처음부터 모두 복사해서 붙여 넣으세요.** 첫 줄이 실행 폴더로 이동하는 명령이므로, 마지막 줄만 실행하면 파일을 찾지 못할 수 있습니다. 제목·설명·표는 PowerShell에 입력하지 않습니다. 현재 작업 중인 검토용 사본의 경로입니다.

같은 PC의 다른 폴더에서 실행할 때는 첫 줄을 그 폴더의 `on-client` 경로로 바꿉니다. 패키지 조회용 `ON_PROJECT_DIRECTORY`는 실제 패키지가 설치된 원본 경로를 그대로 사용합니다.

```powershell
Set-Location -LiteralPath 'C:\Users\82109\Documents\ChatGPT\hackert0n\verification\alekov-0.2.21-merge-review\on-client'
$env:Path = 'C:\Users\82109\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
$env:ON_PROJECT_DIRECTORY = 'C:\Users\82109\Documents\ChatGPT\hackert0n\step22-main'
$env:ON_APPROVED_PUBLIC_PACKAGES = '["@simplewebauthn/server","@supabase/supabase-js","jose"]'
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1 -Port 5197
```

**화면에 나올 안내:** ‘케셰브가 켜졌습니다’와 접속 주소. 이 문장은 입력하는 명령이 아닙니다. 안내된 주소를 브라우저에서 열고 PowerShell 창은 그대로 둡니다. 위 Node 경로는 이 PC에서 확인한 위치이며, 다른 PC에서는 설치 위치에 맞게 바꿔야 합니다. 패키지 조회는 원본 프로젝트의 설치 폴더에서 위 세 패키지만 대조하도록 설정했습니다.

## 2. 점검하기

아래부터는 브라우저에서 할 일입니다. 보호 현황의 **보안 점검**에서 원하는 항목의 이동 버튼을 누릅니다. 이동만으로 조회가 실행되지는 않습니다.

| 점검 | 누를 곳과 확인할 내용 |
|---|---|
| 진단·알림 | **도움정보 불러오기**를 누르고 상태를 읽습니다. 필요한 경우 내용을 확인한 뒤 **확인했으며 복사합니다**를 누릅니다. |
| AI 연결 | 처음이면 **계정 연결과 AI 사용 승인**을 펼쳐 계정 연결과 AI 승인을 마칩니다. **AI 연결 점검**을 누르고 결과·모델 수·시각을 확인합니다. 이 점검은 사건 설명을 실행하지 않습니다. |
| 취약점 조회 | **설치 패키지 조회**를 누르고 패키지별 설치 버전·OSV 결과·조회 시각을 확인합니다. 조회 실패나 미조회는 ‘취약점 없음’이 아닙니다. |

CPU·메모리·C: 남은 공간은 **내 PC 상태**, 네트워크·방화벽·Windows 기록은 **연결과 기록**에서 봅니다. 보안 엔진 미연결은 PC 실측 실패와 별개입니다. 예제 자료와 확인 불가는 실제 점검 성공으로 보지 않습니다.

## 3. 막혔을 때

| 화면이나 창에 나온 내용 | 확인할 것 |
|---|---|
| 포트를 다른 프로그램이 사용 중 | 일반 사용이면 위 주소로 기존 앱을 엽니다. 종료·재실행 확인 중이면 기존 검토용 앱을 종료한 뒤 같은 5197번으로 다시 켭니다. 포트를 계속 바꿀 필요는 없습니다. |
| `tools\start-alekov.ps1` 파일을 찾지 못함 | 현재 폴더가 다릅니다. 첫 줄의 `Set-Location`부터 다섯 줄을 모두 실행합니다. |
| 로컬 서버에 연결할 수 없음 | 실행한 PowerShell 창이 닫혔는지, 오류가 있는지 확인합니다. 서버가 종료됐다면 위 명령으로 다시 켭니다. |
| `NATIVE_HOST_DISABLED` | `npm start` 대신 위 실행 도구로 켰는지 확인합니다. |
| `PROJECT_NOT_CONFIGURED` | 패키지 조회용 환경변수 두 줄을 같은 PowerShell 창에서 설정한 뒤 실행했는지 확인합니다. |

## 4. 끄고 다시 켜기

서버를 켠 PowerShell 창에서 **Ctrl+C**를 누릅니다. 화면을 새로 불러와 연결이 종료됐는지 확인하세요. 계속 응답하면 다른 서버가 남아 있을 수 있으니 중복 실행하지 않습니다. 다시 켤 때는 위 명령을 같은 순서로 사용합니다. 기존 기록이나 계정 설정을 지울 필요는 없습니다.

