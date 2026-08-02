# Help System (LIFEOS-041, Feature 12)

An in-product Help Center at `/help` (`components/design/HelpDrawer.tsx`),
route-aware and sourced from the real docs — never a chat assistant.

## Sections (`lib/onboarding/education.ts` → `HELP_SECTIONS`)

Getting Started · Capture & Processing · Projects & Actions · Planning & Focus ·
Daily Review · Reading & Knowledge · Maintenance · Insights · Backup & Restore ·
Privacy & Security · Keyboard Shortcuts · Glossary · Troubleshooting. Each maps to
a source document (e.g. `CAPTURE_PROCESSING.md`, `DETERMINISTIC_INSIGHTS.md`) and
the routes it covers, so `helpForRoute(route)` surfaces the relevant section on
each page.

## Contextual education (Feature 11)

Small, dismissible, reopenable explanations at moments of uncertainty
(`LESSONS`): what a planning horizon means, action vs milestone, what Focus
changes, what archive means, why insights are descriptive, why a maintenance
candidate appeared, what a coverage notice means, why schema mismatch blocks
writes. Dismissed lesson ids live in `prefs.education.dismissed` and **union**
across devices; every lesson is reopenable from Help — no tooltip is the only
carrier of essential information.

## Keyboard reference + glossary

The Shortcuts section renders the documented keyboard model
(`lib/accessibility/keyboard.ts`) with each shortcut's visible affordance; the
Glossary renders the canonical terminology (`PRODUCT_LANGUAGE.md`).

## Sample workspace (Feature 36)

The Getting Started panel offers an optional, clearly-marked **sample workspace**
(`components/onboarding/SampleWorkspacePreview.tsx`) — capture → project → action
→ focus → review plus a document, citation, belief, and maintenance candidate.
It is explicitly user-created, ordinary data once created (never claimed as the
user's own), and removable in one action.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, and `V1_RELEASE_CHECKLIST.md`; the `/release` surface
shows live readiness. No new features were added in this sprint — only release
packaging and demonstrated fixes.
