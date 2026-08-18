"use client";

/**
 * The Living Constitution (LIFEOS-056).
 *
 * "What have I consciously adopted as part of how I intend to live?"
 *
 * Three things this surface deliberately does NOT do:
 *
 *  - **It does not score.** No alignment percentage, no progress ring, no virtue
 *    meter, no "Constitution health". This is an authored document, not a
 *    dashboard, and a number here would quietly turn a life into a scoreboard.
 *  - **It does not adopt anything for you.** Writing an element creates a DRAFT.
 *    Only pressing "Add to Constitution" makes it constitutional, and only a
 *    person can press it. Nothing arrives here from a save, an import, or an AI.
 *  - **It does not treat retiring as deleting.** Retire keeps the wording and
 *    the history; Delete removes them for good. Both are offered, separately
 *    labelled, and the difference is stated before the click.
 */

import { useMemo, useState } from "react";
import {
  useStore, createConstitutionElement, adoptConstitutionElement, updateConstitutionElement,
  reviseConstitutionElement, retireConstitutionElement, deleteConstitutionElement,
  setConstitutionLinks, setConstitutionAiExclusion,
} from "@/lib/mvpStore";
import {
  activeConstitution, draftElements, retiredElements, revisionsFor, byKind, elementById,
  CONSTITUTION_KIND_ORDER,
} from "@/lib/constitution/constitution";
import { classifyStatementChange, requiresReason } from "@/lib/constitution/revision";
import { CONSTITUTION_KIND_LABEL, CONSTITUTION_KIND_HINT } from "@/types/mvp";
import type { ConstitutionElement, ConstitutionKind, RecordRefLite } from "@/types/mvp";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { toast } from "@/lib/ux/feedback";

const CHANGE_LABEL: Record<string, string> = {
  created: "Written", adopted: "Adopted", edited: "Wording corrected",
  revised: "Revised", relinked: "Links changed", retired: "Retired", readopted: "Re-adopted",
};

/** Records a Constitution element may point at. References, never copies. */
function linkableRecords(state: ReturnType<typeof useStore>): { ref: RecordRefLite; label: string; group: string }[] {
  const out: { ref: RecordRefLite; label: string; group: string }[] = [];
  for (const p of state.practices ?? []) {
    if (p.status === "rejected") continue;
    out.push({ ref: { kind: "practice", id: p.id }, label: p.userWording || p.title, group: "Practices" });
  }
  for (const p of state.protocols ?? []) {
    if (p.status === "retired") continue;
    out.push({ ref: { kind: "protocol", id: p.id }, label: `When ${p.trigger} → ${p.response}`, group: "Protocols" });
  }
  for (const a of state.nextActions ?? []) {
    if (a.status === "completed" || a.status === "cancelled") continue;
    out.push({ ref: { kind: "action", id: a.id }, label: a.title, group: "Actions" });
  }
  for (const pr of state.projects ?? []) out.push({ ref: { kind: "project", id: pr.id }, label: pr.title, group: "Projects" });
  for (const n of state.notes ?? []) {
    if (n.archived) continue;
    out.push({ ref: { kind: "note", id: n.id }, label: n.title || n.body.slice(0, 60), group: "Notes" });
  }
  return out;
}

