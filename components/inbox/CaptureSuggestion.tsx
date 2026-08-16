"use client";

/**
 * Capture suggestion (LIFEOS-054) — "looks like a …", never "is a …".
 *
 * The one behaviour that matters: **this component creates nothing on its own.**
 * Every path out of it is a button the user pressed, and for Protocol the
 * extracted trigger/response are editable BEFORE the record exists, so a
 * machine's reading of a sentence never becomes the user's stated intention
 * without their hands on it.
 *
 * Multi-intent captures are handled by refusing to classify: collapsing
 * "call the dentist, renew the registration, and give him space when he's
 * overwhelmed" into one type would silently drop two of the three things the
 * person said, so the user is pointed at Split instead.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { convertCapture, createProtocol } from "@/lib/mvpStore";
import { classifyCapture, CAPTURE_TYPE_LABEL, hasDestination } from "@/lib/capture/classify";
import { effectiveText } from "@/lib/inbox/capture-status";
import { NEXT_ACTION_ROUTE } from "@/lib/inbox/conversion";
import { classifyOrigin } from "@/lib/provenance/classify";
import { toast } from "@/lib/ux/feedback";
import type { Capture } from "@/types/mvp";

export default function CaptureSuggestion({ capture, onHandled }: { capture: Capture; onHandled?: () => void }) {
  const router = useRouter();
  const text = effectiveText(capture).trim();
  const result = useMemo(() => classifyCapture(text), [text]);

  const [trigger, setTrigger] = useState(result.extracted?.trigger ?? "");
  const [response, setResponse] = useState(result.extracted?.response ?? "");

  if (!text) return null;

  // Multi-intent: propose splitting rather than picking one of several meanings.
  if (result.multiIntent) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[.05] p-3">
        <p className="text-xs text-amber-800 dark:text-amber-200">{result.reason}</p>
        <button type="button" onClick={() => router.push(`/process/${capture.id}?panel=split`)}
          className="mt-2 rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Split this capture →</button>
      </div>
    );
  }

  const type = result.suggestedType;
  const label = CAPTURE_TYPE_LABEL[type];
  const keepAsNote = () => {
    const ref = convertCapture(capture.id, "note", { after: "processed" });
    if (ref) { toast({ kind: "success", message: "Kept as a note" }); onHandled?.(); }
  };

  return (
    <div className="rounded-xl border border-black/[.08] p-3 dark:border-white/[.10]">
      <p className="text-xs text-zinc-600 dark:text-zinc-300">
        Looks like a <strong>{label.toLowerCase()}</strong>.
        {/* Plain-language reason — never a regex, never a percentage. */}
        <span className="text-zinc-500"> {result.reason}</span>
      </p>

      {/* Protocol: edit the extracted structure BEFORE anything is created. */}
      {type === "protocol" && (
        <div className="mt-2 flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">When / if</label>
          <input value={trigger} onChange={(e) => setTrigger(e.target.value)} aria-label="Protocol trigger"
            className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12" />
          <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Then</label>
          <input value={response} onChange={(e) => setResponse(e.target.value)} aria-label="Protocol response"
            className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12" />
        </div>
      )}

      {type === "waiting" && result.extracted?.waitingOn && (
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Waiting on: <strong>{result.extracted.waitingOn}</strong>. Create the action, then mark it waiting from the action page.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {type === "protocol" && (
          <button type="button" disabled={!trigger.trim() || !response.trim()}
            onClick={() => {
              // The capture's CLASSIFIED origin travels with the protocol, so a
              // machine-authored capture cannot be laundered into an authored
              // intention by being routed through the classifier.
              const origin = classifyOrigin({ kind: "capture", text });
              createProtocol({ trigger, response, sourceCaptureId: capture.id, fromAiText: origin === "conqify_ai" });
              toast({ kind: "success", message: "Protocol saved — your capture is preserved" });
              onHandled?.();
            }}
            className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Create protocol</button>
        )}
        {(type === "action" || type === "waiting") && (
          <button type="button" onClick={() => router.push(NEXT_ACTION_ROUTE.href(capture.id))}
            className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Create next action</button>
        )}
        {type === "project" && (
          <button type="button" onClick={() => router.push("/projects")}
            className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Open projects</button>
        )}
        {type === "reflection" && (
          <button type="button" onClick={() => { const ref = convertCapture(capture.id, "reflection", { after: "processed" }); if (ref) { toast({ kind: "success", message: "Saved as a reflection" }); onHandled?.(); } }}
            className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Save as reflection</button>
        )}
        {/* Always available, always safe. */}
        <button type="button" onClick={keepAsNote}
          className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Keep as note</button>
        {!hasDestination(type) && (
          <span className="self-center text-[11px] text-zinc-500">Questions don&apos;t have their own home yet — a note keeps it.</span>
        )}
      </div>
    </div>
  );
}
