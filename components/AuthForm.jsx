'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Lock, Mail } from 'lucide-react';

// 앱 전체 진입 게이트. 로그인/회원가입 탭을 전환하며 계정을 처리한다.
// 여기서 만든 계정은 채팅방 자체 비밀번호/닉네임과는 별개로,
// "내 방 목록"을 기기 상관없이 동기화하기 위한 용도다.
export default function AuthForm() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) alert('로그인 실패: ' + error.message);
    } else {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) {
        alert('회원가입 실패: ' + error.message);
      } else {
        alert('가입 완료! 자동으로 로그인됩니다.');
      }
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4 bg-neutral-100">
      <div className="w-full max-w-xs bg-white p-6 rounded-3xl shadow-lg border space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner mb-3">
            <Lock size={26} />
          </div>
          <h1 className="font-bold text-base text-neutral-900">
            {mode === 'login' ? '로그인' : '회원가입'}
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            계정으로 로그인하면 PC/폰 어디서든 내 대화방 목록이 동일하게 보입니다.
          </p>
        </div>

        <div className="flex p-1 bg-neutral-100 rounded-2xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded-xl transition ${
              mode === 'login' ? 'bg-white text-blue-600 shadow-xs' : 'text-neutral-500'
            }`}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`flex-1 py-2 rounded-xl transition ${
              mode === 'signup' ? 'bg-white text-blue-600 shadow-xs' : 'text-neutral-500'
            }`}
          >
            회원가입
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="email"
              required
              autoFocus
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-neutral-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="relative">
            <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="password"
              required
              minLength={6}
              placeholder="비밀번호 (6자 이상)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-neutral-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow transition disabled:opacity-50"
          >
            {loading ? '처리 중...' : mode === 'login' ? '로그인' : '가입하기'}
          </button>
        </form>
      </div>
    </div>
  );
}
