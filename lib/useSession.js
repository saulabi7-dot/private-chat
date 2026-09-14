import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// 로그인 상태를 어디서든 재사용하기 위한 훅.
// 반환값: undefined(확인 중) / null(비로그인) / Session(로그인됨)
export function useSession() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return session;
}
