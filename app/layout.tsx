import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "霞光预报网 | GlowCast",
  description:
    "基于光路通透度、云层画布、AOD、GFS/ECMWF一致性的六城火烧云指数。",
  openGraph: {
    title: "霞光预报网 | GlowCast",
    description:
      "用光源、光路、云画布、AOD 和模型一致性计算六城火烧云潜力。",
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
    description: "用光源、光路、云画布、AOD 和模型一致性计算六城火烧云潜力。",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
