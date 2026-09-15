-- 대화방(rooms) 생성은 당분간 마스터 계정(saulabi7@gmail.com)만 할 수 있도록 제한한다.
-- 아무나 방을 만들 수 있으면 저장 용량이 계속 늘어나고 관리가 안 되기 때문. 나중에
-- 사용자가 늘어나면 이메일 하나를 하드코딩하는 대신 별도의 사용자/역할 관리 체계로
-- 교체할 예정.
--
-- rooms 테이블은 마이그레이션 파일 없이(대시보드에서) 만들어져 있어 기존에 어떤
-- 이름의 INSERT 정책이 걸려 있는지 알 수 없다. RESTRICTIVE 정책은 기존 PERMISSIVE
-- 정책들과 OR가 아니라 AND로 결합되므로, 기존 정책이 무엇이든 상관없이 이 조건을
-- "추가로" 반드시 만족해야만(=마스터 계정이어야만) INSERT가 허용되게 만들 수 있다.
--
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.

alter table rooms enable row level security;

drop policy if exists "only master can create rooms" on rooms;

create policy "only master can create rooms"
  on rooms
  as restrictive
  for insert
  to authenticated
  with check ((auth.jwt() ->> 'email') = 'saulabi7@gmail.com');

-- 마스터 계정은 관리 목적으로, 자신이 참여(room_members)하지 않은 방까지 포함해
-- 존재하는 모든 대화방을 조회할 수 있어야 한다. PERMISSIVE(기본값) 정책은 서로
-- OR로 결합되므로, 일반 사용자의 기존 조회 동작에는 전혀 영향을 주지 않고 마스터
-- 계정에게만 전체 조회 권한을 추가로 준다.
drop policy if exists "master can read all rooms" on rooms;

create policy "master can read all rooms"
  on rooms for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'saulabi7@gmail.com');
