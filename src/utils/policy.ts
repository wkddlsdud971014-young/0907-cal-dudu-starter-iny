// 서비스가 고객에게 약속하는 값. 업무 규칙이 아니라 운영 정책이라 여기 모아 둔다.
//
// PRD 에는 관리자 응답 시한 규정이 없다. To-be 에서 "확정 시점을 알 수 없다"는 문제를
// 풀려면 시점의 상한선이 필요해서, 실습용 정책값으로 24시간을 정했다.
// 자동 확정이 아니라 안내 문구이므로 "관리자 수동 확정" 규칙을 깨지 않는다.
export const RESPONSE_SLA_HOURS = 24;

// 접수 시각으로부터 회신 기한을 구한다.
export function responseDeadline(receivedAtIso: string): Date {
  return new Date(new Date(receivedAtIso).getTime() + RESPONSE_SLA_HOURS * 3600 * 1000);
}

// "8시간 경과" 처럼 사람이 읽는 문장으로 바꾼다.
export function elapsedLabel(fromIso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(fromIso).getTime();
  if (ms < 0) return '방금';

  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 경과`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 경과`;

  const days = Math.floor(hours / 24);
  return `${days}일 ${hours % 24}시간 경과`;
}

export interface DeadlineView {
  deadline: Date;
  // 기한까지 남은 시간. 지났으면 음수가 아니라 overdue 로 알린다.
  remainingLabel: string;
  overdue: boolean;
}

// 남은 시간을 화면 문구로 만든다. 기한을 넘기면 사실대로 표시하고 숨기지 않는다.
export function deadlineView(receivedAtIso: string, now: Date = new Date()): DeadlineView {
  const deadline = responseDeadline(receivedAtIso);
  const ms = deadline.getTime() - now.getTime();

  if (ms <= 0) {
    return { deadline, overdue: true, remainingLabel: '회신 기한이 지났습니다' };
  }

  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return { deadline, overdue: false, remainingLabel: `${minutes}분 남음` };

  const hours = Math.floor(minutes / 60);
  return { deadline, overdue: false, remainingLabel: `${hours}시간 남음` };
}

// 한국 시간으로 "9/1 19:00" 처럼 짧게 쓴다.
export function shortKst(d: Date): string {
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
