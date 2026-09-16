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
import PaidAccessGate from "@/components/billing/PaidAccessGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Conqify — turn life's chaos into order",
  description:
    "Bring your tasks, ideas, learning, projects, responsibilities, and plans together. Conqify helps you organize what matters and decide what comes next.",
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
        {/*
          LIFEOS-095 §26. Clearance for the mobile command bar.

          `MobileCommandTrigger` is `fixed bottom-0 sm:hidden`, so on a phone it
          floats over whatever the page ends with. Measured on the capture
          review panel: "Confirm all", "Keep the whole thing as a note" and
          "Start over" were all underneath it — including the escape hatch
          LIFEOS-060 §16 promises is always one click away.

          Fixed here rather than on one page: every route ends somewhere, and a
          bar that covers content covers it everywhere.
        */}
        {/*
          LIFEOS-BILLING §18. The paid-access boundary, in one place.

          It wraps the route tree and nothing else: `Nav` above it keeps the
          sign-in/sign-out control reachable from every route, and the command
          centre, inspector and dialog hosts below it are chrome rather than
          content. Off unless NEXT_PUBLIC_REQUIRE_PAID_ACCESS is "true" — see
          lib/billing/gate.ts.
        */}
        <div className="flex flex-1 flex-col pb-16 sm:pb-0">
          <PaidAccessGate>{children}</PaidAccessGate>
        </div>
        <CommandCenter />
        <Inspector />
        <ToastProvider />
        <ConfirmHost />
      </body>
    </html>
  );
}
