import React, { useState, useEffect, useRef } from 'react';
import { SlotTable } from './SlotTable';
import type { Slot, Request, Candidate } from '../types';
import { decideRequestStatus } from '../utils/decide';
import { TIME_SLOTS } from '../utils/constants';
import type { Backend } from '../utils/backend';

interface CustomerPageProps {
  backend: Backend;
  // 고객 코드는 App이 소유한다. Supabase 모드에서는 로그인한 사용자의 uid여야
  // RPC의 auth.uid() 검증을 통과하므로, 그때는 onCustomerIdChange를 넘기지 않아 잠근다.
  customerId: string;
  onCustomerIdChange?: (value: string) => void;
}

export const CustomerPage: React.FC<CustomerPageProps> = ({
  backend,
  customerId,
  onCustomerIdChange,
}) => {
  const [stage, setStage] = useState<'select' | 'confirm' | 'view' | 'reselect'>('select');
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [customerRequests, setCustomerRequests] = useState<
    Array<{ request: Request; candidates: Candidate[]; decision: any }>
  >([]);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // 작업 ID는 "한 번의 제출 시도"를 가리키는 이름이다. 실패해서 다시 누를 때 같은 값을
  // 보내야 서버가 중복 저장을 걸러낸다. 매번 새로 만들면 재시도가 별개 작업이 되어
  // 멱등성 방어가 무력해진다. 성공했거나 선택을 바꾸면 그때 새 ID를 발급한다.
  const submitOpId = useRef<string | null>(null);
  const reselectOpId = useRef<string | null>(null);

  const newOpId = (prefix: string) =>
    `${prefix}-${
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    }`;

  const getRecommendedSlots = (previousRequest: Request, candidates: Candidate[]): string[] => {
    const previousCandidates = candidates.filter(c => c.requestId === previousRequest.id);
    const previousDates = new Set(previousCandidates.map(c => {
      const slot = slots[c.slotId];
      return slot?.date;
    }));
    const previousTimes = new Set(previousCandidates.map(c => {
      const slot = slots[c.slotId];
      return slot?.timeLabel;
    }));

    const available = Object.values(slots).filter(s => s.status === 'available');
    const recommended: string[] = [];

    // 1순위: 원래 날짜, 다른 시간
    for (const slot of available) {
      if (previousDates.has(slot.date) && !previousTimes.has(slot.timeLabel)) {
        recommended.push(slot.id);
        if (recommended.length >= 3) return recommended;
      }
    }

    // 2순위: 다른 날짜, 원래 시간
    for (const slot of available) {
      if (!previousDates.has(slot.date) && previousTimes.has(slot.timeLabel)) {
        recommended.push(slot.id);
        if (recommended.length >= 3) return recommended;
      }
    }

    // 3순위: 나머지 가용 슬롯
    for (const slot of available) {
      if (!recommended.includes(slot.id)) {
        recommended.push(slot.id);
        if (recommended.length >= 3) return recommended;
      }
    }

    return recommended;
  };

  // 초기 로드
  useEffect(() => {
    loadData();
  }, [customerId]);

  const loadData = async () => {
    let status: Awaited<ReturnType<Backend['getCustomerStatus']>>;
    try {
      const [nextSlots, nextStatus] = await Promise.all([
        backend.getSlots(),
        backend.getCustomerStatus(customerId),
      ]);
      setSlots(nextSlots);
      setCustomerRequests(nextStatus);
      status = nextStatus;
      setError('');
    } catch (err: any) {
      setError(err?.message || String(err));
      return;
    }
    setSuccess('');

    // 첫 로드인지 확인
    if (status.length === 0) {
      setStage('select');
      setSelectedSlots([]);
    } else {
      const latest = status[status.length - 1];
      if (latest.request.status === 'needs_reselection') {
        setStage('reselect');
      } else if (latest.request.status === 'confirmed') {
        setStage('view');
      } else {
        setStage('view');
      }
    }
  };

  const handleSlotToggle = (slotId: string) => {
    setSelectedSlots(prev => {
      if (prev.includes(slotId)) {
        return prev.filter(s => s !== slotId);
      } else if (prev.length < 3) {
        return [...prev, slotId];
      }
      return prev;
    });
    // 고른 슬롯이 달라졌으면 다른 작업이다. 다음 제출은 새 ID로 나간다.
    submitOpId.current = null;
    reselectOpId.current = null;
    setError('');
  };

  const handleSubmit = async () => {
    if (selectedSlots.length === 0) {
      setError('최소 1개 이상의 슬롯을 선택하세요');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (!submitOpId.current) submitOpId.current = newOpId('submit');
      const result = await backend.submitRequest(customerId, selectedSlots, submitOpId.current);

      if (result.success) {
        submitOpId.current = null;
        setSuccess('신청이 완료되었습니다!');
        setSelectedSlots([]);
        setStage('view');
        setTimeout(() => loadData(), 500);
      } else {
        setError(result.error || '신청 실패');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReselect = async () => {
    if (selectedSlots.length === 0) {
      setError('최소 1개 이상의 슬롯을 선택하세요');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const latest = customerRequests[customerRequests.length - 1];
      if (!reselectOpId.current) reselectOpId.current = newOpId('reselect');
      const result = await backend.resubmitRequest(
        customerId,
        latest.request.id,
        selectedSlots,
        reselectOpId.current
      );

      if (result.success) {
        reselectOpId.current = null;
        setSuccess('재선택이 완료되었습니다!');
        setSelectedSlots([]);
        setStage('view');
        setTimeout(() => loadData(), 500);
      } else {
        setError(result.error || '재선택 실패');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setSelectedSlots([]);
    setStage('view');
    setError('');
  };

  // 슬롯 상태가 변경되었는지 확인
  const checkSlotAvailability = () => {
    if (stage === 'confirm' && customerRequests.length > 0) {
      const latest = customerRequests[customerRequests.length - 1];
      const allCandidates = customerRequests.flatMap(item => item.candidates);
      const decision = decideRequestStatus(latest.request, allCandidates, slots);

      if (decision.status !== 'ok') {
        setError('선택한 슬롯의 상태가 변경되었습니다. 다시 선택해주세요.');
        setStage('reselect');
        setSelectedSlots([]);
        return false;
      }
    }
    return true;
  };

  return (
    <div className="customer-page">
      <div className="form-group">
        <label>고객 코드</label>
        <input
          type="text"
          value={customerId}
          onChange={e => onCustomerIdChange?.(e.target.value)}
          placeholder="C01"
          // Supabase 모드에서는 로그인 계정이 곧 고객 코드라 편집할 수 없다.
          disabled={!onCustomerIdChange || stage === 'confirm'}
        />
        {!onCustomerIdChange && (
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            로그인한 계정으로 신청합니다.
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {stage === 'select' && (
        <div>
          <h3>슬롯 선택 (1~3개)</h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            원하는 슬롯을 선택하고 제출하세요. 선택 순서가 희망 우선순위입니다.
          </p>
          <SlotTable
            slots={slots}
            selectedSlots={selectedSlots}
            onToggle={handleSlotToggle}
            mode="select"
            maxSelect={3}
          />

          <div style={{ marginBottom: '20px' }}>
            <h4>선택한 슬롯 ({selectedSlots.length}/3)</h4>
            <ul className="list">
              {selectedSlots.map((slotId, idx) => {
                const slot = slots[slotId];
                return (
                  <li key={slotId}>
                    <span>
                      {idx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                    </span>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleSlotToggle(slotId)}
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                    >
                      제거
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <button
            className="btn btn-primary"
            onClick={() => setStage('confirm')}
            disabled={selectedSlots.length === 0 || loading}
          >
            다음: 최종 확인
          </button>
        </div>
      )}

      {stage === 'confirm' && checkSlotAvailability() && (
        <div>
          <h3>최종 확인</h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            다음과 같이 신청합니다. 제출하면 어드민이 확인 후 확정합니다.
          </p>
          <SlotTable slots={slots} selectedSlots={selectedSlots} onToggle={() => {}} mode="view" />

          <div style={{ marginBottom: '20px' }}>
            <h4>최종 선택 (우선순위 순)</h4>
            <ul className="list">
              {selectedSlots.map((slotId, idx) => {
                const slot = slots[slotId];
                return (
                  <li key={slotId}>
                    <span>
                      {idx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? '처리 중...' : '제출'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleCancel}
              disabled={loading}
            >
              돌아가기
            </button>
          </div>
        </div>
      )}

      {stage === 'view' && customerRequests.length > 0 && (
        <div>
          <h3>내 신청 현황</h3>
          {customerRequests.map((item, idx) => (
            <div key={item.request.id} style={{ marginBottom: '20px', padding: '16px', background: 'white', borderRadius: '4px', border: '1px solid #ddd' }}>
              <h4>신청 #{item.request.version} (접수일: {new Date(item.request.createdAt).toLocaleString()})</h4>

              <div className="form-group">
                <label>상태</label>
                <div style={{ padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
                  {item.request.status === 'confirmed' && (
                    <span className="slot-status confirmed">확정됨</span>
                  )}
                  {item.request.status === 'received' && (
                    <span className="slot-status available">접수됨</span>
                  )}
                  {item.request.status === 'needs_reselection' && (
                    <span className="alert alert-warning">재선택 필요</span>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>선택한 슬롯 (우선순위 순)</label>
                <ul className="list">
                  {item.candidates.map((c, cidx) => {
                    const slot = slots[c.slotId];
                    const isAvailable = slot?.status === 'available';
                    return (
                      <li key={c.id}>
                        <span>
                          {cidx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                          {' '}
                          <span style={{ marginLeft: '10px', fontSize: '12px', color: isAvailable ? '#28a745' : '#dc3545' }}>
                            {isAvailable ? '(가능)' : '(마감)'}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {item.request.status === 'confirmed' && (
                <div className="alert alert-success">
                  <strong>확정됨!</strong> {slots[item.request.confirmedSlotId!]?.date}{' '}
                  {TIME_SLOTS.find(t => t.label === slots[item.request.confirmedSlotId!]?.timeLabel)?.displayLabel}에
                  확정되었습니다.
                </div>
              )}

              {item.request.status === 'needs_reselection' && idx === customerRequests.length - 1 && (
                <button
                  className="btn btn-warning"
                  onClick={() => {
                    setStage('reselect');
                    setSelectedSlots([]);
                  }}
                  style={{ background: '#ffc107', marginTop: '10px' }}
                >
                  재선택하기
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {stage === 'reselect' && customerRequests.length > 0 && (() => {
        const latest = customerRequests[customerRequests.length - 1];
        const recommendedSlotIds = getRecommendedSlots(latest.request, latest.candidates);

        return (
          <div>
            <h3>슬롯 재선택</h3>
            <p style={{ color: '#666', fontSize: '14px' }}>
              이전 신청의 슬롯이 모두 마감되었습니다. 다시 선택해주세요.
            </p>

            {recommendedSlotIds.length > 0 && (
              <div style={{ marginBottom: '20px', padding: '16px', background: '#e8f5e9', borderRadius: '4px', border: '1px solid #4caf50' }}>
                <h4 style={{ color: '#2e7d32', marginTop: 0 }}>✨ 추천 슬롯 (3개)</h4>
                <p style={{ color: '#666', fontSize: '12px', marginBottom: '12px' }}>
                  이전 선택과 유사한 슬롯을 추천합니다. 클릭하면 자동 선택됩니다.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                  {recommendedSlotIds.slice(0, 3).map((slotId: string, idx: number) => {
                    const slot = slots[slotId];
                    const isSelected = selectedSlots.includes(slotId);
                    return (
                      <button
                        key={slotId}
                        onClick={() => handleSlotToggle(slotId)}
                        style={{
                          padding: '12px',
                          background: isSelected ? '#4caf50' : '#ffffff',
                          color: isSelected ? '#ffffff' : '#2e7d32',
                          border: `2px solid ${isSelected ? '#4caf50' : '#4caf50'}`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: isSelected ? 'bold' : 'normal',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{ marginBottom: '4px' }}>
                          {idx + 1}. {slot?.date}
                        </div>
                        <div style={{ fontSize: '12px' }}>
                          {TIME_SLOTS.find((t: any) => t.label === slot?.timeLabel)?.displayLabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <SlotTable
            slots={slots}
            selectedSlots={selectedSlots}
            onToggle={handleSlotToggle}
            mode="select"
            maxSelect={3}
          />

          <div style={{ marginBottom: '20px' }}>
            <h4>새로 선택한 슬롯 ({selectedSlots.length}/3)</h4>
            <ul className="list">
              {selectedSlots.map((slotId, idx) => {
                const slot = slots[slotId];
                return (
                  <li key={slotId}>
                    <span>
                      {idx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                    </span>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleSlotToggle(slotId)}
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                    >
                      제거
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-primary"
              onClick={handleReselect}
              disabled={selectedSlots.length === 0 || loading}
            >
              {loading ? '처리 중...' : '재선택 제출'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setStage('view');
                setSelectedSlots([]);
              }}
              disabled={loading}
            >
              돌아가기
            </button>
          </div>
        </div>
        );
      })()}
    </div>
  );
};
