"use client";

/**
 * CommandCenter (LIFEOS-027) — the global orchestrator.
 *
 * Mounted once in the root layout. It owns the single "which overlay is open"
 * state (so duplicate dialogs are impossible), installs the global keyboard
 * shortcuts (delegating the decision to the pure `resolveKey`), manages a "g"
 * navigation chord, restores focus to the previously-focused element when an
 * overlay closes, tracks recently-viewed records from the route, and renders the
 * palette, quick capture, shortcut help, and the mobile trigger. Nothing here
 * runs on the server; every path is reachable without the keyboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore, endSession } from "@/lib/mvpStore";
import { resolveKey, isTypingTarget, isMacPlatform } from "@/lib/command/shortcuts";
import { OPEN_CAPTURE_EVENT, OPEN_PALETTE_EVENT } from "@/lib/command/events";
import { recordVisit } from "@/lib/command/recent";
import { resolveRecord } from "@/lib/command/records";
import CommandPalette from "@/components/command/CommandPalette";
import QuickCapture from "@/components/command/QuickCapture";
import ShortcutHelp from "@/components/command/ShortcutHelp";
import MobileCommandTrigger from "@/components/command/MobileCommandTrigger";

type Overlay = null | "palette" | "capture" | "help";

/** Map a pathname to a record (kind,id) for recent-history tracking, or null. */
function routeToRecord(pathname: string): { kind: string; id: string } | null {
  const seg = pathname.split("/").filter(Boolean);
  if (seg.length === 3 && seg[0] === "world" && seg[1] === "concept") return { kind: "concept", id: seg[2] };
  if (seg.length !== 2) return null;
  const [head, id] = seg;
  const map: Record<string, string> = {
    dialogue: "dialogue", research: "research_project", decisions: "decision",
    themes: "theme", formation: "formation", library: "source", inquiry: "inquiry", author: "knowledge_project",
    document: "document",
  };
  // Guard against non-id second segments (e.g. /formation/timeline, /review/weekly).
  if (!map[head] || ["timeline", "weekly", "concept", "new"].includes(id)) return null;
  return { kind: map[head], id };
}

export default function CommandCenter() {
  const state = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const isMac = useMemo(() => isMacPlatform(), []);

  const chordPending = useRef(false);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<Overlay>(null);

  const open = useCallback((o: Exclude<Overlay, null>) => {
    if (overlayRef.current) return; // prevent duplicate dialogs
    restoreFocus.current = (document.activeElement as HTMLElement) ?? null;
    overlayRef.current = o; // keep the ref authoritative immediately (no render lag)
    setOverlay(o);
  }, []);

  const close = useCallback(() => {
    overlayRef.current = null;
    setOverlay(null);
    // Restore focus to where the user was, on the next frame.
    const el = restoreFocus.current;
    requestAnimationFrame(() => { try { el?.focus?.(); } catch { /* ignore */ } });
  }, []);

  // ---- Global keyboard shortcuts ----
  useEffect(() => {
    const clearChord = () => { chordPending.current = false; if (chordTimer.current) clearTimeout(chordTimer.current); };
    const onKey = (e: KeyboardEvent) => {
      // While an overlay is open, it owns the keyboard — but Escape always
      // closes it here (works even when focus is not inside the overlay).
      if (overlayRef.current) {
        if (e.key === "Escape") { e.preventDefault(); clearChord(); close(); }
        return;
      }
      const typing = isTypingTarget(e.target);
      const outcome = resolveKey({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey }, { typing, chordPending: chordPending.current });
      switch (outcome.type) {
        case "palette": case "focus-search": e.preventDefault(); clearChord(); open("palette"); break;
        case "quick-capture": e.preventDefault(); clearChord(); open("capture"); break;
        case "shortcut-help": e.preventDefault(); clearChord(); open("help"); break;
        case "start-chord":
          e.preventDefault();
          chordPending.current = true;
          if (chordTimer.current) clearTimeout(chordTimer.current);
          chordTimer.current = setTimeout(() => { chordPending.current = false; }, 1500);
          break;
        case "goto": e.preventDefault(); clearChord(); router.push(outcome.href); break;
        default: if (outcome.type === "none" && chordPending.current && !e.metaKey && !e.ctrlKey && !typing) clearChord();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (chordTimer.current) clearTimeout(chordTimer.current); };
  }, [open, close, router]);

  // ---- Event bridge: open via buttons (nav, Today, mobile) ----
  useEffect(() => {
    const openPalette = () => open("palette");
    const openCapture = () => open("capture");
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette);
    window.addEventListener(OPEN_CAPTURE_EVENT, openCapture);
    return () => { window.removeEventListener(OPEN_PALETTE_EVENT, openPalette); window.removeEventListener(OPEN_CAPTURE_EVENT, openCapture); };
  }, [open]);

  // ---- Recent-history tracking from the route ----
  const lastPath = useRef<string>("");
  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    lastPath.current = pathname;
    const rec = routeToRecord(pathname);
    if (!rec) return;
    const live = resolveRecord(state, rec.kind, rec.id);
    if (live) recordVisit(rec.kind, rec.id, live.title);
    // `state` intentionally omitted from deps: we track on navigation, and read
    // the freshest title at that moment; re-running on every store change would
    // spam writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Overlays are mounted only while open, so each open starts from fresh state
  // (no reset effects). The onAction handoff runs after the palette has closed.
  return (
    <>
      {overlay === "palette" && <CommandPalette onClose={close} onAction={(a) => { if (a === "quick-capture") setTimeout(() => open("capture"), 0); else if (a === "shortcut-help") setTimeout(() => open("help"), 0); else if (a === "end-session") endSession(); }} />}
      {overlay === "capture" && <QuickCapture onClose={close} />}
      {overlay === "help" && <ShortcutHelp onClose={close} isMac={isMac} />}
      <MobileCommandTrigger onOpenPalette={() => open("palette")} onOpenCapture={() => open("capture")} />
    </>
  );
}