function LinkPicker({ element, onClose }: { element: ConstitutionElement; onClose: () => void }) {
  const state = useStore();
  const options = useMemo(() => linkableRecords(state), [state]);
  const [sel, setSel] = useState<RecordRefLite[]>(element.linkedRefs ?? []);
  const has = (r: RecordRefLite) => sel.some((x) => x.kind === r.kind && x.id === r.id);
  const toggle = (r: RecordRefLite) =>
    setSel((cur) => (has(r) ? cur.filter((x) => !(x.kind === r.kind && x.id === r.id)) : [...cur, r]));
  const groups = [...new Set(options.map((o) => o.group))];

  return (
    <div className="mt-3 rounded-xl border border-black/[.08] p-3 dark:border-white/[.10]">
      <p className="mb-2 text-xs text-zinc-500">
        Point this at what already makes it real. The Constitution references these records — it never copies them.
      </p>
      {options.length === 0 && <p className="text-xs text-zinc-400">Nothing to link yet — create a practice, protocol, action, project or note first.</p>}
      <div className="max-h-64 space-y-3 overflow-y-auto">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">{g}</p>
            <ul className="space-y-1">
              {options.filter((o) => o.group === g).map((o) => (
                <li key={`${o.ref.kind}:${o.ref.id}`}>
                  <label className="flex cursor-pointer items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={has(o.ref)} onChange={() => toggle(o.ref)} />
                    <span className="text-zinc-700 dark:text-zinc-300">{o.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          onClick={() => { setConstitutionLinks(element.id, sel); toast({ kind: "success", message: "Links updated" }); onClose(); }}>
          Save links
        </button>
        <button type="button" className="text-xs text-zinc-500 underline underline-offset-2" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function History({ elementId }: { elementId: string }) {
  const state = useStore();
  const revisions = revisionsFor(state, elementId);
  if (revisions.length === 0) return <p className="mt-2 text-xs text-zinc-400">No history yet.</p>;
  return (
    <ol className="mt-2 space-y-2 border-l border-black/[.08] pl-3 dark:border-white/[.10]">
      {revisions.map((r) => (
        <li key={r.id} className="text-xs">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{CHANGE_LABEL[r.changeKind] ?? r.changeKind}</span>
          <span className="text-zinc-400"> · {new Date(r.at).toLocaleDateString()}</span>
          {r.previousStatement && r.newStatement && r.previousStatement !== r.newStatement && (
            <p className="mt-0.5 text-zinc-500">
              <span className="line-through decoration-zinc-400">{r.previousStatement}</span>
              {" → "}
              <span className="text-zinc-700 dark:text-zinc-300">{r.newStatement}</span>
            </p>
          )}
          {r.reason && <p className="mt-0.5 italic text-zinc-500">“{r.reason}”</p>}
        </li>
      ))}
    </ol>
  );
}

function ElementCard({ element, highlight }: { element: ConstitutionElement; highlight: boolean }) {
  const state = useStore();
  const [open, setOpen] = useState(highlight);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(element.statement);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"edited" | "revised">("edited");
  const [modeTouched, setModeTouched] = useState(false);
  const [linking, setLinking] = useState(false);

  const suggestion = useMemo(
    () => (draft.trim() && draft.trim() !== element.statement ? classifyStatementChange(element.statement, draft.trim()) : null),
    [draft, element.statement],
  );
  // The rule SUGGESTS; the author decides. The suggestion tracks the text as it
  // is typed, but the moment the user picks a side it stops moving under them —
  // only they know whether a rewording changed what they meant.
  const effectiveMode = modeTouched ? mode : (suggestion?.suggested ?? "edited");
  const chooseMode = (m: "edited" | "revised") => { setMode(m); setModeTouched(true); };

  const startEdit = () => {
    setDraft(element.statement);
    setReason("");
    setMode("edited");
    setModeTouched(false);
    setEditing(true);
    setOpen(true);
  };

  const save = () => {
    const next = draft.trim();
    if (!next || next === element.statement) { setEditing(false); return; }
    if (effectiveMode === "revised") {
      reviseConstitutionElement(element.id, next, { reason });
      toast({ kind: "success", message: "Revised — the previous wording is kept in history" });
    } else {
      updateConstitutionElement(element.id, { statement: next }, { changeKind: "edited" });
      toast({ kind: "success", message: "Wording corrected" });
    }
    setEditing(false);
  };

  const confirmRetire = () => {
    requestConfirm({
      impact: {
        name: element.statement,
        typeLabel: CONSTITUTION_KIND_LABEL[element.kind],
        verb: "Retire",
        children: [],
        linkedNote: "Its wording and full history stay exactly as they are, and you can re-adopt it later. This is not deletion.",
        undoable: true,
        severity: "normal",
      },
      confirmLabel: "Retire",
      onConfirm: () => { retireConstitutionElement(element.id); toast({ kind: "success", message: "Retired — history kept" }); },
    });
  };

  const confirmDelete = () => {
    const revs = revisionsFor(state, element.id).length;
    const linked = (element.linkedRefs ?? []).length;
    // Disclose what this reaches — and, just as importantly, what it does not.
    requestConfirm({
      impact: {
        name: element.statement,
        typeLabel: CONSTITUTION_KIND_LABEL[element.kind],
        verb: "Delete",
        children: revs > 0 ? [{ label: "history entries (including every earlier wording)", count: revs }] : [],
        linkedNote: [
          linked > 0
            ? `${linked} linked ${linked === 1 ? "record is" : "records are"} referenced here. Those records are NOT deleted — only the link is lost.`
            : "",
          "Anything you wrote elsewhere that quotes this — a note or a reflection — is your own writing and stays where it is.",
          "To keep the history instead, retire it.",
        ].filter(Boolean).join(" "),
        undoable: false,
        severity: "high",
      },
      confirmLabel: "Delete permanently",
      onConfirm: () => { deleteConstitutionElement(element.id); toast({ kind: "success", message: "Deleted" }); },
    });
  };

  return (
    <li className={`rounded-xl border p-3 ${highlight ? "border-zinc-400 dark:border-zinc-500" : "border-black/[.06] dark:border-white/[.08]"}`}>
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="flex-1 text-left" onClick={() => setOpen((o) => !o)}>
          <p className="leading-relaxed text-zinc-900 dark:text-zinc-100">{element.statement}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
            <span>{CONSTITUTION_KIND_LABEL[element.kind]}</span>
            {element.status === "active" && element.adoptedAt && <span>· adopted {new Date(element.adoptedAt).toLocaleDateString()}</span>}
            {element.status === "draft" && <span>· not yet adopted</span>}
            {element.status === "retired" && element.retiredAt && <span>· retired {new Date(element.retiredAt).toLocaleDateString()}</span>}
            {(element.linkedRefs ?? []).length > 0 && <span>· {element.linkedRefs.length} linked</span>}
            {element.excludeFromAi && <span>· hidden from AI</span>}
            {element.fromAiText && <span>· wording came from AI</span>}
          </p>
        </button>
        {element.status === "draft" && (
          <button type="button" onClick={() => { adoptConstitutionElement(element.id); toast({ kind: "success", message: "Adopted" }); }}
            className="shrink-0 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Add to Constitution
          </button>
        )}
        {element.status === "retired" && (
          <button type="button" onClick={() => { adoptConstitutionElement(element.id); toast({ kind: "success", message: "Re-adopted" }); }}
            className="shrink-0 rounded-full border border-black/[.12] px-3 py-1 text-xs dark:border-white/[.15]">
            Re-adopt
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
          {element.note && <p className="mb-3 text-xs italic text-zinc-500">{element.note}</p>}

          {editing ? (
            <div className="space-y-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
                className="w-full rounded-lg border border-black/[.10] bg-transparent p-2 text-sm dark:border-white/[.12]" />
              {suggestion && (
                <div className="rounded-lg bg-black/[.03] p-2 text-xs dark:bg-white/[.04]">
                  <p className="text-zinc-500">{suggestion.reason}</p>
                  <div className="mt-1.5 flex gap-3">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={effectiveMode === "edited"} onChange={() => chooseMode("edited")} />
                      <span>Just fixing the wording</span>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={effectiveMode === "revised"} onChange={() => chooseMode("revised")} />
                      <span>I&apos;ve changed my position</span>
                    </label>
                  </div>
                </div>
              )}
              {requiresReason(effectiveMode) && (
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What changed your mind? (optional)"
                  className="w-full rounded-lg border border-black/[.10] bg-transparent p-2 text-xs dark:border-white/[.12]" />
              )}
              <div className="flex gap-2">
                <button type="button" onClick={save} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Save</button>
                <button type="button" onClick={() => setEditing(false)} className="text-xs text-zinc-500 underline underline-offset-2">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              <button type="button" onClick={startEdit} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">Edit or revise</button>
              <button type="button" onClick={() => setLinking((l) => !l)} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
                Linked records ({(element.linkedRefs ?? []).length})
              </button>
              <button type="button"
                onClick={() => { setConstitutionAiExclusion(element.id, !element.excludeFromAi); toast({ kind: "success", message: element.excludeFromAi ? "AI may see this again" : "Hidden from AI" }); }}
                className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
                {element.excludeFromAi ? "Allow AI to see this" : "Hide from AI"}
              </button>
              {element.status !== "retired" && (
                <button type="button" onClick={confirmRetire} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">Retire</button>
              )}
              <button type="button" onClick={confirmDelete} className="text-red-600 underline underline-offset-2 dark:text-red-400">Delete permanently</button>
            </div>
          )}

          {linking && <LinkPicker element={element} onClose={() => setLinking(false)} />}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-zinc-500">History</summary>
            <History elementId={element.id} />
          </details>
        </div>
      )}
    </li>
  );
}

export default function ConstitutionPage({ initialId }: { initialId?: string }) {
  const state = useStore();
  const [kind, setKind] = useState<ConstitutionKind>("value");
  const [statement, setStatement] = useState("");
  const [note, setNote] = useState("");
  const [showRetired, setShowRetired] = useState(false);

  const active = activeConstitution(state);
  const drafts = draftElements(state);
  const retired = retiredElements(state);
  const grouped = byKind(active);
  const highlighted = initialId ? elementById(state, initialId) : undefined;

  const write = (adoptNow: boolean) => {
    const text = statement.trim();
    if (!text) return;
    const id = createConstitutionElement({ kind, statement: text, note: note.trim() || undefined });
    if (adoptNow) adoptConstitutionElement(id);
    setStatement(""); setNote("");
    toast({ kind: "success", message: adoptNow ? "Added to your Constitution" : "Saved as a draft — adopt it when you're ready" });
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Constitution</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500">
          What you have consciously adopted as part of how you intend to live. You write it; Conqify
          remembers it, links it to what you actually do, and keeps every version you have held.
          Nothing here is scored, and nothing becomes part of it unless you say so.
        </p>
      </header>

      {/* ---- write ---- */}
      <section className="mb-8 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CONSTITUTION_KIND_ORDER.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1 text-xs ${k === kind ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] dark:border-white/[.15]"}`}>
              {CONSTITUTION_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="mb-2 text-xs text-zinc-500">{CONSTITUTION_KIND_HINT[kind]}</p>
        <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={2}
          placeholder={kind === "purpose" ? "What is this life for?" : kind === "value" ? "What matters to you?" : kind === "principle" ? "How do you intend to act?" : "What bar do you hold yourself to?"}
          className="w-full rounded-lg border border-black/[.10] bg-transparent p-2 text-sm dark:border-white/[.12]" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this matters to you (optional)"
          className="mt-2 w-full rounded-lg border border-black/[.10] bg-transparent p-2 text-xs dark:border-white/[.12]" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => write(true)} disabled={!statement.trim()}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
            Add to Constitution
          </button>
          <button type="button" onClick={() => write(false)} disabled={!statement.trim()}
            className="text-xs text-zinc-500 underline underline-offset-2 disabled:opacity-40">
            Save as a draft instead
          </button>
        </div>
      </section>

      {/* ---- drafts ---- */}
      {drafts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium">Not yet adopted</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Written down, but not part of your Constitution until you add it.
          </p>
          <ul className="space-y-2">
            {drafts.map((e) => <ElementCard key={e.id} element={e} highlight={e.id === highlighted?.id} />)}
          </ul>
        </section>
      )}

      {/* ---- the Constitution ---- */}
      {active.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.12] p-6 text-center text-sm text-zinc-500 dark:border-white/[.15]">
          Your Constitution is empty. Write one thing above — a purpose, a value, a principle you
          already live by — and add it. It can change as often as you do.
        </p>
      ) : (
        grouped.filter((g) => g.elements.length > 0).map((g) => (
          <section key={g.kind} className="mb-8">
            <h2 className="mb-1 text-sm font-medium">{CONSTITUTION_KIND_LABEL[g.kind]}</h2>
            <p className="mb-3 text-xs text-zinc-500">{CONSTITUTION_KIND_HINT[g.kind]}</p>
            <ul className="space-y-2">
              {g.elements.map((e) => <ElementCard key={e.id} element={e} highlight={e.id === highlighted?.id} />)}
            </ul>
          </section>
        ))
      )}

      {/* ---- retired ---- */}
      {retired.length > 0 && (
        <section className="mt-10 border-t border-black/[.06] pt-6 dark:border-white/[.08]">
          <button type="button" onClick={() => setShowRetired((s) => !s)} className="text-sm font-medium">
            {showRetired ? "▾" : "▸"} No longer adopted ({retired.length})
          </button>
          <p className="mt-1 text-xs text-zinc-500">
            Kept on purpose. What you used to hold is part of how you got here.
          </p>
          {showRetired && (
            <ul className="mt-3 space-y-2">
              {retired.map((e) => <ElementCard key={e.id} element={e} highlight={e.id === highlighted?.id} />)}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
