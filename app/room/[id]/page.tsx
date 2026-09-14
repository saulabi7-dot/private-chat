'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { 
  ChevronLeft, MoreVertical, Copy, Trash2, Send, 
  Smile, Image as ImgIcon, Lock, X, Edit2, CheckSquare, Square 
} from 'lucide-react';

const PACKS = [
  { id: 'couple', name: '👩‍❤️‍👨 커플', src: '/stickers/couple.png' },
  { id: 'boy', name: '👦 남자', src: '/stickers/boy.png' },
  { id: 'girl', name: '👧 여자', src: '/stickers/girl.png' },
];

export default function RoomPage() {
  const { id: roomId } = useParams();
  const router = useRouter();
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  const [nickname, setNickname] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activePack, setActivePack] = useState('couple');
  const [stickers, setStickers] = useState({});
  const [showMenu, setShowMenu] = useState(false);

  // 수정 및 선택 삭제 상태
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const scrollRef = useRef(null);
  const fileRef = useRef(null);

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? '오후' : '오전';
    h = h % 12 || 12;
    return `${ampm} ${h}:${m}`;
  };

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  useEffect(() => {
    PACKS.forEach((pack) => {
      const img = new Image();
      img.onload = () => {
        const cellW = img.naturalWidth / 2;
        const cellH = img.naturalHeight / 5;
        const list = [];
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(cellW, 360);
        canvas.height = Math.min(cellH, 360);
        const ctx = canvas.getContext('2d');

        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 2; c++) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, canvas.width, canvas.height);
            list.push(canvas.toDataURL('image/png'));
          }
        }
        setStickers((prev) => ({ ...prev, [pack.id]: list }));
      };
      img.onerror = () => {};
      img.src = pack.src;
    });
  }, []);

  useEffect(() => {
    if (!roomId) return;
    supabase.from('rooms').select('*').eq('id', roomId).single().then(({ data }) => {
      if (data) {
        setRoom(data);
        const savedList = JSON.parse(localStorage.getItem('my_chat_rooms') || '[]');
        const updated = [{ id: data.id, title: data.title }, ...savedList.filter((r) => r.id !== data.id)];
        localStorage.setItem('my_chat_rooms', JSON.stringify(updated));

        if (sessionStorage.getItem(`unlocked_${roomId}`) === 'true' || !data.password) {
          setIsUnlocked(true);
        }
        const savedNick = sessionStorage.getItem(`nick_${roomId}`);
        if (savedNick) { setNickname(savedNick); setIsJoined(true); }
      }
      setLoading(false);
    });
  }, [roomId]);

  // 실시간 수신 (INSERT, UPDATE, DELETE 모두 감지)
  useEffect(() => {
    if (!isJoined || !isUnlocked || !roomId) return;
    supabase.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).then(({ data }) => {
      if (data) setMessages(data);
    });

    const ch = supabase
      .channel(`room_${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (p) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === p.new.id)) return prev;
          const filtered = prev.filter((m) => !(m.sender === p.new.sender && m.content === p.new.content && typeof m.id === 'number' && m.id > 1000000000000));
          return [...filtered, p.new];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (p) => {
        setMessages((prev) => prev.map((m) => (m.id === p.new.id ? p.new : m)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (p) => {
        setMessages((prev) => prev.filter((m) => m.id !== p.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [isJoined, isUnlocked, roomId]);

  useEffect(() => {
    if (!isSelectMode && !editingId) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isSelectMode, editingId]);

  const handleUnlock = (e) => {
    e.preventDefault();
    if (passwordInput === room.password) {
      sessionStorage.setItem(`unlocked_${roomId}`, 'true');
      setIsUnlocked(true);
    } else {
      alert('비밀번호가 올바르지 않습니다.');
      setPasswordInput('');
    }
  };

  const send = async (content) => {
    if (!content) return;
    const tempId = Date.now();
    const nowIso = new Date().toISOString();
    setMessages((prev) => [...prev, { id: tempId, room_id: roomId, sender: nickname, content, created_at: nowIso }]);

    const { error } = await supabase.from('messages').insert([{ room_id: roomId, sender: nickname, content }]);
    if (error) { alert('전송 실패: ' + error.message); }
  };

  const handleSendText = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(text.trim());
    setText('');
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText(e);
    }
  };

  // 1. 메시지 수정 저장
  const handleSaveEdit = async (msgId) => {
    if (!editText.trim()) return;
    const newContent = editText.trim();
    setEditingId(null);

    // 내 화면 즉시 반영
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, content: newContent } : m)));

    // DB 업데이트
    const { error } = await supabase.from('messages').update({ content: newContent }).eq('id', msgId);
    if (error) { alert('수정 실패: ' + error.message); }
  };

  // 2. 단일 메시지 삭제
  const handleDeleteSingle = async (msgId) => {
    if (confirm('이 메시지를 삭제하시겠습니까?')) {
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      await supabase.from('messages').delete().eq('id', msgId);
    }
  };

  // 3. 다중 선택 체크 토글
  const toggleSelectMessage = (msgId) => {
    setSelectedIds((prev) =>
      prev.includes(msgId) ? prev.filter((id) => id !== msgId) : [...prev, msgId]
    );
  };

  // 4. 선택한 메시지 일괄 삭제
  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (confirm(`선택한 ${selectedIds.length}개의 메시지를 삭제하시겠습니까?`)) {
      const idsToDelete = [...selectedIds];
      setMessages((prev) => prev.filter((m) => !idsToDelete.includes(m.id)));
      setIsSelectMode(false);
      setSelectedIds([]);

      await supabase.from('messages').delete().in('id', idsToDelete);
    }
  };

  const handleImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const r = new FileReader();
    r.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 600;
        const nw = img.naturalWidth || img.width || 400;
        const nh = img.naturalHeight || img.height || 400;
        const scale = Math.min(1, maxDim / Math.max(nw, nh));
        canvas.width = Math.round(nw * scale);
        canvas.height = Math.round(nh * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        send(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.src = ev.target?.result;
    };
    r.readAsDataURL(file);
    e.target.value = '';
  };

  const join = (e) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    sessionStorage.setItem(`nick_${roomId}`, nickname.trim());
    setIsJoined(true);
  };

  if (loading) return <div className="flex h-[100dvh] items-center justify-center text-sm text-neutral-400">대화방 연결 중...</div>;
  if (!room) return <div className="flex h-[100dvh] items-center justify-center text-sm text-red-500">대화방을 찾을 수 없습니다.</div>;

  if (!isUnlocked) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4 bg-neutral-100">
        <form onSubmit={handleUnlock} className="w-full max-w-xs bg-white p-6 rounded-3xl shadow-lg border space-y-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner">
            <Lock size={28} />
          </div>
          <div>
            <h2 className="font-bold text-base text-neutral-800">{room.title}</h2>
            <p className="text-xs text-neutral-400 mt-1">대화방 비밀번호를 입력해 주세요.</p>
          </div>
          <input
            type="password"
            required
            autoFocus
            placeholder="비밀번호"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            className="w-full px-4 py-2.5 text-sm bg-neutral-50 border rounded-xl text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex space-x-2">
            <button type="button" onClick={() => router.push('/')} className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-600 text-xs font-semibold rounded-xl transition">목록으로</button>
            <button type="submit" className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition">입장하기</button>
          </div>
        </form>
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div className="flex h-[100dvh] items-center justify-center p-4 bg-neutral-100">
        <form onSubmit={join} className="w-full max-w-xs bg-white p-6 rounded-3xl shadow-lg border space-y-4 text-center">
          <div className="w-14 h-14 rounded-full bg-blue-600 text-white flex items-center justify-center mx-auto font-bold text-lg shadow-md">
            💬
          </div>
          <div>
            <h2 className="font-bold text-base text-neutral-800">{room.title}</h2>
            <p className="text-xs text-neutral-400 mt-1">사용할 대화명을 입력하세요.</p>
          </div>
          <input required placeholder="닉네임 (예: 홍길동)" value={nickname} onChange={e => setNickname(e.target.value)} className="w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-center" />
          <button type="submit" className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow transition">대화 시작하기</button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] max-w-2xl mx-auto bg-[#EBF2F7] border-x border-neutral-300 shadow-2xl relative">
      {/* 상단 네비게이션 헤더 */}
      <header className="flex items-center justify-between px-3 py-2.5 bg-white/95 backdrop-blur border-b border-neutral-200 sticky top-0 z-20 shadow-xs">
        <button
          onClick={() => router.push('/')}
          className="flex items-center space-x-0.5 px-2 py-1.5 -ml-1 text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 rounded-xl transition cursor-pointer"
          title="대화방 목록으로 이동"
        >
          <ChevronLeft size={22} className="text-blue-600" />
          <span className="text-sm font-bold text-blue-600">목록</span>
        </button>

        <div className="text-center truncate px-2">
          <h1 className="font-bold text-sm text-neutral-900 truncate max-w-[200px]">{room.title}</h1>
          <div className="flex items-center justify-center space-x-1.5 mt-0.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] text-neutral-500 font-medium">코드: {room.id}</span>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowMenu((prev) => !prev)}
            className="p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition"
            title="메뉴"
          >
            <MoreVertical size={20} />
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-1 w-44 bg-white rounded-2xl shadow-xl border border-neutral-200 py-1.5 z-30 animate-in fade-in duration-100">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  alert('초대 링크가 복사되었습니다!');
                  setShowMenu(false);
                }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2.5 text-xs text-neutral-700 hover:bg-neutral-50 transition"
              >
                <Copy size={15} className="text-neutral-500" />
                <span>초대 링크 복사</span>
              </button>

              <button
                onClick={() => {
                  setIsSelectMode((prev) => !prev);
                  setSelectedIds([]);
                  setShowMenu(false);
                }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2.5 text-xs text-neutral-700 hover:bg-neutral-50 transition"
              >
                <CheckSquare size={15} className="text-blue-600" />
                <span>{isSelectMode ? '선택 취소' : '메시지 선택 삭제'}</span>
              </button>

              <div className="h-[1px] bg-neutral-100 my-1"></div>
              <button
                onClick={async () => {
                  if (confirm('대화방을 삭제하면 모든 대화와 사진이 완전히 사라집니다. 삭제하시겠습니까?')) {
                    await supabase.from('rooms').delete().eq('id', roomId);
                    router.push('/');
                  }
                }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2.5 text-xs text-red-600 hover:bg-red-50 transition"
              >
                <Trash2 size={15} />
                <span>대화방 삭제(폭파)</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 선택 삭제 모드 상단 바 */}
      {isSelectMode && (
        <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between text-xs font-semibold shadow-md z-10 animate-in slide-in-from-top-2">
          <span>{selectedIds.length}개 선택됨</span>
          <div className="space-x-2">
            <button
              onClick={() => { setIsSelectMode(false); setSelectedIds([]); }}
              className="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-lg"
            >
              취소
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={selectedIds.length === 0}
              className="px-2.5 py-1 bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-40"
            >
              선택 삭제
            </button>
          </div>
        </div>
      )}

      {/* 대화 메시지 영역 */}
      <div 
        onClick={() => setShowMenu(false)}
        className="flex-1 overflow-y-auto p-4 space-y-3.5"
      >
        <div className="flex justify-center my-2">
          <span className="px-3 py-1 bg-black/15 text-white/90 text-[11px] font-medium rounded-full shadow-xs">
            {formatDate(room.created_at)}
          </span>
        </div>

        {messages.length === 0 ? (
          <div className="text-center py-20 text-xs text-neutral-400">
            대화가 시작되지 않았습니다.<br />이모티콘이나 메시지를 보내 대화를 시작해보세요!
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender === nickname;
            const isImg = msg.content?.startsWith('data:image/jpeg');
            const isSticker = msg.content?.startsWith('data:image/png');
            const isEditing = editingId === msg.id;

            return (
              <div 
                key={msg.id} 
                className={`flex ${isMe ? 'justify-end' : 'justify-start'} items-end space-x-1.5 group relative`}
              >
                {/* 선택 모드 체크박스 */}
                {isSelectMode && (
                  <button
                    onClick={() => toggleSelectMessage(msg.id)}
                    className="p-1 text-blue-600 shrink-0 self-center"
                  >
                    {selectedIds.includes(msg.id) ? (
                      <CheckSquare size={20} className="fill-blue-600 text-white" />
                    ) : (
                      <Square size={20} className="text-neutral-400" />
                    )}
                  </button>
                )}

                {/* 상대방 프로필 이니셜 */}
                {!isMe && (
                  <div className="w-8 h-8 rounded-full bg-white shadow-xs border border-neutral-200 flex items-center justify-center text-xs font-bold text-neutral-600 shrink-0 self-start mt-0.5">
                    {msg.sender?.slice(0, 1) || '상'}
                  </div>
                )}

                {/* 내가 보낸 메시지: 수정/삭제 액션 버튼 (마우스 호버 시 표시) */}
                {isMe && !isSelectMode && !isEditing && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex space-x-1 mb-1 shrink-0">
                    {!isImg && !isSticker && (
                      <button
                        onClick={() => { setEditingId(msg.id); setEditText(msg.content); }}
                        className="p-1 text-neutral-400 hover:text-blue-600 hover:bg-white/80 rounded-md transition"
                        title="글자 수정"
                      >
                        <Edit2 size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteSingle(msg.id)}
                      className="p-1 text-neutral-400 hover:text-red-600 hover:bg-white/80 rounded-md transition"
                      title="삭제"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}

                {/* 시간 (내 메시지일 때 왼쪽) */}
                {isMe && !isEditing && (
                  <span className="text-[10px] text-neutral-400 mb-0.5 shrink-0 font-light">
                    {formatTime(msg.created_at)}
                  </span>
                )}

                {/* 메시지 본체 */}
                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && (
                    <span className="text-[11px] font-semibold text-neutral-600 mb-1 ml-1">
                      {msg.sender}
                    </span>
                  )}

                  {/* 수정 입력창 모드 */}
                  {isEditing ? (
                    <div className="bg-white p-2.5 rounded-2xl border-2 border-blue-500 shadow-md w-full min-w-[240px] max-w-[360px] animate-in zoom-in-95">
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(msg.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        className="w-full text-xs text-neutral-800 focus:outline-none px-1"
                      />
                      <div className="flex justify-end space-x-2 mt-2 pt-1 border-t border-neutral-100 text-[11px] font-semibold">
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2 py-0.5 text-neutral-500 hover:bg-neutral-100 rounded"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => handleSaveEdit(msg.id)}
                          className="px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          수정 완료
                        </button>
                      </div>
                    </div>
                  ) : isSticker ? (
                    <div className="p-0.5 hover:scale-105 transition-transform duration-150">
                      <img src={msg.content} alt="이모티콘" className="w-28 h-28 object-contain drop-shadow-sm" />
                    </div>
                  ) : isImg ? (
                    <div className="rounded-2xl overflow-hidden shadow-md border border-black/5 bg-white p-1">
                      <img
                        src={msg.content}
                        alt="사진"
                        className="rounded-xl max-h-64 max-w-[280px] object-cover cursor-pointer hover:opacity-95"
                        onClick={() => window.open(msg.content)}
                      />
                    </div>
                  ) : (
                    <div
                      className={`px-3.5 py-2 rounded-2xl text-[13px] leading-relaxed shadow-xs max-w-[320px] sm:max-w-[420px] break-words ${
                        isMe
                          ? 'bg-blue-600 text-white rounded-br-xs font-normal'
                          : 'bg-white text-neutral-800 rounded-bl-xs border border-neutral-200/80'
                      }`}
                    >
                      {msg.content}
                    </div>
                  )}
                </div>

                {/* 시간 (상대방 메시지일 때 오른쪽) */}
                {!isMe && (
                  <span className="text-[10px] text-neutral-400 mb-0.5 shrink-0 font-light">
                    {formatTime(msg.created_at)}
                  </span>
                )}
              </div>
            );
          })
        )}
        <div ref={scrollRef} />
      </div>

      {/* 하단 입력바 */}
      <footer className="bg-white border-t border-neutral-200">
        {showEmojiPicker && (
          <div className="border-b border-neutral-200 bg-white">
            <div className="flex items-center justify-between px-3 pt-2.5 border-b border-neutral-100">
              <div className="flex space-x-3 text-xs font-semibold">
                {PACKS.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => setActivePack(pack.id)}
                    className={`pb-2 transition ${
                      activePack === pack.id
                        ? 'border-b-2 border-blue-600 text-blue-600'
                        : 'text-neutral-400 hover:text-neutral-600'
                    }`}
                  >
                    {pack.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowEmojiPicker(false)}
                className="p-1 text-neutral-400 hover:text-neutral-600 rounded-full mb-1"
                title="닫기"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3 grid grid-cols-5 gap-2 max-h-52 overflow-y-auto">
              {(stickers[activePack] || []).length === 0 ? (
                <div className="col-span-5 text-center py-6 text-xs text-neutral-400">
                  이모티콘 파일을 불러오는 중입니다...
                </div>
              ) : (
                stickers[activePack].map((stickerUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => { send(stickerUrl); setShowEmojiPicker(false); }}
                    className="p-1 hover:bg-neutral-100 active:scale-90 rounded-2xl transition flex items-center justify-center cursor-pointer"
                  >
                    <img src={stickerUrl} alt="스티커" className="w-14 h-14 object-contain" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSendText} className="flex items-center p-2.5 space-x-1.5">
          <input type="file" ref={fileRef} accept="image/*" className="hidden" onChange={handleImage} />
          
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-full transition"
            title="사진 전송"
          >
            <ImgIcon size={21} />
          </button>

          <button
            type="button"
            onClick={() => setShowEmojiPicker((prev) => !prev)}
            className={`p-2 rounded-full transition ${
              showEmojiPicker
                ? 'text-blue-600 bg-blue-50'
                : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100'
            }`}
            title="이모티콘"
          >
            <Smile size={21} />
          </button>

          <input
            placeholder="메시지를 입력하세요..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 px-4 py-2 text-sm bg-neutral-100 rounded-2xl border border-transparent focus:border-blue-400 focus:bg-white focus:outline-none transition"
          />

          <button
            type="submit"
            disabled={!text.trim()}
            className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xs transition disabled:opacity-40"
            title="보내기"
          >
            <Send size={15} />
          </button>
        </form>
      </footer>
    </div>
  );
}