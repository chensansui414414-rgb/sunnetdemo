import type { Metadata } from "next";
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
  title: "霞光预报网 | GlowCast",
  description:
    "基于真实逐小时气象预报的六城日落与日出霞光指数。",
  openGraph: {
    title: "霞光预报网 | GlowCast",
    description:
      "基于真实逐小时气象预报的六城霞光指数、峰值窗口、置信度和因子解释。",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "霞光预报网 GlowCast 六城霞光指数",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "霞光预报网 | GlowCast",
    description: "基于真实逐小时气象预报的六城霞光指数、峰值窗口、置信度和因子解释。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
