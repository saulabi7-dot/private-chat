'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Lock, KeyRound } from 'lucide-react';

// 이메일의 "비밀번호 재설정" 링크를 눌렀을 때 도착하는 페이지.
// Supabase JS 클라이언트가 URL에 담긴 recovery 토큰을 자동으로 감지해서
// 임시 세션을 만들고 PASSWORD_RECOVERY 이벤트를 발생시킨다 (detectSessionInUrl 기본값 true).
// 그 이벤트(또는 이미 만들어진 세션)를 확인한 뒤에만 새 비밀번호 입력 폼을 보여준다.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState('checking'); // 'checking' | 'ready' | 'invalid' | 'done'
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let settled = false;

    const markReady = () => {
      if (settled) return;
      settled = true;
      setPhase('ready');
    };

    // 링크를 눌러 들어온 직후 이미 세션이 만들어져 있는 경우도 있어 먼저 확인한다.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') markReady();
    });

    // 일정 시간 안에 recovery 세션이 확인되지 않으면 유효하지 않은 링크로 간주한다.
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setPhase('invalid');
      }
    }, 2500);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      alert('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== confirmPassword) {
      alert('비밀번호가 서로 일치하지 않습니다.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      alert('비밀번호 변경 실패: ' + error.message);
      return;
    }
    setPhase('done');
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4 bg-neutral-100">
      <div className="w-full max-w-xs bg-white p-6 rounded-3xl shadow-lg border space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner mb-3">
            <KeyRound size={26} />
          </div>
          <h1 className="font-bold text-base text-neutral-900">비밀번호 재설정</h1>
        </div>

        {phase === 'checking' && (
          <p className="text-center text-sm text-neutral-400 py-6">링크를 확인하는 중...</p>
        )}

        {phase === 'invalid' && (
          <div className="text-center space-y-4">
            <p className="text-sm text-neutral-500">
              유효하지 않거나 만료된 링크입니다. 로그인 화면에서 재설정 링크를 다시
              요청해 주세요.
            </p>
            <button
              onClick={() => router.push('/')}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow transition"
            >
              홈으로 돌아가기
            </button>
          </div>
        )}

        {phase === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="password"
                required
                autoFocus
                minLength={6}
                placeholder="새 비밀번호 (6자 이상)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-neutral-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="password"
                required
                minLength={6}
                placeholder="새 비밀번호 확인"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-neutral-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow transition disabled:opacity-50"
            >
              {saving ? '변경 중...' : '비밀번호 변경'}
            </button>
          </form>
        )}

        {phase === 'done' && (
          <div className="text-center space-y-4">
            <p className="text-sm text-neutral-500">
              비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.
            </p>
            <button
              onClick={() => router.push('/')}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow transition"
            >
              로그인하러 가기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
