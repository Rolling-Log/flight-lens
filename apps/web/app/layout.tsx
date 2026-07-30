import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "航探 Flight Lens｜中国航线透明比价",
  description: "核对航司官网、国内 OTA 与国际比价渠道，以统一全价口径找到更合适的机票。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
