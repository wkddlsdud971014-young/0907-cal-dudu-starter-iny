// 로컬/Supabase 두 모드를 같은 인터페이스로 감싸는 계층.
// 화면 컴포넌트는 이 파일만 보고, 어느 저장소를 쓰는지 신경 쓰지 않는다.
import type { Slot, Request, Candidate, OperationLog } from '../types';
import type { DecisionResult } from './decide';
import { decideRequestStatus } from './decide';
import { DatabaseManager } from './database';
import { OperationManager } from './operations';
import {
  supabase,
  submitRequestRPC,
  confirmRequestRPC,
  resubmitRequestRPC,
} from './supabase';

export interface RequestView {
  request: Request;
  candidates: Candidate[];
  decision: DecisionResult;
}

export interface MutationResult {
  success: boolean;
  error?: string;
  requestId?: string;
  affectedRequests?: string[];
}

export interface Backend {
  readonly mode: 'local' | 'supabase';
  getSlots(): Promise<Record<string, Slot>>;
  getCustomerStatus(customerId: string): Promise<RequestView[]>;
  getAdminRequests(): Promise<RequestView[]>;
  getLogs(): Promise<OperationLog[]>;
  // 고객 자신의 진행 이력. 어드민 전용 getLogs 와 달리 본인 것만 돌아온다.
  // 권한이 없거나 정책이 아직 없으면 빈 배열이라 화면은 그대로 뜬다.
  getMyLogs(customerId: string): Promise<OperationLog[]>;
  // 확정 건이 캘린더에 실제로 들어갔는지. requestId → 결과.
  // 어드민이 자기가 누른 확정의 뒷일을 화면에서 확인하는 데 쓴다.
  getCalendarResults(): Promise<Record<string, { link?: string; error?: string }>>;
  // 고객 식별자를 사람이 읽을 이름으로 바꾸는 표. 어드민 화면 표시용이다.
  // 로컬 모드는 고객 코드가 이미 'C01' 이라 빈 표를 준다.
  getCustomerLabels(): Promise<Record<string, string>>;
  // 슬롯별로 지금 몇 명이 대기 중인지. slotId → 인원 수.
  // 접수는 점유가 아니라서 한 슬롯에 여러 명이 겹친다. 그 사실을 고르기 전에 보여준다.
  // 인원 수만 돌아오고 누구인지는 돌아오지 않는다. 실패하면 빈 표라 화면은 그대로 뜬다.
  getSlotDemand(): Promise<Record<string, number>>;
  submitRequest(customerId: string, slotIds: string[], operationId: string): Promise<MutationResult>;
  confirmRequest(
    requestId: string,
    slotId: string,
    adminId: string,
    operationId: string
  ): Promise<MutationResult>;
  resubmitRequest(
    customerId: string,
    requestId: string,
    slotIds: string[],
    operationId: string
  ): Promise<MutationResult>;
}

// ── 로컬 모드 ────────────────────────────────────────────────
// 기존 DatabaseManager/OperationManager를 그대로 감싸기만 한다.
export class LocalBackend implements Backend {
  readonly mode = 'local' as const;
  private om: OperationManager;

  constructor(private db: DatabaseManager) {
    this.om = new OperationManager(db);
  }

  async getSlots() {
    return this.db.getState().slots;
  }

  async getCustomerStatus(customerId: string) {
    return this.om.getCustomerStatus(customerId);
  }

  async getAdminRequests() {
    return this.om.getAdminRequests();
  }

  async getLogs() {
    return this.db.getState().logs || [];
  }

  async getCustomerLabels() {
    return {};
  }

  // 로컬 모드는 데이터가 전부 한 브라우저 안에 있어 직접 센다.
  // Supabase 쪽 slot_demand() 와 같은 기준이다 — 미확정(received) 신청, 열린 슬롯만.
  async getSlotDemand() {
    const state = this.db.getState();
    const openRequestIds = new Set(
      state.requests.filter(r => r.status === 'received').map(r => r.id)
    );

    const demand: Record<string, number> = {};
    state.candidates.forEach(c => {
      if (!openRequestIds.has(c.requestId)) return;
      if (state.slots[c.slotId]?.status !== 'available') return;
      demand[c.slotId] = (demand[c.slotId] || 0) + 1;
    });
    return demand;
  }

  // 로컬 모드에는 캘린더 연동이 없다.
  async getCalendarResults() {
    return {};
  }

