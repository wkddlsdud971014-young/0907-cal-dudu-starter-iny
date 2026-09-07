-- 확정 알림 트리거가 왜 안 도는지 찾는 진단 쿼리.
-- 아무것도 바꾸지 않는다. 읽기만 한다. 결과 네 개를 순서대로 본다.

-- 1) pg_net 확장이 깔려 있고, http_post 가 어느 스키마에 있나
select
  '1. http_post 위치' as check,
  n.nspname as schema,
  p.proname as func
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'http_post';

-- 2) confirmations 에 트리거가 붙어 있나
select
  '2. 트리거' as check,
  tgname as trigger_name,
  tgenabled as enabled
from pg_trigger
where tgrelid = 'confirmations'::regclass
  and not tgisinternal;

-- 3) 설정값이 들어 있나 (비밀값은 앞 8자만)
select
  '3. 설정' as check,
  key,
  left(value, 8) || '…' as value_head
from app_config
order by key;

-- 4) 실제로 호출을 시도한 기록이 있나. 있으면 응답 코드까지 본다.
select
  '4. 최근 호출' as check,
  id,
  status_code,
  left(coalesce(error_msg, content, ''), 120) as detail,
  created
from net._http_response
order by created desc
limit 5;
