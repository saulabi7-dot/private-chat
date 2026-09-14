import type { MetadataRoute } from 'next';

// iOS Safari에서 "홈 화면에 추가"로 설치했을 때 앱처럼 보이게 하기 위한 매니페스트.
// (iOS는 PWA로 설치된 상태에서만 웹 푸시 알림을 지원하므로 필수적인 파일이다.)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '비공개 대화방',
    short_name: '대화방',
    description: '비밀번호로 들어가는 비공개 채팅방',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f5f5',
    theme_color: '#2563eb',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  };
}
