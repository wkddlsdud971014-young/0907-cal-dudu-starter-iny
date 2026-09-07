// 로컬 인메모리 데이터베이스 (트랜잭션 지원)
import type { Slot, Request, Candidate, OperationLog } from '../types';
import { generateSlotId, getAllDates, TIME_SLOTS } from './constants';

export interface LocalDatabase {
  slots: Record<string, Slot>;
  requests: Request[];
  candidates: Candidate[];
  logs: OperationLog[];
  operationIdempotency: Record<string, { result: unknown; error?: string }>;
  nextQueueSeq: number;
}

// 초기 데이터베이스 상태
export function initializeDatabase(): LocalDatabase {
  const slots: Record<string, Slot> = {};
  const dates = getAllDates();

  dates.forEach(date => {
    TIME_SLOTS.forEach(slot => {
      const slotId = generateSlotId(date, slot.label);
      slots[slotId] = {
        id: slotId,
        date,
        timeLabel: slot.label,
        status: 'available',
      };
    });
  });

  return {
    slots,
    requests: [],
    candidates: [],
    logs: [],
    operationIdempotency: {},
    nextQueueSeq: 1,
  };
}

// 로컬 데이터베이스 매니저 (트랜잭션 지원)
export class DatabaseManager {
  private db: LocalDatabase;
  private draft: LocalDatabase | null = null; // 트랜잭션 중인 draft

  constructor() {
    this.db = initializeDatabase();
    this.loadFromLocalStorage();
  }

  // 로컬 스토리지 저장/복원
  private loadFromLocalStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('cal_dudu_db');
        if (stored) {
          const data = JSON.parse(stored);
          this.db = data;
        }
      }
    } catch (e) {
      // Node.js 환경 또는 localStorage 오류 무시
      this.db = initializeDatabase();
    }
  }

  private saveToLocalStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('cal_dudu_db', JSON.stringify(this.db));
      }
    } catch (e) {
      // Node.js 환경 또는 localStorage 오류 무시
    }
  }

  // 작업 ID로 중복 제출 방지
  checkIdempotency(operationId: string): { isDuplicate: boolean; cached?: unknown; error?: string } {
    const cached = this.db.operationIdempotency[operationId];
    if (cached) {
      return { isDuplicate: true, cached: cached.result, error: cached.error };
    }
    return { isDuplicate: false };
  }

  recordOperation(operationId: string, result: unknown, error?: string): void {
    this.db.operationIdempotency[operationId] = { result, error };
    this.saveToLocalStorage();
  }

  // 트랜잭션 시작 (draft 생성)
  beginTransaction(): void {
    this.draft = JSON.parse(JSON.stringify(this.db));
  }

  // 트랜잭션 커밋 (draft를 메모리로 교체)
  commitTransaction(): void {
    if (this.draft) {
      this.db = this.draft;
      this.draft = null;
      this.saveToLocalStorage();
    }
  }

  // 트랜잭션 롤백 (draft 폐기)
  rollbackTransaction(): void {
    this.draft = null;
  }

  // 현재 작업 대상 (draft 또는 main)
  private getCurrent(): LocalDatabase {
    return this.draft || this.db;
  }

  // 슬롯 조회
  getSlot(slotId: string): Slot | undefined {
    return this.getCurrent().slots[slotId];
  }

  getAllSlots(): Slot[] {
    return Object.values(this.getCurrent().slots);
  }

  // 슬롯 상태 업데이트
  updateSlot(slotId: string, updates: Partial<Slot>): void {
    const current = this.getCurrent();
    const slot = current.slots[slotId];
    if (slot) {
      current.slots[slotId] = { ...slot, ...updates };
    }
  }

  // 요청 생성 (고객당 1개만 허용, needs_reselection 상태는 제외)
  createRequest(customerId: string): Request | null {
    const current = this.getCurrent();
    // 고객의 미확정 요청이 있으면 새로 생성하지 않음
    const existing = current.requests.find(
      r => r.customerId === customerId && r.status !== 'confirmed'
    );
    if (existing) {
      return null; // 이미 미확정 요청이 있음
    }

    const request: Request = {
      id: generateId(),
      customerId,
      version: 1,
      createdAt: new Date().toISOString(),
      status: 'received',
    };
    current.requests.push(request);
    return request;
  }

  // 요청 조회
  getRequest(id: string): Request | undefined {
    return this.getCurrent().requests.find(r => r.id === id);
  }

  getRequestsByCustomerId(customerId: string): Request[] {
    return this.getCurrent().requests.filter(r => r.customerId === customerId);
  }

  getAllRequests(): Request[] {
    return this.getCurrent().requests;
  }

  // 요청 상태 업데이트
  updateRequest(id: string, updates: Partial<Request>): void {
    const current = this.getCurrent();
    const request = current.requests.find(r => r.id === id);
    if (request) {
      const idx = current.requests.indexOf(request);
      current.requests[idx] = { ...request, ...updates };
    }
  }

  // 후보 생성/추가
  addCandidate(
    requestId: string,
    slotId: string,
    priority: number,
    version: number
  ): Candidate {
    const current = this.getCurrent();
    const candidate: Candidate = {
      id: generateId(),
      requestId,
      slotId,
      priority,
      version,
      queueSeq: current.nextQueueSeq,
    };
    current.nextQueueSeq += 1;
    current.candidates.push(candidate);
    return candidate;
  }

  // 후보 조회
  getCandidatesByRequestId(requestId: string): Candidate[] {
    return this.getCurrent().candidates.filter(c => c.requestId === requestId);
  }

  getAllCandidates(): Candidate[] {
    return this.getCurrent().candidates;
  }

  // 요청의 모든 후보 삭제
  deleteCandidatesByRequestId(requestId: string): void {
    const current = this.getCurrent();
    current.candidates = current.candidates.filter(c => c.requestId !== requestId);
  }

  // 로그 추가
  addLog(log: Omit<OperationLog, 'id'>): OperationLog {
    const current = this.getCurrent();
    const fullLog: OperationLog = {
      id: generateId(),
      ...log,
    };
    current.logs.push(fullLog);
    return fullLog;
  }

  getAllLogs(): OperationLog[] {
    return this.getCurrent().logs;
  }

  // 전체 상태 리셋 (테스트용)
  reset(): void {
    this.db = initializeDatabase();
    this.draft = null;
    this.saveToLocalStorage();
  }

  // 현재 상태 export
  getState(): LocalDatabase {
    return this.getCurrent();
  }
}

// UUID 생성
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
