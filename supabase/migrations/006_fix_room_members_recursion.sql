-- 004에서 추가한 "select fellow members of my rooms" 정책은 room_members
-- 서브쿼리 안에서 다시 room_members 자신의 RLS를 타게 되어(Postgres가 정책
-- 안에서 같은 테이블을 참조하면 그 서브쿼리에도 RLS를 재적용함) 아래 에러로
-- room_members 조회 전체가 500 에러가 나는 문제가 있었다:
--   "infinite recursion detected in policy for relation \"room_members\""
-- 이 때문에 홈 화면의 "내 대화방 목록"이 통째로 안 보이는 심각한 문제가 생겼다.
--
-- 해법(Supabase 공식 권장 패턴): 멤버십 확인을 SECURITY DEFINER 함수로 뺀다.
-- 이 함수는 테이블 소유자 권한으로 실행되어 RLS를 우회하므로, 정책 평가 중
-- 자기 자신을 다시 트리거하지 않는다.
--
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.

drop policy if exists "select fellow members of my rooms" on room_members;

create or replace function is_room_member(_room_id text, _uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from room_members
    where room_id = _room_id and user_id = _uid
  );
$$;

create policy "select fellow members of my rooms"
  on room_members for select
  using (is_room_member(room_id, auth.uid()));
