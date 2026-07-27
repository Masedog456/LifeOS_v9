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
  title: "LifeOS — Belief Threads",
  description:
    "Capture a thought, resurface a past one, and watch your beliefs bend over time.",
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
