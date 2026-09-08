// 확정 내용을 메일로 넘기는 유틸.
// 발송 API 키는 브라우저에 둘 수 없다(PRD: anon key 외 비밀값 금지).
// 그래서 앱이 직접 보내지 않고, 내용이 채워진 작성 화면을 열어 사람이 보낸다.
import type { Slot } from '../types';
import { TIME_SLOTS } from './constants';

export interface MailDraft {
  subject: string;
  body: string;
}

export function buildConfirmationMail(slot: Slot, customerLabel: string): MailDraft | null {
  const timeSlot = TIME_SLOTS.find(t => t.label === slot.timeLabel);
  if (!timeSlot) return null;

  return {
    subject: `[예약 확정] ${slot.date} ${timeSlot.displayLabel}`,
    body: [
      '예약이 확정되었습니다.',
      '',
      `날짜: ${slot.date}`,
      `시간: ${timeSlot.displayLabel} (한국 시간)`,
      `고객: ${customerLabel}`,
      '',
      '— Duduworks - iny Calendar',
    ].join('\n'),
  };
}

// Gmail 작성 화면. to 를 비워 두면 받는 사람은 사용자가 고른다.
export function gmailComposeUrl(draft: MailDraft, to = ''): string {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to,
    su: draft.subject,
    body: draft.body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

// Gmail 을 안 쓰는 사람을 위한 기본 메일 앱 링크.
export function mailtoUrl(draft: MailDraft, to = ''): string {
  const params = new URLSearchParams({
    subject: draft.subject,
    body: draft.body,
  });
  return `mailto:${to}?${params.toString()}`;
}
