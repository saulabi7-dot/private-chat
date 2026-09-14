import { createClient } from '@supabase/supabase-js';

// 서버 전용 Supabase 클라이언트 (service role key로 RLS를 우회한다).
// lib/supabase.js와 달리 이 파일은 하드코딩된 폴백 값을 절대 두지 않는다 —
// service role key는 진짜 비밀키라서 레포에 값이 남으면 안 된다.
// app/api/*/route.ts 안에서만 import할 것 (클라이언트 번들에 섞이면 안 됨).
function clean(value) {
  return (value || '').trim().replace(/^['"]|['"]$/g, '');
}

let cached = null;

export function getSupabaseAdmin() {
  if (cached) return cached;

  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL 환경변수가 설정되어 있지 않습니다.');
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되어 있지 않습니다.');
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
