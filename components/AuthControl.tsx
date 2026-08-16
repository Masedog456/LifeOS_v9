"use client";

import { useState } from "react";
import { signInWithEmail, signOut, useAuth } from "@/lib/authStore";

export default function AuthControl() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");

  if (!auth.configured) return null;
  if (auth.loading) return <span className="text-xs text-zinc-400">…</span>;

  if (auth.email) {
    return (
      <span className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="hidden max-w-[12rem] truncate sm:inline" title={auth.email}>
          {auth.email}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          Sign out
        </button>
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-black/[.12] px-3 py-1 text-xs font-medium hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
      >
        Get started
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-black/[.10] bg-white p-4 shadow-lg dark:border-white/[.12] dark:bg-zinc-900">
          <p className="text-sm font-medium">Join Conqify Early Access</p>
          <p className="mt-1 text-xs text-zinc-500">
            Enter your email and we&apos;ll send a secure link. New verified emails create an account; returning members sign back in with the same flow.
          </p>

          {auth.phase === "sent" ? (
            <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              Check your email for your secure Conqify link.
            </p>
          ) : (
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void signInWithEmail(email);
              }}
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/[.25] dark:border-white/[.12] dark:focus:border-white/[.30]"
              />
              <button
                type="submit"
                disabled={auth.phase === "sending" || !email.trim()}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {auth.phase === "sending" ? "Sending…" : "Email me a secure link"}
              </button>
              {auth.phase === "error" && (
                <p className="text-xs text-red-500">{auth.error ?? "Sign-in failed."}</p>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
