'use client';

import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { compressImageFile } from '@/lib/compressImage';
import { User as UserIcon, X } from 'lucide-react';

// 프로필 사진(아바타) 변경 모달. 홈/채팅방 양쪽에서 공용으로 쓴다.
// 계정(profiles 테이블) 기준으로 저장되므로 어느 화면에서 바꿔도 전체에 반영된다.
export default function AvatarModal({ userId, avatarUrl, onChange, onClose }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userId) return;

    setUploading(true);
    try {
      const base64 = await compressImageFile(file, { maxDim: 256, quality: 0.85 });
      const { error } = await supabase
        .from('profiles')
        .upsert([{ user_id: userId, avatar_url: base64, updated_at: new Date().toISOString() }], {
          onConflict: 'user_id',
        });
      if (error) {
        alert('프로필 사진 저장 실패: ' + error.message);
      } else {
        onChange?.(base64);
        onClose?.();
      }
    } catch (err) {
      alert('이미지 처리 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!userId) return;
    setUploading(true);
    const { error } = await supabase
      .from('profiles')
      .upsert([{ user_id: userId, avatar_url: null, updated_at: new Date().toISOString() }], {
        onConflict: 'user_id',
      });
    setUploading(false);
    if (error) {
      alert('삭제 실패: ' + error.message);
      return;
    }
    onChange?.(null);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
      <div className="w-full max-w-xs bg-white rounded-3xl p-6 shadow-2xl border border-neutral-200 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-base text-neutral-900">프로필 사진</h2>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 rounded-full">
            <X size={18} />
          </button>
        </div>

        <div className="flex justify-center">
          <div className="w-28 h-28 rounded-full bg-blue-50 text-blue-300 flex items-center justify-center overflow-hidden border border-blue-100 shadow-inner">
            {avatarUrl ? (
              <img src={avatarUrl} alt="내 프로필" className="w-full h-full object-cover" />
            ) : (
              <UserIcon size={44} />
            )}
          </div>
        </div>

        <input type="file" ref={fileRef} accept="image/*" className="hidden" onChange={handleFileSelect} />

        <div className="flex space-x-2">
          {avatarUrl && (
            <button
              type="button"
              disabled={uploading}
              onClick={handleRemove}
              className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold rounded-xl transition disabled:opacity-50"
            >
              사진 삭제
            </button>
          )}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow transition disabled:opacity-50"
          >
            {uploading ? '업로드 중...' : '사진 선택'}
          </button>
        </div>
      </div>
    </div>
  );
}
