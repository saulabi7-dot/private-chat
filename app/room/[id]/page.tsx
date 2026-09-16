'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { isPushSupported, subscribeToPush, unsubscribeFromPush, getCurrentSubscription } from '@/lib/push';
import { readImageFileAsDataUrl, resizeImageFile, CHAT_THUMBNAIL_OPTIONS } from '@/lib/compressImage';
import { downloadDataUrl, filenameFor } from '@/lib/download';
import AuthForm from '@/components/AuthForm';
import AvatarModal from '@/components/AvatarModal';
import MemberListModal from '@/components/MemberListModal';
import PhotoGalleryModal from '@/components/PhotoGalleryModal';
import ZoomableImage from '@/components/ZoomableImage';
import {
  ChevronLeft, MoreVertical, Copy, Trash2, Send,
  Smile, Image as ImgIcon, Lock, X, Edit2, CheckSquare, Square,
  UserCircle2, Bell, BellOff, Users, Images, Download, Settings2
} from 'lucide-react';

const PACKS = [
  { id: 'couple', name: '👩‍❤️‍👨 커플', src: '/stickers/couple.png' },
  { id: 'boy', name: '👦 남자', src: '/stickers/boy.png' },
  { id: 'girl', name: '👧 여자', src: '/stickers/girl.png' },
];
const STICKER_PREFIX = 'data:image/png;sticker,';
const IMAGE_PREFIX = 'data:image/';

function isStickerContent(content) {
  if (typeof content !== 'string') return false;
  // 새 메시지는 명시적인 접두사로 판별한다. 접두사 추가 전의 기존 스티커는 모두
  // 작은 PNG data URL이므로 크기 기준을 폴백으로 남겨 과거 대화도 그대로 보인다.
  return content.startsWith(STICKER_PREFIX) || (content.startsWith('data:image/png') && content.length < 900_000);
}

function stickerImageUrl(content) {
  return content.startsWith(STICKER_PREFIX)
    ? `data:image/png;base64,${content.slice(STICKER_PREFIX.length)}`
    : content;
}

function encodeStickerContent(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : `${STICKER_PREFIX}${dataUrl.slice(comma + 1)}`;
}

// 스티커 시트(2열×5행)를 낱개 이모티콘 10개로 잘라낸다. 세 팩의 실제
// 행 경계는 균등하지 않고 팩마다 조금씩 다르다. 특히 boy/girl 시트는 행 사이의
// 그림이 이어져 있어 알파 채널 자동 감지로는 경계를 찾을 수 없다. 원본 시트를
// 픽셀 단위로 확인해 얻은 팩별 경계를 비율로 저장하고, 각 열 안의 큰 좌우 여백도
// 함께 잘라 실제 그림과 캡션이 선택창/메시지에서 크고 선명하게 보이도록 한다.
const STICKER_CROP = {
  couple: {
    rows: [
      [0, 0.2052, 0.4004, 0.5915, 0.7827, 1],
      [0, 0.2052, 0.3991, 0.5936, 0.7827, 1],
    ],
    cols: [[0.26, 0.99], [0.02, 0.81]],
  },
  boy: {
    rows: [
      [0, 0.2072, 0.4125, 0.6063, 0.7988, 1],
      [0, 0.2086, 0.4131, 0.6076, 0.7981, 1],
    ],
    cols: [[0.35, 0.99], [0.04, 0.75]],
  },
  girl: {
    rows: [
      [0, 0.2079, 0.4138, 0.6030, 0.7907, 1],
      [0, 0.2079, 0.4131, 0.6030, 0.7914, 1],
    ],
    cols: [[0.35, 1], [0.01, 0.76]],
  },
};

function sliceStickerSheet(img, packId) {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const cols = 2;
  const rows = 5;
  const MAX_SIDE = 440;
  const crop = STICKER_CROP[packId] || STICKER_CROP.couple;
  const cellW = width / cols;

  const drawScaled = (sx, sy, sw, sh) => {
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  };

  const list = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rowBoundaries = crop.rows[c];
      const top = Math.round(height * rowBoundaries[r]);
      const bottom = Math.round(height * rowBoundaries[r + 1]);
      const columnStart = c * cellW;
      const [leftRatio, rightRatio] = crop.cols[c];
      const left = Math.round(columnStart + cellW * leftRatio);
      const right = Math.round(columnStart + cellW * rightRatio);
      list.push(drawScaled(left, top, right - left, bottom - top));
    }
  }
  return list;
}

// 키보드에 있는 기본(유니코드) 이모지를 1~3개만 단독으로 보낸 메시지는 말풍선
// 없이 큰 글자로 보여주기 위한 판별 헬퍼. \p{Emoji_Component}는 숫자/#/* 같은
// 일반 문자에도 걸리는 경우가 있어서 일부러 빼고, 실제 그림 이모지(Extended_
// Pictographic)와 피부색 수정자/국기 조합/ZWJ/변형 선택자만 허용한다.
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️\s]+$/u;

