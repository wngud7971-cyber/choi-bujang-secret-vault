# BYTE BACK · 보너스 xdr-01 저장점

무차별 로그인 보너스는 `xdr/brute-force/`에 구현했습니다. `node xdr/brute-force/read-alerts.mjs`는 원본 28건에서 시각·출발 주소·가명 계정·규칙 수준·설명만 28줄로 출력하고 비밀값을 지웁니다. 원본 경보와 기존 ZTNA 규칙은 보존합니다. MITRE T1110·T1110.001·T1110.003의 한 줄 근거와 도구의 별도 탐지 기준은 `patterns.json`에 있습니다.

다시 실행: `npm run xdr:run -- brute-force`. npm이 없는 이 작업 환경에서는 같은 실행 파일인 `node --env-file-if-exists=.env scripts/xdr-run.mjs brute-force`를 실제로 실행했습니다. 공식 Jev의 실제 응답을 받은 최신 `result.json`은 block 10·alert 1·record 17입니다. 애매한 경보 9건 중 8건의 공격 확률이 0.5 미만이어서 record로 처리했고, 1건은 0.5 이상 0.85 미만이라 alert로 남겼습니다. 명확한 공격 10건과 원래 정상 이벤트 9건의 판단은 유지됩니다. `verification.json`은 명확한 공격의 거부 10·정상 이벤트 차단 0·정상 주소의 추가 거부 0입니다. 키가 없거나 Jev가 미응답인 재현에서는 block 10·alert 9·record 9가 됩니다. `xdr/alerts.log`에는 차단·알림의 시각·경보 번호·행동·확신도·패턴 이름만 한 줄씩 추가합니다. 이 결과는 수업용 시험 경보 재현이며 심판 판정이나 운영 반 엔진의 실제 접속 차단을 증명하지 않습니다.

