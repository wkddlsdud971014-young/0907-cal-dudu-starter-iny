// 실습 기준 시각 (변경 금지)
export const REFERENCE_TIME = new Date('2026-09-07T08:00:00+09:00');

// 날짜 범위 (양끝 포함, 9/9~9/22)
export const START_DATE = new Date('2026-09-09T00:00:00+09:00');
export const END_DATE = new Date('2026-09-22T23:59:59+09:00');

// 시간대 (KST 기준)
export const TIME_SLOTS = [
  { label: 'am', hour: 9, displayLabel: '오전 09:00' },
  { label: 'pm', hour: 13, displayLabel: '오후 13:00' },
  { label: 'evening', hour: 18, displayLabel: '저녁 18:00' },
];

// 총 슬롯 수 계산
export function calculateTotalSlots(): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((END_DATE.getTime() - START_DATE.getTime()) / msPerDay) + 1;
  return diffDays * TIME_SLOTS.length;
}

export const TOTAL_SLOTS = 42; // 14일 × 3시간대

// 슬롯 ID 생성
export function generateSlotId(dateStr: string, timeLabel: string): string {
  return `${dateStr}:${timeLabel}`;
}

// 슬롯 ID 파싱
export function parseSlotId(slotId: string): { date: string; timeLabel: string } | null {
  const match = slotId.match(/^(\d{4}-\d{2}-\d{2}):(\w+)$/);
  if (!match) return null;
  return { date: match[1], timeLabel: match[2] };
}

// 모든 날짜 배열 생성 (KST 기준)
export function getAllDates(): string[] {
  const dates: string[] = [];
  const current = new Date(START_DATE);

  while (current <= END_DATE) {
    // KST 날짜 문자열
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);

    current.setDate(current.getDate() + 1);
  }

  return dates;
}

// 모든 슬롯 생성 (초기값)
export function generateAllSlots() {
  const slots: Record<string, { date: string; timeLabel: string; status: 'available' }> = {};
  const dates = getAllDates();

  dates.forEach(date => {
    TIME_SLOTS.forEach(slot => {
      const slotId = generateSlotId(date, slot.label);
      slots[slotId] = {
        date,
        timeLabel: slot.label,
        status: 'available',
      };
    });
  });

  return slots;
}
