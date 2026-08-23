import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Lawson Coupon Lookup | クーポンコード検索",
  description:
    "Bulk coupon code lookup tool for Lawson campaigns. Enter multiple coupon codes and retrieve coupon detail links instantly.",
  keywords: ["lawson", "coupon", "lookup", "petit.gift", "kakaotalk"],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