  async getMyLogs(customerId: string) {
    const myIds = new Set(
      this.db.getRequestsByCustomerId(customerId).map(r => r.id)
    );
    return (this.db.getState().logs || []).filter(l => myIds.has(l.requestId));
  }

  async submitRequest(customerId: string, slotIds: string[], operationId: string) {
    return this.om.submitRequest(customerId, slotIds, operationId);
  }

  async confirmRequest(requestId: string, slotId: string, adminId: string, operationId: string) {
    return this.om.confirmRequest(requestId, slotId, adminId, operationId);
  }

  async resubmitRequest(
    customerId: string,
    requestId: string,
    slotIds: string[],
    operationId: string
  ) {
    return this.om.resubmitRequest(customerId, requestId, slotIds, operationId);
  }
}

// ── Supabase 모드 ────────────────────────────────────────────
// DB는 snake_case, 앱 타입은 camelCase라 경계에서 변환한다.
type SlotRow = {
  id: string;
  date: string;
  time_label: string;
  status: 'available' | 'confirmed';
  confirmed_by?: string | null;
  confirmed_at?: string | null;
};

type CandidateRow = {
  id: string;
  request_id: string;
  slot_id: string;
  priority: number;
  version: number;
  queue_seq: number;
};

type RequestRow = {
  id: string;
  customer_id: string;
  version: number;
  created_at: string;
  status: Request['status'];
  confirmed_slot_id?: string | null;
  confirmed_at?: string | null;
  candidates?: CandidateRow[];
};

type LogRow = {
  id: string;
  timestamp: string;
  action: OperationLog['action'];
  request_id?: string | null;
  admin_id?: string | null;
  slot_id?: string | null;
  status: OperationLog['status'];
  error_message?: string | null;
};

function toSlot(r: SlotRow): Slot {
  return {
    id: r.id,
    date: r.date,
    timeLabel: r.time_label,
    status: r.status,
    confirmedBy: r.confirmed_by ?? undefined,
    confirmedAt: r.confirmed_at ?? undefined,
  };
}

function toRequest(r: RequestRow): Request {
  return {
    id: r.id,
    customerId: r.customer_id,
    version: r.version,
    createdAt: r.created_at,
    status: r.status,
    confirmedSlotId: r.confirmed_slot_id ?? undefined,
    confirmedAt: r.confirmed_at ?? undefined,
  };
}

function toCandidate(r: CandidateRow): Candidate {
  return {
    id: r.id,
    requestId: r.request_id,
    slotId: r.slot_id,
    priority: r.priority,
    version: r.version,
    queueSeq: r.queue_seq,
  };
}

function toLog(r: LogRow): OperationLog {
  return {
    id: r.id,
    timestamp: r.timestamp,
    action: r.action,
    requestId: r.request_id ?? '',
    adminId: r.admin_id ?? undefined,
    slotId: r.slot_id ?? undefined,
    status: r.status,
    error: r.error_message ?? undefined,
  };
}

