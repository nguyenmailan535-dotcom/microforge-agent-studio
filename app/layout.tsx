import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MicroForge · Agent Studio",
  description: "MicroForge Agent Studio",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
