-- 슬롯마다 몇 명이 대기 중인지 세는 조회 함수.
--
-- 왜 필요한가.
--   PRD 는 "접수는 점유가 아니다"라고 정한다. 여러 고객이 같은 슬롯에 신청할 수 있고,
--   확정만 슬롯을 마감한다. 그런데 지금까지 화면에는 그 사실이 어디에도 없어서,
--   고객은 자기 후보가 남과 겹쳤다는 걸 마감된 뒤에야 알았다.
--   숫자를 미리 보여주면 마감이 사후 통보에서 사전 예고로 바뀐다.
--
-- 무엇을 열고 무엇을 닫는가.
--   연다: 슬롯별 대기 "인원 수".
--   닫는다: 누가 신청했는지. customer_id·request_id·이메일은 한 열도 내보내지 않는다.
--   candidates 의 RLS 는 본인 것만 보게 막혀 있고 그 정책은 그대로 둔다.
--   security definer 로 집계만 우회하며, 우회 범위를 count 로 한정한다.
--
-- 세는 기준.
--   status = 'received' 인 미확정 신청만 센다.
--   needs_reselection 은 이미 후보가 무효라 경쟁이 아니고,
--   confirmed 는 슬롯이 이미 마감이라 셀 이유가 없다.
--   한 신청이 같은 슬롯을 두 번 가리킬 수 없으므로(unique_request_slot) 행 수 = 사람 수다.
--   마감된 슬롯은 결과에서 빠진다. 화면이 "마감"으로 이미 말하고 있다.
--
-- sql/00_supabase.sql 은 보호 대상이라 건드리지 않는다. 이 파일만 따로 실행한다.
-- 여러 번 실행해도 안전하다.

create or replace function public.slot_demand()
returns table (slot_id text, waiting integer)
security definer
set search_path = public
language sql
stable
as $$
  select c.slot_id, count(*)::int as waiting
  from candidates c
  join requests r on r.id = c.request_id
  join slots s on s.id = c.slot_id
  where r.status = 'received'
    and s.status = 'available'
  group by c.slot_id;
$$;

-- 로그인한 사용자만 부를 수 있다. 익명 로그인 참여자도 authenticated 라 포함된다.
-- 로그인하지 않은 방문자(anon)는 못 부른다.
revoke all on function public.slot_demand() from public, anon;
grant execute on function public.slot_demand() to authenticated;

-- 확인용
--   select * from public.slot_demand() order by waiting desc;
