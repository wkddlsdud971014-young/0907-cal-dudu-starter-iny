-- To-be ②: 고객이 자기 신청의 진행 이력을 볼 수 있게 연다.
--
-- 문제: 접수·확정 시각이 operation_logs 에 이미 쌓이는데 어드민만 읽을 수 있어서,
--       고객 화면에는 상태 세 글자밖에 내려가지 않았다. 없는 것은 데이터가 아니라 통로였다.
--
-- sql/00_supabase.sql 은 보호 대상이라 건드리지 않는다. 정책을 "추가"만 한다.
-- 기존 어드민 정책은 그대로 남고, 두 정책은 OR 로 합쳐진다.
-- 여러 번 실행해도 안전하다.

-- 자기 신청에 달린 기록만 읽는다. 남의 기록은 보이지 않는다.
drop policy if exists "Customers can view own logs" on operation_logs;
create policy "Customers can view own logs"
  on operation_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from requests r
      where r.id = operation_logs.request_id
        and r.customer_id = auth.uid()::text
    )
  );

-- 확인용
--   고객 계정으로 로그인해 아래를 실행하면 자기 것만 나와야 한다.
--   select action, status, timestamp from operation_logs order by timestamp;
