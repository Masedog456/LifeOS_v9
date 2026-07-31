"use client";

/**
 * Production-safe error boundary (LIFEOS-040, Feature 10).
 *
 * Wraps a major surface. On error it renders a SafeError: a concise message, a
 * quotable reference id, a retry, and safe navigation — never a stack, SQL, env
 * var, token, or record payload. In development it also logs the redacted detail
 * to the console. Also offers an export path when data may be at risk.
 */

import React from "react";
import Link from "next/link";
import { toSafeError, type SafeError } from "@/lib/security/errors";

interface Props { surface: string; children: React.ReactNode; offerExport?: boolean }
interface State { error: SafeError | null }

export default class SecurityErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: unknown): State {
    return { error: toSafeError(err, { isDev: process.env.NODE_ENV !== "production" }) };
  }

  componentDidCatch(err: unknown) {
    if (process.env.NODE_ENV !== "production") {
      // Redacted detail only, never the raw stack/payload.
      const safe = toSafeError(err, { isDev: true });
      console.warn(`[${this.props.surface}] ${safe.reference} ${safe.category}: ${safe.devDetail ?? ""}`);
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" data-error-boundary={this.props.surface} className="mx-auto my-8 w-full max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/[.04] p-5 text-center">
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Something went wrong in {this.props.surface}.</p>
        <p className="mt-1 text-[13px] text-zinc-500">{error.message}</p>
        <p className="mt-2 font-mono text-[11px] text-zinc-400" data-error-reference>Reference: {error.reference}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2 text-[13px]">
          {error.retryable && <button type="button" onClick={this.reset} data-error-retry className="rounded-full bg-zinc-900 px-4 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Try again</button>}
          <Link href="/today" className="rounded-full border border-black/[.12] px-4 py-1.5 dark:border-white/[.15]">Go to Today</Link>
          {this.props.offerExport && <Link href="/backup" className="rounded-full border border-black/[.12] px-4 py-1.5 dark:border-white/[.15]">Export my data</Link>}
        </div>
      </div>
    );
  }
}
