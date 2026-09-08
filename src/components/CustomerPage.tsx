import React, { useState, useEffect, useRef } from 'react';
import { SlotTable } from './SlotTable';
import type { Slot, Request, Candidate } from '../types';
import { decideRequestStatus } from '../utils/decide';
import { TIME_SLOTS } from '../utils/constants';
import type { Backend } from '../utils/backend';
import { slotToEvent, googleCalendarUrl, downloadIcs } from '../utils/calendar';
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
  // 슬롯별 대기 인원. 접수가 점유가 아니라는 사실을 고르기 전에 알려주는 값이다.
  const [slotDemand, setSlotDemand] = useState<Record<string, number>>({});

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

  // retry: 첫 조회가 실패했을 때 한 번만 더 부를지.
  //
  // 익명 로그인 직후 첫 조회가 "JWT issued at future" 로 튕기는 일이 있다.
  // 토큰을 발급하는 인증 서버와 조회를 받는 API 서버의 시계가 순간적으로 어긋나면,
  // 방금 발급된 토큰의 iat 가 API 서버 기준으로 아직 미래라 거부된다.
  // 몇백 밀리초 뒤에는 통과한다. 배포판에서 처음 들어온 사람이 전부 이걸 맞고
  // 화면이 빈 채로 굳어서, 한 번만 조용히 다시 부른다.
  const loadData = async (retry = true) => {
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

      // 대기 인원도 곁들이는 정보다. 06_slot_demand.sql 을 아직 실행하지 않았거나
      // 조회가 막혀도 슬롯표와 신청 현황은 그대로 보여야 한다.
      try {
        setSlotDemand(await backend.getSlotDemand());
      } catch {
        setSlotDemand({});
      }
      setError('');
    } catch (err: any) {
      if (retry) {
        await new Promise(r => setTimeout(r, 1200));
        return loadData(false);
      }
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
            : `${shortKst(view.deadline)} KST까지 회신 예정`}
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

  // 왼쪽에 "무엇을 예약하는가"를 고정해 두는 패널.
  //
  // Cal.com·TidyCal·Setmore·Microsoft·Zoho 캡처가 전부 같은 구조다.
  // 왼쪽에 서비스·소요시간·시간대를 붙박이로 두고 오른쪽에서 고르게 한다.
  // 우리 화면에는 그 왼쪽이 아예 없어서, 무엇을 신청하는 중인지 알려주는 문장이
  // 화면 어디에도 없었다.
  const renderAside = () => (
    <aside className="pane-side">
      <div className="svc">
        <p className="svc-host">Duduworks</p>
        <h2 className="svc-name">상담 예약</h2>
        <dl className="svc-meta">
          <dt>소요</dt>
          <dd>1시간</dd>
          <dt>시간대</dt>
          <dd>한국 표준시 (KST)</dd>
          <dt>예약 기간</dt>
          <dd>9월 9일 ~ 9월 22일</dd>
          <dt>회신</dt>
          <dd>신청 후 {RESPONSE_SLA_HOURS}시간 이내</dd>
        </dl>
      </div>

      <div className="svc-how">
        <h3>어떻게 진행되나요</h3>
        <ol>
          <li>원하는 시간을 최대 3개까지 고릅니다. 먼저 고른 것이 1순위입니다.</li>
          <li>신청해도 자리가 잡히지는 않습니다. 다른 분과 같은 시간을 신청할 수 있습니다.</li>
          <li>담당자가 희망 중 하나를 확정하면 그 시간이 마감됩니다.</li>
          <li>희망이 모두 마감되면 다시 고르실 수 있습니다.</li>
        </ol>
      </div>
    </aside>
  );

  // 지금 어느 단계인지. Zoho 는 Service·Date,Time&Staff·Your Info 를 왼쪽에 세워두고,
  // Setmore 는 Summary 로 같은 일을 한다. 우리 화면도 네 단계인데 표시가 없었다.
  const renderStepper = () => {
    const steps =
      stage === 'reselect'
        ? [
            { key: 'pick', label: '다시 고르기' },
            { key: 'done', label: '검토 대기' },
          ]
        : [
            { key: 'select', label: '시간 고르기' },
            { key: 'confirm', label: '최종 확인' },
            { key: 'view', label: '검토 대기' },
          ];

    const nowIndex = steps.findIndex(s =>
      stage === 'reselect' ? s.key === 'pick' : s.key === stage
    );

    return (
      <ol className="stepper">
        {steps.map((s, i) => (
          <li key={s.key} className={i === nowIndex ? 'on' : i < nowIndex ? 'done' : ''}>
            <span className="n">{i < nowIndex ? '✓' : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
    );
  };

  // 화면 맨 위에 상태 한 줄. To-be v2 ⑥이 여기 들어간다.
  //
  // 진행 타임라인은 이미 카드 안에 있지만 본문 중간이라, 앱을 열 때마다 눈으로 찾아야 했다.
  // 상태를 맨 위 한 줄로 올려서 열자마자 읽고 닫을 수 있게 한다.
  // 새 정보를 만들지 않고 아래 카드에 이미 있는 값을 끌어올리기만 한다.
  const renderStatusBanner = () => {
    const latest = customerRequests[customerRequests.length - 1];
    if (!latest) return null;

    const { status, createdAt, confirmedSlotId } = latest.request;

    let tone = { bg: '#eef3fb', border: '#c7d6ef', label: '#1a376e' };
    let headline = '';
    let detail = '';

    if (status === 'confirmed') {
      const slot = confirmedSlotId ? slots[confirmedSlotId] : undefined;
      const time = TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel ?? '';
      tone = { bg: '#e8f5e9', border: '#93c79a', label: '#1b5e20' };
      headline = '예약이 확정되었습니다';
      detail = slot ? `${slot.date} ${time} · 한국 표준시(KST)` : '';
    } else if (status === 'needs_reselection') {
      tone = { bg: '#fff3cd', border: '#e0c068', label: '#7a5b00' };
      headline = '재선택이 필요합니다';
      detail = '희망하신 시간이 모두 마감되었습니다. 아래에서 다시 골라주세요.';
    } else {
      const view = deadlineView(createdAt);
      tone = view.overdue
        ? { bg: '#fff3cd', border: '#e0c068', label: '#7a5b00' }
        : { bg: '#eef3fb', border: '#c7d6ef', label: '#1a376e' };
      headline = '검토 대기 중';
      detail = view.overdue
        ? `회신 기한이 지났습니다 · 접수 후 ${elapsedLabel(createdAt)}`
        : `${shortKst(view.deadline)} KST까지 회신 · ${view.remainingLabel} · ${elapsedLabel(createdAt)}`;
    }

    return (
      <div
        style={{
          marginBottom: '16px',
          padding: '12px 16px',
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          borderLeft: `4px solid ${tone.label}`,
          borderRadius: '4px',
        }}
      >
        <div style={{ fontWeight: 'bold', fontSize: '15px', color: tone.label }}>{headline}</div>
        {detail && (
          <div style={{ fontSize: '13px', color: '#444', marginTop: '3px' }}>{detail}</div>
        )}
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
        <div style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
          확정되면 초대 메일이 이미 발송됩니다. 아래 버튼은 다른 캘린더 앱에 직접 넣고 싶을 때만 쓰세요.
          일정 길이는 1시간이며, 예약은 날짜와 시간대로만 잡습니다.
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
    <div className="customer-page pane">
      {renderAside()}

      <div className="pane-main">
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

      {/* 상태 배너는 어느 단계에서나 맨 위에 있다. 신청이 아직 없으면 보일 게 없어 비운다. */}
      {renderStatusBanner()}

      {renderStepper()}

      {stage === 'select' && (
        <div>
          <h3>슬롯 선택 (1~3개)</h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            원하는 슬롯을 최대 3개까지 고르세요. 먼저 고른 것이 1순위이고, 순위는 아래 목록에 표시됩니다.
          </p>
          <SlotTable
            slots={slots}
            selectedSlots={selectedSlots}
            onToggle={handleSlotToggle}
            mode="select"
            maxSelect={3}
            demand={slotDemand}
          />

          <div style={{ marginBottom: '20px' }}>
            <h4>선택한 슬롯 ({selectedSlots.length}/3)</h4>
            <ul className="list">
              {selectedSlots.map((slotId, idx) => {
                const slot = slots[slotId];
                return (
                  <li key={slotId}>
                    <span>
                      <b style={{
                        display: 'inline-block', minWidth: '52px', marginRight: '8px',
                        padding: '1px 7px', fontSize: '12px',
                        background: idx === 0 ? '#2446ad' : '#dde3ee',
                        color: idx === 0 ? '#fff' : '#333',
                      }}>{idx + 1}순위</b>
                      {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
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
          {/* 제출하기 전에 언제 답을 받는지 알려준다. As-is 에서는 제출한 뒤에야
              알 수 있어서, 고르는 동안 얼마나 기다릴지 가늠할 수 없었다. */}
          <div className="alert alert-info" style={{ fontSize: '14px' }}>
            제출 후 <strong>{RESPONSE_SLA_HOURS}시간 안에 회신</strong>합니다.
            그때까지 기다리시면 되고, 진행 상태는 이 화면에서 계속 확인할 수 있습니다.
            모든 시각은 한국 표준시(KST) 기준입니다.
          </div>
          {/* 여기서 42칸 표를 다시 펼치지 않는다.
              고를 수 없는 표라 읽을 이유가 없고, 고른 것은 바로 아래에 그대로 있다.
              Setmore·Zoho 도 확인 단계에서는 Summary 만 보여준다. */}

          <div style={{ marginBottom: '20px' }}>
            <h4>최종 선택 (우선순위 순)</h4>
            <ul className="list">
              {selectedSlots.map((slotId, idx) => {
                const slot = slots[slotId];
                return (
                  <li key={slotId}>
                    <span>
                      <b style={{
                        display: 'inline-block', minWidth: '52px', marginRight: '8px',
                        padding: '1px 7px', fontSize: '12px',
                        background: idx === 0 ? '#2446ad' : '#dde3ee',
                        color: idx === 0 ? '#fff' : '#333',
                      }}>{idx + 1}순위</b>
                      {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
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
          {/* 새 상담 신청은 개별 카드가 아니라 화면 전체에 걸린 동작이라
              제목 줄 오른쪽에 둔다. 카드 맨 아래에 있으면 스크롤해야 보인다. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>내 신청 현황</h3>
            {customerRequests[customerRequests.length - 1]?.request.status === 'confirmed' && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setStage('select');
                  setSelectedSlots([]);
                  setSuccess('');
                  setError('');
                }}
              >
                새 상담 신청하기
              </button>
            )}
          </div>
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
                          <b style={{
                            display: 'inline-block', minWidth: '52px', marginRight: '8px',
                            padding: '1px 7px', fontSize: '12px',
                            background: cidx === 0 ? '#2446ad' : '#dde3ee',
                            color: cidx === 0 ? '#fff' : '#333',
                          }}>{cidx + 1}순위</b>
                          {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                          {' '}
                          {/* 마감된 후보는 언제 닫혔는지 함께 보여준다.
                              시각은 슬롯에 적혀 있고 누구나 읽을 수 있다.
                              누가 가져갔는지(confirmedBy)는 고객 식별 정보라 쓰지 않는다. */}
                          <span style={{ marginLeft: '10px', fontSize: '12px', color: isAvailable ? '#28a745' : '#dc3545' }}>
                            {isAvailable
                              ? '(가능)'
                              : slot?.confirmedAt
                                ? `(${shortKst(new Date(slot.confirmedAt))} KST 마감)`
                                : '(마감)'}
                          </span>
                          {/* 아직 열려 있는 후보에만 경쟁 상황을 보여준다.
                              마감된 후보는 결과가 이미 나와서 대기 수가 의미 없다. */}
                          {isAvailable && (slotDemand[c.slotId] || 0) > 1 && (
                            <span style={{ marginLeft: '8px', fontSize: '12px', color: '#b26a00' }}>
                              나 포함 {slotDemand[c.slotId]}명 대기
                            </span>
                          )}
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

            {/* 원래 무엇을 골랐고 언제 닫혔는지를 재선택하는 내내 옆에 둔다. To-be v2 ⑤.
                고객은 여기서 개인 달력을 다녀오기 때문에, 돌아왔을 때 이전 선택이
                화면에 남아 있지 않으면 맥락을 다시 세워야 한다. */}
            <div style={{ marginBottom: '20px', padding: '14px 16px', background: '#f7f7f7', border: '1px solid #ddd', borderRadius: '4px' }}>
              <h4 style={{ margin: '0 0 4px', fontSize: '14px' }}>이전에 신청하신 시간</h4>
              <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#666' }}>
                신청 #{latest.request.version} · 접수 {shortKst(new Date(latest.request.createdAt))} KST
              </p>
              <ul className="list" style={{ margin: 0 }}>
                {latest.candidates.map((c, cidx) => {
                  const slot = slots[c.slotId];
                  return (
                    <li key={c.id}>
                      <span>
                        <b style={{
                          display: 'inline-block', minWidth: '52px', marginRight: '8px',
                          padding: '1px 7px', fontSize: '12px',
                          background: '#dde3ee', color: '#333',
                        }}>{cidx + 1}순위</b>
                        {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
                        <span style={{ marginLeft: '10px', fontSize: '12px', color: '#dc3545' }}>
                          {slot?.confirmedAt
                            ? `(${shortKst(new Date(slot.confirmedAt))} KST 마감)`
                            : '(마감)'}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

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
            demand={slotDemand}
          />

          <div style={{ marginBottom: '20px' }}>
            <h4>새로 선택한 슬롯 ({selectedSlots.length}/3)</h4>
            <ul className="list">
              {selectedSlots.map((slotId, idx) => {
                const slot = slots[slotId];
                return (
                  <li key={slotId}>
                    <span>
                      <b style={{
                        display: 'inline-block', minWidth: '52px', marginRight: '8px',
                        padding: '1px 7px', fontSize: '12px',
                        background: idx === 0 ? '#2446ad' : '#dde3ee',
                        color: idx === 0 ? '#fff' : '#333',
                      }}>{idx + 1}순위</b>
                      {slot?.date} {TIME_SLOTS.find(t => t.label === slot?.timeLabel)?.displayLabel}
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
    </div>
  );
};
