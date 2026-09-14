-- room_members에 "이 방에서 쓰는 닉네임"을 계정 기준으로 저장해서, 참여자
-- 목록을 서버 데이터로 보여줄 수 있게 한다. (기존엔 닉네임이 sessionStorage
-- 에만 있어서 다른 사람 화면에서는 전혀 알 수 없었다.)
--
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.

alter table room_members add column if not exists nickname text;

-- 기존엔 update 정책이 없어서, 이미 있는 멤버십 행에 닉네임을 나중에
-- 채워 넣는 upsert(충돌 시 갱신)가 RLS에 막혀 조용히 실패했다.
create policy "update own membership"
  on room_members for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 기존 select 정책("select own memberships")은 "본인 소속 행"만 보여주도록
-- 되어 있어서, 참여자 목록 화면에서 같은 방의 "다른 사람" 멤버십 행은 하나도
-- 조회되지 않는 문제가 있었다(본인 행 1개만 보임). 내가 속한 방이라면 그 방의
-- 다른 멤버 행도 볼 수 있도록 정책을 추가한다. 서브쿼리는 기존 "select own
-- memberships" 정책으로 이미 허용되는 "본인 행 조회"만으로 충족되므로 재귀
-- 없이 안전하게 동작한다.
create policy "select fellow members of my rooms"
  on room_members for select
  using (
    exists (
      select 1 from room_members my
      where my.room_id = room_members.room_id
        and my.user_id = auth.uid()
    )
  );
