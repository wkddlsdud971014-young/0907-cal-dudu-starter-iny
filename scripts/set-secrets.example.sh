#!/bin/sh
# 구글 키를 Supabase Edge Function 비밀값으로 넣는 양식.
#
# 쓰는 법
#   1) 이 파일을 복사해서 내 파일을 만든다 (복사본은 git 에 안 올라간다)
#        cp scripts/set-secrets.example.sh scripts/secrets.local.sh
#   2) 아래 따옴표 안에 값을 붙여넣는다
#   3) 실행한다
#        sh scripts/secrets.local.sh
#
# 주의
#   - .env.local 에는 넣지 마세요. 그 파일은 Vite 가 읽어 브라우저로 나갈 수 있습니다.
#   - 이 파일(복사본)은 키가 든 채로 디스크에 남습니다. 다 쓰면 지우세요.

# ── 4단계에서 받은 값 ──────────────────────────────────────
GOOGLE_CLIENT_ID=''
GOOGLE_CLIENT_SECRET=''

# ── 5단계 스크립트가 출력한 값 ─────────────────────────────
GOOGLE_REFRESH_TOKEN=''

# ── 일정을 넣을 캘린더 ─────────────────────────────────────
# 'primary' 는 로그인한 운영자의 기본 캘린더.
# 다른 캘린더면 캘린더 설정 > "캘린더 통합" 의 캘린더 ID 를 넣으세요.
GOOGLE_CALENDAR_ID='primary'

# ── 웹훅 공유 비밀 ─────────────────────────────────────────
# 비워두면 자동으로 만들어 줍니다. 그대로 두세요.
WEBHOOK_SECRET=''

# ═══════════════ 아래는 건드리지 마세요 ═══════════════

PROJECT_REF='dqaksdtjbikwrougyhxj'

fail() { printf '\n[중단] %s\n' "$1" >&2; exit 1; }

[ -n "$GOOGLE_CLIENT_ID" ]     || fail "GOOGLE_CLIENT_ID 가 비어 있습니다. 4단계 값을 넣으세요."
[ -n "$GOOGLE_CLIENT_SECRET" ] || fail "GOOGLE_CLIENT_SECRET 가 비어 있습니다. 4단계 값을 넣으세요."
[ -n "$GOOGLE_REFRESH_TOKEN" ] || fail "GOOGLE_REFRESH_TOKEN 이 비어 있습니다. 5단계를 먼저 하세요."

case "$GOOGLE_CLIENT_ID" in
  *.apps.googleusercontent.com) ;;
  *) fail "GOOGLE_CLIENT_ID 형식이 이상합니다. 보통 .apps.googleusercontent.com 으로 끝납니다." ;;
esac

if [ -z "$WEBHOOK_SECRET" ]; then
  WEBHOOK_SECRET=$(openssl rand -hex 24) || fail "openssl 로 비밀값을 만들지 못했습니다."
  echo "웹훅 비밀값을 새로 만들었습니다."
fi

echo "Supabase 프로젝트에 연결합니다: $PROJECT_REF"
npx supabase link --project-ref "$PROJECT_REF" || fail "link 실패. 먼저 'npx supabase login' 을 하세요."

echo "비밀값을 등록합니다..."
npx supabase secrets set \
  GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
  GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
  GOOGLE_REFRESH_TOKEN="$GOOGLE_REFRESH_TOKEN" \
  GOOGLE_CALENDAR_ID="$GOOGLE_CALENDAR_ID" \
  WEBHOOK_SECRET="$WEBHOOK_SECRET" || fail "secrets set 실패."

echo "함수를 배포합니다..."
npx supabase functions deploy on-confirmation || fail "배포 실패."

cat <<EOF

────────────────────────────────────────────────────────────
여기까지 성공했습니다. 이제 마지막으로 SQL 한 번만 실행하세요.

  https://supabase.com/dashboard/project/$PROJECT_REF/sql/new

sql/01_notify_webhook.sql 을 붙여넣고, 가운데 두 줄을 아래로 바꾸세요.

  ('edge_url', 'https://$PROJECT_REF.supabase.co/functions/v1/on-confirmation'),
  ('webhook_secret', '$WEBHOOK_SECRET')

이 화면은 캡처하지 마세요. 비밀값이 보입니다.
다 끝나면 이 파일을 지우세요:  rm scripts/secrets.local.sh
────────────────────────────────────────────────────────────
EOF
