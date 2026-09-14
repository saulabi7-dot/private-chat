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
