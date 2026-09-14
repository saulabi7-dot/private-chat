import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://xfiavhzhnlkyggvfpuqh.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmaWF2aHpobmxreWdndmZwdXFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNDMyMzUsImV4cCI6MjEwNDkxOTIzNX0.XB06oYU70_lbNBtNVsZKEvxAh5yKtjIQ_JSXvZOgUpM';

// Vercel 환경변수에 실수로 따옴표/공백/개행이 섞여 들어오는 경우를 방어한다.
function clean(value) {
  return (value || '').trim().replace(/^['"]|['"]$/g, '');
}

function resolveUrl(rawValue) {
  const value = clean(rawValue);
  try {
    if (value) {
      // eslint-disable-next-line no-new
      new URL(value);
      return value;
    }
  } catch {
    console.warn('[supabase] NEXT_PUBLIC_SUPABASE_URL이 올바른 URL 형식이 아니어서 기본값을 사용합니다:', rawValue);
  }
  return FALLBACK_URL;
}

const supabaseUrl = resolveUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || FALLBACK_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
