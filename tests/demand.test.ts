import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/utils/database';
import { LocalBackend } from '../src/utils/backend';

// 슬롯별 대기 인원. 화면이 "대기 2명"이라고 말하려면 이 숫자가 맞아야 한다.
//
// sql/06_slot_demand.sql 이 Supabase 쪽에서 같은 기준으로 센다.
// 두 모드가 같은 답을 내야 하므로 기준을 여기서 고정해 둔다.
describe('LocalBackend.getSlotDemand', () => {
  let db: DatabaseManager;
  let backend: LocalBackend;

  beforeEach(() => {
    db = new DatabaseManager();
    db.reset();
    backend = new LocalBackend(db);
  });

  it('접수가 없으면 빈 표를 준다', async () => {
    expect(await backend.getSlotDemand()).toEqual({});
  });

  it('같은 슬롯을 노리는 신청을 사람 수로 센다', async () => {
    await backend.submitRequest('C01', ['2026-09-09:am', '2026-09-09:pm'], 'op-1');
    await backend.submitRequest('C02', ['2026-09-09:am'], 'op-2');

    const demand = await backend.getSlotDemand();
    expect(demand['2026-09-09:am']).toBe(2);
    expect(demand['2026-09-09:pm']).toBe(1);
  });

  it('한 번도 안 고른 슬롯은 표에 없다', async () => {
    await backend.submitRequest('C01', ['2026-09-09:am'], 'op-1');

    const demand = await backend.getSlotDemand();
    expect(demand['2026-09-10:evening']).toBeUndefined();
  });

  it('확정으로 마감된 슬롯은 세지 않는다', async () => {
    const first = await backend.submitRequest('C01', ['2026-09-09:am'], 'op-1');
    await backend.submitRequest('C02', ['2026-09-09:am'], 'op-2');
    expect((await backend.getSlotDemand())['2026-09-09:am']).toBe(2);

    await backend.confirmRequest(first.requestId!, '2026-09-09:am', 'ADMIN001', 'op-3');

    // 슬롯이 닫혔으므로 경쟁이라는 말 자체가 성립하지 않는다.
    // 화면은 이 자리를 "마감"으로 표시하고 대기 수를 지운다.
    expect((await backend.getSlotDemand())['2026-09-09:am']).toBeUndefined();
  });

  it('재선택 필요로 밀려난 신청은 세지 않는다', async () => {
    const first = await backend.submitRequest('C01', ['2026-09-09:am'], 'op-1');
    // C02 는 9/9 오전만 골랐다. C01 이 그 자리를 가져가면 C02 는 재선택 필요가 된다.
    await backend.submitRequest('C02', ['2026-09-09:am'], 'op-2');
    await backend.submitRequest('C03', ['2026-09-09:pm'], 'op-3');

    await backend.confirmRequest(first.requestId!, '2026-09-09:am', 'ADMIN001', 'op-4');

    const demand = await backend.getSlotDemand();
    // C03 은 여전히 접수 상태라 남는다.
    expect(demand['2026-09-09:pm']).toBe(1);
  });
});
