"use client";

/**
 * First-run onboarding shell (LIFEOS-041, Feature 9). Calm, skippable, resumable.
 * Teaches through USE by linking each interactive step to the real surface; no
 * forced demo data, no urgency, no confetti. Progress is descriptive. Hydration-
 * safe: reads persisted onboarding state after mount.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STEPS, STEP_IDS, type OnboardingStep } from "@/lib/onboarding/steps";
import { useOnboarding, completeStep, skipStep, skipOnboarding, completeOnboardingAll, resetOnboarding, onboardingProgress } from "@/lib/onboarding/state";

const STEP_LINK: Record<string, { href: string; label: string } | null> = {
  welcome: null,
  capture: { href: "/", label: "Open Capture" },
  decide: { href: "/process", label: "Open Processing" },
  project: { href: "/projects", label: "Open Projects" },
  action: { href: "/actions", label: "Open Actions" },
  today: { href: "/today", label: "Open Today" },
  focus: { href: "/focus", label: "Open Focus" },
  review: { href: "/daily", label: "Open Daily Review" },
  privacy: { href: "/privacy", label: "Open Privacy" },
  finish: null,
};

export default function OnboardingShell() {
  const router = useRouter();
  const s = useOnboarding();
  // Displayed step: an explicit override (set by Back/Continue handlers) takes
  // precedence over the persisted current step; both fall back to the first step.
  const [override, setOverride] = useState<string | null>(null);
  const stepId = override ?? s.currentStep ?? STEP_IDS[0];
  const done = new Set([...s.completedSteps, ...s.skippedSteps]);
  const progress = onboardingProgress(s);
  const step = STEPS.find((x) => x.id === stepId) as OnboardingStep;
  const idx = STEP_IDS.indexOf(stepId);

  const onNext = useCallback(() => {
    completeStep(stepId);
    if (idx >= STEP_IDS.length - 1) { completeOnboardingAll(); router.push("/today"); return; }
    setOverride(STEP_IDS[idx + 1]);
  }, [stepId, idx, router]);

  const onSkipStep = useCallback(() => { skipStep(stepId); if (idx < STEP_IDS.length - 1) setOverride(STEP_IDS[idx + 1]); }, [stepId, idx]);
  const onSkipAll = useCallback(() => { skipOnboarding(); router.push("/today"); }, [router]);
  const onReset = useCallback(() => { resetOnboarding(); setOverride(STEP_IDS[0]); }, []);
  const goTo = useCallback((id: string | null) => { if (id) setOverride(id); }, []);

  const link = STEP_LINK[stepId];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-12" data-onboarding-shell aria-labelledby="onboarding-title">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-[12px] text-zinc-400" data-onboarding-progress>Step {idx + 1} of {STEP_IDS.length} · {progress.done} done</p>
        <button type="button" onClick={onSkipAll} data-onboarding-skip-all className="text-[12px] text-zinc-400 underline hover:text-zinc-600 dark:hover:text-zinc-200">Skip for now</button>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]" aria-hidden>
        <div className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100" style={{ width: `${((idx + 1) / STEP_IDS.length) * 100}%` }} />
      </div>

      <section className="mt-8 flex-1" data-onboarding-step={stepId} aria-live="polite">
        <h1 id="onboarding-title" className="text-2xl font-semibold tracking-tight">{step.title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{step.teaches}</p>
        {done.has(stepId) && <p className="mt-3 text-[13px] text-emerald-600 dark:text-emerald-400" role="status">Done — you can continue.</p>}
        {link && (
          <Link href={link.href} data-onboarding-open className="mt-4 inline-block rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">{link.label} →</Link>
        )}
      </section>

      <div className="mt-8 flex items-center justify-between gap-2">
        <button type="button" onClick={() => goTo(idx > 0 ? STEP_IDS[idx - 1] : null)} disabled={idx === 0} data-onboarding-back className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] disabled:opacity-30 dark:border-white/[.15]">Back</button>
        <div className="flex gap-2">
          {step.interactive && <button type="button" onClick={onSkipStep} data-onboarding-skip className="rounded-full px-3 py-1.5 text-[13px] text-zinc-500">Skip step</button>}
          <button type="button" onClick={onNext} data-onboarding-next className="rounded-full bg-zinc-900 px-5 py-1.5 text-[13px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">{idx >= STEP_IDS.length - 1 ? "Finish" : "Continue"}</button>
        </div>
      </div>

      <button type="button" onClick={onReset} data-onboarding-reset className="mt-6 self-center text-[11px] text-zinc-400 underline">Restart onboarding</button>
    </main>
  );
}
