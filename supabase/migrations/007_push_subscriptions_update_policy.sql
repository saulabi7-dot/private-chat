-- 브라우저에 이미 존재하는 push subscription을 로그인할 때마다 서버와 다시
-- 동기화(upsert)할 수 있도록, 자기 구독 행에 대한 UPDATE 권한을 추가한다.
-- USING은 기존 행, WITH CHECK는 갱신 후 행 모두 현재 로그인 계정 소유인지 확인한다.

drop policy if exists "update own subscriptions" on push_subscriptions;

create policy "update own subscriptions"
  on push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
