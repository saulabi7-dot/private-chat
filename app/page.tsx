'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getCurrentSubscription } from '@/lib/push';
import AuthForm from '@/components/AuthForm';
import AvatarModal from '@/components/AvatarModal';
import { Plus, MessageSquare, ArrowRight, Trash2, LogOut, Camera, Bell, BellOff } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const session = useSession();

  const [myRooms, setMyRooms] = useState([]);
  const [roomTitle, setRoomTitle] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // 내 프로필 사진
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  // 이 기기의 푸시 알림 구독 여부 (계정 전체 기준 — 한 번 켜두면 모든 방의 메시지 알림을 받음)
  const [notifEnabled, setNotifEnabled] = useState(null);
  const [notifLoading, setNotifLoading] = useState(false);

  // 로그인 계정 기준으로 "내 대화방 목록"을 서버(room_members)에서 불러온다.
  useEffect(() => {
    if (!session) return;

    const fetchRooms = () => {
      supabase
        .from('room_members')
        .select('room_id, joined_at, rooms(id, title)')
        .eq('user_id', session.user.id)
        .order('joined_at', { ascending: false })
        .then(({ data, error }) => {
          if (!error && data) {
            setMyRooms(data.map((row) => row.rooms).filter(Boolean));
          } else if (error) {
            console.error('[home] 대화방 목록 조회 실패:', error.message);
          }
        });
    };

    fetchRooms();

    supabase
      .from('profiles')
      .select('avatar_url')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setAvatarUrl(data.avatar_url);
      });

    // 방에 들어갔다가 뒤로가기로 돌아오면 브라우저가(특히 모바일 사파리) 이 화면을
    // 다시 마운트하지 않고 캐시(bfcache)에서 그대로 복원하는 경우가 있어서, 방금
    // 새로 들어간 방이 목록에 반영되지 않은 옛 상태로 보이는 문제가 있었다.
    // 화면이 다시 보이는 시점(pageshow/visibilitychange/focus)마다 목록을 새로
    // 불러와서 항상 최신 상태로 맞춘다.
    const handleWake = () => {
      if (document.visibilityState !== 'visible') return;
      fetchRooms();
    };
    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);
    window.addEventListener('pageshow', handleWake);

    return () => {
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('focus', handleWake);
      window.removeEventListener('pageshow', handleWake);
    };
  }, [session]);

  // 이 기기에 이미 켜져 있는 알림 구독이 있는지 확인해서 방울 아이콘 초기 상태를 맞춘다.
  useEffect(() => {
    if (!session) return;
    if (!isPushSupported()) { setNotifEnabled(false); return; }
    getCurrentSubscription().then((sub) => setNotifEnabled(!!sub));
  }, [session]);

  const handleToggleNotif = async () => {
    if (!session?.user?.id || notifLoading) return;
    if (!isPushSupported()) {
      alert('이 브라우저(또는 iOS의 경우 홈 화면에 추가하지 않은 사파리 탭)에서는 푸시 알림을 지원하지 않습니다.');
      return;
    }
    setNotifLoading(true);
    try {
      if (notifEnabled) {
        await unsubscribeFromPush(session.user.id);
        setNotifEnabled(false);
      } else {
        await subscribeToPush(session.user.id);
        setNotifEnabled(true);
      }
    } catch (err) {
      alert(err?.message || '알림 설정 중 오류가 발생했습니다.');
    } finally {
      setNotifLoading(false);
    }
  };

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

    await supabase.from('room_members').insert([{ room_id: data.id, user_id: session.user.id }]);

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

    await supabase
      .from('room_members')
      .upsert([{ room_id: data.id, user_id: session.user.id }], { onConflict: 'room_id,user_id', ignoreDuplicates: true });

    router.push(`/room/${code}`);
  };

  const handleRemoveFromList = async (e, roomId) => {
    e.stopPropagation();
    if (confirm('대화방 목록에서 삭제하시겠습니까?')) {
      setMyRooms((prev) => prev.filter((r) => r.id !== roomId));
      await supabase.from('room_members').delete().eq('room_id', roomId).eq('user_id', session.user.id);
    }
  };

  if (session === undefined) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-sm text-neutral-400">
        확인 중...
      </div>
    );
  }

  if (session === null) {
    return <AuthForm />;
  }

  return (
    <div className="min-h-[100dvh] bg-neutral-100 flex items-center justify-center p-0 md:p-6">
      {/* PC에서는 시원한 max-w-2xl(672px) 카드 뷰, 모바일에서는 100% 꽉 차게 동작 */}
      <main className="w-full max-w-2xl bg-white min-h-[100dvh] md:min-h-[85vh] md:rounded-3xl shadow-xl border border-neutral-200 flex flex-col overflow-hidden">
        {/* 상단 헤더 */}
        <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200">
          <div className="flex items-center space-x-3 min-w-0">
            <button
              onClick={() => setShowAvatarModal(true)}
              title="내 프로필 사진 변경"
              className="relative w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 overflow-hidden border border-blue-100 hover:opacity-80 transition"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="내 프로필" className="w-full h-full object-cover" />
              ) : (
                <MessageSquare size={22} />
              )}
              <span className="absolute bottom-0 right-0 w-4 h-4 bg-neutral-900/80 text-white rounded-tl-md flex items-center justify-center">
                <Camera size={9} />
              </span>
            </button>
            <div className="min-w-0">
              <h1 className="font-bold text-lg text-neutral-900">대화방 목록</h1>
              <p className="text-xs text-neutral-400 truncate">{session.user.email}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={handleToggleNotif}
              disabled={notifLoading || notifEnabled === null}
              title={notifEnabled ? '알림 끄기' : '알림 켜기 (모든 대화방)'}
              className="p-2 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition disabled:opacity-40"
            >
              {notifEnabled ? <Bell size={18} className="text-blue-600" /> : <BellOff size={18} />}
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition active:scale-95"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">새 대화방 만들기</span>
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              title="로그아웃"
              className="p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition"
            >
              <LogOut size={18} />
            </button>
          </div>
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

        {/* 프로필 사진 변경 모달창 */}
        {showAvatarModal && (
          <AvatarModal
            userId={session.user.id}
            avatarUrl={avatarUrl}
            onChange={setAvatarUrl}
            onClose={() => setShowAvatarModal(false)}
          />
        )}
      </main>
    </div>
  );
}
