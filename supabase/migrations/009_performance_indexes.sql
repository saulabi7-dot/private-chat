-- room_members, messages 두 테이블 모두 마이그레이션 파일 없이 Supabase
-- 대시보드에서 만들어졌다(002_profiles.sql, 005_backfill_room_members.sql 주석
-- 참고). room_members의 기본키는 (room_id, user_id) 복합키라서 user_id 단독
-- 조회(홈 화면 "내 대화방 목록")는 인덱스를 효율적으로 못 쓰고, messages.room_id는
-- 외래키이지만 Postgres가 외래키 컬럼에 자동으로 인덱스를 만들지는 않으므로
-- 대화방을 열 때마다 하는 room_id 조회 + created_at 정렬도 마찬가지다.
-- 방/대화 목록을 불러올 때 생기는 1~2초 지연의 원인 중 하나로 보여 추가한다.

create index if not exists room_members_user_id_idx on room_members(user_id);
create index if not exists messages_room_id_created_at_idx on messages(room_id, created_at);
