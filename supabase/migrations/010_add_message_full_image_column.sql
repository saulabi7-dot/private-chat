-- 사진이 많은 방을 열 때마다 전체 대화 기록을 사진 "원본 화질" 그대로 한 번에
-- 받아오는 게 느린 원인이었다(messages.content에 압축 후에도 data URL로 저장,
-- 저화질 ~100KB/고화질 ~800KB/원본 수 MB까지). 말풍선/사진첩 그리드에는 그 정도
-- 화질이 필요 없으므로, 앞으로 사진 메시지는 content에 작은 썸네일을 저장하고
-- 원본은 이 새 컬럼에 따로 저장한다. 방 진입 시의 전체 조회는 이 컬럼을 아예
-- select하지 않아 payload가 작아지고, 사용자가 사진을 확대(라이트박스)하거나
-- 다운로드할 때만 id로 이 컬럼을 조회한다.
--
-- 같은 행에 컬럼만 추가하는 것이라 RLS는 기존 messages 정책이 그대로 적용된다
-- (Postgres RLS는 행 단위라 컬럼 추가로 별도 정책이 필요 없음). 이 컬럼 추가
-- 이전에 보내진 사진들은 full_image가 null로 남고, 클라이언트가 이 경우
-- content(그 시절엔 원본 그대로 저장됨)로 자동 폴백하므로 별도 백필은 불필요.
--
-- Supabase 대시보드 → SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.

alter table messages add column if not exists full_image text;
