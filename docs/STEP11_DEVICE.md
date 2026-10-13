# 11단계 · 기존 자료실의 서버 기기 승인과 요청 서명

기존 BYTE BACK 자료실·Supabase 로그인·메모/공지/복구 API를 유지하고, 그 API 앞에 서버 기기 승인·WebAuthn 증명 검사를 추가합니다. 기존 18항목 판정기 요청과 5항목 응답은 변경하지 않습니다. 공식 엔진의 기기 등록부와 이 자료실의 등록부가 연결됐다고 주장하지 않습니다. 이 구현의 공식 심판 서명 형식과 호환성은 미확인입니다.

## 등록과 운영자 승인

1. 기존 학습 Supabase **SQL Editor → New query**에서 `STEP11_DATABASE.sql` 전체를 한 번 실행합니다. 2026-10-13 사용자가 프로젝트 재개 후 **Success. No rows returned** 결과를 보고했습니다. 도구가 직접 운영 DB의 설정/권한을 검증하지는 않았습니다. 기존 메모·공지·백업·감사·권한은 교체하지 않습니다. 새 기기 등록부·일회용 challenge 저장소·추가 감사 저장소만 만듭니다. DB 미설정은 503으로 중단합니다.
2. 기존 HTTPS 배포 주소에서 로그인하고 **기기 승인 요청**을 누릅니다. 운영체제의 기기 인증 창에서 본인 확인을 완료합니다. 서버는 RP·origin·challenge·사용자 확인·등록 응답을 검증한 뒤 공개키만 비공개 DB에 저장하며 상태는 항상 `pending`입니다. 화면에 16자리 등록 요청 번호가 표시됩니다.
3. 운영자는 요청자와 해당 기기를 확인한 뒤 같은 학습 DB의 SQL Editor에서 다음 한 줄을 실행합니다. `등록요청번호`는 화면의 16자리 소문자 16진수로 바꿉니다. 학생 화면이나 서비스 역할은 이 승인 함수를 호출할 권한이 없습니다.

   ```sql
   select public.decide_training_device('등록요청번호', 'approved');
   ```

4. 사용자는 **승인 결과 확인하고 자료실 열기**를 누르고 기기 인증을 다시 완료합니다. 서버가 해당 기기의 서명과 등록 상태를 확인한 결과가 `approved: true, state: approved`일 때 기존 메모 화면을 엽니다. 계정에 승인된 기기가 있다는 사실만으로 현재 기기를 승인하지 않습니다. 요청 버튼·설치 표시·로그인·브라우저가 보낸 상태는 승인 근거가 아닙니다.
5. 회수는 같은 운영자 SQL Editor에서 `select public.decide_training_device('등록요청번호', 'revoked');`로 수행합니다. 감사 기록은 추가만 합니다. 회수된 credential은 다시 승인하지 않으며 새 등록 요청부터 시작해야 합니다.

## 키와 토큰

WebAuthn의 플랫폼 인증기를 사용합니다. 앱은 개인키를 생성·내보내기·가져오기·복사·저장하지 않습니다. 서버는 검증에 필요한 공개키와 counter만 저장합니다. 브라우저의 localStorage·sessionStorage·IndexedDB·Cache Storage에는 기기 키·토큰·서명·메모를 저장하지 않습니다. 로그인 SDK는 `persistSession: false`이며 세션은 현재 페이지 메모리에만 존재합니다.

