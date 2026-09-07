-- 실습 데이터 초기화. 처음부터 다시 시나리오를 돌릴 때 쓴다.
--
-- AGENTS.md 14행 "설치 SQL과 데이터 초기화를 분리하세요" 에 따라 설치 파일과 나눠 둔다.
-- 이 파일은 스키마·함수·정책을 건드리지 않는다. 쌓인 데이터만 지운다.
--
-- 주의: 예약 기록이 전부 사라진다. 구글 캘린더에 이미 만들어진 일정은
--       여기서 지워지지 않으므로 필요하면 캘린더에서 직접 지운다.

begin;

-- 참조 순서대로 지운다.
delete from confirmations;
delete from candidates;
delete from operation_logs;
delete from requests;

-- 42개 슬롯을 모두 열린 상태로 되돌린다. 슬롯 자체는 지우지 않는다.
update slots
set status = 'available',
    confirmed_by = null,
    confirmed_at = null,
    updated_at = now();

commit;

-- 확인
select
  (select count(*) from requests)       as requests,
  (select count(*) from candidates)     as candidates,
  (select count(*) from confirmations)  as confirmations,
  (select count(*) from operation_logs) as logs,
  (select count(*) from slots where status = 'available') as available_slots;
-- 기대값: 0, 0, 0, 0, 42
