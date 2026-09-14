// 사진 일괄 다운로드용 유틸.
//
// dataURL(base64) → Blob 변환은 fetch(dataUrl)로도 가능하지만, 일부 환경의
// CSP/네트워크 정책에 걸릴 수 있어 base64를 직접 디코딩하는 방식을 쓴다.
function dataUrlToBlob(dataUrl) {
  const [header, base64 = ''] = dataUrl.split(',');
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// dataURL 하나를 <a download>로 브라우저 기본 다운로드 폴더에 저장한다.
// 모든 브라우저(모바일 포함)에서 동작하는 표준적인 방식.
export function downloadDataUrl(dataUrl, filename) {
  const blob = dataUrlToBlob(dataUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// window.showDirectoryPicker()는 데스크톱 Chrome/Edge 계열에서만 지원되고
// 모바일 Chrome이나 iOS의 모든 브라우저에서는 지원하지 않는다(플랫폼 자체의
// 한계). 지원 여부를 미리 확인해서, 지원하지 않는 환경에서는 "다른 폴더에
// 저장" 버튼 자체를 숨기는 데 쓴다.
export function isDirectoryPickerSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// 여러 장을 한 번에 저장한다.
// - toDirectory:true 이고 showDirectoryPicker를 지원하면, 폴더 선택창을 띄워
//   사용자가 고른 폴더 안에 실제로 저장한다.
// - 그 외(기본, 모바일 포함 모든 브라우저)에는 순서대로 기본 다운로드 폴더에
//   내려받는다. 한꺼번에 여러 개를 트리거하면 브라우저가 다운로드를 팝업처럼
//   막아버리는 경우가 있어 약간의 간격을 두고 하나씩 처리한다.
export async function downloadMany(items, { toDirectory = false } = {}) {
  if (toDirectory && isDirectoryPickerSupported()) {
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker();
    } catch (err) {
      if (err?.name === 'AbortError') return { saved: 0, cancelled: true };
      throw err;
    }
    let saved = 0;
    for (const { dataUrl, filename } of items) {
      const blob = dataUrlToBlob(dataUrl);
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      saved++;
    }
    return { saved, cancelled: false };
  }

  for (let i = 0; i < items.length; i++) {
    downloadDataUrl(items[i].dataUrl, items[i].filename);
    if (i < items.length - 1) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { saved: items.length, cancelled: false };
}
