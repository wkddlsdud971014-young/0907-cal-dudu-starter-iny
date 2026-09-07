-- 어드민 화면에서 고객을 uid 대신 이메일로 보여주기 위한 조회 함수.
--
-- auth.users 는 브라우저에서 직접 읽을 수 없다. 그래서 어드민 권한을 확인한 뒤
-- id → email 만 돌려주는 함수를 둔다. 비밀번호 같은 다른 열은 내보내지 않는다.
--
-- sql/00_supabase.sql 은 보호 대상이라 건드리지 않는다. 이 파일만 따로 실행한다.
-- 여러 번 실행해도 안전하다.

create or replace function public.admin_customer_emails()
returns table (id uuid, email text)
security definer
set search_path = public
language plpgsql
as $$
begin
  -- 권한 근거는 app_metadata 만 믿는다. user_metadata 는 사용자가 고칠 수 있다.
  if coalesce((auth.jwt()::jsonb->'app_metadata'->>'role')::text, '') <> 'admin' then
    raise exception 'Not authorized';
  end if;

  return query
    select u.id, u.email::text
    from auth.users u;
end;
$$;

-- 익명 사용자는 실행할 수 없다. 로그인한 사용자만 호출할 수 있고,
-- 어드민이 아니면 함수 안에서 막힌다.
revoke all on function public.admin_customer_emails() from public, anon;
grant execute on function public.admin_customer_emails() to authenticated;

-- 확인용
--   select * from public.admin_customer_emails();
