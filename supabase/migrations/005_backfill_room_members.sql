-- 004 이전(계정 기준 room_members 구조가 생기기 전)에 메시지를 주고받았던 방들은
-- 계정과 연결하는 room_members 행이 없어서 "내 대화방 목록"에서 빠져 보인다.
-- rooms/messages 데이터 자체는 전혀 삭제된 적이 없고, 그대로 남아 있다.
--
-- messages.user_id에 "이 계정이 이 방에서 실제로 메시지를 보냈다"는 기록이 남아있으므로,
-- 이를 근거로 room_members 행을 소급 생성해서 목록에 다시 나타나게 한다.
-- 이미 있는 행은 건드리지 않고(on conflict do nothing), 데이터를 지우는 구문은 없다.
--
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.

insert into room_members (room_id, user_id, joined_at)
select distinct on (m.room_id, m.user_id)
  m.room_id,
  m.user_id,
  m.created_at
from messages m
where m.user_id is not null
order by m.room_id, m.user_id, m.created_at asc
on conflict (room_id, user_id) do nothing;
