import React, { useState, useEffect, useRef } from 'react';
import { SlotTable } from './SlotTable';
import type { Slot, Request, Candidate, OperationLog } from '../types';
import { TIME_SLOTS } from '../utils/constants';
import type { Backend } from '../utils/backend';
import { BookingCalendar } from './BookingCalendar';
import { deadlineView, elapsedLabel } from '../utils/policy';

interface AdminPageProps {
  backend: Backend;
  // Supabase 모드에서는 로그인한 어드민의 uid가 confirmations.admin_id로 기록된다.
  adminId: string;
}

export const AdminPage: React.FC<AdminPageProps> = ({ backend, adminId }) => {
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [requests, setRequests] = useState<
    Array<{ request: Request; candidates: Candidate[]; decision: any }>
  >([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [selectedSlotForConfirm, setSelectedSlotForConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'manage' | 'calendar'>('manage');
  // uid 는 사람이 못 읽는다. 어드민 화면에서만 이메일로 바꿔 보여준다.
  const [customerLabels, setCustomerLabels] = useState<Record<string, string>>({});
  // 확정한 예약이 캘린더에 들어갔는지. 블루프린트에서 비어 있던 어드민 쪽 접점.
  const [calendarResults, setCalendarResults] = useState<Record<string, { link?: string; error?: string }>>({});

  // 표시용 이름. 이메일을 못 구하면 uid 앞부분만 보여 표가 밀리지 않게 한다.
  const nameOf = (customerId: string) =>
    customerLabels[customerId] ||
    (customerId.length > 12 ? `${customerId.slice(0, 8)}…` : customerId);

  // 확정 실패 후 다시 누를 때 같은 작업 ID를 보내야 서버가 중복 확정을 걸러낸다.
  // 대상(요청·슬롯)이 바뀌면 다른 작업이므로 새로 발급한다.
  const confirmOpId = useRef<string | null>(null);

  useEffect(() => {
    confirmOpId.current = null;
  }, [selectedRequest, selectedSlotForConfirm]);

  // 초기 로드
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // 확정 작업에 꼭 필요한 것들. 실패하면 오류를 보여준다.
      const [nextSlots, nextRequests, nextLogs] = await Promise.all([
        backend.getSlots(),
        backend.getAdminRequests(),
        backend.getLogs(),
      ]);
      setSlots(nextSlots);
      setRequests(nextRequests);
      setLogs(nextLogs);
      setError('');

      // 이메일 표시는 곁들이는 정보다. 실패해도 uid 로 보이면 되고 확정은 그대로 된다.
      try {
        const [labels, cal] = await Promise.all([
          backend.getCustomerLabels(),
          backend.getCalendarResults(),
        ]);
        setCustomerLabels(labels);
        setCalendarResults(cal);
      } catch {
        setCustomerLabels({});
        setCalendarResults({});
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      return;
    }
    setSuccess('');
  };

  const handleConfirm = async () => {
    if (!selectedRequest || !selectedSlotForConfirm) {
      setError('요청과 슬롯을 선택하세요');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (!confirmOpId.current) {
        confirmOpId.current = `confirm-${
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`
        }`;
      }
      const result = await backend.confirmRequest(
        selectedRequest,
        selectedSlotForConfirm,
        adminId,
        confirmOpId.current
      );

      if (result.success) {
        confirmOpId.current = null;
        setSuccess(`확정되었습니다! 영향받은 요청: ${result.affectedRequests?.length || 0}건`);
        setSelectedRequest(null);
        setSelectedSlotForConfirm(null);
        setTimeout(() => loadData(), 500);
      } else {
        setError(result.error || '확정 실패');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const currentRequest = selectedRequest ? requests.find(r => r.request.id === selectedRequest) : null;

  // To-be ③: 오래 기다린 미확정 신청을 위로 올린다.
  // 앞의 두 개는 기다림을 견디게 하고, 이건 기다림 자체를 줄인다.
  // 자동 확정이 아니라 사람이 먼저 보게 만드는 것이라 수동 확정 규칙을 지킨다.
  const waitingSorted = [...requests].sort((a, b) => {
    const aPending = a.request.status !== 'confirmed';
    const bPending = b.request.status !== 'confirmed';
    if (aPending !== bPending) return aPending ? -1 : 1;
    return new Date(a.request.createdAt).getTime() - new Date(b.request.createdAt).getTime();
  });

  const overdueCount = requests.filter(
    r =>
      r.request.status !== 'confirmed' &&
      deadlineView(r.request.createdAt).overdue
  ).length;

  return (
    <div className="admin-page">
      <h2>어드민 패널</h2>

      {/* 확정 작업 화면과 달력 보기를 나눈다. 데이터는 같은 것을 쓴다. */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          className={`btn ${tab === 'manage' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('manage')}
        >
          신청 관리
        </button>
        <button
          className={`btn ${tab === 'calendar' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('calendar')}
        >
          예약 달력
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {tab === 'calendar' && (
        <BookingCalendar slots={slots} requests={requests} customerLabels={customerLabels} />
      )}

      {tab === 'manage' && (
      <>
      <div className="grid">
        {/* 요청 목록 */}
        <div>
          <h3>신청 목록 (총 {requests.length}건)</h3>
          {overdueCount > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: '10px' }}>
              회신 기한이 지난 신청이 {overdueCount}건 있습니다. 위쪽부터 처리하세요.
            </div>
          )}
          <p style={{ fontSize: '12px', color: '#666', margin: '0 0 8px' }}>
            미확정 신청을 오래 기다린 순으로 보여줍니다.
          </p>
          <div style={{ maxHeight: '500px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '4px' }}>
            <ul className="list" style={{ margin: 0 }}>
              {waitingSorted.map((item, idx) => (
                <li
                  key={item.request.id}
                  onClick={() => {
                    setSelectedRequest(item.request.id);
                    setSelectedSlotForConfirm(null);
                  }}
                  style={{
                    cursor: 'pointer',
                    background: selectedRequest === item.request.id ? '#e7f3ff' : 'white',
                    borderColor: selectedRequest === item.request.id ? '#007bff' : '#ddd',
                    marginBottom: '0',
                    borderRadius: '0',
                    borderBottom: '1px solid #ddd',
                  }}
                >
                  <div>
                    <strong>#{idx + 1}</strong> {nameOf(item.request.customerId)} (v
                    {item.request.version})
                    <br />
                    <span style={{ fontSize: '12px', color: '#666' }}>
                      {new Date(item.request.createdAt).toLocaleString()}
                    </span>
                    <br />
                    <span className={`slot-status ${item.request.status === 'confirmed' ? 'confirmed' : 'available'}`}>
                      {item.request.status === 'confirmed'
                        ? '확정됨'
                        : item.request.status === 'needs_reselection'
                          ? '재선택필요'
                          : '접수됨'}
                    </span>
                    {item.request.status !== 'confirmed' && (
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '12px',
                          fontWeight: deadlineView(item.request.createdAt).overdue ? 'bold' : 'normal',
                          color: deadlineView(item.request.createdAt).overdue ? '#dc3545' : '#666',
                        }}
                      >
                        {elapsedLabel(item.request.createdAt)}
                        {deadlineView(item.request.createdAt).overdue && ' · 기한 초과'}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 요청 상세 */}
        <div>
          <h3>요청 상세</h3>
          {currentRequest ? (
            <div style={{ padding: '16px', background: 'white', border: '1px solid #ddd', borderRadius: '4px' }}>
              <div className="form-group">
                <label>고객 코드</label>
                <input type="text" value={nameOf(currentRequest.request.customerId)} disabled />
                {customerLabels[currentRequest.request.customerId] && (
                  <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
                    ID: {currentRequest.request.customerId}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>상태</label>
                <input
                  type="text"
                  value={
                    currentRequest.request.status === 'confirmed'
                      ? '확정됨'
                      : currentRequest.request.status === 'needs_reselection'
                        ? '재선택필요'
                        : '접수됨'
                  }
                  disabled
                />
              </div>

              <div className="form-group">
                <label>희망 슬롯 (우선순위 순)</label>
                <ul className="list">
                  {currentRequest.candidates.map((c, idx) => {
                    const slot = slots[c.slotId];
                    const isAvailable = slot?.status === 'available';
                    return (
                      <li
                        key={c.id}
                        onClick={() => {
                          if (isAvailable && currentRequest.request.status !== 'confirmed') {
                            setSelectedSlotForConfirm(c.slotId);
                          }
                        }}
                        style={{
                          cursor: isAvailable && currentRequest.request.status !== 'confirmed' ? 'pointer' : 'default',
                          background:
                            selectedSlotForConfirm === c.slotId
                              ? '#d4edda'
                              : isAvailable
                                ? 'white'
                                : '#f8d7da',
                          borderColor: selectedSlotForConfirm === c.slotId ? '#28a745' : '#ddd',
                        }}
                      >
                        <span>
                          {idx + 1}. {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                          {' '}
                          <span style={{ marginLeft: '10px', fontSize: '12px' }}>
                            {isAvailable ? '(가능)' : '(마감)'}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {currentRequest.request.status === 'confirmed' && currentRequest.request.confirmedSlotId && (
                <div className="alert alert-success">
                  <strong>확정 완료</strong>
                  <br />
                  {slots[currentRequest.request.confirmedSlotId]?.date}{' '}
                  {TIME_SLOTS.find(t => t.label === slots[currentRequest.request.confirmedSlotId!]?.timeLabel)?.displayLabel}
                  <br />
                  {new Date(currentRequest.request.confirmedAt!).toLocaleString()}
                </div>
              )}

              {/* 확정 뒤에 실제로 무슨 일이 일어났는지 어드민에게 돌려준다.
                  As-is 에서는 확정 버튼을 누른 뒤가 화면에서 통째로 비어 있었다. */}
              {currentRequest.request.status === 'confirmed' && (() => {
                const cal = calendarResults[currentRequest.request.id];
                if (cal?.link) {
                  return (
                    <div style={{ padding: '12px 14px', background: '#eef3fb', border: '1px solid #c7d6ef', borderRadius: '4px' }}>
                      <strong style={{ fontSize: '14px' }}>확정 후 처리</strong>
                      <ul style={{ margin: '8px 0 10px', paddingLeft: '18px', fontSize: '13px', lineHeight: 1.7 }}>
                        <li>운영자 캘린더에 일정 생성됨</li>
                        <li>{nameOf(currentRequest.request.customerId)} 에게 초대 메일 발송됨</li>
                      </ul>
                      <a
                        className="btn btn-secondary"
                        href={cal.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'inline-block', textDecoration: 'none', padding: '6px 12px', fontSize: '13px' }}
                      >
                        캘린더에서 보기
                      </a>
                    </div>
                  );
                }
                if (cal?.error) {
                  return (
                    <div className="alert alert-error">
                      <strong>확정은 저장됐지만 캘린더 등록에 실패했습니다.</strong>
                      <br />
                      <span style={{ fontSize: '12px' }}>{cal.error}</span>
                      <br />
                      <span style={{ fontSize: '12px' }}>고객에게 초대 메일이 가지 않았습니다. 직접 안내가 필요합니다.</span>
                    </div>
                  );
                }
                return (
                  <div style={{ padding: '10px 14px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', color: '#666' }}>
                    캘린더 등록 결과를 아직 받지 못했습니다. 잠시 후 새로고침하세요.
                  </div>
                );
              })()}

              {currentRequest.request.status !== 'confirmed' && (
                <button
                  className="btn btn-success"
                  onClick={handleConfirm}
                  disabled={!selectedSlotForConfirm || loading}
                  style={{ marginTop: '10px', width: '100%' }}
                >
                  {loading ? '처리 중...' : '확정'}
                </button>
              )}
            </div>
          ) : (
            <div style={{ padding: '16px', background: '#f0f0f0', borderRadius: '4px', color: '#666' }}>
              목록에서 요청을 선택하세요
            </div>
          )}
        </div>
      </div>

      {/* 슬롯 현황 */}
      <div style={{ marginTop: '40px' }}>
        <h3>슬롯 현황 (표시용)</h3>
        <SlotTable slots={slots} selectedSlots={[]} onToggle={() => {}} mode="view" />
      </div>

      {/* 실행 기록 */}
      <div style={{ marginTop: '40px' }}>
        <h3>실행 기록 (최근 20건)</h3>
        <div className="table-container">
          <table className="slots-table">
            <thead>
              <tr>
                <th>시간</th>
                <th>행위</th>
                <th>요청ID</th>
                <th>슬롯</th>
                <th>결과</th>
                <th>오류</th>
              </tr>
            </thead>
            <tbody>
              {logs
                .slice()
                .reverse()
                .slice(0, 20)
                .map(log => (
                  <tr key={log.id} style={{ fontSize: '12px' }}>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                    <td>{log.action}</td>
                    <td style={{ fontSize: '10px', fontFamily: 'monospace' }}>
                      {log.requestId.substring(0, 8)}...
                    </td>
                    <td>{log.slotId ? log.slotId : '-'}</td>
                    <td>
                      <span style={{ color: log.status === 'success' ? '#28a745' : '#dc3545' }}>
                        {log.status === 'success' ? '성공' : '실패'}
                      </span>
                    </td>
                    <td style={{ color: '#dc3545' }}>{log.error ? log.error.substring(0, 30) : '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
};
