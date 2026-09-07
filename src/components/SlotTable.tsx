import React from 'react';
import type { Slot } from '../types';
import { TIME_SLOTS, getAllDates } from '../utils/constants';

interface SlotTableProps {
  slots: Record<string, Slot>;
  selectedSlots: string[];
  onToggle: (slotId: string) => void;
  maxSelect?: number;
  mode: 'view' | 'select';
}

export const SlotTable: React.FC<SlotTableProps> = ({
  slots,
  selectedSlots,
  onToggle,
  maxSelect = 3,
  mode = 'view',
}) => {
  const dates = getAllDates();

  return (
    <div className="table-container">
      <table className="slots-table">
        <thead>
          <tr>
            <th style={{ width: '120px' }}>날짜</th>
            {TIME_SLOTS.map(slot => (
              <th key={slot.label} style={{ width: '140px' }}>
                {slot.displayLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map(date => (
            <tr key={date}>
              <td>{date}</td>
              {TIME_SLOTS.map(timeSlot => {
                const slotId = `${date}:${timeSlot.label}`;
                const slot = slots[slotId];
                const isSelected = selectedSlots.includes(slotId);
                const isConfirmed = slot?.status === 'confirmed';

                return (
                  <td key={slotId}>
                    {mode === 'view' ? (
                      <span className={`slot-status ${slot?.status || 'available'}`}>
                        {slot?.status === 'confirmed' ? '마감' : '가능'}
                      </span>
                    ) : (
                      <>
                        <input
                          type="checkbox"
                          className="slot-checkbox"
                          checked={isSelected}
                          onChange={() => onToggle(slotId)}
                          disabled={isConfirmed || (!isSelected && selectedSlots.length >= maxSelect)}
                          title={isConfirmed ? '마감됨' : ''}
                        />
                        <span style={{ marginLeft: '6px', fontSize: '12px' }}>
                          {isConfirmed ? '마감' : '가능'}
                        </span>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
