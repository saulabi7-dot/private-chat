'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X, ChevronLeft, ChevronRight, CheckSquare, Square,
  Download, FolderDown,
} from 'lucide-react';
import { downloadDataUrl, downloadMany, isDirectoryPickerSupported, filenameFor } from '@/lib/download';
import ZoomableImage from '@/components/ZoomableImage';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? '오후' : '오전';
  h = h % 12 || 12;
  return `${ampm} ${h}:${m}`;
}

// "..." 메뉴 → "사진첩"에서 여는 모달. 이미 방 페이지가 들고 있는 messages를
// 그대로 받아서(별도 쿼리 없이) 이미지 data URL 중 스티커 PNG를 제외한 사진
// 메시지만 추려 날짜별로 묶어 썸네일 그리드로 보여준다. 카카오톡/텔레그램의
// 사진첩과 동일한 동작: 썸네일 탭 → 확대 보기, "선택" → 다중 선택 후 일괄
// 다운로드(기본 폴더 또는, 지원 브라우저에서는 다른 폴더 선택).
export default function PhotoGalleryModal({ messages, onClose, getFullImage, getFullImages }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [lightboxIdx, setLightboxIdx] = useState(null); // photos 배열 기준 인덱스
  const [lightboxFullSrc, setLightboxFullSrc] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const photos = useMemo(() => {
    return messages
      .filter((m) => typeof m.content === 'string' && m.content.startsWith('data:image/') && (!m.content.startsWith('data:image/png') || m.content.length >= 900_000))
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }, [messages]);

  const groups = useMemo(() => {
    const map = new Map();
    photos.forEach((p, idx) => {
      const key = formatDate(p.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ ...p, idx });
    });
    return [...map.entries()];
  }, [photos]);

  const dirSupported = isDirectoryPickerSupported();

  // 라이트박스가 열리거나 사진이 바뀔 때 원본 이미지를 비동기로 가져온다.
  // 썸네일이 먼저 보이고, 원본이 도착하면 선명해지는 방식.
  useEffect(() => {
    if (lightboxIdx === null || !photos[lightboxIdx]) return;
    let cancelled = false;
    if (getFullImage) {
      getFullImage(photos[lightboxIdx]).then((full) => {
        if (!cancelled) setLightboxFullSrc(full);
      });
    }
    return () => { cancelled = true; };
  }, [lightboxIdx, photos, getFullImage]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAll = () => {
    setSelectedIds(selectedIds.length === photos.length ? [] : photos.map((p) => p.id));
  };

  const buildItems = async (ids) => {
    const chosen = photos.filter((p) => ids.includes(p.id));
    // getFullImages가 있으면 원본으로 다운로드, 없으면 content(폴백)
    if (getFullImages) {
      const fulls = await getFullImages(chosen);
      return chosen.map((p, i) => ({ dataUrl: fulls[i], filename: filenameFor(p.created_at, p.idx + 1) }));
    }
    return chosen.map((p) => ({ dataUrl: p.content, filename: filenameFor(p.created_at, p.idx + 1) }));
  };

  const handleDownloadSelected = async (toDirectory) => {
    if (selectedIds.length === 0 || downloading) return;
    setDownloading(true);
    try {
      const items = await buildItems(selectedIds);
      const result = await downloadMany(items, { toDirectory });
      if (!result.cancelled) {
        setSelectMode(false);
        setSelectedIds([]);
      }
    } catch (err) {
      alert('다운로드 중 오류가 발생했습니다: ' + (err?.message || ''));
    } finally {
      setDownloading(false);
    }
  };

  const handleThumbClick = (photo) => {
    if (selectMode) {
      toggleSelect(photo.id);
    } else {
      setLightboxFullSrc(null);
      setLightboxIdx(photo.idx);
    }
  };

  const gotoLightbox = (delta) => {
    setLightboxFullSrc(null);
    setLightboxIdx((cur) => {
      if (cur === null) return cur;
      const next = cur + delta;
      if (next < 0 || next >= photos.length) return cur;
      return next;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-100">
      <div className="w-full max-w-lg h-[85vh] bg-white rounded-3xl shadow-2xl border border-neutral-200 flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 shrink-0">
          <h2 className="font-bold text-sm text-neutral-900">사진첩 ({photos.length})</h2>
          <div className="flex items-center space-x-1">
            {photos.length > 0 && (
              <button
                onClick={() => { setSelectMode((prev) => !prev); setSelectedIds([]); }}
                className="px-2.5 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded-lg transition"
              >
                {selectMode ? '선택 취소' : '선택'}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-neutral-600 rounded-full">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 썸네일 그리드 (날짜별) */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {photos.length === 0 ? (
            <div className="text-center py-24 text-xs text-neutral-400">
              아직 주고받은 사진이 없습니다.
            </div>
          ) : (
            groups.map(([dateLabel, dayPhotos]) => (
              <div key={dateLabel}>
                <div className="flex justify-center mb-2">
                  <span className="px-3 py-1 bg-neutral-100 text-neutral-500 text-[11px] font-medium rounded-full">
                    {dateLabel}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {dayPhotos.map((p) => {
                    const checked = selectedIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleThumbClick(p)}
                        className="relative aspect-square rounded-lg overflow-hidden bg-neutral-100 group"
                      >
                        <img src={p.content} alt="사진" className="w-full h-full object-cover" />
                        {selectMode && (
                          <span className="absolute top-1 right-1 bg-black/40 rounded-md p-0.5">
                            {checked ? (
                              <CheckSquare size={16} className="fill-blue-600 text-white" />
                            ) : (
                              <Square size={16} className="text-white" />
                            )}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 선택 모드 하단 액션바 */}
        {selectMode && (
          <div className="border-t border-neutral-200 px-4 py-3 flex items-center justify-between shrink-0 bg-neutral-50">
            <div className="flex items-center space-x-3">
              <span className="text-xs font-semibold text-neutral-600">{selectedIds.length}장 선택됨</span>
              <button onClick={selectAll} className="text-xs font-semibold text-blue-600">
                {selectedIds.length === photos.length ? '전체 해제' : '전체선택'}
              </button>
            </div>
            <div className="flex items-center space-x-1.5">
              {dirSupported && (
                <button
                  type="button"
                  disabled={selectedIds.length === 0 || downloading}
                  onClick={() => handleDownloadSelected(true)}
                  title="다른 폴더에 저장"
                  className="p-2 text-neutral-600 hover:bg-neutral-200 rounded-xl transition disabled:opacity-40"
                >
                  <FolderDown size={18} />
                </button>
              )}
              <button
                type="button"
                disabled={selectedIds.length === 0 || downloading}
                onClick={() => handleDownloadSelected(false)}
                className="flex items-center space-x-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition disabled:opacity-40"
              >
                <Download size={14} />
                <span>{downloading ? '저장 중...' : '다운로드'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 라이트박스: 풀스크린 확대 보기 */}
      {lightboxIdx !== null && photos[lightboxIdx] && (
        <div className="fixed inset-0 bg-black/90 flex flex-col z-[60] animate-in fade-in duration-100">
          <div className="flex items-center justify-between px-4 py-3 text-white/90 shrink-0">
            <div className="text-xs">
              <p className="font-semibold">{formatDate(photos[lightboxIdx].created_at)}</p>
              <p className="text-white/60">{formatTime(photos[lightboxIdx].created_at)}</p>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={async () => {
                  const full = lightboxFullSrc || (getFullImage ? await getFullImage(photos[lightboxIdx]) : photos[lightboxIdx].content);
                  downloadDataUrl(full, filenameFor(photos[lightboxIdx].created_at, photos[lightboxIdx].idx + 1));
                }}
                className="p-2 hover:bg-white/10 rounded-full transition"
                title="이 사진 다운로드"
              >
                <Download size={19} />
              </button>
              <button onClick={() => { setLightboxFullSrc(null); setLightboxIdx(null); }} className="p-2 hover:bg-white/10 rounded-full transition">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center relative px-2">
            {lightboxIdx > 0 && (
              <button
                onClick={() => gotoLightbox(-1)}
                className="absolute left-1 sm:left-3 p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition"
              >
                <ChevronLeft size={26} />
              </button>
            )}
            <ZoomableImage
              src={lightboxFullSrc || photos[lightboxIdx].content}
              alt="사진"
              className="max-h-full max-w-full object-contain"
              containerClassName="w-full h-full flex items-center justify-center"
            />
            {lightboxIdx < photos.length - 1 && (
              <button
                onClick={() => gotoLightbox(1)}
                className="absolute right-1 sm:right-3 p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition"
              >
                <ChevronRight size={26} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
