import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "부자재 발주 체크리스트",
  description: "생산일정 기준 부자재 발주 체크리스트",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased print:bg-white">{children}</body>
    </html>
  );
}