`decide(alert)`는 높은 수준과 반복 실패·다계정 신호가 함께 있는 명확한 공격을 0.95로 차단합니다. 개별 실패도 같은 주소·계정의 3분 내 20건을 중복 없이 모읍니다. 애매한 이벤트에만 `jev.mjs`가 TypeSafe의 공식 Jev API `POST https://api.typesafe.ai/v1/systemone`을 호출합니다. 요청은 `model: jev-latest`, 개인정보를 제외한 `state`, 공격 여부를 묻는 `questions.brute_force`의 `type: noul`로 구성합니다. [공식 HTTP 규격](https://docs.typesafe.ai/api)에 맞춰 응답의 `answers.brute_force.noul`을 공격 확률 0~1로 읽습니다. 무관한 분류의 confidence나 이전의 임의 `{ confidence }` 응답은 사용하지 않습니다. 공격 확률을 반환의 confidence에 그대로 담아 0.85 이상은 block, 0.5 이상은 alert, 그 아래는 record로 처리합니다. Jev 오류·키 미설정·잘못된 응답·1.5초 시간초과는 confidence 0.5의 alert로 내립니다. 원본 로그·주소·계정·비밀번호는 Jev로 전송하지 않습니다. 실패 횟수·경보 수준·계정 수·시간창·실패 뒤 성공·비밀번호 변경·잠금 뒤 재시도 등의 수치와 참/거짓 신호만 보냅니다.

실제 Jev 요청에는 [TypeSafe 공식 콘솔](https://console.typesafe.ai/)에서 발급한 API 키를 XDR 명령이 실행되는 PC/서버의 `TYPESAFE_API_KEY` 환경변수로 지정해야 합니다. 로컬에서는 Git에서 제외된 `.env` 비밀 설정 파일에 사용자가 직접 입력하며, 실행 명령이 이를 읽습니다. 키를 채팅·소스 코드·Git·로그에 넣지 않습니다. 이전의 `JEV_ENDPOINT`·`JEV_API_KEY` 설정은 사용하지 않습니다. Vercel 서버 함수의 환경변수 설정만으로 별도로 실행되는 로컬 또는 심판의 명령에 키가 전달되지는 않습니다. 사용자가 키 설정을 수정한 뒤 공식 Jev API의 HTTP 200과 실제 공격 확률을 확인했고, 전체 실행의 애매한 경보 9건도 실제 응답을 받았습니다. `verification.json`의 `jev`에는 판단 요청 수·응답 수신 수·미응답 알림 수가 있으며, 최신 실서버 시험은 각각 9·9·0입니다. 명령 출력에도 이 수를 표시합니다. 키 없는 미응답 시험과 공식 형식의 모의 응답 시험은 이 실서버 시험과 별도로 수행했습니다. 로컬 `.env`와 상세 연결 점검 파일은 Git 및 업로드 묶음에서 제외합니다.

실행기는 모듈의 `afterRun`으로 block·확신도 0.85 이상·유효한 주소·계정·시각·일치하는 패턴 근거를 갖춘 후보만 `deny-rules.json`에 별도 저장합니다. 정상 이벤트는 규칙에서 제외합니다. 규칙은 출발 주소·근거 경보 번호·시작·만료 시각을 갖고, 경보 시각부터 15분만 유효합니다. 과거 시험 경보를 실행한 현재 시각으로 만료를 연장하지 않습니다. `src/decider.mjs`는 `src/xdr-policy.mjs`를 통해 유효한 XDR 규칙을 기존 규칙보다 먼저 확인합니다. `RULE_IDS`에는 기존 `starter.deny`와 추가한 `xdr.brute_force.deny`가 있습니다. 기존 거부 코드 `starter_not_ready`와 기존 규칙의 판단은 유지하고, XDR 거부는 추가 규칙 이름으로 구분합니다.

서버 연결 입구는 `src/ztna.mjs`의 `decideFromTransport(verifiedRequest, incomingMessage)`입니다. 서버가 확인한 소켓 출발 주소를 요청별 비동기 문맥으로 넘겨 `decide(request)`의 18항목 요청·다섯 항목 응답 계약을 유지합니다. 브라우저 본문과 전달 헤더의 주소는 사용하지 않습니다. 규칙이 없거나 만료된 주소는 기존 판정으로 넘깁니다. 기본 `starter.deny`는 계속 모든 요청을 거부하며 보너스가 허용 권한을 새로 주지 않습니다. 허용 가능한 가상 기존 판정기를 붙인 시험에서 정상 요청 통과와 공격 주소 거부를 확인했습니다. `afterRun`은 같은 연결 입구와 실제 `src/decider.mjs`를 호출하여 명확한 공격 10건의 추가 거부와 정상 경보 9건의 기존 판정 전달을 검증합니다. 기록된 결과는 경보 시각을 기준으로 한 로컬 재현이며 운영 반 엔진에 배포했다는 의미는 아닙니다. 메모 API·DB·5단계 설정은 보존합니다.

로컬 확인: `node --test test/brute-force.test.mjs test/xdr-run.test.mjs` (20개 통과), `node --test test/*.test.mjs` (기존 기능 포함 54개 통과), `node scripts/build-public.mjs --local` (빌드 성공), `node scripts/check-note-removal.mjs` (공개할 파일 66개에서 메모 본문·비밀값·정적 표시 검출 0건). 원본 불변·비밀값 제거·분류·공식 Jev 요청과 Noul 응답·실패·확신도 경계·시간창·중복·주소/계정 분리·만료·정상 요청 보존·기존 거부 보존·실행기 처리 후 실제 판정기 연결·동시 요청 분리·Jev 응답 통계를 확인합니다. GitHub에는 최신 수정본을 올리고, 보너스 창의 기존 Vercel 주소와 공개 GitHub 주소로 제출합니다. 정상 결과는 record와 추가 거부 없음, Jev 미응답은 alert, 명확한 공격의 결과는 block와 유효 기간 중 주소 거부입니다. 실제 심판의 접수·점수는 아직 확인하지 않았습니다.

## 5단계 저장점

브라우저 메모 읽기·추가·수정·삭제는 기존 Vercel 서버 함수만 사용합니다. 서버의 토큰 검증·소유자 검사·서버 전용 환경변수는 유지했습니다. 제작 1의 브라우저 직접 자료 호출은 없었습니다. 이후 100점 추가 조건을 위해 화면의 실제 Supabase 공개 키를 제거하고 인증 요청도 서버 함수로 보냅니다.

100점 추가 조건: 배포 `aleph.json`에 기존 메모 `allowedRoutes`와 `originalApiUrl`을 포함합니다. `vercel.json`에 사용자가 작성한 전체 경로의 `X-Content-Type-Options: nosniff`를 보존했습니다. 화면에는 실제 프로젝트 공개 키나 서버 키를 두지 않습니다. 기존 공식 SDK의 비밀번호 로그인·세션 저장·갱신·로그아웃은 유지하고 전송만 `/api/auth/:action`으로 변경했습니다. 초기화의 `server-auth-proxy`는 자격 증명이 아닌 SDK용 자리표시자이며 Supabase로 전달하지 않습니다. `/api/auth/:action`은 비밀번호 로그인·토큰 갱신·본인 정보·현재 세션 로그아웃만 허용하며 관리자 기능·회원 가입·자료 API·임의 주소 중계는 거부합니다. 서버는 기존 `SUPABASE_URL`·`SUPABASE_SECRET_KEY`를 사용하고 오류 원문·키·비밀번호를 응답이나 로그로 내보내지 않습니다. 정상 세션 토큰은 기존 SDK의 세션 처리에만 사용합니다. DB 권한 변경이나 추가 환경변수 설정은 필요하지 않습니다.

사용자가 학습 DB에서 `docs/STEP5_DATABASE.sql`을 실행한 결과 표를 제공했습니다. 적용 후 `anon`·`authenticated`의 테이블 CRUD·추가 권한·열 접근은 모두 false, PUBLIC 권한은 false, RLS는 true이며 `service_role`의 CRUD는 모두 true로 유지됩니다. 이 SQL은 `public.training_notes`만 대상으로 하며 메모·소유자·기존 정책·다른 테이블·서버 역할의 개별 권한을 보존합니다. 검사 실패 시 전체 트랜잭션이 취소됩니다.

사용자는 실제 배포 화면에서 A의 추가·수정·삭제 정상 동작, B 목록에 B 메모만 표시되고 A 메모는 없는 것, 로그아웃 후 `/api/notes`의 `LOGIN_REQUIRED` 응답을 확인했습니다. 도구가 브라우저 publishable 키만으로 원본 Data API를 직접 조회한 결과 HTTP 401·권한 오류 `42501`이었고 메모 배열은 반환되지 않았습니다. 이 확인은 심판의 anon 키 시험과 별도입니다. 실제 B의 A 메모 단건 조회·수정·삭제 요청과 authenticated 토큰 직접 Data API 요청은 미실행입니다.

`aleph.config.json`은 5단계이며 `originalApiUrl`에 학습용 `training_notes`의 쿼리 없는 원본 HTTPS 경로를 기록했습니다. 기존 저장소·배포 주소·발급자·대상·JWKS·허용 경로·운영 측 `judgeIssuer`는 유지합니다. 빌드와 배포 식별 JSON은 1~5단계를 지원하며 공개 메모 JSON은 빈 배열입니다. 판정기 규칙은 실제 기존 구현인 `starter.deny`만 유지합니다.

다시 실행: `node scripts/build-public.mjs --local`. 로컬 확인: `node --test test/notes.test.mjs test/auth-ui.test.mjs test/auth-gateway.test.mjs test/r5.test.mjs test/package-starter.test.mjs test/build-public.test.mjs` (34개 통과). 실제 SDK와 가상 인증 응답으로 로그인·갱신·로그아웃·인증 중계 제한을 검사합니다. 가상 인증·메모 시험은 실제 DB 권한이나 심판 판정을 대신하지 않습니다. 권한 확인 SQL과 전후 결과 설명은 `docs/STEP5_DATABASE.sql`에 있습니다. 4단계 SQL은 authenticated 직접 CRUD 권한을 다시 부여하므로 5단계 적용 후 재실행하지 않습니다.

저장점 커밋 후 `npm run bundle`로 `artifacts/submission.json`을 생성합니다 (npm이 없는 이 실행 환경에서는 동일한 `node scripts/bundle.mjs` 사용). 자기 점검은 실제 배포의 공개 JSON, 무로그인 다섯 경로, 가상 서명 거부, 배포 단계·저장점 커밋 일치, 배포 HTML·인라인 코드의 공개 키·비밀값·시드 표식 패턴, 첫 화면 보안 헤더, 배포 허용 경로를 확인합니다. 화면에서 공개 키를 제거했으므로 직접 원본 조회 재시험은 서버 점검 환경의 선택적 `SUPABASE_PUBLISHABLE_KEY`가 없으면 미실행으로 남깁니다. 이 점검용 설정은 앱의 정상 동작에 필요하지 않고 키는 소스·출력·묶음에 넣지 않습니다. 미실행 계정·anon 키 검사는 미실행으로 남깁니다. 응답 본문·메모·토큰·키는 제출 묶음에서 제외하고 `bundle-notes.json`·`artifacts/submission.json`은 커밋하지 않습니다.

사용자가 5단계 파일을 GitHub 웹에서 업로드하고, 배포 식별 JSON의 단계 5·공개 JSON의 빈 메모 배열·화면 기능 확인을 완료했다고 알려 주었습니다. 이어 제공한 심판 결과는 50/100점이며 원본 조회 항목에 `S05_ORIGINAL_URL_MISSING`이 기록됐고 직접 수정·정적 키 검색 항목은 격파로 표시됐습니다. 원인은 설정의 `originalApiUrl`이 배포 `aleph.json` 생성 결과에 포함되지 않았던 누락입니다. 생성 도구에 해당 필드를 추가하고 실제 빌드 출력으로 이를 검사하는 시험을 보강했습니다. 원본 주소 수정 및 100점 추가 조건 변경의 업로드·재배포·재판정은 아직 미확인입니다. 업로드·재배포 후 `/aleph.json`의 단계 5·원본 주소·허용 경로, 첫 화면 보안 헤더와 키 제거, A/B 로그인·본인 CRUD·로그아웃·무로그인 거부를 확인하고 같은 Vercel 주소로 다시 제출합니다. GitHub 웹 업로드의 원격 커밋은 로컬 커밋과 다를 수 있으므로 커밋 일치 점검을 자동 통과로 기록하지 않습니다.

## 4단계 저장점 (이전 기록)

4단계의 자료 API는 검증된 사용자 ID와 `training_notes.owner_id`를 DB 요청에서 함께 비교합니다. 목록·단건 조회·수정·삭제는 본인 행만 허용하며, 다른 소유자와 소유자 없는 행의 단건 요청은 메모 없이 HTTP 404로 거부합니다. 추가는 확인된 사용자 ID를 소유자로 저장하고, 수정은 제목·본문만 갱신해 기존 소유자를 유지합니다. 수정 본문에 `owner_id`가 있으면 HTTP 400 `OWNER_CHANGE_NOT_ALLOWED`로 거부합니다. URL·본문·사용자 지정 헤더의 신원 정보는 인증 근거가 아닙니다. 기존 로그인·로그아웃과 응답 형식은 유지합니다.

사용자가 학습 DB의 기존 가상 메모 세 건을 A에게 연결하고 B 시험 메모 한 건을 추가한 결과 화면을 제공했습니다. 기존 네 번째 메모는 보존하도록 SQL을 제안했습니다. 사용자는 `docs/STEP4_RLS.sql` 실행 결과도 제공했습니다. 적용 후 `anon`의 네 작업 권한은 모두 false, `authenticated`는 SELECT·INSERT·UPDATE·DELETE만 true, 추가 권한과 권한 재부여는 false, RLS는 true입니다. SQL은 해당 메모 테이블의 기존 정책을 교체해 SELECT·DELETE는 기존 행 USING, INSERT는 새 행 WITH CHECK, UPDATE는 두 조건 모두 `auth.uid() = owner_id`로 제한합니다. 다른 테이블·메모 내용·서버 역할 권한은 변경하지 않습니다. 이 화면은 권한 설정 확인이며 실제 A/B 요청이나 심판 판정은 아닙니다.

`aleph.config.json`은 4단계이며 기존 저장소·배포 주소·Supabase 발급자·대상·JWKS와 운영 측 `judgeIssuer`를 유지합니다. 실제 경로는 GET·POST `/api/notes`, GET·PUT·DELETE `/api/notes/:id`입니다. 1~4단계 빌드가 지원되며 공개 JSON은 계속 빈 메모 배열입니다. 판정기는 기존에 실제 구현된 `starter.deny`만 기록하며 6단계 정책을 추가했다고 주장하지 않습니다.

다시 실행: `node scripts/build-public.mjs --local`. 로컬 가상 시험: `node --test test/notes.test.mjs test/auth-ui.test.mjs test/r5.test.mjs test/package-starter.test.mjs test/build-public.test.mjs`. 시험에는 가상 서명 신원과 메모만 사용합니다. A/B의 본인 CRUD, 양방향 상대 메모 조회·수정·삭제 거부, 학생 신원의 심판 소유 메모 거부, 소유자 변경 거부와 로그인·로그아웃 회귀를 검사합니다.

저장점 커밋 후 `npm run bundle`로 제출 JSON을 생성합니다. 자기 점검은 현재 배포의 공개 JSON·무로그인 다섯 경로·가상 서명 토큰 거부 응답과 배포 식별 JSON만 실제 요청합니다. 실제 A/B CRUD·교차 소유자 요청·소유자 변경·발급자의 만료/다른 대상 토큰·anon 키의 직접 Data API 요청은 실행 전까지 미실행으로 기록합니다. authenticated 역할 직접 접근은 점수 확인에 포함하지 않습니다. 묶음은 메모 본문·토큰·이메일 없이 파일명과 요약만 포함하며 `bundle-notes.json`, `artifacts/submission.json`과 로컬 메모 SQL은 커밋하지 않습니다.

현재 로컬 4단계 변경의 GitHub 업로드·실제 재배포·심판 접수/판정은 미확인입니다. 제출 JSON이 생성되어도 4단계가 배포되었다는 뜻은 아닙니다. 업로드와 배포 후 자료실에서 A/B 각각 로그인 → 본인 메모 읽기·추가·수정·삭제 → 로그아웃을 확인합니다. B 로그인 목록에 A 메모가 없어야 하며, 상대 메모 상세 URL을 직접 요청해도 404여야 합니다. 배포 식별 JSON의 단계·커밋이 저장점과 일치하는지 확인한 뒤 제출 묶음을 다시 생성합니다.

## 3단계 저장점 (이전 기록)

Supabase Auth 이메일·비밀번호 로그인과 로그아웃 화면을 붙였고, `api/notes.js`는 기존 `src/verify-login.mjs`를 변경 없이 사용해 요청 토큰을 검증합니다. 토큰이 없거나 유효하지 않으면 메모 없이 HTTP 401로 거부하며 브라우저의 `userId`·`role`은 신원으로 사용하지 않습니다. 로그인 뒤에는 Authorization 헤더로 SDK의 접근 토큰을 보내 자료를 조회합니다. 로그아웃하면 화면의 메모를 지우고 이전 요청의 늦은 응답도 폐기합니다.

`aleph.config.json`은 3단계이며 `identityProvider`에 Supabase 발급자·대상·JWKS 공개 주소를 기록했습니다. `judgeIssuer`는 기존 값을 유지합니다. 공개 정적 JSON은 계속 빈 메모 배열만 포함하고, 빌드는 3단계를 지원합니다. 화면에는 공개용 publishable key만 사용하며 서버 전용 키는 기존 Vercel 환경변수에서 읽습니다.

로그인한 계정의 가상 메모 추가·수정·삭제 화면과 서버 API를 구현했습니다. `POST /api/notes`는 `{id,title,body}`를 받고 ID가 없으면 UUID를 생성해 HTTP 201 `{id}`를 반환합니다. 서버가 검증한 사용자 ID만 `owner_id`로 저장하며 브라우저의 소유자 정보는 무시합니다. `GET /api/notes`는 본인 메모 배열을 반환합니다. `GET /api/notes/:id`와 `PUT /api/notes/:id`는 `{id,title,body}`, `DELETE /api/notes/:id`는 `{id}`를 반환하며 삭제 이후의 단건 조회는 404입니다. DB의 기존 `content` 열은 API의 `body`로 변환하고 새 메모의 필수 `position`은 0으로 저장합니다. 실제 다섯 경로를 `allowedRoutes`에 기록했습니다.

Supabase SQL Editor에서 `docs/STEP3_DATABASE.sql`을 실행해 서버에 읽기·추가·수정·삭제 권한을 부여합니다. 사용자가 실행 결과의 서버 권한 네 항목과 브라우저 접근 차단 두 항목이 모두 true인 화면을 제공했습니다. 브라우저의 테이블 직접 접근은 계속 차단하며 기존 DB 메모는 삭제·재배정하지 않습니다. 기존의 소유자 없는 네 메모는 DB에 보존되지만 개인 목록에는 포함되지 않습니다. 새 A 계정의 목록이 비어 있는 것은 정상이며 직접 만든 가상 메모부터 표시됩니다.

3단계에서는 소유자 검사를 목록에만 적용합니다. 로그인한 B가 A 메모의 ID를 알면 단건 조회·수정·삭제할 수 있다는 허점을 유지했으며, 로컬 가상 시험에서도 이를 확인합니다. 실제 B 계정 접근 시험은 미실행이고 4단계에서 기록·차단합니다. 서버는 무로그인 요청을 모든 메서드에서 자료 없이 401로 거부합니다. 사용자는 실제 배포에서 A 계정의 추가·수정·삭제 완료를 확인했고, 로그인·메모 추가·로그아웃·무로그인 API의 LOGIN_REQUIRED 응답 화면을 제공했습니다. 도구가 실제 A 계정 토큰으로 직접 시험한 것은 아니며 심판 접수·판정은 미확인입니다.

실행 확인: `node scripts/build-public.mjs --local`. 로컬 시험: `node --test test/notes.test.mjs test/auth-ui.test.mjs test/r5.test.mjs test/package-starter.test.mjs test/build-public.test.mjs`. 시험 토큰과 공개키는 시험 중 생성하며 실제 계정·서버·심판을 사용하지 않습니다. 실제 화면에서는 로그인 후 가상 메모 추가 → 수정 → 삭제 → 로그아웃을 확인하고, 시크릿 창에서 `/api/notes`가 메모 없이 거부되는지 확인합니다.

저장점 확인 후 `npm run bundle`로 제출 묶음을 생성합니다. 3단계 자기 점검은 실제 배포의 공개 JSON, 무로그인 목록·추가·단건 조회·수정·삭제와 자체 서명한 가상 토큰의 거부 응답만 기록합니다. 응답 본문·메모·토큰은 묶음에 넣지 않습니다. 실제 A 계정의 도구 시험과 실제 발급자의 만료·다른 대상 토큰 시험은 미실행으로 표시합니다. 이는 심판 판정이 아니며, 로컬 저장점 커밋과 배포 커밋이 같다고 가정하지 않습니다. GitHub 업로드로 생긴 원격 커밋과 로컬 저장점 커밋은 별도 확인이 필요합니다.

## 2단계 기록 (이전 구현)

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
