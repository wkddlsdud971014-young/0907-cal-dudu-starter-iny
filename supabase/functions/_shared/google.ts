// 구글 캘린더에 일정을 만드는 최소 클라이언트.
// 외부 라이브러리를 쓰지 않고 fetch 만 쓴다.
//
// 운영자 계정으로 동작한다. 서비스 계정이 아니라 OAuth refresh token 을 쓰는 이유는,
// 서비스 계정은 Workspace 도메인 전체 위임이 없으면 참석자에게 초대 메일을 보내지
// 못하기 때문이다. 개인 Gmail 운영자도 쓸 수 있어야 해서 이 방식을 택했다.

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string; // 보통 운영자 메일 주소 또는 'primary'
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  startIso: string; // 예: 2026-09-22T18:00:00+09:00
  endIso: string;
  attendeeEmails: string[];
  // 같은 예약으로 두 번 호출돼도 일정이 두 개 생기지 않게 하는 열쇠.
  // 구글이 이 값으로 중복을 걸러낸다.
  eventId: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// refresh token 으로 짧은 수명의 access token 을 받는다.
export async function getAccessToken(cred: GoogleCredentials): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: cred.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `구글 토큰 발급 실패 (${res.status}): ${body.error ?? ''} ${body.error_description ?? ''}`.trim()
    );
  }
  return body.access_token as string;
}

// 구글 이벤트 ID 규칙: base32hex 소문자(a-v, 0-9), 5~1024자.
// UUID 를 그대로 못 쓰므로 허용 문자만 남긴다.
export function toGoogleEventId(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-v0-9]/g, '');
  return cleaned.length >= 5 ? cleaned.slice(0, 1024) : `evt${cleaned}00000`.slice(0, 1024);
}

export async function upsertCalendarEvent(
  cred: GoogleCredentials,
  accessToken: string,
  input: CalendarEventInput
): Promise<{ created: boolean; htmlLink?: string; id?: string }> {
  const payload = {
    id: input.eventId,
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startIso, timeZone: 'Asia/Seoul' },
    end: { dateTime: input.endIso, timeZone: 'Asia/Seoul' },
    attendees: input.attendeeEmails.filter(Boolean).map(email => ({ email })),
  };

  // sendUpdates=all 이 있어야 구글이 참석자에게 초대 메일을 보낸다.
  // 이게 이 프로젝트에서 별도 메일 발송 서비스를 두지 않는 이유다.
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(cred.calendarId)}/events?sendUpdates=all`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 409) {
    // 같은 eventId 가 이미 있다. 재시도·중복 웹훅이라 정상으로 본다.
    return { created: false, id: input.eventId };
  }

  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `캘린더 일정 생성 실패 (${res.status}): ${body?.error?.message ?? JSON.stringify(body)}`
    );
  }

  return { created: true, htmlLink: body.htmlLink, id: body.id };
}
