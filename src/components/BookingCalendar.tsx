// 이 앱으로 들어온 예약만 달력으로 본다.
// 운영자 개인 구글 일정은 섞이지 않는다. 데이터를 구글이 아니라 이 앱의 DB에서
// 그대로 읽기 때문이다. 구글 캘린더는 확정 건을 내보내는 쪽이고, 여기는 읽는 쪽이다.
import React from 'react';
import type { Slot, Request, Candidate } from '../types';
import { TIME_SLOTS, getAllDates } from '../utils/constants';

interface RequestView {
  request: Request;
  candidates: Candidate[];
  decision: unknown;
}

interface BookingCalendarProps {
  slots: Record<string, Slot>;
  requests: RequestView[];
  // uid → 이메일. 어드민만 구할 수 있고, 없으면 uid 앞부분으로 대체된다.
  customerLabels?: Record<string, string>;
}

interface CellInfo {
  slot?: Slot;
  confirmedFor?: string; // 확정된 고객
  pendingCount: number; // 아직 확정 안 된 신청 수
}

// 고객 식별자가 uid 처럼 길면 앞부분만 보여준다. 표가 밀리지 않게.
function shortLabel(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

export const BookingCalendar: React.FC<BookingCalendarProps> = ({
  slots,
  requests,
  customerLabels = {},
}) => {
  const dates = getAllDates();
  const nameOf = (customerId: string) => customerLabels[customerId] || shortLabel(customerId);

  // 슬롯별로 확정 1건과 대기 N건을 센다.
  const cells: Record<string, CellInfo> = {};
  Object.values(slots).forEach(slot => {
    cells[slot.id] = { slot, pendingCount: 0 };
  });

  requests.forEach(({ request, candidates }) => {
    if (request.status === 'confirmed' && request.confirmedSlotId) {
      const cell = cells[request.confirmedSlotId];
      if (cell) cell.confirmedFor = request.customerId;
      return;
    }
    // 접수·재선택 상태의 희망은 아직 점유가 아니다. 개수만 센다.
    candidates.forEach(c => {
      const cell = cells[c.slotId];
      if (cell) cell.pendingCount += 1;
    });
  });

  const confirmedTotal = requests.filter(r => r.request.status === 'confirmed').length;
  const pendingTotal = requests.filter(r => r.request.status !== 'confirmed').length;

  return (
    <div>
      <h3>예약 달력</h3>
      <p style={{ color: '#666', fontSize: '14px' }}>
        이 앱으로 들어온 예약만 보여줍니다. 확정 {confirmedTotal}건, 미확정 {pendingTotal}건.
        운영자 개인 구글 일정은 표시하지 않습니다.
      </p>

      <div style={{ marginBottom: '12px', fontSize: '13px', color: '#666' }}>
        <span className="slot-status confirmed" style={{ marginRight: '6px' }}>
          확정
        </span>
        슬롯이 마감된 예약
        <span className="slot-status available" style={{ margin: '0 6px 0 16px' }}>
          대기
        </span>
        아직 확정되지 않은 희망 신청 수
      </div>

      <div className="table-container">
        <table className="slots-table">
          <thead>
            <tr>
              <th style={{ width: '120px' }}>날짜</th>
              {TIME_SLOTS.map(t => (
                <th key={t.label} style={{ width: '160px' }}>
                  {t.displayLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map(date => (
              <tr key={date}>
                <td style={{ fontWeight: 'bold' }}>{date}</td>
                {TIME_SLOTS.map(t => {
                  const cell = cells[`${date}:${t.label}`];
                  const confirmed = cell?.confirmedFor;
                  return (
                    <td
                      key={t.label}
                      style={{
                        background: confirmed ? '#f8d7da' : cell?.pendingCount ? '#fff3cd' : undefined,
                        verticalAlign: 'top',
                      }}
                    >
                      {confirmed ? (
                        <span>
                          <strong>확정</strong>
                          <br />
                          <span style={{ fontSize: '12px' }}>{nameOf(confirmed)}</span>
                        </span>
                      ) : cell?.pendingCount ? (
                        <span style={{ fontSize: '12px' }}>대기 {cell.pendingCount}건</span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#999' }}>-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
