// 프로필 사진처럼 정사각형으로 작게 리사이즈해서 base64(dataURL)로 반환한다.
// 채팅 이미지 전송(화질 선택)과는 별개의 용도라 가볍게 캔버스로 직접 처리한다.
export function compressImageFile(file, { maxDim = 256, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'));
      img.onload = () => {
        const nw = img.naturalWidth || img.width || maxDim;
        const nh = img.naturalHeight || img.height || maxDim;
        // 정사각형으로 가운데를 크롭해서 아바타처럼 보이게 한다.
        const side = Math.min(nw, nh);
        const sx = (nw - side) / 2;
        const sy = (nh - side) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = maxDim;
        canvas.height = maxDim;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxDim, maxDim);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target?.result;
    };
    reader.readAsDataURL(file);
  });
}

export function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== 'string' || !result.startsWith('data:image/')) {
        reject(new Error('지원하지 않는 이미지 형식입니다.'));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

// 채팅 사진 전송용 리사이즈: 아바타와 달리 정사각형으로 자르지 않고 비율을
// 유지한다. maxBytes가 지정되면 JPEG 품질과 해상도를 단계적으로 낮춰 data URL의
// 실제 바이트 크기가 목표치에 가까워질 때까지 압축한다(사진 내용에 따라 최종 크기는
// 조금 달라질 수 있음). 원본 모드는 이 함수를 거치지 않고 위 헬퍼로 그대로 읽는다.
export function resizeImageFile(
  file,
  { maxDim = 720, quality = 0.6, maxBytes = null, minQuality = 0.38 } = {}
) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'));
      img.onload = () => {
        const nw = img.naturalWidth || img.width || 600;
        const nh = img.naturalHeight || img.height || 600;
        let scale = Math.min(1, maxDim / Math.max(nw, nh));
        let currentQuality = quality;
        let attempts = 0;

        const encode = () => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(nw * scale));
          canvas.height = Math.max(1, Math.round(nh * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('이미지를 처리할 수 없습니다.');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', currentQuality);
        };

        try {
          let result = encode();
          while (maxBytes && dataUrlByteSize(result) > maxBytes && attempts < 10) {
            if (currentQuality > minQuality + 0.04) {
              currentQuality = Math.max(minQuality, currentQuality - 0.1);
            } else {
              scale *= 0.82;
              currentQuality = quality;
            }
            result = encode();
            attempts += 1;
          }
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };
      img.src = ev.target?.result;
    };
    reader.readAsDataURL(file);
  });
}

function dataUrlByteSize(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}
