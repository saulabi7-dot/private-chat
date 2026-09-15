'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { UserCircle2, X } from 'lucide-react';
import ZoomableImage from '@/components/ZoomableImage';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// "..." 메뉴 → "참여자 목록"에서 여는 모달. room_members(계정 기준)를
// profiles(아바타)와 합쳐서 보여준다. room_members와 profiles는 서로 직접
// 연결된 외래키가 없어(둘 다 auth.users만 참조) PostgREST 중첩 조회(embed)가
// 불가능하므로, 방 페이지의 loadProfilesFor와 같은 방식으로 두 번 조회해서
// 클라이언트에서 합친다.
export default function MemberListModal({ roomId, myUserId, onClose }) {
  const [members, setMembers] = useState(null); // null = 불러오는 중
  const [avatarViewerUrl, setAvatarViewerUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from('room_members')
        .select('user_id, nickname, joined_at')
        .eq('room_id', roomId)
        .order('joined_at', { ascending: true });

      if (cancelled) return;
      if (error || !data) {
        console.error('[MemberListModal] 참여자 목록 조회 실패:', error?.message);
        setMembers([]);
        return;
      }

      const userIds = [...new Set(data.map((m) => m.user_id).filter(Boolean))];
      let avatarByUser = {};
      if (userIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('user_id, avatar_url')
          .in('user_id', userIds);
        (profileRows || []).forEach((p) => { avatarByUser[p.user_id] = p.avatar_url; });
      }

      if (cancelled) return;
      setMembers(data.map((m) => ({ ...m, avatar_url: avatarByUser[m.user_id] || null })));
    };

    load();
    return () => { cancelled = true; };
  }, [roomId]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
      <div className="w-full max-w-xs bg-white rounded-3xl p-5 shadow-2xl border border-neutral-200 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="font-bold text-base text-neutral-900">
            참여자 목록{members ? ` (${members.length})` : ''}
          </h2>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 rounded-full">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto space-y-1 -mx-1 px-1">
          {members === null ? (
            <p className="text-center text-xs text-neutral-400 py-8">불러오는 중...</p>
          ) : members.length === 0 ? (
            <p className="text-center text-xs text-neutral-400 py-8">참여자가 없습니다.</p>
          ) : (
            members.map((m) => (
              <div key={m.user_id} className="flex items-center space-x-3 px-2 py-2 rounded-xl hover:bg-neutral-50">
                <div
                  onClick={() => m.avatar_url && setAvatarViewerUrl(m.avatar_url)}
                  className={`w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center overflow-hidden border border-blue-100 shrink-0 ${m.avatar_url ? 'cursor-pointer' : ''}`}
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.nickname || '참여자'} className="w-full h-full object-cover" />
                  ) : (
                    <UserCircle2 size={20} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-neutral-800 truncate">
                    {m.nickname || '닉네임 미설정'}
                    {m.user_id === myUserId && (
                      <span className="ml-1 text-[10px] font-normal text-blue-500">(나)</span>
                    )}
                  </p>
                  <p className="text-[10px] text-neutral-400">{formatDate(m.joined_at)} 참여</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 참여자 프로필 사진 확대보기 라이트박스 (핀치줌/더블탭 확대 가능) */}
      {avatarViewerUrl && (
        <div className="fixed inset-0 bg-black/90 flex flex-col z-[60] animate-in fade-in duration-100">
          <div className="flex items-center justify-end px-4 py-3 shrink-0">
            <button onClick={() => setAvatarViewerUrl(null)} className="p-2 text-white/90 hover:bg-white/10 rounded-full transition">
              <X size={20} />
            </button>
          </div>
          <ZoomableImage
            src={avatarViewerUrl}
            alt="프로필 사진"
            className="max-h-full max-w-full object-contain rounded-2xl"
            containerClassName="flex-1 flex items-center justify-center px-4 pb-4 w-full h-full"
            onTap={() => setAvatarViewerUrl(null)}
          />
        </div>
      )}
    </div>
  );
}
