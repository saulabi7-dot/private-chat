'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Plus, MessageSquare, ArrowRight, Trash2 } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [myRooms, setMyRooms] = useState([]);
  const [roomTitle, setRoomTitle] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('my_chat_rooms');
    if (saved) {
      try {
        setMyRooms(JSON.parse(saved));
      } catch (e) {
        setMyRooms([]);
      }
    }
  }, []);

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!roomPassword.trim()) {
      alert('비밀번호를 입력해 주세요.');
      return;
    }
    setLoading(true);

    const shortCode = Math.random().toString(36).substring(2, 8);
    const title = roomTitle.trim() || '비공개 대화방';
    const password = roomPassword.trim();

    const { data, error } = await supabase
      .from('rooms')
      .insert([{ id: shortCode, title, password }])
      .select()
      .single();

    if (error) {
      alert('방 생성 실패: ' + error.message);
      setLoading(false);
      return;
    }

    sessionStorage.setItem(`unlocked_${shortCode}`, 'true');

    const updated = [{ id: data.id, title: data.title }, ...myRooms.filter((r) => r.id !== data.id)];
    localStorage.setItem('my_chat_rooms', JSON.stringify(updated));

    router.push(`/room/${shortCode}`);
  };

  const handleJoinByCode = async (e) => {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase();
    if (!code) return;

    const { data, error } = await supabase.from('rooms').select('*').eq('id', code).single();
    if (error || !data) {
      alert('존재하지 않는 대화방 코드입니다.');
      return;
    }

    const updated = [{ id: data.id, title: data.title }, ...myRooms.filter((r) => r.id !== data.id)];
    localStorage.setItem('my_chat_rooms', JSON.stringify(updated));

    router.push(`/room/${code}`);
  };

  const handleRemoveFromList = (e, roomId) => {
    e.stopPropagation();
    if (confirm('대화방 목록에서 삭제하시겠습니까?')) {
      const updated = myRooms.filter((r) => r.id !== roomId);
      setMyRooms(updated);
      localStorage.setItem('my_chat_rooms', JSON.stringify(updated));
    }
  };

  return (
    <div className="min-h-[100dvh] bg-neutral-100 flex items-center justify-center p-0 md:p-6">
      {/* PC에서는 시원한 max-w-2xl(672px) 카드 뷰, 모바일에서는 100% 꽉 차게 동작 */}
      <main className="w-full max-w-2xl bg-white min-h-[100dvh] md:min-h-[85vh] md:rounded-3xl shadow-xl border border-neutral-200 flex flex-col overflow-hidden">
        {/* 상단 헤더 */}
        <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <MessageSquare size={22} />
            </div>
            <div>
              <h1 className="font-bold text-lg text-neutral-900">대화방 목록</h1>
              <p className="text-xs text-neutral-400">참여 중인 비공개 대화방</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition active:scale-95"
          >
            <Plus size={16} />
            <span>새 대화방 만들기</span>
          </button>
        </header>

        {/* 6자리 초대 코드로 입장 영역 */}
        <div className="p-4 md:px-6 bg-neutral-50/70 border-b border-neutral-200">
          <form onSubmit={handleJoinByCode} className="flex space-x-2">
            <input
              type="text"
              placeholder="친구에게 받은 6자리 초대 코드 입력 (예: k9x2pa)"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              className="flex-1 px-4 py-2.5 text-xs md:text-sm bg-white rounded-xl border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
            />
            <button
              type="submit"
              disabled={!joinCode.trim()}
              className="px-5 py-2.5 bg-neutral-900 hover:bg-black text-white text-xs md:text-sm rounded-xl font-semibold transition disabled:opacity-40 shadow-xs"
            >
              입장하기
            </button>
          </form>
        </div>

        {/* 내 대화방 목록 (넓고 시원한 리스트) */}
        <div className="flex-1 p-4 md:p-6 space-y-3 overflow-y-auto">
          {myRooms.length === 0 ? (
            <div className="text-center py-24 text-neutral-400">
              <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-semibold text-sm text-neutral-600">참여 중인 대화방이 없습니다.</p>
              <p className="mt-1 text-xs text-neutral-400">우측 상단에서 새 방을 만들거나 초대 코드를 입력해 보세요.</p>
            </div>
          ) : (
            myRooms.map((room) => (
              <div
                key={room.id}
                onClick={() => router.push(`/room/${room.id}`)}
                className="flex items-center justify-between p-4 bg-white rounded-2xl border border-neutral-200/80 shadow-xs hover:shadow-md hover:border-blue-400 cursor-pointer transition active:scale-[0.99] group"
              >
                <div className="flex items-center space-x-4 overflow-hidden">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm shrink-0">
                    {room.title.slice(0, 1)}
                  </div>
                  <div className="truncate">
                    <h2 className="text-sm md:text-base font-bold text-neutral-900 group-hover:text-blue-600 transition truncate">
                      {room.title}
                    </h2>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-[11px] px-2 py-0.5 bg-neutral-100 text-neutral-600 font-mono rounded-md">
                        코드: {room.id}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <span className="hidden sm:inline text-xs font-semibold text-blue-600 group-hover:underline">
                    입장
                  </span>
                  <button
                    onClick={(e) => handleRemoveFromList(e, room.id)}
                    title="목록에서 삭제"
                    className="p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition"
                  >
                    <Trash2 size={18} />
                  </button>
                  <ArrowRight size={18} className="text-neutral-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition" />
                </div>
              </div>
            ))
          )}
        </div>

        {/* 새 대화방 만들기 모달창 */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
            <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-neutral-200">
              <h2 className="font-bold text-base text-neutral-900 mb-1 text-center">새 대화방 만들기</h2>
              <p className="text-xs text-neutral-400 text-center mb-5">
                비밀번호를 아는 사람만 들어올 수 있는 방을 만듭니다.
              </p>
              <form onSubmit={handleCreateRoom} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">대화방 제목</label>
                  <input
                    type="text"
                    required
                    placeholder="예: 프로젝트 회의실, 친구들 모임"
                    value={roomTitle}
                    onChange={(e) => setRoomTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">방 비밀번호</label>
                  <input
                    type="password"
                    required
                    placeholder="비밀번호 설정 (예: 1234)"
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold rounded-xl transition"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow transition disabled:opacity-50"
                  >
                    {loading ? '생성 중...' : '만들기'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}