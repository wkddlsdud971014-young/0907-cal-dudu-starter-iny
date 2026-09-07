-- 확정이 저장되면 Edge Function 을 자동 호출하는 트리거.
--
-- sql/00_supabase.sql 은 보호 대상이라 건드리지 않는다. 이 파일만 따로 실행한다.
-- 여러 번 실행해도 안전하다(기존 트리거를 지우고 다시 만든다).
--
-- 실행 전에 아래 두 값을 이 프로젝트 값으로 바꾸세요.
--   :project_ref  Supabase 프로젝트 ref (대시보드 주소에 들어 있는 문자열)
--   :webhook_secret  supabase secrets set WEBHOOK_SECRET=... 에 넣은 것과 같은 값

-- 1. 외부 HTTP 호출에 필요한 확장
create extension if not exists pg_net with schema extensions;

-- 2. 설정값을 DB 에 보관한다.
--    함수 본문에 키를 박지 않으려고 분리한다.
create table if not exists app_config (
  key text primary key,
  value text not null
);

alter table app_config enable row level security;
-- 아무에게도 열지 않는다. SECURITY DEFINER 함수만 읽는다.
revoke all on app_config from anon, authenticated;

-- ↓↓↓ 값을 바꿔서 실행하세요 ↓↓↓
insert into app_config (key, value) values
  ('edge_url', 'https://<project_ref>.supabase.co/functions/v1/on-confirmation'),
  ('webhook_secret', '<webhook_secret>')
on conflict (key) do update set value = excluded.value;
-- ↑↑↑ 값을 바꿔서 실행하세요 ↑↑↑

-- 3. 확정 행이 생기면 Edge Function 을 부른다.
create or replace function public.notify_confirmation()
returns trigger
security definer
set search_path = public, extensions
language plpgsql
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_config where key = 'edge_url';
  select value into v_secret from app_config where key = 'webhook_secret';

  if v_url is null or v_secret is null then
    -- 설정이 없으면 예약 저장 자체를 막지는 않는다. 알림만 건너뛴다.
    raise warning 'app_config 에 edge_url/webhook_secret 이 없어 알림을 건너뜁니다';
    return new;
  end if;

  -- pg_net 은 비동기다. 메일·캘린더가 느려도 확정 트랜잭션을 붙잡지 않는다.
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'confirmations',
      'record', to_jsonb(new)
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_confirmation on confirmations;
create trigger trg_notify_confirmation
  after insert on confirmations
  for each row
  execute function public.notify_confirmation();

-- 4. 확인용
--   select * from app_config;
--   select tgname from pg_trigger where tgrelid = 'confirmations'::regclass and not tgisinternal;
--   pg_net 응답 확인: select * from net._http_response order by created desc limit 5;
