import React, { useState, useEffect, useRef } from 'react';
import { SlotTable } from './SlotTable';
import type { Slot, Request, Candidate } from '../types';
import { decideRequestStatus } from '../utils/decide';
import { TIME_SLOTS } from '../utils/constants';
import type { Backend } from '../utils/backend';
import { slotToEvent, googleCalendarUrl, downloadIcs } from '../utils/calendar';
import { buildConfirmationMail, gmailComposeUrl, mailtoUrl } from '../utils/mail';
import { RESPONSE_SLA_HOURS, deadlineView, elapsedLabel, shortKst } from '../utils/policy';
import type { OperationLog } from '../types';

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
  // 내 신청의 처리 이력. 진행 타임라인을 그리는 데 쓴다.
  const [myLogs, setMyLogs] = useState<OperationLog[]>([]);

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
      // 슬롯과 신청 현황은 화면의 뼈대라 실패하면 오류를 보여준다.
      const [nextSlots, nextStatus] = await Promise.all([
        backend.getSlots(),
        backend.getCustomerStatus(customerId),
      ]);
      setSlots(nextSlots);
      setCustomerRequests(nextStatus);
      status = nextStatus;

      // 타임라인은 곁들이는 정보다. 정책 SQL 미실행이나 오래된 세션 때문에
      // 실패하더라도 기한·경과 표시와 신청 현황은 그대로 보여야 한다.
      try {
        setMyLogs(await backend.getMyLogs(customerId));
      } catch {
        setMyLogs([]);
      }
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

  // 확정 전 신청의 진행 상황. To-be ①②가 여기 들어간다.
  //
  // As-is 에서는 '접수됨' 세 글자뿐이라 언제 결과가 나오는지 알 수 없었다.
  // 여기서 세 가지를 알려준다. 언제 접수됐는지, 얼마나 지났는지, 언제까지 회신하는지.
  const renderProgress = (request: Request) => {
    if (request.status === 'confirmed') return null;

    const view = deadlineView(request.createdAt);
    const steps = myLogs
      .filter(l => l.requestId === request.id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return (
      <div
        style={{
          marginTop: '10px',
          padding: '14px 16px',
          background: view.overdue ? '#fff3cd' : '#eef3fb',
          border: `1px solid ${view.overdue ? '#e0c068' : '#c7d6ef'}`,
          borderRadius: '4px',
        }}
      >
        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' }}>
          {view.overdue
            ? '회신 기한이 지났습니다'
            : `${shortKst(view.deadline)}까지 회신 예정`}
          <span style={{ fontWeight: 'normal', color: '#555', marginLeft: '8px' }}>
            {view.overdue ? '' : view.remainingLabel}
          </span>
        </div>

        <div style={{ fontSize: '13px', color: '#555', marginBottom: '10px' }}>
          접수 {shortKst(new Date(request.createdAt))} · {elapsedLabel(request.createdAt)}
        </div>

        {/* 처리 이력. 정책 SQL 을 아직 실행하지 않았으면 비어 있고, 그때는 안내만 뜬다. */}
        {steps.length > 0 ? (
          <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: 1.8 }}>
            {steps.map(s => (
              <li key={s.id}>
                {s.action === 'submit' && '신청 접수'}
                {s.action === 'reselect' && '재선택 접수'}
                {s.action === 'confirm' && '확정 처리'}
                {s.status === 'failed' && ' (실패)'}
                <span style={{ color: '#777', marginLeft: '8px' }}>
                  {shortKst(new Date(s.timestamp))}
                </span>
              </li>
            ))}
            <li style={{ color: '#777' }}>관리자 검토 대기 중</li>
          </ol>
        ) : (
          <div style={{ fontSize: '13px', color: '#777' }}>관리자 검토 대기 중</div>
        )}

        <div style={{ fontSize: '12px', color: '#777', marginTop: '10px' }}>
          접수 후 {RESPONSE_SLA_HOURS}시간 안에 회신합니다. 기한까지는 다시 확인하지 않으셔도 됩니다.
        </div>
      </div>
    );
  };

  // 확정된 슬롯을 캘린더로 넘기는 버튼 두 개.
  // 구글 캘린더는 새 탭 링크, .ics 는 내려받기라 둘 다 서버·키가 필요 없다.
  const renderCalendarActions = (confirmedSlotId: string | undefined, requestId: string) => {
    const slot = confirmedSlotId ? slots[confirmedSlotId] : undefined;
    if (!slot) return null;

    const event = slotToEvent(slot, customerId);
    if (!event) return null;

    const mail = buildConfirmationMail(slot, customerId);

    return (
      <div style={{ marginTop: '10px' }}>
        <a
          className="btn btn-secondary"
          href={googleCalendarUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginRight: '8px', textDecoration: 'none' }}
        >
          구글 캘린더에 추가
        </a>
        <button
          className="btn btn-secondary"
          onClick={() => downloadIcs(event, `${requestId}@cal.dudu-works`, `cal-dudu-${slot.id}.ics`)}
          style={{ marginRight: '8px' }}
        >
          캘린더 파일(.ics) 내려받기
        </button>
        {mail && (
          <>
            <a
              className="btn btn-secondary"
              href={gmailComposeUrl(mail)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-block', marginRight: '8px', textDecoration: 'none' }}
            >
              Gmail로 알리기
            </a>
            <a
              className="btn btn-secondary"
              href={mailtoUrl(mail)}
              style={{ display: 'inline-block', textDecoration: 'none' }}
            >
              메일 앱으로 알리기
            </a>
          </>
        )}
        <div style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
          일정 길이는 1시간으로 넣습니다. 예약은 날짜와 시간대로만 잡히고 소요시간은 계산하지 않습니다.
          메일은 앱이 직접 보내지 않고 내용이 채워진 작성 화면을 엽니다. 받는 사람은 직접 넣으세요.
        </div>
      </div>
    );
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
        {/* 고객 코드는 로컬 모드에서만 손으로 정한다.
            Supabase 모드에서는 로그인 계정이 곧 고객이고 화면 위에 이메일이 이미 떠 있어서,
            읽을 수 없는 uid 를 한 번 더 보여줄 이유가 없다. */}
        {onCustomerIdChange && (
          <>
            <label>고객 코드</label>
            <input
              type="text"
              value={customerId}
              onChange={e => onCustomerIdChange(e.target.value)}
              placeholder="C01"
              disabled={stage === 'confirm'}
            />
          </>
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
                {renderProgress(item.request)}
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
                <>
                  <div className="alert alert-success">
                    <strong>확정됨!</strong> {slots[item.request.confirmedSlotId!]?.date}{' '}
                    {TIME_SLOTS.find(t => t.label === slots[item.request.confirmedSlotId!]?.timeLabel)?.displayLabel}에
                    확정되었습니다.
                  </div>
                  {/* 확정된 예약만 캘린더로 내보낸다. 접수·재선택 상태는 시각이 안 정해져서 제외. */}
                  {renderCalendarActions(item.request.confirmedSlotId, item.request.id)}
                </>
              )}

              {/* 확정이 끝난 뒤에는 새 상담을 신청할 수 있다.
                  submit_request 는 received·needs_reselection 만 막고 confirmed 는 막지 않는다.
                  서버가 이미 허용하는 길인데 화면에 입구가 없었다. */}
              {item.request.status === 'confirmed' && idx === customerRequests.length - 1 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setStage('select');
                    setSelectedSlots([]);
                    setSuccess('');
                    setError('');
                  }}
                  style={{ marginTop: '12px' }}
                >
                  새 상담 신청하기
                </button>
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
