# LifeOS Accessibility (LIFEOS-032)

> Provisional — reflects the accessibility pass in the Daily Use, Reliability &
> Product Polish sprint. Target: practical **WCAG 2.2 AA**. This documents what
> is implemented and what remains, honestly.

## Principles

- **Keyboard-first.** Every interactive control is reachable and operable by
  keyboard. Shortcuts never fire while typing in an input/textarea/contenteditable
  (guarded by `isTypingTarget`).
- **Dialogs trap focus and restore it.** The command palette, entity inspector,
  the shared **ConfirmDialog**, and **UnsavedChangesDialog** trap Tab within the
  dialog, close on `Escape`, and restore focus to the invoking element on close.
- **Destructive confirmations focus the safest action.** The confirm dialog lands
  focus on **Cancel**; high-impact actions require an explicit acknowledgement
  checkbox before the destructive button enables.
- **Live regions.** Toasts are announced via a `aria-live="polite"` region in the
  `ToastProvider`; save status uses `role="status"`.
- **Semantic structure.** One `<h1>` per page, section headings, `<dl>` for
  key/value diagnostics, `<label>`-associated form fields, and `role`/`aria-*`
  on dialogs (`role="dialog"`/`"alertdialog"`, `aria-modal`, `aria-labelledby`,
  `aria-describedby`).
- **Icon-only buttons carry `aria-label`.** Dismiss, pin, remove, inspect (ⓘ),
  and add/remove controls all have accessible names.
- **Progress is exposed.** Goal/project progress bars use
  `role="progressbar"` with `aria-valuenow/min/max`.

## Component checklist

| Area | Status | Notes |
| --- | --- | --- |
| Command palette (⌘K) | ✅ | combobox + listbox roles, arrow-key nav, focus trap, Escape, focus restore |
| Entity inspector | ✅ | dialog role, tablist with arrow keys, Escape, focus capture/restore |
| ConfirmDialog | ✅ | alertdialog, focus trap, safest-action focus, acknowledgement gate |
| UnsavedChangesDialog | ✅ | alertdialog, focuses "Continue editing", Escape cancels |
| Toasts | ✅ | polite live region, per-toast dismiss with `aria-label` |
| SaveStatus / SyncStatus | ✅ | `role="status"`; honest labels (never "Saved" before remote success) |
| Session banner | ✅ | labelled region, elapsed clock labelled |
| Forms (create flows) | ✅ | labelled inputs, keyboard submit, autofocus first field |
| Mobile sheets / dialogs | ✅ | safe-area padding (`env(safe-area-inset-bottom)`), no hover-only actions |
| Reduced motion | ⚠️ | transitions are minimal (width/opacity); no large motion. Honors `prefers-reduced-motion` via the absence of nonessential animation. |

## Contrast & theming

- Light and dark themes both use zinc/emerald/amber/rose scales chosen for AA
  contrast on body text and status labels. Muted helper text (`text-zinc-400`)
  is used only for non-essential secondary text, never for the sole conveyance
  of meaning.

## Known limitations (honest)

- Some deep legacy screens (pre-LIFEOS-029 knowledge modules) have not been
  re-audited line-by-line this sprint; their dialogs and forms follow the same
  primitives but a couple of older icon buttons may still rely on `title` rather
  than `aria-label`.
- The radial graph preview in the inspector exposes focusable nodes with names,
  but a full text-alternative list of edges is not yet provided.
- Automated axe-core CI is not yet wired; this pass is manual + fixture-driven.
- Color-only status (e.g. sync tone) is always paired with a text label, but a
  few progress bars convey state primarily by fill — the numeric percent is
  shown alongside to compensate.

These are tracked for a future dedicated accessibility hardening pass.