function getEmojiOnlyCount(content) {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed || !EMOJI_ONLY_RE.test(trimmed)) return null;

  // 화면에 실제로 보이는 이모지 개수를 세려면(스킨톤 수정자, 국기, ZWJ 합성
  // 이모지 등이 여러 코드포인트로 이루어져 있어도 1개로 세야 함) grapheme
  // 단위로 나누는 Intl.Segmenter를 쓰고, 지원 안 하는 환경에서는 코드포인트
  // 배열 스프레드로 대체한다(정확도는 조금 떨어지지만 동작은 보장됨).
  const graphemes = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(trimmed)].map((s) => s.segment)
    : [...trimmed];
  const count = graphemes.filter((g) => g.trim().length > 0).length;
  return count >= 1 && count <= 3 ? count : null;
}

function emojiOnlySizeClass(count) {
  if (count === 1) return 'text-6xl';
  if (count === 2) return 'text-5xl';
  return 'text-4xl';
}

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
  // 라이트박스에 표시할 원본 화질 이미지. lightboxMsg가 바뀌면 일단 null로
  // 비워서(=말풍선과 같은 썸네일이 먼저 보임) 원본을 비동기로 가져온 뒤 채운다
  // (아래 useEffect). 즉시 뜨는 썸네일 → 도착하는 대로 선명해지는 원본 순서.
  const [lightboxFullSrc, setLightboxFullSrc] = useState(null);
  // 상대방 프로필 사진(아바타)을 탭했을 때 확대해서 보여주는 뷰어에 쓰는 이미지 URL
  const [avatarViewerUrl, setAvatarViewerUrl] = useState(null);

  // 수정 및 선택 삭제
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  // 사진은 파일 선택 또는 클립보드 붙여넣기로 추가한 뒤 미리보기에서 확인한다.
  // 화질 모드는 매번 묻지 않고 설정 메뉴에서 한 번 정해 localStorage에 보관한다.
  const [pendingImages, setPendingImages] = useState(null); // [{ file, previewUrl }] | null
  const [imageQuality, setImageQuality] = useState(() => {
    if (typeof window === 'undefined') return 'high';
    try {
      const savedQuality = localStorage.getItem('image_quality');
      return ['low', 'high', 'original'].includes(savedQuality) ? savedQuality : 'high';
    } catch {
      return 'high';
    }
  }); // 'low' | 'high' | 'original'
  const [showImageQualitySettings, setShowImageQualitySettings] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  // 메시지 목록 스크롤 컨테이너 자체에 대한 ref. 예전엔 맨 아래 빈 sentinel div에
  // scrollIntoView()를 호출했는데, scrollIntoView는 기본적으로 이 요소를 보이게
  // 하기 위해 필요한 모든 조상 스크롤 컨테이너(문서 전체 포함)를 함께 움직일 수
  // 있어서, 메시지를 보낸 뒤 화면(카드) 전체가 아래로 밀려 헤더가 잘려 보이는
  // 문제가 있었다. 컨테이너의 scrollTop만 직접 옮기면 이 컨테이너 안에서만
  // 스크롤되고 페이지 자체는 절대 움직이지 않는다.
  const messagesContainerRef = useRef(null);
  // 화면 전체를 뷰포트에 고정하는 바깥 래퍼(아래 JSX 참고)에 대한 ref.
  // 키보드가 뜰 때 visualViewport 기준으로 높이/오프셋을 직접 보정하는 데 쓴다.
  const viewportWrapRef = useRef(null);
  // 이 방에서 "맨 아래로 스크롤"을 이미 한 번 했는지 여부. 방에 처음 들어와
  // 메시지가 한꺼번에 채워질 때는 즉시 이동시키고, 이미 보고 있는 중에 새
  // 메시지가 도착했을 때만 부드럽게 스크롤한다(아래 스크롤 useEffect 참고).
  const hasScrolledOnceRef = useRef(false);
  // 사용자가 지금 맨 아래(최신 메시지) 근처를 보고 있는지. 콘텐츠가 늘어나는
  // 것만으로는 scroll 이벤트가 발생하지 않으므로(scrollTop은 그대로, scrollHeight만
  // 커짐), 새 메시지가 도착하기 "직전" 사용자가 어디를 보고 있었는지가 그대로
  // 유지된다 — 아래 스크롤 useEffect에서 이 값을 보고, 위로 스크롤해 지난 대화를
  // 읽는 중이면 새 메시지가 와도 화면을 강제로 끌어내리지 않는다.
  const isNearBottomRef = useRef(true);
  const fileRef = useRef(null);
  // 사진 원본(full_image)은 방 진입 시 통째로 불러오지 않고, 라이트박스로 열거나
  // 다운로드할 때만 그때 id로 조회한다. 같은 사진을 다시 열 때마다 재조회하지
  // 않도록 메모리에 캐시해 둔다(방을 나가면 아래 roomId 초기화 useEffect에서 비움).
  // realtime으로 받은 새 메시지는 payload에 원본이 이미 포함돼 있으므로(Realtime은
  // select절과 무관하게 변경된 행 전체를 보내줌) 조회 없이 여기에 바로 채워 넣는다.
  const fullImageCacheRef = useRef(new Map());
  // "보내기" 버튼을 탭하면 포커스가 버튼으로 넘어가면서 모바일 키보드가 바로
  // 닫혀버리는 문제가 있어서, 버튼이 포커스를 가져가지 못하게 막고(mouseDown에서
  // preventDefault) 전송 후에도 입력창에 포커스를 유지시키는 데 쓴다.
  const textInputRef = useRef(null);

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
        setStickers((prev) => ({ ...prev, [pack.id]: sliceStickerSheet(img, pack.id) }));
      };
      img.onerror = () => {};
      img.src = pack.src;
    });
  }, []);

  useEffect(() => {
    if (!roomId || !session) return;
    let cancelled = false;

    // localStorage 확인은 서버 응답과 무관하므로, 네트워크 요청을 시작하기 전에
    // 먼저 읽어둔다.
    const alreadyUnlocked = localStorage.getItem(`unlocked_${roomId}`) === 'true';
    const savedNick = localStorage.getItem(`nick_${roomId}`);

    // 이 기기에 저장된 닉네임이 없는(=새 기기/새 브라우저) 경우에만 필요한
    // room_members.nickname 조회를, 예전처럼 방 조회가 끝나길 기다렸다가 그
    // 안에서 순서대로 시작하지 않고 방 조회와 동시에 시작한다 — 두 조회가 서로
    // 다른 값에 의존하지 않으므로 직렬로 기다릴 이유가 없다.
    const memberPromise = savedNick
      ? Promise.resolve(null)
      : supabase
          .from('room_members')
          .select('nickname')
          .eq('room_id', roomId)
          .eq('user_id', session.user.id)
          .maybeSingle();

    Promise.all([
      supabase.from('rooms').select('*').eq('id', roomId).single(),
      memberPromise,
    ]).then(([{ data }, memberResult]) => {
      if (cancelled) return;
      if (!data) { setLoading(false); return; }
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

      // localStorage 사용: sessionStorage는 브라우징 컨텍스트(탭)별로 분리되어
      // 있어서, 알림을 눌러 열리는 새 창(sw.js의 clients.openWindow)은 매번
      // 빈 세션으로 시작한다 — 비밀번호를 풀고 닉네임을 정해도 다음번에 알림을
      // 눌러 들어오면 또 처음부터 물어보던 게 이 때문이었다. localStorage는
      // 같은 기기·브라우저 안에서 탭/창에 상관없이 공유되므로 한 번만 하면 된다.
      if (alreadyUnlocked || !data.password) {
        setIsUnlocked(true);
      }
      if (savedNick) {
        setNickname(savedNick);
        setIsJoined(true);
        // 이 기기엔 이미 닉네임이 저장돼 있으니 서버 확인 없이 바로 보여준다.
        setLoading(false);
        return;
      }

      // 이 기기에는 저장된 닉네임이 없는(=새 기기/새 브라우저) 경우, 같은 계정으로
      // 다른 기기에서 이미 이 방에 입장한 적이 있는지 서버(room_members.nickname,
      // 위에서 방 조회와 동시에 이미 조회해 둠)로 확인한다. nickname 컬럼은
      // join() 함수(아래)에서 비밀번호를 통과하고 닉네임을 정한 뒤에만 채워지므로,
      // 값이 있다는 사실 자체가 "과거 이 계정으로 비밀번호를 통과했다"는 증거가
      // 된다 — 그래서 이 값이 있으면 비밀번호/닉네임 입력 화면을 건너뛰고 바로
      // 대화창으로 들어가게 해서, 어느 기기로 로그인하든 같은 이메일 계정이면
      // 닉네임도 같고 비밀번호도 다시 묻지 않게 한다.
      const memberRow = memberResult?.data;
      if (memberRow?.nickname) {
        localStorage.setItem(`unlocked_${roomId}`, 'true');
        localStorage.setItem(`nick_${roomId}`, memberRow.nickname);
        setIsUnlocked(true);
        setNickname(memberRow.nickname);
        setIsJoined(true);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [roomId, session]);

  // 닉네임이 정해지면(직접 입력했거나 localStorage에 저장된 게 있어서
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

  // 비밀번호/닉네임 화면을 보고 있는 동안에도 메시지를 백그라운드로 미리
  // 받아온다. 메시지는 어차피 isUnlocked/isJoined가 true가 될 때까지 화면에
  // 렌더링되지 않으므로(아래 조기 return들이 그대로 화면을 가림) 표시 시점은
  // 그대로고, 사용자가 잠금 해제/닉네임 입력을 마쳤을 때 이미 로드돼 있어 그
  // 시점의 왕복이 사라진다.
  useEffect(() => {
    if (!roomId || !session) return;
    let cancelled = false;
    let ch = null;

    // 사진 원본(full_image)은 여기서 select하지 않는다 — 방의 전체 대화 기록을
    // 열 때마다 사진 원본 화질까지 전부 받아오는 게 느린 원인이었어서, 목록에는
    // content(작은 썸네일)만 가져오고 원본은 getFullImage()로 필요할 때만 조회한다.
    const fetchMessages = () => {
      supabase
        .from('messages')
        .select('id, room_id, sender, content, created_at, user_id')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (cancelled || !data) return;
          setMessages(data);
          loadProfilesFor(data.map((m) => m.user_id));
        });
    };

    // realtime(postgres_changes)은 select절과 무관하게 변경된 행 전체(full_image
    // 포함)를 그대로 보내준다. 그걸 그대로 state에 넣으면 결국 방을 오래 쓸수록
    // 원본이 메모리에 쌓이므로, 원본은 캐시에 빼두고 썸네일 버전만 state에 넣는다.
    const stripFullImage = (row) => {
      const { full_image, ...rest } = row;
      if (full_image) fullImageCacheRef.current.set(row.id, full_image);
      return rest;
    };

    const subscribe = () => {
      ch = supabase
        .channel(`room_${roomId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (p) => {
          const row = stripFullImage(p.new);
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            const filtered = prev.filter((m) => !(m.sender === row.sender && m.content === row.content && typeof m.id === 'number' && m.id > 1000000000000));
            return [...filtered, row];
          });
          loadProfilesFor([row.user_id]);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (p) => {
          const row = stripFullImage(p.new);
          setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
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
  }, [roomId, session]);

  // 방을 나갔다가(뒤로가기) 다시 들어올 때 hasScrolledOnceRef도 새로 시작하도록.
  // 대부분은 페이지 이동으로 컴포넌트 자체가 다시 마운트되어 자연히 초기화되지만,
  // 혹시 같은 컴포넌트가 재사용되는 경우까지 대비한 방어 코드.
  useEffect(() => {
    hasScrolledOnceRef.current = false;
    isNearBottomRef.current = true;
    fullImageCacheRef.current = new Map();
  }, [roomId]);

  // id로 사진 "원본" 화질을 가져온다. 캐시에 있으면(전송 직후 본인 사진이거나,
  // realtime으로 이미 받아둔 사진) 즉시 반환하고, 없으면 그때 딱 한 건만 조회한다.
  // full_image가 null이면(이 컬럼이 생기기 전에 보낸 옛 사진 — 그때는 content 자체가
  // 원본이었음) msg.content로 자동 폴백해서 백필 없이도 옛 사진이 그대로 보인다.
  const getFullImage = async (msg) => {
    if (!msg) return null;
    const cached = fullImageCacheRef.current.get(msg.id);
    if (cached) return cached;
    const { data, error } = await supabase.from('messages').select('full_image').eq('id', msg.id).maybeSingle();
    const full = !error && data?.full_image ? data.full_image : msg.content;
    fullImageCacheRef.current.set(msg.id, full);
    return full;
  };

  // 사진첩 일괄 다운로드처럼 여러 장을 한 번에 원본으로 바꿔야 할 때 쓰는 버전.
  // 캐시에 없는 것만 한 번의 in() 조회로 채운다.
  const getFullImages = async (msgs) => {
    const missing = msgs.filter((m) => !fullImageCacheRef.current.has(m.id));
    if (missing.length > 0) {
      const { data } = await supabase
        .from('messages')
        .select('id, full_image')
        .in('id', missing.map((m) => m.id));
      const byId = new Map((data || []).map((r) => [r.id, r.full_image]));
      missing.forEach((m) => {
        fullImageCacheRef.current.set(m.id, byId.get(m.id) || m.content);
      });
    }
    return msgs.map((m) => fullImageCacheRef.current.get(m.id) || m.content);
  };

  // 라이트박스가 열려 있는 동안 대상 사진이 바뀔 때마다(다른 사진을 열 때 포함)
  // 원본을 비동기로 채운다. 위 lightboxFullSrc 선언부 주석 참고.
  useEffect(() => {
    if (!lightboxMsg) return;
    let cancelled = false;
    getFullImage(lightboxMsg).then((full) => {
      if (!cancelled) setLightboxFullSrc(full);
    });
    return () => {
      cancelled = true;
    };
  }, [lightboxMsg]);

  // isNearBottomRef를 최신 상태로 유지: 사용자가 손으로 스크롤하거나(위로 스크롤
  // 해서 지난 대화 읽기), 아래 useEffect가 프로그램적으로 맨 아래로 스크롤할 때
  // 모두 scroll 이벤트가 발생하므로 여기서 감지한다.
  useEffect(() => {
    if (!isJoined || !isUnlocked) return;
    const el = messagesContainerRef.current;
    if (!el) return;
    const NEAR_BOTTOM_PX = 120;
    const handleScroll = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [isJoined, isUnlocked]);

  useEffect(() => {
    if (isSelectMode || editingId || pendingImages || messages.length === 0) return;
    const el = messagesContainerRef.current;
    if (!el) return;

    // 방에 처음 들어와 서버에서 메시지가 한꺼번에 로드될 때 매번 맨 위부터
    // 맨 아래까지 smooth 스크롤이 재생되면, 대화가 길수록 시간이 오래 걸리고
    // 불필요하게 화면이 쭉 흘러내려가는 것처럼 보였다. 이 방에서 처음 스크롤할
    // 때만 즉시(auto) 이동시킨다.
    if (!hasScrolledOnceRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      hasScrolledOnceRef.current = true;
      isNearBottomRef.current = true;
      return;
    }

    // 위로 스크롤해 지난 대화를 읽는 중일 때 상대가 보낸 새 메시지 때문에 화면이
    // 강제로 맨 아래까지 끌려 내려가던 문제 수정: 이미 맨 아래 근처를 보고
    // 있었거나(= 최신 메시지를 계속 따라가려는 의도), 방금 내가 보낸 메시지일
    // 때만 부드럽게 따라 내려간다. 그 외(과거 메시지 읽는 중 + 남이 보낸 메시지)
    // 에는 스크롤 위치를 그대로 둔다.
    const lastMessage = messages[messages.length - 1];
    const isOwnMessage = !!(lastMessage && session && lastMessage.user_id === session.user.id);
    if (isNearBottomRef.current || isOwnMessage) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      isNearBottomRef.current = true;
    }
  }, [messages, isSelectMode, editingId, pendingImages, session]);

  // 키보드가 뜰 때 헤더가 화면 밖으로 밀리는 문제의 잔여 케이스 보정.
  // body/래퍼를 position:fixed + h-[100dvh]로 고정해도(globals.css, 아래 JSX 참고),
  // iOS Safari나 일부 인앱 브라우저는 레이아웃 뷰포트는 그대로 둔 채 "포커스된
  // 입력창이 보이도록" 문서 자체를 스크롤시켜 버려서, fixed로 고정해둔 헤더까지
  // 화면 밖으로 밀려 보이지 않는 경우가 남아있다. window.visualViewport는 이런
  // 스크롤/축소와 무관하게 "지금 실제로 보이는 영역"의 크기(height)와 문서 기준
  // 오프셋(offsetTop)을 알려주므로, 이를 그대로 래퍼에 반영하면 브라우저가 문서를
  // 어떻게 스크롤시키든 항상 화면에 보이는 영역에 붙어있게 만들 수 있다.
  useEffect(() => {
    if (!isJoined || !isUnlocked) return;
    const vv = window.visualViewport;
    const el = viewportWrapRef.current;
    if (!vv || !el) return;

    let frame = 0;
    let lastHeight = 0;
    let lastOffsetTop = -1;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // 키보드 애니메이션 중 resize/scroll 이벤트가 같은 프레임에 연달아 오면서
        // 서로 다른 중간값으로 두 번 그려지던 것이 한 번 깜빡이는 원인이었다.
        // 프레임당 마지막 값만 반영하고, 실제 값이 달라질 때만 스타일을 바꾼다.
        const height = Math.round(vv.height);
        const offsetTop = Math.round(vv.offsetTop);
        if (height !== lastHeight) {
          el.style.height = `${height}px`;
          lastHeight = height;
        }
        if (offsetTop !== lastOffsetTop) {
          el.style.transform = offsetTop ? `translate3d(0, ${offsetTop}px, 0)` : '';
          lastOffsetTop = offsetTop;
        }
      });
    };

    // 첫 페인트 전에 현재 visual viewport 크기를 즉시 적용해 CSS의 100dvh 값과
    // JS 보정 높이가 한 프레임 동안 번갈아 보이지 않게 한다.
    el.style.height = `${Math.round(vv.height)}px`;
    lastHeight = Math.round(vv.height);
    lastOffsetTop = Math.round(vv.offsetTop);
    el.style.transform = lastOffsetTop ? `translate3d(0, ${lastOffsetTop}px, 0)` : '';
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);

    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      el.style.height = '';
      el.style.transform = '';
    };
  }, [isJoined, isUnlocked]);

  // 아바타 변경 모달에 보여줄 내 프로필 사진도 미리 캐시에 채워둔다.
  useEffect(() => {
    if (!session) return;
    supabase.from('profiles').select('avatar_url').eq('user_id', session.user.id).maybeSingle().then(({ data }) => {
      if (data) setProfiles((prev) => ({ ...prev, [session.user.id]: data.avatar_url }));
    });
  }, [session]);

  // 이 브라우저의 권한과 현재 push 구독을 모두 확인한다. 예전에는 브라우저에
  // subscription 객체만 남아 있으면 서버 DB에 실제로 등록돼 있지 않아도 켜짐으로
  // 표시되어, 특히 PC에서 방울은 켜져 있는데 알림은 안 오는 상태가 생길 수 있었다.
  // 권한이 허용된 기존 구독은 로그인할 때마다 서버에 다시 upsert해 자동 복구한다.
  useEffect(() => {
    if (!session) return;
    if (!isPushSupported()) {
      Promise.resolve().then(() => setNotifEnabled(false));
      return;
    }

    getCurrentSubscription().then(async (sub) => {
      if (sub && Notification.permission === 'granted') {
        try {
          await subscribeToPush(session.user.id, { requestPermission: false });
          setNotifEnabled(true);
          return;
        } catch (err) {
          console.error('[push] 기존 구독 서버 동기화 실패:', err);
        }
      }
      setNotifEnabled(false);
    });
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

  // 메시지 전송 성공 후 같은 방 멤버들에게 보낼 알림을 fire-and-forget 발송한다.
  // 서버(/api/notify)가 발신 계정(senderId) 전체를 수신자에서 제외하므로, 같은
  // 계정으로 로그인한 내 다른 기기(PC/폰 등)에는 내가 보낸 메시지 알림이 가지
  // 않는다.
  const postNotification = async (body) => {
    if (!session?.access_token) return;

    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        roomId,
        title: room?.title || '새 메시지',
        body,
      }),
    }).catch(() => {});
  };

  const notifyNewMessage = (content) => {
    const isSticker = isStickerContent(content);
    const isImg = typeof content === 'string' && content.startsWith(IMAGE_PREFIX) && !isSticker;
    let preview;
    if (isImg) preview = '사진을 보냈습니다';
    else if (isSticker) preview = '이모티콘을 보냈습니다';
    else preview = content.length > 40 ? content.slice(0, 40) + '…' : content;

    void postNotification(`${nickname}: ${preview}`);
  };

  // 여러 장을 한 번에 보냈을 때는 "사진 N장을 보냈습니다"로 알림을 한 번만
  // 보낸다 (notifyNewMessage를 사진 수만큼 반복 호출하면 알림이 그만큼 따로 울림).
  const notifyPhotos = (count) => {
    void postNotification(`${nickname}: 사진 ${count}장을 보냈습니다`);
  };

  const handleUnlock = (e) => {
    e.preventDefault();
    if (passwordInput === room.password) {
      localStorage.setItem(`unlocked_${roomId}`, 'true');
      setIsUnlocked(true);
    } else {
      alert('비밀번호가 올바르지 않습니다.');
      setPasswordInput('');
    }
  };

  // fullImage: 사진일 때만 전달되는 원본 화질(선택한 화질) data URL. content는
  // 항상 목록/말풍선용 값(텍스트는 그대로, 사진은 작은 썸네일)이다. 텍스트
  // 메시지는 fullImage가 null이라 컬럼도 그냥 null로 들어간다.
  const send = async (content, fullImage = null) => {
    if (!content) return;
    const tempId = Date.now();
    const nowIso = new Date().toISOString();
    const userId = session?.user?.id ?? null;
    setMessages((prev) => [...prev, { id: tempId, room_id: roomId, sender: nickname, content, created_at: nowIso, user_id: userId }]);
    // 방금 만든 원본을 미리 캐시에 넣어둔다 — realtime 응답을 기다리지 않고도
    // 본인이 방금 보낸 사진을 바로 확대해봤을 때 재조회 없이 즉시 보이게 한다.
    if (fullImage) fullImageCacheRef.current.set(tempId, fullImage);

    const { error } = await supabase.from('messages').insert([{ room_id: roomId, sender: nickname, content, full_image: fullImage, user_id: userId }]);
    if (error) {
      alert('전송 실패: ' + error.message);
    } else {
      notifyNewMessage(content);
    }
  };

  // 사진 여러 장을 한 번에 전송한다. 메시지 자체는 기존 스키마 그대로 한 장당
  // 한 행으로 저장하되, 낙관적 업데이트와 insert를 배열로 한 번에 처리하고
  // 푸시 알림은 notifyPhotos로 한 번만 보내 사진 수만큼 알림이 울리는 걸 막는다.
  // items: [{ content: 썸네일, fullImage: 원본 }]
  const sendMany = async (items) => {
    if (!items || items.length === 0) return;
    const nowIso = new Date().toISOString();
    const userId = session?.user?.id ?? null;
    const tempRows = items.map((item, i) => ({
      id: Date.now() + i,
      room_id: roomId,
      sender: nickname,
      content: item.content,
      created_at: nowIso,
      user_id: userId,
    }));
    tempRows.forEach((row, i) => {
      if (items[i].fullImage) fullImageCacheRef.current.set(row.id, items[i].fullImage);
    });
    setMessages((prev) => [...prev, ...tempRows]);

    const { error } = await supabase
      .from('messages')
      .insert(items.map((item) => ({ room_id: roomId, sender: nickname, content: item.content, full_image: item.fullImage, user_id: userId })));

    if (error) {
      alert('전송 실패: ' + error.message);
    } else {
      notifyPhotos(items.length);
    }
  };

  const handleSendText = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(text.trim());
    setText('');
    setShowEmojiPicker(false);
    // 모바일에서 "보내기" 버튼 탭으로 포커스가 잠깐 빠져나가 키보드가 내려가는
    // 경우를 대비해, 전송 후 입력창에 포커스를 다시 준다.
    textInputRef.current?.focus();
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

  const openImagePreview = (fileList) => {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    setShowEmojiPicker(false);
    setPendingImages(files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })));
  };

  // 파일 선택과 클립보드 붙여넣기 모두 같은 미리보기/전송 흐름으로 보낸다.
  const handleImageFileSelect = (e) => {
    openImagePreview(e.target.files);
    e.target.value = '';
  };

  const handlePaste = (e) => {
    const imageFiles = Array.from(e.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length === 0) return;
    e.preventDefault();
    openImagePreview(imageFiles);
  };

  // 설정에 저장한 화질로 전송한다. 원본은 파일을 다시 인코딩하지 않고 그대로 data
  // URL로 읽어서 픽셀/품질을 보존하고, 저화질/고화질만 목표 용량에 맞춰 압축한다.
  const handleConfirmSendImage = async () => {
    if (!pendingImages || pendingImages.length === 0) return;
    setIsCompressing(true);

    const qualityOptions = {
      low: { maxBytes: 100 * 1024, maxDim: 1280, quality: 0.72 },
      high: { maxBytes: 800 * 1024, maxDim: 2560, quality: 0.9 },
    };

    try {
      // 사진마다 ① 사용자가 고른 화질의 원본(fullImage)과 ② 말풍선/사진첩 그리드에
      // 쓸 아주 작은 썸네일(content)을 함께 만든다. content에는 항상 썸네일만
      // 저장하고, 원본은 full_image 컬럼에 따로 저장해 방 진입 시의 전체 조회가
      // 무거워지지 않게 한다.
      const items = [];
      for (const { file } of pendingImages) {
        const fullImage =
          imageQuality === 'original'
            ? await readImageFileAsDataUrl(file)
            : await resizeImageFile(file, qualityOptions[imageQuality] || qualityOptions.high);
        const content = await resizeImageFile(file, CHAT_THUMBNAIL_OPTIONS);
        items.push({ content, fullImage });
      }
      if (items.length === 1) {
        await send(items[0].content, items[0].fullImage);
      } else {
        await sendMany(items);
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
    localStorage.setItem(`nick_${roomId}`, nickname.trim());
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
    // 바깥 래퍼를 position:fixed로 실제 뷰포트(top:0/left:0 + 명시적 100dvh)에
    // 고정한다. 예전엔 이 래퍼가 position:relative(문서 흐름 안)였는데, 모바일에서
    // 입력창에 포커스가 가면 iOS/Android가 "포커스된 요소를 보이게" 문서(body)를
    // 자체적으로 스크롤시키는 경우가 있어서, 그 스크롤을 따라 sticky 헤더가 함께
    // 위로 밀려 화면 밖으로 사라져 버렸다(레이아웃 자체의 top:0에는 붙어있지만,
    // 스크롤된 문서 좌표계 안에서 밀려난 것). fixed는 문서 스크롤과 완전히
    // 무관하게 실제 화면 좌표에 고정되므로 이 현상 자체가 원천적으로 발생하지
    // 않는다. inset-0 대신 h-[100dvh]를 명시하는 이유는, 키보드가 열렸을 때
    // 브라우저가 줄여주는 값이 동적 뷰포트 단위(dvh)이기 때문 — inset-0은 초기
    // containing block 크기로 굳어질 수 있어 키보드가 열려도 안 줄어들 수 있다.
    // PC에서 쓰던 가운데 정렬(max-w-2xl mx-auto)은 fixed로 빠지면서 사라지므로,
    // 바깥에 flex justify-center를 둔 래퍼를 하나 더 씌워 대신한다.
    // 그래도 iOS Safari 등 일부 브라우저는 위 CSS만으로 못 잡는 잔여 케이스가
    // 있어서(레이아웃 뷰포트는 안 줄이고 문서 자체를 스크롤시켜 버림),
    // viewportWrapRef를 통해 visualViewport 기반 보정을 추가로 건다(위 useEffect 참고).
    <div ref={viewportWrapRef} className="fixed top-0 left-0 w-full h-[100dvh] flex justify-center bg-neutral-300 overflow-hidden">
    <div className="flex flex-col w-full h-full max-w-2xl bg-[#EBF2F7] border-x border-neutral-300 shadow-2xl relative">
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

              <button
                onClick={() => {
                  setShowImageQualitySettings(true);
                  setShowMenu(false);
                }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2.5 text-xs text-neutral-700 hover:bg-neutral-50 transition"
              >
                <Settings2 size={15} className="text-blue-600" />
                <span>사진 화질 설정</span>
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
        ref={messagesContainerRef}
        onClick={() => setShowMenu(false)}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-2.5 sm:px-4 py-3 space-y-3"
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
            // 같은 계정이라도 기기마다(폰/PC) 닉네임을 다르게 설정해 놓으면, 예전엔
            // "내가 보낸 메시지"를 msg.sender(닉네임 문자열)로만 판정해서 다른
            // 기기에서 보낸 내 과거 메시지가 "상대방 메시지"처럼 왼쪽에 표시되는
            // 문제가 있었다. user_id(계정, 기기가 바뀌어도 로그인 계정이면 항상
            // 동일)로 판정하도록 고쳐서 닉네임이 달라도 항상 내 메시지로 인식되게
            // 한다. user_id가 없는(컬럼 추가 이전) 옛 메시지만 닉네임 비교로 대체.
            const isMe = msg.user_id ? msg.user_id === session.user.id : msg.sender === nickname;
            const isSticker = isStickerContent(msg.content);
            const isImg = typeof msg.content === 'string' && msg.content.startsWith(IMAGE_PREFIX) && !isSticker;
            // 키보드 기본 이모지를 1~3개만 단독으로 보낸 경우 말풍선 없이 크게
            // 보여주기 위한 개수(1~3) 판별. 사진/스티커는 대상이 아니다.
            const emojiOnlyCount = !isImg && !isSticker ? getEmojiOnlyCount(msg.content) : null;
            const isEditing = editingId === msg.id;

            return (
              <div 
                key={msg.id} 
                className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} items-end gap-1.5 group relative`}
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
                  <div
                    onClick={() => profiles[msg.user_id] && setAvatarViewerUrl(profiles[msg.user_id])}
                    className={`w-8 h-8 rounded-full bg-white shadow-xs border border-neutral-200 flex items-center justify-center text-xs font-bold text-neutral-600 shrink-0 self-start mt-0.5 overflow-hidden ${profiles[msg.user_id] ? 'cursor-pointer' : ''}`}
                  >
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

                <div className={`flex min-w-0 max-w-[82%] sm:max-w-[78%] flex-col ${isMe ? 'items-end' : 'items-start'}`}>
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
                      <img src={stickerImageUrl(msg.content)} alt="이모티콘" className="w-40 h-40 sm:w-44 sm:h-44 object-contain drop-shadow-sm" />
                    </div>
                  ) : isImg ? (
                    <div className="rounded-2xl overflow-hidden shadow-md border border-black/5 bg-white p-1">
                      <img
                        src={msg.content}
                        alt="사진"
                        className="rounded-xl max-h-64 max-w-[280px] object-cover cursor-pointer hover:opacity-95"
                        onClick={() => {
                          setLightboxFullSrc(null);
                          setLightboxMsg(msg);
                        }}
                      />
                    </div>
                  ) : emojiOnlyCount ? (
                    // 기본 이모지 1~3개만 보낸 메시지는 스티커처럼 말풍선 없이
                    // 큰 글자로만 보여주고, 등장할 때 살짝 튀어오르는 pop-in
                    // 애니메이션을 줘서 밋밋하지 않게 한다(globals.css 참고).
                    <div className={`emoji-pop leading-none ${emojiOnlySizeClass(emojiOnlyCount)}`}>
                      {msg.content}
                    </div>
                  ) : (
                    <div
                      className={`px-3.5 py-2 rounded-2xl text-[13px] leading-relaxed shadow-xs max-w-full break-words ${
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
          getFullImage={getFullImage}
          getFullImages={getFullImages}
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
                onClick={async () => {
                  const full = lightboxFullSrc || await getFullImage(lightboxMsg);
                  downloadDataUrl(full, filenameFor(lightboxMsg.created_at));
                }}
                className="p-2 hover:bg-white/10 rounded-full transition"
                title="사진 다운로드"
              >
                <Download size={19} />
              </button>
              <button onClick={() => { setLightboxFullSrc(null); setLightboxMsg(null); }} className="p-2 hover:bg-white/10 rounded-full transition">
                <X size={20} />
              </button>
            </div>
          </div>
          <ZoomableImage
            src={lightboxFullSrc || lightboxMsg.content}
            alt="사진"
            className="max-h-full max-w-full object-contain"
            containerClassName="flex-1 flex items-center justify-center px-2 w-full h-full"
            onTap={() => { setLightboxFullSrc(null); setLightboxMsg(null); }}
          />
        </div>
      )}

      {/* 프로필 사진 확대보기 라이트박스 (핀치줌/더블탭 확대 가능) */}
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

      {/* 사진 화질은 메시지를 보낼 때마다 묻지 않고 여기서 한 번 설정한다. */}
      {showImageQualitySettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-neutral-200">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-sm text-neutral-900">사진 전송 화질</h3>
              <button
                type="button"
                onClick={() => setShowImageQualitySettings(false)}
                className="p-1.5 text-neutral-400 hover:bg-neutral-100 rounded-full"
                title="닫기"
              >
                <X size={17} />
              </button>
            </div>
            <p className="text-[11px] text-neutral-400 mb-4">선택한 설정은 이 브라우저에 저장되어 다음 사진에도 계속 적용됩니다.</p>
            <div className="space-y-2">
              {[
                { id: 'low', title: '저화질', description: '사진당 약 100KB · 빠른 전송' },
                { id: 'high', title: '고화질', description: '사진당 약 800KB · 선명한 화질' },
                { id: 'original', title: '원본', description: '압축 없이 원본 파일 그대로' },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setImageQuality(option.id);
                    try { localStorage.setItem('image_quality', option.id); } catch {}
                    setShowImageQualitySettings(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border text-left transition ${
                    imageQuality === option.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-neutral-200 hover:bg-neutral-50 text-neutral-700'
                  }`}
                >
                  <span>
                    <span className="block text-xs font-bold">{option.title}</span>
                    <span className="block text-[10px] mt-0.5 opacity-70">{option.description}</span>
                  </span>
                  <span className={`w-4 h-4 rounded-full border-4 ${imageQuality === option.id ? 'border-blue-600' : 'border-neutral-300'}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 파일 선택/붙여넣기로 추가한 사진을 전송 전에 확인한다. */}
      {pendingImages && pendingImages.length > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-neutral-200 space-y-4">
            <div className="text-center">
              <h3 className="font-bold text-sm text-neutral-900">
                사진 전송{pendingImages.length > 1 && ` (${pendingImages.length}장 선택됨)`}
              </h3>
              <p className="text-[10px] text-neutral-400 mt-1">
                현재 화질: {imageQuality === 'low' ? '저화질 · 약 100KB' : imageQuality === 'high' ? '고화질 · 약 800KB' : '원본'}
              </p>
            </div>

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

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 p-2 max-h-[22rem] overflow-y-auto">
              {(stickers[activePack] || []).length === 0 ? (
                <div className="col-span-4 text-center py-6 text-xs text-neutral-400">
                  이모티콘 파일을 불러오는 중입니다...
                </div>
              ) : (
                stickers[activePack].map((stickerUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => { send(encodeStickerContent(stickerUrl)); setShowEmojiPicker(false); }}
                    className="p-1.5 hover:bg-neutral-100 active:scale-90 rounded-2xl transition flex items-center justify-center cursor-pointer"
                  >
                    <img src={stickerUrl} alt="스티커" className="w-24 h-24 sm:w-28 sm:h-28 object-contain" />
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
            ref={textInputRef}
            placeholder="메시지를 입력하세요..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="flex-1 px-4 py-2 text-sm bg-neutral-100 rounded-2xl border border-transparent focus:border-blue-400 focus:bg-white focus:outline-none transition"
          />

          <button
            type="submit"
            disabled={!text.trim()}
            onMouseDown={(e) => e.preventDefault()}
            className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xs transition disabled:opacity-40"
            title="보내기"
          >
            <Send size={15} />
          </button>
        </form>
      </footer>
    </div>
    </div>
  );
}