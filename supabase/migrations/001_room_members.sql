-- room_members: 어떤 유저가 어떤 방에 속해 있는지 기록해서
-- 기기(PC/폰)와 무관하게 "내 대화방 목록"이 계정 기준으로 동기화되게 한다.
--
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.

create table if not exists room_members (
  room_id text not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table room_members enable row level security;

create policy "select own memberships"
  on room_members for select
  using (auth.uid() = user_id);

create policy "insert own memberships"
  on room_members for insert
  with check (auth.uid() = user_id);

create policy "delete own memberships"
  on room_members for delete
  using (auth.uid() = user_id);
