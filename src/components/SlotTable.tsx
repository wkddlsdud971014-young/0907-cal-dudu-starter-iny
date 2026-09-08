import React from 'react';
import type { Slot } from '../types';
import { TIME_SLOTS, getAllDates } from '../utils/constants';

interface SlotTableProps {
  slots: Record<string, Slot>;
  selectedSlots: string[];
  onToggle: (slotId: string) => void;
  maxSelect?: number;
  mode: 'view' | 'select';
  // 슬롯별 대기 인원. 없으면 표시하지 않고 표는 그대로 뜬다.
  demand?: Record<string, number>;
}

// "2026-09-09" 를 "9월 9일 (화)" 로. 레퍼런스들이 전부 요일을 함께 보여준다.
// 주말인지 아닌지가 고를 때 가장 먼저 필요한 정보인데 우리 표에는 없었다.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function dateLabel(date: string): { main: string; day: string; weekend: boolean } {
  // 날짜 문자열은 이미 KST 기준으로 만들어진 값이다(getAllDates).
  // 여기서 지역 시간으로 다시 해석하면 한국 밖에서 보는 사람에게 요일이 하루 밀린다.
  // 예: 뉴욕에서 "2026-09-09"(수)가 화요일로 표시된다.
  // 그래서 UTC 로 고정 파싱해 문자열이 가리키는 날짜를 그대로 읽는다.
  const d = new Date(`${date}T00:00:00Z`);
  const w = d.getUTCDay();
  return {
    main: `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`,
    day: WEEKDAYS[w],
    weekend: w === 0 || w === 6,
  };
}

export const SlotTable: React.FC<SlotTableProps> = ({
  slots,
  selectedSlots,
  onToggle,
  maxSelect = 3,
  mode = 'view',
  demand,
}) => {
  const dates = getAllDates();
  const all = Object.values(slots);
  const openCount = all.filter(s => s.status === 'available').length;

  return (
    <div className="table-container">
      {/* 42칸이 한 판에 펼쳐져 있으니 지금 상태를 글로 한 번 짚어준다.
          Setmore 의 Summary, TidyCal 의 서비스 설명이 하는 역할이다. */}
      <p className="table-note">
        <span>
          <b>{openCount}칸</b> 예약 가능 · 전체 {all.length}칸
        </span>
        <span>시간대: 한국 표준시(KST)</span>
        {/* 이 표를 보는 사람은 아직 제출 전(첫 신청)이거나 재선택 필요 상태다.
            두 경우 모두 본인 신청은 집계에서 빠지므로, 여기 숫자는 언제나 남의 수다.
            내 신청 현황 카드의 "나 포함 n명"과 뜻이 다르니 문구를 섞지 않는다. */}
        {demand && <span>대기 n = 그 시간을 이미 신청해 둔 다른 사람 수</span>}
      </p>

      <table className="slots-table">
        <thead>
          <tr>
            <th style={{ width: '132px' }}>날짜</th>
            {TIME_SLOTS.map(slot => (
              <th key={slot.label}>{slot.displayLabel}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map(date => {
            const label = dateLabel(date);
            return (
              <tr key={date}>
                <td>
                  {label.main}{' '}
                  <span style={{ color: label.weekend ? 'var(--danger)' : 'var(--ink-3)' }}>
                    ({label.day})
                  </span>
                </td>
                {TIME_SLOTS.map(timeSlot => {
                  const slotId = `${date}:${timeSlot.label}`;
                  const slot = slots[slotId];
                  const isSelected = selectedSlots.includes(slotId);
                  const isConfirmed = slot?.status === 'confirmed';
                  const isFull = !isSelected && selectedSlots.length >= maxSelect;
                  // 마감된 칸에는 대기 수를 쓰지 않는다. 이미 결과가 나온 자리다.
                  const waiting = !isConfirmed && demand ? demand[slotId] || 0 : 0;

                  if (mode === 'view') {
                    return (
                      <td key={slotId}>
                        <span className={`slot-status ${slot?.status || 'available'}`}>
                          {isConfirmed ? '마감' : '가능'}
                        </span>
                      </td>
                    );
                  }

                  return (
                    <td key={slotId}>
                      {/* 칸 전체를 라벨로 감싸 체크박스를 정확히 겨냥하지 않아도 눌리게 한다.
                          Cal.com·Calendly 의 시간 버튼이 큼직한 것과 같은 이유다. */}
                      <label
                        className={[
                          'slot-pick',
                          isSelected ? 'picked' : '',
                          isConfirmed ? 'closed' : '',
                          isFull && !isConfirmed ? 'full' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={
                          isConfirmed
                            ? '이미 확정된 자리입니다'
                            : isFull
                              ? `희망은 최대 ${maxSelect}개까지 고를 수 있습니다`
                              : ''
                        }
                      >
                        <input
                          type="checkbox"
                          className="slot-checkbox"
                          checked={isSelected}
                          onChange={() => onToggle(slotId)}
                          disabled={isConfirmed || isFull}
                        />
                        <span>{isConfirmed ? '마감' : '가능'}</span>
                      </label>
                      {waiting > 0 && (
                        <span
                          className={`badge-wait ${waiting >= 2 ? 'hot' : ''}`}
                          style={{ marginLeft: '6px' }}
                          title={
                            waiting >= 2
                              ? '여러 명이 이 시간을 희망합니다. 다른 후보도 함께 골라두면 안전합니다.'
                              : '이 시간을 희망한 사람이 있습니다.'
                          }
                        >
                          대기 {waiting}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
