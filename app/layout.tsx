import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import StoreHydrator from "@/components/StoreHydrator";
import PersistenceBootstrap from "@/components/PersistenceBootstrap";
import CommandCenter from "@/components/command/CommandCenter";
import Inspector from "@/components/entity/Inspector";
import SessionBanner from "@/components/workspace/SessionBanner";
import ToastProvider from "@/components/ux/ToastProvider";
import ConfirmHost from "@/components/ux/ConfirmDialog";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LifeOS — a quiet home for thinking clearly",
  description:
    "A calm place to organize your reading, thinking, projects, and decisions. LifeOS helps you think and keeps your own judgment at the center — it never thinks for you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <StoreHydrator />
        <PersistenceBootstrap />
        <Nav />
        <SessionBanner />
        <div className="flex flex-1 flex-col">{children}</div>
        <CommandCenter />
        <Inspector />
        <ToastProvider />
        <ConfirmHost />
      </body>
    </html>
  );
}
