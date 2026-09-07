import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/utils/database';
import { OperationManager } from '../src/utils/operations';

describe('OperationManager', () => {
  let db: DatabaseManager;
  let om: OperationManager;

  beforeEach(() => {
    db = new DatabaseManager();
    db.reset();
    om = new OperationManager(db);
  });

  describe('submitRequest', () => {
    it('should create a request with selected slots', async () => {
      const result = await om.submitRequest('C01', ['2026-09-09:am', '2026-09-09:pm'], 'op-1');

      expect(result.success).toBe(true);
      expect(result.requestId).toBeDefined();

      const request = db.getRequest(result.requestId!);
      expect(request).toBeDefined();
      expect(request?.customerId).toBe('C01');
      expect(request?.status).toBe('received');

      const candidates = db.getCandidatesByRequestId(request!.id);
      expect(candidates).toHaveLength(2);
      expect(candidates[0].priority).toBe(1);
      expect(candidates[1].priority).toBe(2);
    });

    it('should reject submission with 0 slots', async () => {
      const result = await om.submitRequest('C01', [], 'op-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('1~3개');
    });

    it('should reject submission with 4+ slots', async () => {
      const result = await om.submitRequest(
        'C01',
        ['2026-09-09:am', '2026-09-09:pm', '2026-09-09:evening', '2026-09-10:am'],
        'op-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('1~3개');
    });

    it('should reject duplicate submission with same operationId', async () => {
      const opId = 'op-duplicate';
      const result1 = await om.submitRequest('C01', ['2026-09-09:am'], opId);
      const result2 = await om.submitRequest('C01', ['2026-09-09:pm'], opId);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result2.requestId).toBe(result1.requestId); // 캐시됨
    });

    it('should reject customer with pending request', async () => {
      await om.submitRequest('C01', ['2026-09-09:am'], 'op-1');
      const result2 = await om.submitRequest('C01', ['2026-09-09:pm'], 'op-2');

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('pending request');
    });

    it('should allow resubmit after reselection', async () => {
      const r1 = await om.submitRequest('C01', ['2026-09-09:am'], 'op-1');
      const req1 = db.getRequest(r1.requestId!);

      // 확정
      await om.confirmRequest(req1!.id, '2026-09-09:am', 'ADMIN', 'op-confirm');

      // 다시 신청 가능
      const r2 = await om.submitRequest('C01', ['2026-09-09:pm'], 'op-3');
      expect(r2.success).toBe(true);
    });
  });

  describe('confirmRequest', () => {
    it('should confirm a request and mark slot as unavailable', async () => {
      const submit = await om.submitRequest('C01', ['2026-09-09:am', '2026-09-09:pm'], 'op-1');
      const requestId = submit.requestId!;

      const confirm = await om.confirmRequest(requestId, '2026-09-09:am', 'ADMIN', 'op-confirm');

      expect(confirm.success).toBe(true);

      const request = db.getRequest(requestId);
      expect(request?.status).toBe('confirmed');
      expect(request?.confirmedSlotId).toBe('2026-09-09:am');

      const slot = db.getSlot('2026-09-09:am');
      expect(slot?.status).toBe('confirmed');
    });

    it('should mark affected requests as needs_reselection', async () => {
      // 두 고객 모두 같은 슬롯에 신청
      const r1 = await om.submitRequest('C01', ['2026-09-09:am'], 'op-1');
      const r2 = await om.submitRequest('C02', ['2026-09-09:am'], 'op-2');

      // C01 확정
      await om.confirmRequest(r1.requestId!, '2026-09-09:am', 'ADMIN', 'op-confirm-1');

      // C02는 needs_reselection
      const req2 = db.getRequest(r2.requestId!);
      expect(req2?.status).toBe('needs_reselection');
    });

    it('should reject confirmation of already confirmed request', async () => {
      const submit = await om.submitRequest('C01', ['2026-09-09:am'], 'op-1');
      await om.confirmRequest(submit.requestId!, '2026-09-09:am', 'ADMIN', 'op-confirm-1');

      const result = await om.confirmRequest(submit.requestId!, '2026-09-09:am', 'ADMIN', 'op-confirm-2');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already confirmed');
    });

    it('should reject confirmation of wrong slot', async () => {
      const submit = await om.submitRequest('C01', ['2026-09-09:am', '2026-09-09:pm'], 'op-1');

      const result = await om.confirmRequest(
        submit.requestId!,
        '2026-09-10:am', // 선택하지 않은 슬롯
        'ADMIN',
        'op-confirm'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('원래 희망');
    });

    it('should use idempotency with operationId', async () => {
      const submit = await om.submitRequest('C01', ['2026-09-09:am'], 'op-1');
      const opId = 'op-confirm-idempotent';

      const confirm1 = await om.confirmRequest(submit.requestId!, '2026-09-09:am', 'ADMIN', opId);
      const confirm2 = await om.confirmRequest(submit.requestId!, '2026-09-09:am', 'ADMIN', opId);

      expect(confirm1.success).toBe(true);
      expect(confirm2.success).toBe(true);
      expect(confirm2).toEqual(confirm1); // 캐시된 결과
    });
  });

  describe('resubmitRequest', () => {
    it('should create new request with higher version', async () => {
      const r1 = await om.submitRequest('C01', ['2026-09-09:am'], 'op-1');
      const req1 = db.getRequest(r1.requestId!);

      // needs_reselection 상태로 만들기
      const r2 = await om.submitRequest('C02', ['2026-09-09:am'], 'op-2');
      await om.confirmRequest(r2.requestId!, '2026-09-09:am', 'ADMIN', 'op-confirm');

      const req1Updated = db.getRequest(r1.requestId!);
      expect(req1Updated?.status).toBe('needs_reselection');

      // 재선택
      const r1New = await om.resubmitRequest('C01', r1.requestId!, ['2026-09-10:am'], 'op-reselect');
      expect(r1New.success).toBe(true);

      const reqNew = db.getRequest(r1New.requestId!);
      expect(reqNew?.version).toBe(2);
      expect(reqNew?.customerId).toBe('C01');
    });

    it('should reject reselect if not owner', async () => {
      const submit = await om.submitRequest('C01', ['2026-09-09:am'], 'op-1');

      const result = await om.resubmitRequest('C02', submit.requestId!, ['2026-09-10:am'], 'op-reselect');

      expect(result.success).toBe(false);
      expect(result.error).toContain('owner');
    });

    it('should reject reselect of confirmed request', async () => {
      const submit = await om.submitRequest('C01', ['2026-09-09:am'], 'op-1');
      await om.confirmRequest(submit.requestId!, '2026-09-09:am', 'ADMIN', 'op-confirm');

      const result = await om.resubmitRequest('C01', submit.requestId!, ['2026-09-10:am'], 'op-reselect');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot reselect');
    });
  });

  describe('integration', () => {
    it('should complete full workflow: submit -> confirm -> needs_reselection -> reselect -> confirm', async () => {
      // C01 신청
      const c01_r1 = await om.submitRequest('C01', ['2026-09-09:am', '2026-09-09:pm'], 'op-c01-1');
      expect(c01_r1.success).toBe(true);

      // C02 신청 (9/9 오전만)
      const c02_r1 = await om.submitRequest('C02', ['2026-09-09:am'], 'op-c02-1');
      expect(c02_r1.success).toBe(true);

      // C03 신청 (9/9 오전, 9/10 오전)
      const c03_r1 = await om.submitRequest('C03', ['2026-09-09:am', '2026-09-10:am'], 'op-c03-1');
      expect(c03_r1.success).toBe(true);

      // C01 확정 (2026-09-09:am)
      const confirm1 = await om.confirmRequest(c01_r1.requestId!, '2026-09-09:am', 'ADMIN', 'op-confirm-1');
      expect(confirm1.success).toBe(true);

      // C02는 needs_reselection (모든 후보 소진)
      const c02_req1 = db.getRequest(c02_r1.requestId!);
      expect(c02_req1?.status).toBe('needs_reselection');

      // C03는 received (한 후보 남음)
      const c03_req1 = db.getRequest(c03_r1.requestId!);
      expect(c03_req1?.status).toBe('received');

      // C02 재선택 (9/10 오전)
      const c02_r2 = await om.resubmitRequest('C02', c02_r1.requestId!, ['2026-09-10:am'], 'op-c02-reselect');
      expect(c02_r2.success).toBe(true);

      const c02_req2 = db.getRequest(c02_r2.requestId!);
      expect(c02_req2?.version).toBe(2);
      expect(c02_req2?.status).toBe('received');

      // C02 확정 (9/10 오전)
      const confirm2 = await om.confirmRequest(c02_r2.requestId!, '2026-09-10:am', 'ADMIN', 'op-confirm-2');
      expect(confirm2.success).toBe(true);

      const c02_req2_final = db.getRequest(c02_r2.requestId!);
      expect(c02_req2_final?.status).toBe('confirmed');
      expect(c02_req2_final?.confirmedSlotId).toBe('2026-09-10:am');
    });
  });
});
