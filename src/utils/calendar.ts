// 확정된 예약을 캘린더로 넘기는 유틸.
// 외부 라이브러리·API 키·서버를 쓰지 않는다. 구글 캘린더는 링크 한 줄이고,
// .ics 는 문자열을 만들어 브라우저가 내려받게 한다. Apple/Outlook 도 .ics 를 읽는다.
import type { Slot } from '../types';
import { TIME_SLOTS } from './constants';

// PRD는 소요시간을 계산하지 않는다("지역별 소요시간·연속 슬롯 계산은 없습니다").
// 캘린더는 끝 시각을 요구하므로 한 시간으로 고정하고 그 사실을 여기 적어둔다.
const DURATION_MINUTES = 60;

export interface CalendarEvent {
  start: Date;
  end: Date;
  title: string;
  description: string;
}

// 슬롯 라벨(am/pm/evening)을 한국 시간의 실제 시각으로 바꾼다.
// 기기 시간대와 무관하게 KST로 해석해야 해서 오프셋을 문자열에 직접 박는다.
export function slotToEvent(slot: Slot, customerLabel: string): CalendarEvent | null {
  const timeSlot = TIME_SLOTS.find(t => t.label === slot.timeLabel);
  if (!timeSlot) return null;

  const hh = String(timeSlot.hour).padStart(2, '0');
  const start = new Date(`${slot.date}T${hh}:00:00+09:00`);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start.getTime() + DURATION_MINUTES * 60 * 1000);

  return {
    start,
    end,
    title: `[확정] Duduworks 상담 예약 ${slot.date} ${timeSlot.displayLabel}`,
    description: [
      'Duduworks - iny Calendar 예약이 확정되었습니다.',
      `날짜: ${slot.date}`,
      `시간: ${timeSlot.displayLabel} (한국 시간)`,
      `슬롯: ${slot.id}`,
      `고객: ${customerLabel}`,
    ].join('\n'),
  };
}

// 구글 캘린더 링크는 UTC를 요구한다. 20260922T090000Z 꼴.
function toUtcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toUtcStamp(event.start)}/${toUtcStamp(event.end)}`,
    details: event.description,
    ctz: 'Asia/Seoul',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// .ics 의 TEXT 값은 역슬래시·세미콜론·쉼표·줄바꿈을 이스케이프해야 한다.
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// 한 줄이 75옥텟을 넘으면 접어야 한다. 넘친 줄은 다음 줄을 공백으로 시작해 잇는다.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) parts.push(' ' + rest);
  return parts.join('\r\n');
}

export function buildIcs(event: CalendarEvent, uid: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Duduworks//iny Calendar//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${toUtcStamp(event.start)}`,
    `DTEND:${toUtcStamp(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // .ics 는 CRLF 로 줄을 나눈다.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function downloadIcs(event: CalendarEvent, uid: string, fileName: string): void {
  const blob = new Blob([buildIcs(event, uid)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 즉시 해제하면 일부 브라우저가 저장을 못 끝낸다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
