// 회신 기한 계산 검사.
// 이 값이 틀리면 고객에게 잘못된 약속이 화면에 뜬다. 기한을 넘긴 경우까지 고정한다.
import { describe, it, expect } from 'vitest';
import {
  RESPONSE_SLA_HOURS,
  responseDeadline,
  elapsedLabel,
  deadlineView,
} from '../src/utils/policy';

const received = '2026-08-31T19:00:00+09:00';

describe('responseDeadline', () => {
  it('접수 시각에서 정확히 SLA 시간 뒤다', () => {
    const d = responseDeadline(received);
    expect(d.toISOString()).toBe('2026-09-01T10:00:00.000Z'); // 9/1 19:00 KST
    expect((d.getTime() - new Date(received).getTime()) / 3600000).toBe(RESPONSE_SLA_HOURS);
  });
});

describe('elapsedLabel', () => {
  it('한 시간 안이면 분으로 센다', () => {
    expect(elapsedLabel(received, new Date('2026-08-31T19:30:00+09:00'))).toBe('30분 경과');
  });

  it('하루 안이면 시간으로 센다', () => {
    expect(elapsedLabel(received, new Date('2026-09-01T09:00:00+09:00'))).toBe('14시간 경과');
  });

  it('하루가 넘으면 일과 시간을 함께 쓴다', () => {
    expect(elapsedLabel(received, new Date('2026-09-02T01:00:00+09:00'))).toBe('1일 6시간 경과');
  });
});

describe('deadlineView', () => {
  it('기한 전에는 남은 시간을 알려준다', () => {
    const v = deadlineView(received, new Date('2026-09-01T09:00:00+09:00'));
    expect(v.overdue).toBe(false);
    expect(v.remainingLabel).toBe('10시간 남음');
  });

  it('기한을 넘기면 숨기지 않고 지났다고 말한다', () => {
    const v = deadlineView(received, new Date('2026-09-02T09:00:00+09:00'));
    expect(v.overdue).toBe(true);
    expect(v.remainingLabel).toBe('회신 기한이 지났습니다');
  });

  it('기한 정각은 지난 것으로 본다', () => {
    expect(deadlineView(received, new Date('2026-09-01T19:00:00+09:00')).overdue).toBe(true);
  });
});
