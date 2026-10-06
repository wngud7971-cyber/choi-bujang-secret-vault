# BYTE BACK · 2단계 자료실

현재 로컬 구현은 메모를 공개 파일에서 제거하고 Supabase 학습 DB를 Vercel 서버 함수로 읽도록 변경한 상태입니다. 가상 메모 네 건만 사용합니다. 화면은 `GET /api/notes`를 호출하며 `data.json`과 `public/data.json`은 `{ "notes": [] }`입니다. 2단계 빌드는 공개 메모와 1단계 확인 표시를 복사하지 않고 빈 메모 JSON을 생성하며, 원본에 메모가 다시 들어가면 실패합니다. 배포 식별 JSON에도 2단계부터 1단계 확인 표시를 넣지 않습니다.

심판의 `S02_MARKER_IN_STATIC` 피드백을 반영해 정적 JSON에 남았던 1단계 표시를 제거했습니다. 자기 점검도 메모가 비어 있어도 표시가 남아 있으면 실패하도록 수정했습니다. 이 수정의 재배포와 심판 재판정은 별도로 확인해야 합니다.

## 연결 설정과 실행

1. Supabase 학습 프로젝트의 SQL Editor에서 로컬 `private/step2-notes.sql`을 실행합니다. 이 파일은 메모 본문을 포함하므로 Git에서 제외하며 정적 배포 폴더에 넣지 않습니다. `public.training_notes`의 `owner_id`는 nullable UUID이며 `auth.users` 외래키가 없습니다. RLS를 켜고 `PUBLIC`·`anon`·`authenticated`의 테이블 권한을 회수한 뒤 `service_role`에 읽기 권한을 줍니다.
2. Vercel의 해당 프로젝트 → Settings → Environment Variables에 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`를 직접 입력합니다. 후자는 Supabase의 서버 전용 Secret key이며 브라우저 공개용 접두사를 붙이지 않습니다. 값은 채팅·소스·Git·로그·제출 묶음에 넣지 않습니다. 서버는 키를 Supabase 요청의 `apikey` 헤더로만 보냅니다. [Supabase API 키 공식 안내](https://supabase.com/docs/guides/getting-started/api-keys)
3. 변경된 코드와 환경변수를 적용해 Vercel을 다시 배포합니다. `/`에는 네 카드가 보여야 하고 `/data.json`에는 메모가 없어야 합니다. `GET /api/notes`만 허용하며 다른 메서드는 HTTP 405입니다. 연결 설정 누락은 503, DB 조회 실패는 502이며 원본 오류나 키는 응답·로그에 출력하지 않습니다.

로컬 정적 빌드 확인: `node scripts/build-public.mjs --local` (`npm run build -- --local`과 같은 실행). 함수 점검: `node --test test/notes.test.mjs test/r5.test.mjs test/package-starter.test.mjs test/build-public.test.mjs`. 정적 파일만 여는 방식으로는 서버 API를 실행할 수 없습니다. 배포 빌드는 Vercel의 저장소·커밋·주소 환경변수를 검증하고 2단계 `public/aleph.json`을 만듭니다.

## 남은 약점과 확인 상태

**`/api/notes`는 아직 누구나 호출할 수 있는 공개 주소입니다.** RLS와 브라우저 DB 권한 차단만으로 서버 API 방문자를 구분하지는 못합니다. 로그인과 소유자별 접근 확인은 다음 단계에서 구현하므로 실제 자료는 넣지 않습니다. `owner_id`도 이번 단계에서는 비어 있습니다.

사용자가 SQL 실행 결과의 메모 수 4와 RLS 활성화, Vercel 환경변수 두 개의 저장을 확인했다고 알려 주었습니다. DB의 나머지 권한 검사는 도구가 직접 실행하지 않았습니다. 로컬 빌드, 서버 함수의 정상·오류·거부 동작 시험과 공개 가능한 파일의 메모 본문·비밀값 검색이 통과했습니다. GitHub 업로드·실제 재배포·배포 화면의 네 카드 확인은 이 기록 작성 시점에는 미실행입니다.

## 현재 파일 검색과 공개 API 확인 절차

`node scripts/check-note-removal.mjs`로 Git에 포함할 로컬 파일과 현재 정적 JSON을 확인합니다. 원래 가상 메모 문장은 1단계 기준 커밋의 `data.json`에서 읽어 검색하므로 검색 코드 자체에 본문을 복사하지 않습니다. SQL과 제출 묶음은 검색·공개 대상에서 제외합니다. 결과는 본문이나 비밀값 대신 검출 파일 이름만 기록합니다.

업로드와 재배포 후 `node scripts/check-note-removal.mjs --live`를 실행합니다. GitHub 기본 브랜치의 최신 커밋을 읽고 그 커밋의 모든 파일, 해당 커밋의 `public` 파일에 대응하는 현재 배포 파일을 검색합니다. 1단계 확인 표시는 원본 `data.json`·정적 파일과 실제 배포 응답에서 검색합니다. 배포된 `/aleph.json`의 커밋도 GitHub 최신 커밋과 대조합니다. `noteMatches`·`secretMatches`·`staticMarkerMatches`는 각각 빈 배열이어야 하고 `matchesGithubLatest`는 `true`여야 합니다. 접속 실패·다른 커밋·검색 일치는 통과로 기록하지 않습니다. 이 절차는 옛 커밋과 옛 배포를 삭제하지 않습니다.

공개 API의 남은 약점은 별도로 기록합니다. `npm run bundle`은 현재 배포에 인증 없이 `/data.json`, `/api/notes` GET과 POST를 실제 요청합니다. 정상은 정적 메모 0건과 API 메모 4건, 거부 결과는 POST HTTP 405입니다. GET API의 성공은 2단계의 남은 공개 접근 약점이며 방어 완성으로 표시하지 않습니다. 접속 실패는 미확인으로 남기고 응답 본문은 묶음에 넣지 않습니다. 이 자기 점검은 심판 판정이 아닙니다.

저장점 절차: 포함 파일과 비밀값 검색 결과 확인 → `git commit -m "2단계 저장점"` → `npm run bundle`. `bundle-notes.json`과 `artifacts/submission.json`, 로컬 SQL은 커밋하지 않습니다. 제출 묶음은 그 실행 시점의 배포 응답을 담으므로 실제 배포가 바뀌면 다시 생성해서 확인합니다.

**과거 공개 커밋과 과거 배포의 메모는 이번 수정으로 지워지지 않습니다.** 최신 파일에서 메모가 사라져도 과거 노출까지 해소됐다고 판단하지 않습니다. 실제 심판 접수와 판정은 포털에서 확인합니다.

## 1단계 시작 틀 R5 (이전 안내)

아래는 1단계의 공개 자료 동작을 설명하는 기존 안내입니다. 현재의 2단계 실행은 위 내용을 따릅니다.

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