동기화/백업 가능한 credential의 BE/BS 플래그는 거부하고, `singleDevice`·사용자 확인이 검증된 credential만 받습니다. 그러므로 동기화되는 패스키만 제공하는 기기에서는 등록이 거부될 수 있습니다. 지원되는 기기의 플랫폼 인증기(예: Windows Hello)를 사용해야 합니다. `attestationType: none`이므로 기업 관리 상태나 특정 하드웨어 모델이 검증됐다는 뜻은 아닙니다. 지원 안내는 [SimpleWebAuthn 공식 문서](https://simplewebauthn.dev/docs/packages/server)를 따릅니다.

## 서버 계약

모든 기기 경로는 기존 JWT 검증기로 신원을 확인합니다. 미로그인은 401, 다른 origin/메서드/경로/입력은 거부합니다. 승인 관련 POST의 사용자 ID·역할·승인 상태는 입력으로 받지 않습니다.

| 경로 | 동작 |
|---|---|
| `GET /api/device/status` | 해당 계정의 pending/approved 수만 제공, 현재 기기는 항상 `approved: false` |
| `POST /api/device/register` + `{}` | 플랫폼 인증기 등록 옵션과 일회용 challenge ID |
| `POST /api/device/finish` | 검증한 등록 응답을 pending으로 저장, 공개 요청 번호 반환 |
| `POST /api/device/options` | `kind: status` 또는 `kind: request`의 일회용 인증 옵션 |
| `POST /api/device/verify` | 현재 인증기의 서명 후 승인 결과 반환 |

`finish`·`verify` 본문은 `{challengeId, credential}`입니다. 브라우저의 WebAuthn 공개 응답만 보내며 키 원문은 보낼 수 없습니다. `request` 옵션에는 `{kind, method, path, bodySha256}`가 필요하고 기존 허용 경로만 선택할 수 있습니다. 경로는 쿼리까지 정확히 묶으며 기존 파서가 허용하는 단일 UUID ID 선택만 유지합니다.

보호 요청은 `x-byteback-device-proof`에 base64url로 인코딩한 `{challengeId, credential}`을 보냅니다. 서버는 메서드·정확한 요청 대상·JSON 값의 canonical SHA-256·검증한 발급자/사용자/시험 실행·로그인 토큰 해시·만료 시각을 저장된 challenge와 대조합니다. 키 이름 정렬을 사용하므로 JSON 공백과 키 순서만 달라진 것은 같은 값이며 제목/내용의 변경은 다른 해시입니다. GET/DELETE는 기존 API가 본문을 사용하지 않으므로 빈 본문에 묶습니다.

RP/origin·사용자 존재/확인·기기 공개키 서명·counter를 검증한 뒤 DB 트랜잭션에서 challenge와 credential을 잠급니다. 최종 승인 상태·counter·만료·사용 여부를 재검사하고 일회용으로 소비해야 원래 API가 실행됩니다. 무서명, 미승인, 경로/본문 변경, 토큰/사용자 변경, 만료, 재사용, 회수는 자료 DB에 접근하기 전에 거부됩니다. DB의 소유자 검사·강사 grant·B 복구 대상 검사는 그 뒤에도 원래대로 유지됩니다.

## 검증과 운영 확인

`npm run test:11` (동일 실행: `node --test test/step11-device.test.mjs test/auth-ui.test.mjs test/step11-app.test.mjs`)은 로컬 일시 키로 실제 WebAuthn 등록/서명을 만들고 임시 PostgreSQL에서 SQL을 실행합니다. 실제 운영체제 인증기·학생 계정·운영 DB는 사용하지 않습니다. 기존 단계의 API 시험은 명시적으로 10단계 조건에서 이전 경계를 재검사하고, 새 11단계 시험은 현재 API의 실제 서명 경계를 확인합니다. 2026-10-13 로컬 결과는 기기/화면 묶음 22개·전체 회귀 191개 통과이며 실제 기기 설치나 공식 심판 통과를 뜻하지 않습니다.

배포 후 직접 확인: 승인 전 메모/편집기 없음 → 등록 요청 뒤에도 없음 → 운영자 승인 후 기기 인증 → 본인 메모 조회/추가/수정/삭제 → 로그아웃 시 화면 지움. 각 보호 요청에서 기기 확인이 필요합니다. 오프라인/토큰 변경/승인 재확인은 화면을 잠그고 새 확인을 요구합니다. 무서명은 403, 승인 기기의 정상 조회는 200이어야 합니다. 실제 승인·회수·물리 인증기·공식 심판 판정은 아직 미실행입니다.
