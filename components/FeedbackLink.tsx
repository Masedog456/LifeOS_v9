/**
 * Closed-beta feedback entry point (LIFEOS-048).
 *
 * The smallest safe mechanism for beta users to report confusion, a bug, an idea,
 * or a data-loss concern. The destination is configured via the PUBLIC env var
 * `NEXT_PUBLIC_FEEDBACK_URL` (a mailto:, a form URL, or a GitHub/issues link) so no
 * personal address is ever hardcoded in the repo. When it's not configured, we show
 * a calm fallback that points beta users back to their invitation — never a broken
 * or empty link. No analytics, no tracking, no user content collected here.
 */

const FEEDBACK_URL = process.env.NEXT_PUBLIC_FEEDBACK_URL;

export default function FeedbackLink() {
  const external = FEEDBACK_URL ? !FEEDBACK_URL.startsWith("mailto:") : false;
  return (
    <section aria-labelledby="feedback-heading" className="mb-6 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <h2 id="feedback-heading" className="text-sm font-semibold">Send feedback</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        In the closed beta, tell us what&apos;s confusing, broken, or missing — and if you
        ever think something you created disappeared, report it right away with the words
        <span className="font-medium"> &ldquo;DATA LOSS&rdquo;</span>. Please don&apos;t include private
        content unless it&apos;s needed to explain the problem.
      </p>
      {FEEDBACK_URL ? (
        <a
          href={FEEDBACK_URL}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="mt-3 inline-block rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Send feedback{external ? " ↗" : ""}
        </a>
      ) : (
        <p className="mt-2 text-[13px] text-zinc-500">
          Reply to your beta invitation to reach us — that&apos;s the fastest way during the
          closed beta.
        </p>
      )}
    </section>
  );
}
