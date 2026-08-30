"use client";

/**
 * Notes (LIFEOS-052).
 *
 * The deliberately plain surface: a place to keep useful information without
 * promoting it into anything. Everything about this screen is chosen to keep
 * filing cheap — one textarea, an optional topic, no required fields, no status,
 * no lifecycle. If using it ever feels like filling in a form, it has failed.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore, createNote, updateNote, archiveNote, deleteNote, promoteNote } from "@/lib/mvpStore";
import { activeNotes, notesInTopic, notesWithoutTopic, searchNotes, topicsWithNotes, noteDisplayTitle, notePreview } from "@/lib/notes/notes";
import { availableTopics, topicName, TOPIC_LABEL } from "@/lib/notes/topics";
import { NOTE_PROMOTIONS, previewPromotion, type NotePromotionKey } from "@/lib/notes/promotion";
import { toast } from "@/lib/ux/feedback";
import ConflictNotice from "@/components/sync/ConflictNotice";
import type { Note } from "@/types/mvp";

export default function NotesPage({ initialNoteId }: { initialNoteId?: string }) {
  const state = useStore();
  const [query, setQuery] = useState("");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | undefined>(initialNoteId);
  const [draft, setDraft] = useState("");
  const [draftTopic, setDraftTopic] = useState("");

  const topics = useMemo(() => topicsWithNotes(state), [state]);
  const allTopics = useMemo(() => availableTopics(state), [state]);

  const visible = useMemo(() => {
    const base = topicFilter === "all" ? activeNotes(state)
      : topicFilter === "none" ? notesWithoutTopic(state)
      : notesInTopic(state, topicFilter);
    return searchNotes(base, query);
  }, [state, topicFilter, query]);

  const selected = useMemo(() => (state.notes ?? []).find((n) => n.id === selectedId), [state, selectedId]);

  const add = () => {
    const body = draft.trim();
    if (!body) return;
    const id = createNote({ body, workspaceId: draftTopic || undefined });
    setDraft(""); setSelectedId(id);
    toast({ kind: "success", message: "Note kept" });
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Anything useful you want again later — a recipe, a chord shape, a phrase you are learning.
          Notes stay notes. You can make one formal later, but you never have to.
        </p>
      </header>

      {/* Write. One field, because a note should cost one field. */}
      <section className="mb-6 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <label htmlFor="note-body" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">New note</label>
        <textarea id="note-body" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
          placeholder="ser vs estar — ser for permanent traits, estar for states and locations…"
          className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={draftTopic} onChange={(e) => setDraftTopic(e.target.value)} aria-label={`${TOPIC_LABEL} (optional)`}
            className="rounded-full border border-black/[.12] bg-transparent px-3 py-1.5 text-xs dark:border-white/[.15]">
            <option value="">No {TOPIC_LABEL.toLowerCase()}</option>
            {allTopics.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button type="button" onClick={add} disabled={!draft.trim()}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Keep note</button>
          {allTopics.length === 0 && (
            <span className="text-[11px] text-zinc-500">
              {TOPIC_LABEL}s come from your <Link href="/workspaces" className="text-sky-600 underline underline-offset-2 dark:text-sky-400">workspaces</Link> — make one for Spanish or Cooking and it appears here.
            </span>
          )}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* List */}
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" aria-label="Search notes"
              className="min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-3 py-1.5 text-xs outline-none dark:border-white/12" />
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[{ k: "all", label: `All (${activeNotes(state).length})` },
              ...topics.map((t) => ({ k: t.workspaceId, label: `${t.name} (${t.count})` })),
              { k: "none", label: `No ${TOPIC_LABEL.toLowerCase()} (${notesWithoutTopic(state).length})` }]
              .map((chip) => (
                <button key={chip.k} type="button" onClick={() => setTopicFilter(chip.k)}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${topicFilter === chip.k ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300"}`}>{chip.label}</button>
              ))}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/[.12] p-6 text-center text-sm text-zinc-500 dark:border-white/[.14]">
              {query ? "No notes match that search." : "No notes yet. Anything useful counts."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visible.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => setSelectedId(n.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${selectedId === n.id ? "border-sky-500/50 bg-sky-500/[.04]" : "border-black/[.08] hover:bg-black/[.02] dark:border-white/[.10] dark:hover:bg-white/[.03]"}`}>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{noteDisplayTitle(n)}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{notePreview(n)}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
                      {n.workspaceId && topicName(state, n.workspaceId) && <span className="rounded-full bg-black/[.05] px-1.5 py-0.5 dark:bg-white/[.08]">{topicName(state, n.workspaceId)}</span>}
                      {/* Provenance is surfaced in plain words, never as jargon. */}
                      {n.fromAiText && <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">From AI — kept, not written by you</span>}
                      {n.sourceCaptureId && <span>from a capture</span>}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Detail */}
        <section>
          {selected ? <NoteDetail key={selected.id} note={selected} onDeleted={() => setSelectedId(undefined)} />
            : <p className="rounded-xl border border-dashed border-black/[.12] p-6 text-center text-sm text-zinc-500 dark:border-white/[.14]">Pick a note to read or edit it.</p>}
        </section>
      </div>
    </main>
  );
}

function NoteDetail({ note, onDeleted }: { note: Note; onDeleted: () => void }) {
  const state = useStore();
  const [body, setBody] = useState(note.body);
  const [title, setTitle] = useState(note.title ?? "");
  const [topic, setTopic] = useState(note.workspaceId ?? "");
  const [promotion, setPromotion] = useState<NotePromotionKey | "">("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const allTopics = useMemo(() => availableTopics(state), [state]);

  const dirty = body !== note.body || title !== (note.title ?? "") || topic !== (note.workspaceId ?? "");
  const save = () => { updateNote(note.id, { body, title, workspaceId: topic || null }); toast({ kind: "success", message: "Saved" }); };

  const preview = promotion ? previewPromotion(state, note, promotion) : null;
  const def = NOTE_PROMOTIONS.find((p) => p.key === promotion);
  const doPromote = () => {
    if (!promotion || def?.needsContext) return;
    const ref = promoteNote(note.id, promotion);
    if (ref) { toast({ kind: "success", message: `Made a ${def?.label} — your note is unchanged` }); setPromotion(""); }
    else toast({ kind: "error", message: "Couldn’t do that" });
  };

  return (
    <div className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Note title"
        className="w-full rounded-lg border border-transparent bg-transparent px-0 py-1 text-base font-medium outline-none placeholder:text-zinc-400" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} aria-label="Note body"
        className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label={TOPIC_LABEL}
          className="rounded-full border border-black/[.12] bg-transparent px-3 py-1.5 text-xs dark:border-white/[.15]">
          <option value="">No {TOPIC_LABEL.toLowerCase()}</option>
          {allTopics.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button type="button" onClick={save} disabled={!dirty}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Save</button>
        <button type="button" onClick={() => { archiveNote(note.id); onDeleted(); toast({ kind: "info", message: "Archived (reversible)" }); }}
          className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Archive</button>
        {!confirmDelete
          ? <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-full border border-rose-500/40 px-3 py-1.5 text-xs text-rose-600 dark:text-rose-400">Delete</button>
          : <span className="flex items-center gap-1 text-xs"><span className="text-rose-600 dark:text-rose-400">Delete permanently?</span>
              <button type="button" onClick={() => { deleteNote(note.id); onDeleted(); toast({ kind: "info", message: "Deleted" }); }} className="rounded-full bg-rose-600 px-3 py-1 font-medium text-white">Yes</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-zinc-400">No</button></span>}
      </div>

      {/*
        Shown on the record itself: this is where the person is when they find
        their edit missing, and a global banner could not tell them WHICH note
        (LIFEOS-076 §9).
      */}
      <ConflictNotice domain="notes" id={note.id} />

      {note.fromAiText && (
        <p className="mt-3 rounded-lg bg-amber-500/[.08] px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
          This text came from AI. Keeping it does not make it yours — it stays marked so you can tell later what you thought and what a machine said.
        </p>
      )}

      {/* Promotion — always optional, always additive. */}
      <div className="mt-4 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Make something from this (optional)</p>
        <div className="flex flex-wrap gap-1.5">
          {NOTE_PROMOTIONS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPromotion(promotion === p.key ? "" : p.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] ${promotion === p.key ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300"}`}>{p.label}</button>
          ))}
        </div>
        {/*
          No "Next action" control here on purpose. `inheritFromCapture` pre-fills
          the action editor from a CAPTURE; there is no note equivalent, and
          adding one would be the second action route candidate H warns against.
          A dead link would be worse than none, so this waits for real demand.
        */}
        {preview && (
          <div className="mt-2 rounded-lg border border-black/[.08] p-3 text-xs dark:border-white/[.10]">
            <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-200">New {preview.promotionLabel} — copied fields</p>
            <dl className="flex flex-col gap-1">
              {preview.copiedFields.map((f, i) => (
                <div key={i}><dt className="text-[10px] uppercase tracking-wide text-zinc-400">{f.label}</dt><dd className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">{f.value}</dd></div>
              ))}
            </dl>
            <p className="mt-1.5 text-[11px] text-zinc-500">{preview.remainsOnOriginal}</p>
            {def?.needsContext
              ? <p className="mt-2 text-[11px] text-zinc-500">Pick a project from the project page to append this note there.</p>
              : <button type="button" onClick={doPromote} className="mt-2 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Create {preview.promotionLabel}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
