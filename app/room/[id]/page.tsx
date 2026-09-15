'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getCurrentSubscription } from '@/lib/push';
import { resizeImageFile } from '@/lib/compressImage';
import { downloadDataUrl, filenameFor } from '@/lib/download';
import AuthForm from '@/components/AuthForm';
import AvatarModal from '@/components/AvatarModal';
import MemberListModal from '@/components/MemberListModal';
import PhotoGalleryModal from '@/components/PhotoGalleryModal';
import {
  ChevronLeft, MoreVertical, Copy, Trash2, Send,
  Smile, Image as ImgIcon, Lock, X, Edit2, CheckSquare, Square,
  Zap, Sparkles, UserCircle2, Bell, BellOff, Users, Images, Download
} from 'lucide-react';

const PACKS = [
  { id: 'couple', name: '👩‍❤️‍👨 커플', src: '/stickers/couple.png' },
  { id: 'boy', name: '👦 남자', src: '/stickers/boy.png' },
  { id: 'girl', name: '👧 여자', src: '/stickers/girl.png' },
];

export default function RoomPage() {
  const { id: roomId } = useParams();
  const router = useRouter();
  const session = useSession();
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);

  // 계정별 프로필 사진 (user_id -> avatar_url)
  const [profiles, setProfiles] = useState({});
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  // 이 기기의 푸시 알림 구독 여부 (null=확인 중)
  const [notifEnabled, setNotifEnabled] = useState(null);
  const [notifLoading, setNotifLoading] = useState(false);

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
  const [showMemberList, setShowMemberList] = useState(false);
  const [showPhotoGallery, setShowPhotoGallery] = useState(false);

  // 채팅 말풍선의 사진을 탭했을 때 확대해서 보여주는 라이트박스.
  // 예전엔 window.open(dataUrl)로 새 창을 띄웠는데, 대부분의 최신 브라우저가
  // 보안상 이유로 data: URL로의 window.open 네비게이션을 조용히 차단해서
  // 탭해도 아무 반응이 없었다 — 그래서 같은 화면 안에서 확대 + 다운로드 버튼을
  // 보여주는 방식으로 바꾼다(사진첩의 라이트박스와 동일한 패턴).
  const [lightboxMsg, setLightboxMsg] = useState(null);

  // 수정 및 선택 삭제
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  // 사진 전송 모달 (화질 선택) — 여러 장을 한 번에 선택할 수 있도록 배열로 관리
  const [pendingImages, setPendingImages] = useState(null); // [{ file, previewUrl }] | null
  const [imageQuality, setImageQuality] = useState('compressed'); // 'compressed' | 'original'
  const [isCompressing, setIsCompressing] = useState(false);

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
    if (!roomId || !session) return;
    supabase.from('rooms').select('*').eq('id', roomId).single().then(({ data }) => {
      if (data) {
        setRoom(data);
        // 링크로 바로 들어온 사람도 "내 대화방 목록"에 자동 등록되도록
        // 계정(room_members) 기준으로 동기화한다 (기존 localStorage 동작을 대체).
        // 실패해도 조용히 무시되던 것을 콘솔에 남겨서, 목록에 방이 안 뜰 때
        // 원인(RLS, 네트워크 등)을 바로 알 수 있게 한다.
        supabase
          .from('room_members')
          .upsert([{ room_id: data.id, user_id: session.user.id }], {
            onConflict: 'room_id,user_id',
            ignoreDuplicates: true,
          })
          .then(({ error }) => {
            if (error) console.error('[room] room_members 동기화 실패:', error.message);
          });

        if (sessionStorage.getItem(`unlocked_${roomId}`) === 'true' || !data.password) {
          setIsUnlocked(true);
        }
        const savedNick = sessionStorage.getItem(`nick_${roomId}`);
        if (savedNick) { setNickname(savedNick); setIsJoined(true); }
      }
      setLoading(false);
    });
  }, [roomId, session]);

  // 닉네임이 정해지면(직접 입력했거나 sessionStorage에 저장된 게 있어서
  // 자동으로 입장한 경우 모두) room_members에도 닉네임을 갱신해 둔다.
  // 참여자 목록 화면이 "닉네임 미설정" 대신 실제 닉네임을 보여줄 수 있으려면
  // 서버(room_members)에 닉네임이 저장되어 있어야 한다.
  useEffect(() => {
    if (!isJoined || !nickname.trim() || !roomId || !session) return;
    supabase
      .from('room_members')
      .upsert([{ room_id: roomId, user_id: session.user.id, nickname: nickname.trim() }], {
        onConflict: 'room_id,user_id',
        ignoreDuplicates: false,
      })
      .then(({ error }) => {
        if (error) console.error('[room] 닉네임 동기화 실패:', error.message);
      });
  }, [isJoined, nickname, roomId, session]);

  // 메시지에 등장하는 계정들의 프로필 사진을 한꺼번에 불러와 채워 넣는다.
  const loadProfilesFor = (userIds) => {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return;
    setProfiles((prev) => {
      const missing = ids.filter((id) => !(id in prev));
      if (missing.length === 0) return prev;
      supabase.from('profiles').select('user_id, avatar_url').in('user_id', missing).then(({ data }) => {
        if (!data) return;
        setProfiles((cur) => {
          const next = { ...cur };
          missing.forEach((id) => { next[id] = null; }); // 프로필이 없어도 다시 조회하지 않도록 표시
          data.forEach((p) => { next[p.user_id] = p.avatar_url; });
          return next;
        });
      });
      return prev;
    });
  };

  useEffect(() => {
    if (!isJoined || !isUnlocked || !roomId) return;
    let cancelled = false;
    let ch = null;

    const fetchMessages = () => {
      supabase.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).then(({ data }) => {
        if (cancelled || !data) return;
        setMessages(data);
        loadProfilesFor(data.map((m) => m.user_id));
      });
    };

    const subscribe = () => {
      ch = supabase
        .channel(`room_${roomId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (p) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === p.new.id)) return prev;
            const filtered = prev.filter((m) => !(m.sender === p.new.sender && m.content === p.new.content && typeof m.id === 'number' && m.id > 1000000000000));
            return [...filtered, p.new];
          });
          loadProfilesFor([p.new.user_id]);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (p) => {
          setMessages((prev) => prev.map((m) => (m.id === p.new.id ? p.new : m)));
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (p) => {
          setMessages((prev) => prev.filter((m) => m.id !== p.old.id));
        })
        .subscribe();
    };

    fetchMessages();
    subscribe();

    // 폰 화면이 꺼지거나 앱이 백그라운드로 내려가면 모바일 브라우저가 realtime
    // 웹소켓 연결을 끊어버려서, 그 사이 온 메시지가 화면을 다시 켤 때까지
    // 안 보이는 문제가 있었다. 화면이 다시 보이는 시점(visibilitychange/focus)에
    // 메시지를 서버에서 다시 통째로 불러오고, 채널이 끊어져 있으면(state !== 'joined')
    // 새로 구독해서 놓친 메시지가 즉시 반영되게 한다.
    const handleWake = () => {
      if (document.visibilityState !== 'visible') return;
      fetchMessages();
      if (!ch || ch.state !== 'joined') {
        if (ch) supabase.removeChannel(ch);
        subscribe();
      }
    };
    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);
    window.addEventListener('pageshow', handleWake);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('focus', handleWake);
      window.removeEventListener('pageshow', handleWake);
      if (ch) supabase.removeChannel(ch);
    };
  }, [isJoined, isUnlocked, roomId]);

  useEffect(() => {
    if (!isSelectMode && !editingId && !pendingImages) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isSelectMode, editingId, pendingImages]);

  // 아바타 변경 모달에 보여줄 내 프로필 사진도 미리 캐시에 채워둔다.
  useEffect(() => {
    if (!session) return;
    supabase.from('profiles').select('avatar_url').eq('user_id', session.user.id).maybeSingle().then(({ data }) => {
      if (data) setProfiles((prev) => ({ ...prev, [session.user.id]: data.avatar_url }));
    });
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

  // 메시지 전송 성공 후 같은 방의 다른 멤버들에게 보낼 알림 미리보기 텍스트를 만들어
  // /api/notify로 fire-and-forget 발송한다 (실패해도 채팅 자체엔 영향 없음).
  const notifyNewMessage = (content) => {
    if (!session?.access_token) return;
    const isImg = content?.startsWith('data:image/jpeg');
    const isSticker = content?.startsWith('data:image/png');
    let preview;
    if (isImg) preview = '사진을 보냈습니다';
    else if (isSticker) preview = '이모티콘을 보냈습니다';
    else preview = content.length > 40 ? content.slice(0, 40) + '…' : content;

    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ roomId, title: room?.title || '새 메시지', body: `${nickname}: ${preview}` }),
    }).catch(() => {});
  };

  // 여러 장을 한 번에 보냈을 때는 "사진 N장을 보냈습니다"로 알림을 한 번만
  // 보낸다 (notifyNewMessage를 사진 수만큼 반복 호출하면 알림이 그만큼 따로 울림).
  const notifyPhotos = (count) => {
    if (!session?.access_token) return;
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ roomId, title: room?.title || '새 메시지', body: `${nickname}: 사진 ${count}장을 보냈습니다` }),
    }).catch(() => {});
  };

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
    const userId = session?.user?.id ?? null;
    setMessages((prev) => [...prev, { id: tempId, room_id: roomId, sender: nickname, content, created_at: nowIso, user_id: userId }]);

    const { error } = await supabase.from('messages').insert([{ room_id: roomId, sender: nickname, content, user_id: userId }]);
    if (error) {
      alert('전송 실패: ' + error.message);
    } else {
      notifyNewMessage(content);
    }
  };

  // 사진 여러 장을 한 번에 전송한다. 메시지 자체는 기존 스키마 그대로 한 장당
  // 한 행으로 저장하되, 낙관적 업데이트와 insert를 배열로 한 번에 처리하고
  // 푸시 알림은 notifyPhotos로 한 번만 보내 사진 수만큼 알림이 울리는 걸 막는다.
  const sendMany = async (contents) => {
    if (!contents || contents.length === 0) return;
    const nowIso = new Date().toISOString();
    const userId = session?.user?.id ?? null;
    const tempRows = contents.map((content, i) => ({
      id: Date.now() + i,
      room_id: roomId,
      sender: nickname,
      content,
      created_at: nowIso,
      user_id: userId,
    }));
    setMessages((prev) => [...prev, ...tempRows]);

    const { error } = await supabase
      .from('messages')
      .insert(contents.map((content) => ({ room_id: roomId, sender: nickname, content, user_id: userId })));

    if (error) {
      alert('전송 실패: ' + error.message);
    } else {
      notifyPhotos(contents.length);
    }
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

  const handleSaveEdit = async (msgId) => {
    if (!editText.trim()) return;
    const newContent = editText.trim();
    setEditingId(null);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, content: newContent } : m)));
    const { error } = await supabase.from('messages').update({ content: newContent }).eq('id', msgId);
    if (error) { alert('수정 실패: ' + error.message); }
  };

  const handleDeleteSingle = async (msgId) => {
    if (confirm('이 메시지를 삭제하시겠습니까?')) {
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      await supabase.from('messages').delete().eq('id', msgId);
    }
  };

  const toggleSelectMessage = (msgId) => {
    setSelectedIds((prev) =>
      prev.includes(msgId) ? prev.filter((id) => id !== msgId) : [...prev, msgId]
    );
  };

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

  // 사진 선택 시 미리보기 모달 띄우기 (여러 장 동시 선택 지원)
  const handleImageFileSelect = (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (files.length === 0) return;

    setPendingImages(files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })));
  };

  // 선택한 화질(일반/원본)로 최종 전송. 여러 장이면 각각 순차적으로 리사이즈한
  // 뒤 한 번에 sendMany로 보내고, 한 장이면 기존과 동일하게 send를 그대로 쓴다.
  const handleConfirmSendImage = async () => {
    if (!pendingImages || pendingImages.length === 0) return;
    setIsCompressing(true);

    // 일반(축소): 720px / 0.6 품질 (초고속, 약 35KB)
    // 원본(고화질): 1920px (Full HD) / 0.85 품질 (선명한 고화질)
    const isOrig = imageQuality === 'original';
    const maxDim = isOrig ? 1920 : 720;
    const quality = isOrig ? 0.85 : 0.6;

    try {
      const contents = [];
      for (const { file } of pendingImages) {
        contents.push(await resizeImageFile(file, { maxDim, quality }));
      }
      if (contents.length === 1) {
        await send(contents[0]);
      } else {
        await sendMany(contents);
      }
    } catch (err) {
      alert('이미지 처리 중 오류가 발생했습니다: ' + (err?.message || ''));
    } finally {
      pendingImages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setIsCompressing(false);
      setPendingImages(null);
    }
  };

  const join = (e) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    sessionStorage.setItem(`nick_${roomId}`, nickname.trim());
    setIsJoined(true);
  };

  if (session === undefined) {
    return <div className="flex h-[100dvh] items-center justify-center text-sm text-neutral-400">확인 중...</div>;
  }
  if (session === null) {
    return <AuthForm />;
  }

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
    <div className="flex flex-col w-full h-[100dvh] max-w-2xl mx-auto bg-[#EBF2F7] border-x border-neutral-300 shadow-2xl relative">
      {/* 상단 헤더 */}
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

        <div className="flex items-center space-x-0.5">
          <button
            onClick={handleToggleNotif}
            disabled={notifLoading || notifEnabled === null}
            title={notifEnabled ? '알림 끄기' : '알림 켜기'}
            className="p-2 text-neutral-600 hover:bg-neutral-100 rounded-xl transition disabled:opacity-40"
          >
            {notifEnabled ? <Bell size={19} className="text-blue-600" /> : <BellOff size={19} />}
          </button>

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
                  setShowMemberList(true);
                  setShowMenu(false);
                }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2.5 text-xs text-neutral-700 hover:bg-neutral-50 transition"
              >
                <Users size={15} className="text-blue-600" />
                <span>참여자 목록</span>
              </button>

              <button
                onClick={() => {
                  setShowPhotoGallery(true);
                  setShowMenu(false);
                }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2.5 text-xs text-neutral-700 hover:bg-neutral-50 transition"
              >
                <Images size={15} className="text-blue-600" />
                <span>사진첩</span>
              </button>

              <div className="h-[1px] bg-neutral-100 my-1"></div>

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

              <button
                onClick={() => {
                  setShowAvatarModal(true);
                  setShowMenu(false);
                }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2.5 text-xs text-neutral-700 hover:bg-neutral-50 transition"
              >
                <UserCircle2 size={15} className="text-blue-600" />
                <span>내 프로필 사진 변경</span>
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
        </div>
      </header>

      {/* 선택 삭제 모드 바 */}
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

                {!isMe && (
                  <div className="w-8 h-8 rounded-full bg-white shadow-xs border border-neutral-200 flex items-center justify-center text-xs font-bold text-neutral-600 shrink-0 self-start mt-0.5 overflow-hidden">
                    {profiles[msg.user_id] ? (
                      <img src={profiles[msg.user_id]} alt={msg.sender} className="w-full h-full object-cover" />
                    ) : (
                      msg.sender?.slice(0, 1) || '상'
                    )}
                  </div>
                )}

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

                {isMe && !isEditing && (
                  <span className="text-[10px] text-neutral-400 mb-0.5 shrink-0 font-light">
                    {formatTime(msg.created_at)}
                  </span>
                )}

                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && (
                    <span className="text-[11px] font-semibold text-neutral-600 mb-1 ml-1">
                      {msg.sender}
                    </span>
                  )}

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
                        onClick={() => setLightboxMsg(msg)}
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

      {/* 내 프로필 사진 변경 모달 */}
      {showAvatarModal && (
        <AvatarModal
          userId={session.user.id}
          avatarUrl={profiles[session.user.id]}
          onChange={(url) => setProfiles((prev) => ({ ...prev, [session.user.id]: url }))}
          onClose={() => setShowAvatarModal(false)}
        />
      )}

      {/* 참여자 목록 모달 */}
      {showMemberList && (
        <MemberListModal
          roomId={roomId}
          myUserId={session.user.id}
          onClose={() => setShowMemberList(false)}
        />
      )}

      {/* 사진첩(썸네일/날짜별) 모달 */}
      {showPhotoGallery && (
        <PhotoGalleryModal
          messages={messages}
          onClose={() => setShowPhotoGallery(false)}
        />
      )}

      {/* 채팅 말풍선 사진 확대보기 + 다운로드 라이트박스 */}
      {lightboxMsg && (
        <div className="fixed inset-0 bg-black/90 flex flex-col z-[60] animate-in fade-in duration-100">
          <div className="flex items-center justify-between px-4 py-3 text-white/90 shrink-0">
            <div className="text-xs">
              <p className="font-semibold">{formatDate(lightboxMsg.created_at)}</p>
              <p className="text-white/60">{formatTime(lightboxMsg.created_at)}</p>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => downloadDataUrl(lightboxMsg.content, filenameFor(lightboxMsg.created_at))}
                className="p-2 hover:bg-white/10 rounded-full transition"
                title="사진 다운로드"
              >
                <Download size={19} />
              </button>
              <button onClick={() => setLightboxMsg(null)} className="p-2 hover:bg-white/10 rounded-full transition">
                <X size={20} />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center px-2" onClick={() => setLightboxMsg(null)}>
            <img
              src={lightboxMsg.content}
              alt="사진"
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* 사진 전송 전 화질 선택 모달 (카카오톡 스타일, 여러 장 동시 선택 지원) */}
      {pendingImages && pendingImages.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-neutral-200 space-y-4">
            <h3 className="font-bold text-sm text-neutral-900 text-center">
              사진 전송{pendingImages.length > 1 && ` (${pendingImages.length}장 선택됨)`}
            </h3>

            {/* 사진 미리보기: 한 장이면 크게, 여러 장이면 가로 스크롤 썸네일 스트립 */}
            {pendingImages.length === 1 ? (
              <div className="rounded-2xl overflow-hidden max-h-60 bg-neutral-100 flex items-center justify-center border border-neutral-200">
                <img src={pendingImages[0].previewUrl} alt="미리보기" className="max-h-60 w-auto object-contain" />
              </div>
            ) : (
              <div className="flex space-x-2 overflow-x-auto pb-1 -mx-1 px-1">
                {pendingImages.map((p, i) => (
                  <img
                    key={i}
                    src={p.previewUrl}
                    alt={`미리보기 ${i + 1}`}
                    className="w-20 h-20 object-cover rounded-xl border border-neutral-200 shrink-0"
                  />
                ))}
              </div>
            )}

            {/* 화질 선택 버튼 (일반 vs 원본) — 선택한 모든 장에 공통 적용 */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded-2xl">
              <button
                type="button"
                onClick={() => setImageQuality('compressed')}
                className={`flex flex-col items-center py-2.5 px-2 rounded-xl text-xs transition ${
                  imageQuality === 'compressed'
                    ? 'bg-white text-blue-600 font-bold shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <div className="flex items-center space-x-1">
                  <Zap size={14} />
                  <span>일반 화질</span>
                </div>
                <span className="text-[10px] font-normal text-neutral-400 mt-0.5">용량 축소 / 빠른 전송</span>
              </button>

              <button
                type="button"
                onClick={() => setImageQuality('original')}
                className={`flex flex-col items-center py-2.5 px-2 rounded-xl text-xs transition ${
                  imageQuality === 'original'
                    ? 'bg-white text-blue-600 font-bold shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <div className="flex items-center space-x-1">
                  <Sparkles size={14} />
                  <span>원본 / 고화질</span>
                </div>
                <span className="text-[10px] font-normal text-neutral-400 mt-0.5">선명한 원본 해상도</span>
              </button>
            </div>

            {/* 하단 취소 / 전송 버튼 */}
            <div className="flex space-x-2 pt-1">
              <button
                type="button"
                disabled={isCompressing}
                onClick={() => {
                  pendingImages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                  setPendingImages(null);
                }}
                className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold rounded-xl transition"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isCompressing}
                onClick={handleConfirmSendImage}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow transition disabled:opacity-50 flex items-center justify-center space-x-1"
              >
                <span>
                  {isCompressing
                    ? '전송 처리 중...'
                    : `전송하기${pendingImages.length > 1 ? ` (${pendingImages.length}장)` : ''}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

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
          <input type="file" ref={fileRef} accept="image/*" multiple className="hidden" onChange={handleImageFileSelect} />
          
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