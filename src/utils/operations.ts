// 업무 로직: 신청 제출, 확정, 재선택 등 (operationId 중복 방지, 고객당 1개 신청)
import { DatabaseManager } from './database';
import { validateSubmission, validateConfirmation, decideRequestStatus } from './decide';
import type { OperationLog } from '../types';

export class OperationManager {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  // 신청 제출 (고객이 슬롯을 선택하고 제출)
  async submitRequest(
    customerId: string,
    selectedSlotIds: string[],
    operationId: string
  ): Promise<{
    success: boolean;
    requestId?: string;
    error?: string;
    log?: OperationLog;
  }> {
    // operationId로 중복 제출 확인
    const idempotency = this.db.checkIdempotency(operationId);
    if (idempotency.isDuplicate) {
      return idempotency.cached as any;
    }

    let result: any = null;
    let logError: string | undefined;

    try {
      // 검증
      const validation = validateSubmission(selectedSlotIds, this.db.getState().slots);
      if (!validation.valid) {
        logError = validation.error;
        result = { success: false, error: validation.error };
        return result;
      }

      // 트랜잭션 시작
      this.db.beginTransaction();

      // 고객당 1개 신청만 허용 (미확정 요청이 없어야 함)
      const existingRequests = this.db.getRequestsByCustomerId(customerId);
      const hasPendingRequest = existingRequests.some(r => r.status !== 'confirmed');
      if (hasPendingRequest) {
        logError = 'Customer already has a pending request';
        result = { success: false, error: logError };
        this.db.rollbackTransaction();
        return result;
      }

      // 요청 생성
      const request = this.db.createRequest(customerId);
      if (!request) {
        logError = 'Failed to create request';
        result = { success: false, error: logError };
        this.db.rollbackTransaction();
        return result;
      }

      // 후보 추가 (우선순위 순서, version 포함)
      selectedSlotIds.forEach((slotId, index) => {
        this.db.addCandidate(request.id, slotId, index + 1, request.version);
      });

      // 트랜잭션 커밋
      this.db.commitTransaction();

      // 로그 생성 및 저장
      const log = this.db.addLog({
        timestamp: new Date().toISOString(),
        action: 'submit',
        requestId: request.id,
        status: 'success',
      });

      result = { success: true, requestId: request.id, log };
      return result;
    } catch (error) {
      this.db.rollbackTransaction();
      logError = String(error);
      const log = this.db.addLog({
        timestamp: new Date().toISOString(),
        action: 'submit',
        requestId: '',
        status: 'failed',
        error: logError,
      });
      result = { success: false, error: logError, log };
      return result;
    } finally {
      // 결과 캐싱 (성공/실패 모두 기록)
      this.db.recordOperation(operationId, result, logError);
    }
  }

  // 어드민 확정 (동일 슬롯 또는 동일 고객의 중복 확정 방지)
  async confirmRequest(
    requestId: string,
    selectedSlotId: string,
    adminId: string,
    operationId: string
  ): Promise<{
    success: boolean;
    error?: string;
    affectedRequests?: string[];
    log?: OperationLog;
  }> {
    // operationId로 중복 확인
    const idempotency = this.db.checkIdempotency(operationId);
    if (idempotency.isDuplicate) {
      return idempotency.cached as any;
    }

    let result: any = null;
    let logError: string | undefined;

    try {
      const request = this.db.getRequest(requestId);
      if (!request) {
        logError = 'Request not found';
        result = { success: false, error: logError };
        return result;
      }

      const candidates = this.db.getAllCandidates();
      const slots = this.db.getState().slots;

      // 확정 검증
      const validation = validateConfirmation(request, selectedSlotId, candidates, slots);
      if (!validation.valid) {
        logError = validation.error;
        result = { success: false, error: logError };
        return result;
      }

      // 트랜잭션: 슬롯 마감 + 요청 확정 + 영향받은 다른 요청 갱신
      const affectedRequests: string[] = [];

      this.db.beginTransaction();

      try {
        // 슬롯 마감
        this.db.updateSlot(selectedSlotId, {
          status: 'confirmed',
          confirmedBy: request.customerId,
          confirmedAt: new Date().toISOString(),
        });

        // 요청 확정
        this.db.updateRequest(requestId, {
          status: 'confirmed',
          confirmedSlotId: selectedSlotId,
          confirmedAt: new Date().toISOString(),
        });

        // 현재 version에서 모든 후보가 마감된 요청만 needs_reselection으로 갱신
        const allRequests = this.db.getAllRequests();
        const updatedSlots = this.db.getState().slots;
        allRequests.forEach(otherRequest => {
          if (otherRequest.id === requestId) return;
          if (otherRequest.status === 'confirmed') return;

          // 현재 version의 후보만 필터
          const otherCurrentCandidates = candidates.filter(
            c => c.requestId === otherRequest.id && c.version === otherRequest.version
          );

          // 마감된 슬롯을 포함하고 있나
          const hasConfirmedSlot = otherCurrentCandidates.some(c => c.slotId === selectedSlotId);

          if (hasConfirmedSlot) {
            // 현재 version에서 available 슬롯이 남아있는지 확인
            const hasAvailable = otherCurrentCandidates.some(c => {
              const slot = updatedSlots[c.slotId];
              return slot && slot.status === 'available';
            });

            if (!hasAvailable) {
              // 모든 현재 후보가 마감됨 → needs_reselection
              this.db.updateRequest(otherRequest.id, {
                status: 'needs_reselection',
              });
              affectedRequests.push(otherRequest.id);
            }
          }
        });

        this.db.commitTransaction();
      } catch (txError) {
        this.db.rollbackTransaction();
        throw txError;
      }

      // 로그
      const log = this.db.addLog({
        timestamp: new Date().toISOString(),
        action: 'confirm',
        requestId,
        adminId,
        slotId: selectedSlotId,
        status: 'success',
      });

      result = { success: true, affectedRequests, log };
      return result;
    } catch (error) {
      this.db.rollbackTransaction();
      logError = String(error);
      const log = this.db.addLog({
        timestamp: new Date().toISOString(),
        action: 'confirm',
        requestId,
        adminId,
        slotId: selectedSlotId,
        status: 'failed',
        error: logError,
      });
      result = { success: false, error: logError, log };
      return result;
    } finally {
      this.db.recordOperation(operationId, result, logError);
    }
  }

