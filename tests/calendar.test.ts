// 캘린더 내보내기 검사.
// 핵심 위험은 시간대다. 슬롯은 한국 시간으로 정의되는데 캘린더 링크와 .ics 는
// UTC를 요구하므로, 기기 시간대와 무관하게 KST -> UTC 로 9시간 당겨져야 한다.
import { describe, it, expect } from 'vitest';
import { slotToEvent, googleCalendarUrl, buildIcs } from '../src/utils/calendar';
import type { Slot } from '../src/types';

const slot = (timeLabel: string): Slot => ({
  id: `2026-09-22:${timeLabel}`,
  date: '2026-09-22',
  timeLabel,
  status: 'confirmed',
});

describe('slotToEvent', () => {
  it('오전 09:00 KST 는 같은 날 00:00 UTC 다', () => {
    const e = slotToEvent(slot('am'), 'C01')!;
    expect(e.start.toISOString()).toBe('2026-09-22T00:00:00.000Z');
    expect(e.end.toISOString()).toBe('2026-09-22T01:00:00.000Z');
  });

  it('오후 13:00 KST 는 같은 날 04:00 UTC 다', () => {
    const e = slotToEvent(slot('pm'), 'C01')!;
    expect(e.start.toISOString()).toBe('2026-09-22T04:00:00.000Z');
  });

  it('저녁 18:00 KST 는 같은 날 09:00 UTC 다', () => {
    const e = slotToEvent(slot('evening'), 'C01')!;
    expect(e.start.toISOString()).toBe('2026-09-22T09:00:00.000Z');
  });

  it('모르는 시간대 라벨은 만들지 않는다', () => {
    expect(slotToEvent(slot('midnight'), 'C01')).toBeNull();
  });
});

describe('googleCalendarUrl', () => {
  it('UTC 구간을 dates 파라미터로 넘긴다', () => {
    const url = googleCalendarUrl(slotToEvent(slot('evening'), 'C01')!);
    expect(url).toContain('dates=20260922T090000Z%2F20260922T100000Z');
    expect(url).toContain('ctz=Asia%2FSeoul');
  });
});

describe('buildIcs', () => {
  const ics = buildIcs(slotToEvent(slot('evening'), 'C01')!, 'req-1@cal.dudu-works');

  it('필수 블록과 UTC 시각을 담는다', () => {
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20260922T090000Z');
    expect(ics).toContain('DTEND:20260922T100000Z');
    expect(ics).toContain('UID:req-1@cal.dudu-works');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('CRLF 로 줄을 나눈다', () => {
    expect(ics.includes('\r\n')).toBe(true);
  });

  it('본문의 줄바꿈을 \\n 으로 이스케이프한다', () => {
    expect(ics).toContain('DESCRIPTION:');
    // 설명에 든 실제 줄바꿈이 그대로 나가면 .ics 가 깨진다.
    const descLine = ics.split('\r\n').find(l => l.startsWith('DESCRIPTION:'))!;
    expect(descLine).toContain('\\n');
  });
});
