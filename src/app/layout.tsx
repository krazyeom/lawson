import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lawson Coupon Lookup | 쿠폰 코드 검색",
  description:
    "로손 캠페인 쿠폰 코드 일괄 조회 도구. 여러 쿠폰 코드를 입력하면 쿠폰 상세 링크를 즉시 확인할 수 있습니다.",
  keywords: ["lawson", "coupon", "lookup", "petit.gift", "kakaotalk", "로손", "쿠폰"],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
