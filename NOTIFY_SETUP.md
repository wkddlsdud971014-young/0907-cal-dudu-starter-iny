# 확정 알림 설정 (구글 캘린더 + 지메일)

어드민이 예약을 확정하면 **운영자 구글 캘린더에 일정이 자동으로 생기고, 구글이 고객에게 초대 메일을 보냅니다.** 화면을 꺼도 동작합니다.

별도 메일 발송 서비스(Resend·SendGrid)는 쓰지 않습니다. 구글 캘린더가 초대 메일을 대신 보내기 때문입니다.

## 어떻게 흘러가나

```
어드민 확정 → confirmations 테이블에 저장
                    ↓ DB 트리거(자동)
            Edge Function on-confirmation
                    ↓
        구글 캘린더 일정 생성 + 고객에게 초대 메일
```

## 왜 서비스 계정이 아니라 OAuth인가

서비스 계정은 Google Workspace 도메인 전체 위임이 없으면 **참석자에게 초대 메일을 보내지 못합니다.** 개인 Gmail 운영자도 쓸 수 있어야 해서, 운영자가 한 번 동의하고 그 refresh token을 서버에 두는 방식을 씁니다.

동의는 운영자 **한 명만** 하면 됩니다. 고객은 아무것도 안 합니다.

---

## 1. 구글 클라우드 준비

1. <https://console.cloud.google.com> 에서 프로젝트를 만듭니다.
2. **API 및 서비스 → 라이브러리** 에서 `Google Calendar API` 를 켭니다.
3. **OAuth 동의 화면** 을 만듭니다. 외부(External)로 만들고, 테스트 사용자에 운영자 본인 계정을 넣습니다.
4. **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션** 을 만듭니다.
5. **승인된 리디렉션 URI** 에 아래를 정확히 넣습니다.

```
http://localhost:5190/callback
```

클라이언트 ID와 보안 비밀번호를 복사해둡니다.

## 2. refresh token 받기

프로젝트 폴더에서 한 번만 실행합니다.

```bash
node scripts/get-google-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
```

터미널에 뜬 주소를 브라우저에 붙여넣고 운영자 계정으로 동의하면, 다음에 붙여넣을 명령이 터미널에 출력됩니다.

> `refresh_token` 이 안 나오면 이미 동의한 계정입니다. <https://myaccount.google.com/permissions> 에서 이 앱 접근을 지우고 다시 실행하세요.

## 3. Edge Function 비밀값 넣기

```bash
npx supabase login
npx supabase link --project-ref <프로젝트_ref>

npx supabase secrets set \
  GOOGLE_CLIENT_ID='...' \
  GOOGLE_CLIENT_SECRET='...' \
  GOOGLE_REFRESH_TOKEN='...' \
  GOOGLE_CALENDAR_ID='primary' \
  WEBHOOK_SECRET="$(openssl rand -hex 24)"
```

`WEBHOOK_SECRET` 으로 나온 값을 적어두세요. 다음 단계에서 씁니다.

`SUPABASE_URL` 과 `SUPABASE_SERVICE_ROLE_KEY` 는 Supabase가 자동으로 넣어주므로 따로 설정하지 않습니다.

## 4. 함수 배포

```bash
npx supabase functions deploy on-confirmation
```

## 5. DB 트리거 걸기

`sql/01_notify_webhook.sql` 을 열어 두 줄을 실제 값으로 바꾼 뒤, Supabase 대시보드 **SQL Editor** 에서 실행합니다.

```sql
('edge_url', 'https://<project_ref>.supabase.co/functions/v1/on-confirmation'),
('webhook_secret', '<3단계에서 만든 값>')
```

`sql/00_supabase.sql` 은 보호 파일이라 건드리지 않습니다. 이 파일만 따로 실행하며, 여러 번 실행해도 안전합니다.

---

## 확인

어드민으로 예약을 하나 확정한 뒤:

- 운영자 구글 캘린더에 `[예약] 2026-09-22 저녁 18:00` 일정이 보입니다.
- 고객 계정 메일함에 구글 캘린더 초대장이 갑니다.

안 되면 순서대로 봅니다.

```bash
# 함수 로그
npx supabase functions logs on-confirmation
```

```sql
-- 트리거가 실제로 호출했는지 (SQL Editor)
select * from net._http_response order by created desc limit 5;
```

| 증상 | 원인 |
|---|---|
| 401 unauthorized | `WEBHOOK_SECRET` 과 `app_config.webhook_secret` 이 다름 |
| `invalid_grant` | refresh token 이 만료·취소됨. 2단계 다시 |
| 일정은 생기는데 메일이 안 감 | 고객 계정에 메일 주소가 없거나, 참석자 초대가 막힌 계정 |
| `net._http_response` 가 비어 있음 | 트리거 미설치. 5단계 다시 |

## 보안 메모

- 구글 클라이언트 비밀번호와 refresh token 은 **Edge Function 비밀값으로만** 둡니다. 브라우저 코드나 저장소에 넣지 않습니다.
- `app_config` 테이블은 RLS를 켜고 아무 권한도 주지 않습니다. `SECURITY DEFINER` 함수만 읽습니다.
- 이 저장소는 공개입니다. 실제 키를 파일에 적어 커밋하지 마세요.
