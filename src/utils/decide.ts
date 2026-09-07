// 후보 가능 여부 판정 로직
import type { Slot, Request, Candidate } from '../types';

export interface DecisionResult {
  isValid: boolean; // 모든 후보가 유효한가
  availableCandidates: string[]; // 현재 선택 가능한 슬롯 ID 목록
  status: 'ok' | 'some_unavailable' | 'all_unavailable'; // 상태
  reason?: string; // 문제가 있으면 설명
}

export function decideRequestStatus(
  request: Request,
  candidates: Candidate[],
  slots: Record<string, Slot>
): DecisionResult {
  // 이미 확정된 요청
  if (request.status === 'confirmed') {
    return {
      isValid: true,
      availableCandidates: request.confirmedSlotId ? [request.confirmedSlotId] : [],
      status: 'ok',
    };
  }

  // 이 요청의 후보들
  const requestCandidates = candidates.filter(c => c.requestId === request.id);

  if (requestCandidates.length === 0) {
    return {
      isValid: false,
      availableCandidates: [],
      status: 'all_unavailable',
      reason: 'No slots selected',
    };
  }

  // 각 후보의 가용성 확인
  const availableCandidates: string[] = [];
  const allUnavailable: boolean[] = [];

  // 우선순위 순서로 정렬
  const sorted = [...requestCandidates].sort((a, b) => a.priority - b.priority);

  sorted.forEach(candidate => {
    const slot = slots[candidate.slotId];
    if (!slot) {
      allUnavailable.push(true);
      return;
    }

    // 마감 상태 확인
    if (slot.status === 'confirmed') {
      allUnavailable.push(true);
    } else {
      allUnavailable.push(false);
      availableCandidates.push(candidate.slotId);
    }
  });

  const hasAny = availableCandidates.length > 0;
  const allUnavail = allUnavailable.every(u => u);

  if (allUnavail) {
    return {
      isValid: false,
      availableCandidates: [],
      status: 'all_unavailable',
      reason: 'All candidates are unavailable',
    };
  }

  if (!hasAny) {
    return {
      isValid: false,
      availableCandidates: [],
      status: 'some_unavailable',
      reason: 'Some candidates are unavailable',
    };
  }

  return {
    isValid: true,
    availableCandidates,
    status: 'ok',
  };
}

// 신청 검증
export interface SubmissionValidation {
  valid: boolean;
  error?: string;
}

export function validateSubmission(
  slotIds: string[],
  slots: Record<string, Slot>
): SubmissionValidation {
  // 개수 검사
  if (slotIds.length < 1 || slotIds.length > 3) {
    return {
      valid: false,
      error: '1~3개의 슬롯을 선택하세요',
    };
  }

  // 중복 검사
  const unique = new Set(slotIds);
  if (unique.size !== slotIds.length) {
    return {
      valid: false,
      error: '중복된 슬롯이 있습니다',
    };
  }

  // 각 슬롯 유효성 검사
  for (const slotId of slotIds) {
    const slot = slots[slotId];
    if (!slot) {
      return {
        valid: false,
        error: `슬롯을 찾을 수 없습니다: ${slotId}`,
      };
    }

    // 마감 여부
    if (slot.status === 'confirmed') {
      return {
        valid: false,
        error: `슬롯이 마감되었습니다: ${slot.date} ${slot.timeLabel}`,
      };
    }
  }

  return { valid: true };
}

// 확정 가능 여부 (어드민용)
export interface ConfirmationValidation {
  valid: boolean;
  error?: string;
}

export function validateConfirmation(
  request: Request,
  slotId: string,
  candidates: Candidate[],
  slots: Record<string, Slot>
): ConfirmationValidation {
  // 요청이 존재하고 미확정 상태인가
  if (request.status === 'confirmed') {
    return {
      valid: false,
      error: 'already confirmed',
    };
  }

  // 선택한 슬롯이 원래 희망에 있는가
  const hasCandidate = candidates.some(
    c => c.requestId === request.id && c.slotId === slotId
  );

  if (!hasCandidate) {
    return {
      valid: false,
      error: '원래 희망한 슬롯이 아닙니다',
    };
  }

  // 슬롯이 현재 사용 가능한가
  const slot = slots[slotId];
  if (!slot) {
    return {
      valid: false,
      error: '슬롯을 찾을 수 없습니다',
    };
  }

  if (slot.status === 'confirmed') {
    return {
      valid: false,
      error: '이미 확정된 슬롯입니다',
    };
  }

  return { valid: true };
}