  // 고객이 재선택 제출 (새로운 후보로)
  async resubmitRequest(
    customerId: string,
    previousRequestId: string,
    newSlotIds: string[],
    operationId: string
  ): Promise<{
    success: boolean;
    requestId?: string;
    error?: string;
    log?: OperationLog;
  }> {
    // operationId로 중복 제출 확인
    const idempotency = this.db.checkIdempotency(operationId);
    if (idempotency.isDuplicate) {
      return idempotency.cached as any;
    }

    let result: any = null;
    let logError: string | undefined;

    try {
      const previousRequest = this.db.getRequest(previousRequestId);
      if (!previousRequest) {
        logError = 'Previous request not found';
        result = { success: false, error: logError };
        return result;
      }

      // 소유자 확인
      if (previousRequest.customerId !== customerId) {
        logError = 'Not request owner';
        result = { success: false, error: logError };
        return result;
      }

      // 이전 요청의 상태 확인
      if (previousRequest.status === 'confirmed') {
        logError = 'Cannot reselect confirmed request';
        result = { success: false, error: logError };
        return result;
      }

      // 검증
      const validation = validateSubmission(newSlotIds, this.db.getState().slots);
      if (!validation.valid) {
        logError = validation.error;
        result = { success: false, error: logError };
        return result;
      }

      // 트랜잭션 시작
      this.db.beginTransaction();

      // 기존 요청 업데이트 (version 증가, 상태 received)
      const newVersion = previousRequest.version + 1;
      this.db.updateRequest(previousRequestId, {
        version: newVersion,
        status: 'received',
      });

      // 새 후보 추가 (같은 requestId 유지)
      newSlotIds.forEach((slotId, index) => {
        this.db.addCandidate(previousRequest.id, slotId, index + 1, newVersion);
      });

      this.db.commitTransaction();

      // 로그
      const log = this.db.addLog({
        timestamp: new Date().toISOString(),
        action: 'reselect',
        requestId: previousRequestId,
        status: 'success',
      });

      result = { success: true, requestId: previousRequestId, log };
      return result;
    } catch (error) {
      this.db.rollbackTransaction();
      logError = String(error);
      const log = this.db.addLog({
        timestamp: new Date().toISOString(),
        action: 'reselect',
        requestId: previousRequestId,
        status: 'failed',
        error: logError,
      });
      result = { success: false, error: logError, log };
      return result;
    } finally {
      this.db.recordOperation(operationId, result, logError);
    }
  }

  // 고객의 현재 상태 조회
  getCustomerStatus(customerId: string) {
    const requests = this.db.getRequestsByCustomerId(customerId);
    const candidates = this.db.getAllCandidates();
    const slots = this.db.getState().slots;

    return requests.map(request => {
      const requestCandidates = candidates.filter(c => c.requestId === request.id);
      const decision = decideRequestStatus(request, candidates, slots);

      return {
        request,
        candidates: requestCandidates.sort((a, b) => a.priority - b.priority),
        decision,
      };
    });
  }

  // 어드민 요청 목록
  getAdminRequests() {
    const requests = this.db.getAllRequests();
    const candidates = this.db.getAllCandidates();
    const slots = this.db.getState().slots;

    return requests
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(request => {
        const requestCandidates = candidates.filter(c => c.requestId === request.id);
        const decision = decideRequestStatus(request, candidates, slots);

        return {
          request,
          candidates: requestCandidates.sort((a, b) => a.priority - b.priority),
          decision,
        };
      });
  }
}
