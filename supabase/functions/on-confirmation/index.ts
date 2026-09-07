// 확정이 DB에 저장되면 자동으로 불리는 함수.
// 운영자 구글 캘린더에 일정을 만들고, 구글이 참석자에게 초대 메일을 보낸다.
// 화면이 꺼져 있어도 동작한다. 호출은 sql/01_notify_webhook.sql 의 트리거가 한다.
import {
  getAccessToken,
  upsertCalendarEvent,
  toGoogleEventId,
  type GoogleCredentials,
} from '../_shared/google.ts';

// 시간대 정의는 src/utils/constants.ts 의 TIME_SLOTS 와 같아야 한다.
// Edge Function 은 프론트 코드를 가져다 쓸 수 없어 값을 다시 적는다.
// 한쪽을 바꾸면 다른 쪽도 바꿔야 한다.
const TIME_SLOTS: Record<string, { hour: number; label: string }> = {
  am: { hour: 9, label: '오전 09:00' },
  pm: { hour: 13, label: '오후 13:00' },
  evening: { hour: 18, label: '저녁 18:00' },
};

const DURATION_MINUTES = 60;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`환경 변수 ${name} 가 없습니다. supabase secrets set 으로 넣으세요.`);
  return v;
}

// 한국 시간 오프셋을 문자열에 직접 박는다. 서버 시간대에 기대지 않는다.
function kstRange(date: string, timeLabel: string): { startIso: string; endIso: string } | null {
  const slot = TIME_SLOTS[timeLabel];
  if (!slot) return null;

  const hh = String(slot.hour).padStart(2, '0');
  const startIso = `${date}T${hh}:00:00+09:00`;
  const end = new Date(new Date(startIso).getTime() + DURATION_MINUTES * 60 * 1000);

  // 끝 시각도 KST 표기로 되돌린다.
  const kst = new Date(end.getTime() + 9 * 60 * 60 * 1000);
  const endIso = `${kst.toISOString().slice(0, 19)}+09:00`;

  return { startIso, endIso };
}

async function restGet(path: string, serviceKey: string, supabaseUrl: string) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) throw new Error(`조회 실패 ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// 결과를 확정 행에 되돌려 적는다. 어드민 화면이 이걸 읽어
// "캘린더에 갔는지"를 사람이 확인할 수 있게 된다.
// 여기서 실패해도 일정 자체는 이미 만들어졌으므로 조용히 넘어간다.
async function writeBack(
  confirmationId: string,
  patch: Record<string, string | null>,
  serviceKey: string,
  supabaseUrl: string
) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/confirmations?id=eq.${confirmationId}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    });
  } catch (e) {
    console.error('결과 기록 실패(일정은 생성됨):', e);
  }
}

Deno.serve(async req => {
  try {
    // 웹훅 위조를 막는다. DB 트리거가 같은 값을 헤더로 보낸다.
    const expected = env('WEBHOOK_SECRET');
    if (req.headers.get('x-webhook-secret') !== expected) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json();
    const record = payload?.record;
    if (!record?.request_id || !record?.slot_id) {
      return new Response(JSON.stringify({ error: 'confirmations 레코드가 아닙니다' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = env('SUPABASE_URL');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');

    // 슬롯에서 날짜·시간대를 읽는다.
    const slots = await restGet(
      `/rest/v1/slots?id=eq.${encodeURIComponent(record.slot_id)}&select=id,date,time_label`,
      serviceKey,
      supabaseUrl
    );
    const slot = slots[0];
    if (!slot) throw new Error(`슬롯 ${record.slot_id} 을 찾을 수 없습니다`);

    const range = kstRange(slot.date, slot.time_label);
    if (!range) throw new Error(`알 수 없는 시간대 라벨: ${slot.time_label}`);

    // 예약자를 찾는다. customer_id 는 auth 사용자 uid 다.
    const requests = await restGet(
      `/rest/v1/requests?id=eq.${record.request_id}&select=id,customer_id`,
      serviceKey,
      supabaseUrl
    );
    const customerId = requests[0]?.customer_id;

    // 고객 메일 주소는 auth 스키마에 있어 admin API 로만 읽는다.
    let customerEmail = '';
    if (customerId) {
      try {
        const user = await restGet(`/auth/v1/admin/users/${customerId}`, serviceKey, supabaseUrl);
        customerEmail = user?.email ?? '';
      } catch (_) {
        // 메일 주소를 못 찾아도 일정은 만든다. 초대만 못 갈 뿐이다.
      }
    }

    const cred: GoogleCredentials = {
      clientId: env('GOOGLE_CLIENT_ID'),
      clientSecret: env('GOOGLE_CLIENT_SECRET'),
      refreshToken: env('GOOGLE_REFRESH_TOKEN'),
      calendarId: Deno.env.get('GOOGLE_CALENDAR_ID') || 'primary',
    };

    const timeLabel = TIME_SLOTS[slot.time_label].label;
    const accessToken = await getAccessToken(cred);

    const result = await upsertCalendarEvent(cred, accessToken, {
      // 확정 한 건당 일정 하나. 웹훅이 두 번 와도 구글이 같은 ID를 거른다.
      eventId: toGoogleEventId(record.id ?? `${record.request_id}${record.slot_id}`),
      summary: `[예약] ${slot.date} ${timeLabel}`,
      description: [
        'cal.dudu-works.com 확정 예약',
        `슬롯: ${slot.id}`,
        `고객: ${customerEmail || customerId || '알 수 없음'}`,
        `요청 ID: ${record.request_id}`,
      ].join('\n'),
      startIso: range.startIso,
      endIso: range.endIso,
      attendeeEmails: customerEmail ? [customerEmail] : [],
    });

    if (record.id) {
      await writeBack(
        record.id,
        { calendar_link: result.htmlLink ?? null, calendar_error: null },
        serviceKey,
        supabaseUrl
      );
    }

    return new Response(
      JSON.stringify({ ok: true, created: result.created, link: result.htmlLink }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // 실패를 성공으로 숨기지 않는다. 로그와 응답, 그리고 어드민 화면 모두에 남긴다.
    console.error('on-confirmation 실패:', err);

    try {
      const payload = await req.clone().json().catch(() => null);
      const id = payload?.record?.id;
      if (id) {
        await writeBack(
          id,
          { calendar_link: null, calendar_error: String(err).slice(0, 500) },
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
          Deno.env.get('SUPABASE_URL') ?? ''
        );
      }
    } catch (_) {
      // 기록조차 실패하면 로그만 남기고 넘어간다.
    }

    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
