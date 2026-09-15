import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "비공개 대화방",
  description: "비밀번호로 들어가는 비공개 채팅방",
  applicationName: "비공개 대화방",
  manifest: "/manifest.webmanifest",
};

// 뷰포트 메타 태그를 명시하지 않으면 모바일 브라우저가 데스크톱 폭(약 980px)을
// 기준으로 렌더링해서 화면이 줌아웃/팬(좌우 이동) 가능한 상태가 된다.
// 폭을 기기 화면에 고정하고 확대/축소를 막아서 앱처럼 딱 맞게 보이게 한다.
//
// interactiveWidget: "resizes-content" — 크롬(안드로이드)의 기본값은 키보드가 떠도
// 레이아웃 뷰포트(=100dvh 등 CSS 단위의 기준)는 그대로 두고 화면(visual viewport)만
// 가려버리는 것이라, 100dvh로 짜여진 레이아웃이 키보드 크기만큼 줄어들지 않고 그
// 결과 상단 헤더(방 이름/뒤로가기/알림/설정)가 화면 밖으로 밀려 보이지 않는 문제가
// 있었다. 이 값을 주면 키보드가 뜰 때 레이아웃 뷰포트 자체가 줄어들어 100dvh
// 컨테이너가 키보드 높이만큼 실제로 작아지고, 그 안의 메시지 영역(overflow-y-auto)만
// 줄어들 뿐 헤더/입력창 위치는 그대로 유지된다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
