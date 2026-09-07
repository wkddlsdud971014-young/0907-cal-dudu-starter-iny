// 슬롯: 42개 고정 (14일 × 3시간대)
export interface Slot {
  id: string; // "2026-09-07:am" 형식
  date: string; // "2026-09-07"
  timeLabel: string; // "am", "pm", "evening"
  status: 'available' | 'confirmed'; // confirmed면 마감
  confirmedAt?: string; // ISO 8601
  confirmedBy?: string; // 고객 코드
}

// 고객의 신청 (접수 한 번당 하나의 요청)
export interface Request {
  id: string; // UUID
  customerId: string; // "C01" 등
  version: number; // 재선택 시 증가
  createdAt: string; // ISO 8601
  status: 'received' | 'needs_reselection' | 'confirmed';
  confirmedSlotId?: string; // 어드민이 선택한 슬롯
  confirmedAt?: string; // ISO 8601
}

// 고객이 선택한 희망 슬롯 (여러 개)
export interface Candidate {
  id: string; // UUID
  requestId: string;
  slotId: string; // slot.id와 동일
  priority: number; // 1, 2, 3
  version: number; // 원래 요청의 버전 (재선택 이력 보존)
  queueSeq: number; // 전체 제출 순번 (고정, 재선택해도 유지)
}

// 운영 기록 (audit log)
export interface OperationLog {
  id: string; // UUID, 재시도 식별용
  timestamp: string; // ISO 8601
  action: 'submit' | 'confirm' | 'reselect';
  requestId: string; // 영향받은 요청
  adminId?: string; // 어드민만 설정
  slotId?: string; // 확정한 슬롯
  status: 'success' | 'failed';
  error?: string; // 실패 이유
}

export interface AppState {
  mode: 'local' | 'supabase'; // 현재 모드
  isAdmin: boolean; // 어드민 권한
  slots: Slot[];
  requests: Request[];
  candidates: Candidate[];
  logs: OperationLog[];
  userId?: string; // Supabase auth 사용자
}