// RPC는 성공/실패를 예외가 아니라 JSONB로 돌려준다. 통신 예외만 여기서 잡는다.
async function callRPC(fn: () => Promise<any>): Promise<MutationResult> {
  try {
    const data = await fn();
    if (data && typeof data === 'object') {
      return {
        success: Boolean(data.success),
        error: data.error,
        requestId: data.requestId,
        affectedRequests: data.affectedRequests ?? [],
      };
    }
    return { success: false, error: '알 수 없는 응답' };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const;

  private client() {
    if (!supabase) throw new Error('Supabase not initialized');
    return supabase;
  }

  async getSlots(): Promise<Record<string, Slot>> {
    const { data, error } = await this.client()
      .from('slots')
      .select('*')
      .order('date', { ascending: true })
      .order('time_label', { ascending: true });
    if (error) throw error;

    const map: Record<string, Slot> = {};
    // 스키마 제네릭을 생성하지 않아 supabase-js가 행 타입을 못 좁힌다. 경계에서만 단언한다.
    (data as unknown as SlotRow[] | null)?.forEach(row => {
      map[row.id] = toSlot(row);
    });
    return map;
  }

  // requests + 중첩 candidates를 한 번에 읽고 슬롯과 합쳐 판정한다.
  private async loadViews(customerId?: string): Promise<RequestView[]> {
    let query = this.client()
      .from('requests')
      .select('*, candidates(*)')
      .order('created_at', { ascending: true });

    if (customerId) query = query.eq('customer_id', customerId);

    const [{ data, error }, slots] = await Promise.all([query, this.getSlots()]);
    if (error) throw error;

    const rows = (data as unknown as RequestRow[] | null) || [];
    const allCandidates = rows.flatMap(r => (r.candidates || []).map(toCandidate));

    return rows.map(row => {
      const request = toRequest(row);
      // 판정은 로컬 모드와 같은 순수 함수를 재사용한다.
      const decision = decideRequestStatus(request, allCandidates, slots);
      return {
        request,
        candidates: allCandidates
          .filter(c => c.requestId === request.id)
          .sort((a, b) => a.priority - b.priority),
        decision,
      };
    });
  }

  async getCustomerStatus(customerId: string) {
    return this.loadViews(customerId);
  }

  async getAdminRequests() {
    return this.loadViews();
  }

  async getLogs(): Promise<OperationLog[]> {
    const { data, error } = await this.client()
      .from('operation_logs')
      .select('*')
      .order('timestamp', { ascending: false });
    // 로그는 어드민만 읽을 수 있다. 권한이 없으면 화면을 막지 말고 빈 목록으로 둔다.
    if (error) return [];
    return ((data as unknown as LogRow[] | null) || []).map(toLog);
  }

  // sql/05_calendar_link.sql 로 열이 생긴 뒤에만 값이 온다.
  // 열이 없거나 권한이 없으면 빈 표를 돌려 화면은 그대로 뜬다.
  async getCalendarResults(): Promise<Record<string, { link?: string; error?: string }>> {
    const { data, error } = await this.client()
      .from('confirmations')
      .select('request_id, calendar_link, calendar_error');
    if (error) return {};

    const map: Record<string, { link?: string; error?: string }> = {};
    (
      (data as unknown as Array<{
        request_id: string;
        calendar_link: string | null;
        calendar_error: string | null;
      }> | null) || []
    ).forEach(row => {
      map[row.request_id] = {
        link: row.calendar_link ?? undefined,
        error: row.calendar_error ?? undefined,
      };
    });
    return map;
  }

  // RLS 가 본인 신청에 달린 기록만 내려준다. sql/03_customer_logs.sql 참고.
  async getMyLogs(_customerId: string): Promise<OperationLog[]> {
    const { data, error } = await this.client()
      .from('operation_logs')
      .select('*')
      .order('timestamp', { ascending: true });
    // 정책을 아직 실행하지 않았으면 조용히 비운다. 타임라인만 안 보이고 화면은 산다.
    if (error) return [];
    return ((data as unknown as LogRow[] | null) || []).map(toLog);
  }

  async getSlotDemand(): Promise<Record<string, number>> {
    // 06_slot_demand.sql 을 아직 실행하지 않았으면 조용히 비운다.
    // 대기 인원은 곁들이는 정보라, 없다고 슬롯표까지 못 뜨게 만들면 안 된다.
    const { data, error } = await this.client().rpc('slot_demand');
    if (error) return {};

    const map: Record<string, number> = {};
    ((data as unknown as Array<{ slot_id: string; waiting: number }> | null) || []).forEach(row => {
      if (row?.slot_id) map[row.slot_id] = Number(row.waiting) || 0;
    });
    return map;
  }

  async getCustomerLabels(): Promise<Record<string, string>> {
    // 어드민이 아니면 함수가 막는다. 그때는 표시만 uid 로 남기고 화면은 그대로 둔다.
    const { data, error } = await this.client().rpc('admin_customer_emails');
    if (error) return {};

    const map: Record<string, string> = {};
    ((data as unknown as Array<{ id: string; email: string }> | null) || []).forEach(row => {
      if (row?.id && row?.email) map[row.id] = row.email;
    });
    return map;
  }

  async submitRequest(customerId: string, slotIds: string[], operationId: string) {
    return callRPC(() => submitRequestRPC(customerId, slotIds, operationId));
  }

  async confirmRequest(requestId: string, slotId: string, adminId: string, operationId: string) {
    return callRPC(() => confirmRequestRPC(requestId, slotId, adminId, operationId));
  }

  async resubmitRequest(
    customerId: string,
    requestId: string,
    slotIds: string[],
    operationId: string
  ) {
    return callRPC(() => resubmitRequestRPC(customerId, requestId, slotIds, operationId));
  }
}

export function createBackend(mode: 'local' | 'supabase', db: DatabaseManager): Backend {
  return mode === 'supabase' ? new SupabaseBackend() : new LocalBackend(db);
}
