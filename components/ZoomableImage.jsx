'use client';

import { useEffect, useRef } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_MOVE_TOLERANCE = 8; // 이 이상 움직이면 탭이 아니라 드래그로 본다

// 사진/프로필 사진 라이트박스에서 쓰는 확대/축소 뷰어.
// - 모바일: 두 손가락 핀치로 확대/축소, 더블탭으로 토글 확대, 확대된 상태에서는
//   한 손가락 드래그로 이동.
// - 데스크톱: 마우스 휠로 확대/축소, 확대된 상태에서는 드래그로 이동. 더블클릭도
//   더블탭과 같은 경로(포인터 이벤트)로 처리되므로 별도 핸들러는 필요 없다.
// - 확대되어 있지 않은 상태에서 짧게 탭(드래그 없이)하면 onTap을 호출한다.
//   (라이트박스를 "탭해서 닫기"용으로 쓰기 위함 — 확대된 상태에서는 실수로
//   닫히지 않도록 onTap을 호출하지 않는다.)
//
// scale/x/y는 제스처마다(특히 pointermove) 아주 빈번히 바뀌므로 React state로
// 관리하며 매번 리렌더하지 않고, ref에 값을 들고 있다가 img DOM에 직접
// style.transform을 써서 반영한다(리렌더 없이 바로 화면에 그려져 더 매끄럽다).
export default function ZoomableImage({ src, alt = '', className = '', containerClassName = '', onTap }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });

  const pointersRef = useRef(new Map()); // pointerId -> { x, y }
  const gestureRef = useRef(null); // 현재 진행 중인 팬/핀치 정보
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
  const movedRef = useRef(false);

  const paint = (withTransition) => {
    const img = imgRef.current;
    if (!img) return;
    const { scale, x, y } = transformRef.current;
    img.style.transition = withTransition ? 'transform 150ms ease-out' : 'none';
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };

  // 사진이 바뀌면(라이트박스 이전/다음 이동 등) 확대 상태를 초기화한다.
  useEffect(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    transformRef.current = { scale: 1, x: 0, y: 0 };
    paint(false);
  }, [src]);

  const clamp = (scale, x, y) => {
    const el = containerRef.current;
    if (!el) return { x, y };
    const rect = el.getBoundingClientRect();
    // 확대된 만큼 생기는 여유 공간을 넘어서는 이동은 막아서 사진이 화면 밖으로
    // 완전히 사라지지 않게 한다.
    const maxX = (rect.width * (scale - 1)) / 2;
    const maxY = (rect.height * (scale - 1)) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const setTransform = (next, withTransition) => {
    transformRef.current = next;
    paint(withTransition);
  };

  const resetZoom = (withTransition = true) => setTransform({ scale: 1, x: 0, y: 0 }, withTransition);

  const zoomAt = (clientX, clientY, targetScale) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const cur = transformRef.current;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetScale));
    // 확대 중심점(탭/클릭 위치)이 화면상 같은 자리에 남도록 x/y도 함께 보정
    const ratio = scale / cur.scale;
    const nx = cx - (cx - cur.x) * ratio;
    const ny = cy - (cy - cur.y) * ratio;
    setTransform({ scale, ...clamp(scale, nx, ny) }, true);
  };

  const onPointerDown = (e) => {
    containerRef.current?.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;

    if (pointersRef.current.size === 1) {
      gestureRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
      };
    } else if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      gestureRef.current = {
        mode: 'pinch',
        startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        startScale: transformRef.current.scale,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
      };
    }
  };

  const onPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.mode === 'pan' && pointersRef.current.size === 1) {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (Math.hypot(dx, dy) > TAP_MOVE_TOLERANCE) movedRef.current = true;
      if (transformRef.current.scale <= 1.01) return; // 확대 안 된 상태는 탭 판정만 하고 이동은 없음
      setTransform({ scale: transformRef.current.scale, ...clamp(transformRef.current.scale, gesture.originX + dx, gesture.originY + dy) }, false);
    } else if (gesture.mode === 'pinch' && pointersRef.current.size === 2) {
      movedRef.current = true;
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, gesture.startScale * (dist / gesture.startDist)));
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = gesture.midX - rect.left - rect.width / 2;
      const cy = gesture.midY - rect.top - rect.height / 2;
      const ratio = nextScale / gesture.startScale;
      const nx = cx - (cx - gesture.originX) * ratio;
      const ny = cy - (cy - gesture.originY) * ratio;
      setTransform({ scale: nextScale, ...clamp(nextScale, nx, ny) }, false);
    }
  };

  const endPointer = (e) => {
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 1) {
      // 두 손가락 중 하나를 뗀 경우, 남은 손가락 기준으로 팬 모드를 새로 시작
      const [, point] = [...pointersRef.current.entries()][0];
      gestureRef.current = { mode: 'pan', startX: point.x, startY: point.y, originX: transformRef.current.x, originY: transformRef.current.y };
      return;
    }
    if (pointersRef.current.size > 1) return;

    gestureRef.current = null;

    if (!movedRef.current) {
      const now = Date.now();
      const last = lastTapRef.current;
      const isDoubleTap = now - last.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40;
      lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };

      if (isDoubleTap) {
        lastTapRef.current = { time: 0, x: 0, y: 0 };
        if (transformRef.current.scale > 1.01) resetZoom();
        else zoomAt(e.clientX, e.clientY, DOUBLE_TAP_SCALE);
      } else if (transformRef.current.scale <= 1.01 && onTap) {
        // 더블탭일 수도 있으니 잠시 기다렸다가, 그사이 두 번째 탭이 안 왔을 때만 닫기 처리
        setTimeout(() => {
          if (lastTapRef.current.time === now) onTap();
        }, DOUBLE_TAP_MS);
      }
    } else if (transformRef.current.scale < MIN_SCALE + 0.001) {
      resetZoom(false);
    } else {
      // 팬/핀치가 끝난 뒤 경계를 살짝 벗어나 있을 수 있는 위치를 다시 한번 정리
      setTransform({ scale: transformRef.current.scale, ...clamp(transformRef.current.scale, transformRef.current.x, transformRef.current.y) }, true);
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, transformRef.current.scale * factor);
  };

  return (
    <div
      ref={containerRef}
      className={`touch-none select-none overflow-hidden ${containerClassName}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img ref={imgRef} src={src} alt={alt} draggable={false} className={className} />
    </div>
  );
}
