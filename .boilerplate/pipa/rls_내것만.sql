-- 표를 만들 때 이 파일을 같이 실행한다. 이거 없이 표를 만들지 않는다.
-- 하는 일: 로그인한 사람이 자기 행만 읽고 쓰고 지울 수 있게 한다.
--          정책 없이 잠금만 켜면 전부 거부되고, 잠금을 안 켜면 남의 것이 다 보인다.

-- 1) 표에 주인 칸을 둔다. 로그인한 사람의 id 가 자동으로 들어간다.
create table 표이름 (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),   -- 주인
  내용 text,
  created_at timestamptz not null default now()
);

-- 2) 잠금을 켠다.
alter table 표이름 enable row level security;

-- 3) 자기 것만 열어준다. 네 줄 전부 필요하다.
create policy "내 것만 보기"  on 표이름 for select to authenticated using (auth.uid() = user_id);
create policy "내 것으로 쓰기" on 표이름 for insert to authenticated with check (auth.uid() = user_id);
create policy "내 것만 고치기" on 표이름 for update to authenticated using (auth.uid() = user_id);
create policy "내 것만 지우기" on 표이름 for delete to authenticated using (auth.uid() = user_id);

-- 확인: 두 계정으로 로그인해 서로의 글이 안 보이면 통과.
-- 한 계정에서 남의 글이 보이면 3)의 select 정책을 다시 본다.
