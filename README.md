# 케셰브_배주형 · 22단계 제출 검토본

학생 릴리스 **0.22.0-validation.1 · 검증 중**입니다. 수정된 22단계 문서를 main에 먼저 저장했고, 완성된 main 커밋 `91ac3ad22488a8c526daf90ae8decc4867b757f7`을 반영해 이 검토본을 구성했습니다. 브랜치는 **codex/step22-from-main**이며 on-client 전체와 21·22단계 학생 문서만 포함합니다. 전체 프로젝트는 main `91ac3ad22488a8c526daf90ae8decc4867b757f7`에 보존했습니다. main의 기능·데이터·Git 기록을 삭제하거나 검토본으로 덮어쓰지 않습니다.

[새 폴더 재현·단계별 확인·데이터 보존 계획](docs/STUDENT_REPRODUCTION.md) · [실행 설명서·글 구성도](docs/STUDENT_RUNBOOK.md) · [버전 기록](docs/STUDENT_RELEASE.json)

본인 신원·기기·세션, 선택 앱 접근 판정, 보안 기록 필터·상세, 상태·알림·진단, AI 점검·근거 설명·조치 결과, 정확한 패키지 버전별 OSV 결과를 표시합니다. 브라우저 → 제공 로컬 서버 → 명시적으로 연결한 접근 제어·XDR 시스템 / AI 게이트웨이 구조입니다. 학생 DOM과 제공 요청·인증·집행의 경계는 실행 설명서에 있습니다.

실행 조건은 Windows·Node.js 24.19.0이며 제공 launcher는 22~24를 허용합니다. 앱 시작 틀은 0.2.11, 도움정보 component는 0.1.0입니다. 외부 npm 의존성이 없어 npm 설치 단계가 없습니다. 다른 OS·다른 Node 버전·운영 native 연결은 미확인입니다.

검토 커밋을 새 빈 폴더에 clone·checkout한 뒤 저장소 최상위 PowerShell에서 다음을 실행합니다.

```powershell
Set-Location -LiteralPath .\on-client
node .\src\server.mjs
```

기본 주소는 http://127.0.0.1:5189/ 이며 ON_PORT를 지정했다면 로그의 포트로 엽니다. 종료는 실행 창에서 Ctrl+C, 재실행은 같은 폴더에서 같은 명령입니다. 기본 실행의 연결 없음과 --demo 예제 결과는 실제 연결 성공이 아닙니다. 실제 집행 연결은 미준비이며 운영 인증·유료 AI·외부 OSV·원천 DB 복원은 미확인입니다.

검토본의 최종 커밋은 새 clone에서 git rev-parse HEAD로 기록합니다. 모의 DOM·실제 로컬 HTTP·기본 화면 관찰을 구분하며, 이전 단계 통과 기록을 최종 버전 전체의 운영 성공으로 합산하지 않습니다. 22단계 AI 원문 검토 통과도 운영 인증·v1.0 자동 인증이 아닙니다.

비밀값 없는 [설정 견본](on-client/.env.example)만 포함합니다. 실제 .env·인증서·Vault·DB를 기존 폴더에서 복사하지 않습니다. 기본 Node 실행은 .env나 견본을 자동 로드하지 않습니다.
