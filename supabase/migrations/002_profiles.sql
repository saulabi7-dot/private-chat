-- profiles: 계정별 프로필 사진(아바타)을 저장한다.
-- messages에는 어떤 계정이 보낸 메시지인지 알 수 있도록 user_id를 추가해서
-- 채팅방에서 상대방의 프로필 사진을 보여줄 수 있게 한다.
--
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.
-- (001_room_members.sql을 먼저 실행한 뒤에 실행해야 합니다.)

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  avatar_url text,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- 같은 방에 있는 상대방의 프로필 사진을 봐야 하므로 조회는 로그인한 누구나 가능하게 열어둔다.
create policy "select all profiles"
  on profiles for select
  to authenticated
  using (true);

create policy "insert own profile"
  on profiles for insert
  with check (auth.uid() = user_id);

create policy "update own profile"
  on profiles for update
  using (auth.uid() = user_id);

alter table messages add column if not exists user_id uuid references auth.users(id) on delete set null;
