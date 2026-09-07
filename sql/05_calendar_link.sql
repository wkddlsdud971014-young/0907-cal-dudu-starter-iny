-- 어드민이 확정한 예약이 캘린더에 실제로 들어갔는지 화면에서 확인할 수 있게 한다.
--
-- 블루프린트에서 드러난 구멍: 확정하면 캘린더 일정이 자동 생성되는데,
-- 정작 어드민 화면에는 그 결과가 돌아오지 않았다. 고객 쪽만 채우고
-- 운영자 쪽 접점은 비어 있었다.
--
-- 00_supabase.sql 은 보호 대상이라 건드리지 않는다. 열을 추가만 한다.
-- 여러 번 실행해도 안전하다.

-- 구글 일정 링크를 담을 자리. 실패하면 null 로 남아 "아직 안 감"이 드러난다.
alter table confirmations add column if not exists calendar_link text;
alter table confirmations add column if not exists calendar_error text;

-- Edge Function 이 service_role 로 이 열을 채운다. 고객은 confirmations 를
-- 자기 것만 읽으므로 기존 정책이 그대로 보호한다.

-- 확인용
--   select slot_id, calendar_link is not null as linked, calendar_error
--   from confirmations order by confirmed_at desc;
