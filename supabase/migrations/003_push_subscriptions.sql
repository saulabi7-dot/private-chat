-- push_subscriptions: 계정별 브라우저 푸시 구독 정보를 저장한다.
-- 한 계정이 여러 기기(폰/PC)에서 알림을 켤 수 있으므로 endpoint(기기별 고유값) 기준으로
-- 여러 행을 가질 수 있다. 서버(app/api/notify)는 service role key로 이 테이블을
-- 전체 조회해서(RLS 우회) 같은 방의 다른 멤버들에게 알림을 발송한다.
--
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.
-- (001_room_members.sql, 002_profiles.sql을 먼저 실행한 뒤에 실행해야 합니다.)

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

-- 클라이언트는 자기 자신의 구독만 등록/조회/삭제할 수 있다.
-- (다른 사람 구독 조회는 서버 라우트가 service role key로 RLS를 우회해서 처리함)
create policy "select own subscriptions"
  on push_subscriptions for select
  using (auth.uid() = user_id);

create policy "insert own subscriptions"
  on push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "delete own subscriptions"
  on push_subscriptions for delete
  using (auth.uid() = user_id);
