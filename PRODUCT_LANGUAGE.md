# Product Language (LIFEOS-041)

The canonical vocabulary LifeOS uses in the UI and docs. One concept, one word —
never a noun/verb split or a singular/plural drift, and implementation terms
never leak to users. Generated from and kept in sync with
`lib/design/terminology.ts` (a self-test fails on duplicates, missing
definitions, or a deprecated alternative colliding with a canonical name). Tone:
calm, direct, respectful, neutral, concise, human (`lib/design/microcopy.ts`
holds the forbidden-phrase list a self-test scans copy against).

| Term | Short | Plural | Verb | Definition | Avoid |
| --- | --- | --- | --- | --- | --- |
| Capture | Capture | Captures | capture | A quick, unprocessed note you save to deal with later. | quick note, braindump, todo |
| Next action | Action | Next actions | complete | A specific, concrete thing you can do next — the smallest unit of doing. | task, todo, ticket |
| Milestone | Milestone | Milestones | — | A meaningful checkpoint within a project. | phase, epic |
| Project | Project | Projects | — | A body of related work with an outcome, made of milestones and actions. | board, initiative |
| Goal | Goal | Goals | — | A longer-term outcome that projects serve. | objective, okr |
| Workspace | Workspace | Workspaces | — | A context you work within; groups sessions and records. | team, org, space |
| Session | Session | Sessions | — | A recorded stretch of focused work. | timer, pomodoro |
| Focus session | Focus | Focus sessions | focus | A deliberately quiet session on one target, with interruptions logged by hand. | deep work session |
| Planning horizon | Horizon | Planning horizons | — | When you intend to work on something — a choice, never a deadline. | bucket, sprint, column |
| Daily review | Review | Daily reviews | review | A short daily reflection on what happened and what's next. | standup, check-in |
| Belief | Belief | Beliefs | — | A claim you hold, with evidence and revisions over time. | fact, note |
| Citation | Citation | Citations | — | A link from a record back to its exact source in a document. | reference link, footnote |
| Research | Research | Research projects | — | An open investigation with questions, hypotheses, and evidence. | study |
| Record | Record | Records | — | Any first-class item in LifeOS (a project, belief, document…). | object, node, row |
| Document | Document | Documents | read | An imported text you read, highlight, and cite. | file, article record |
| Relationship | Link | Relationships | — | A connection between two records. | edge, association |
| Maintenance candidate | Candidate | Maintenance candidates | — | Something that may need your attention — a duplicate, orphan, or stale record. Not an error. | issue, problem, warning |
| Insight | Insight | Insights | — | A descriptive view of recorded activity — counts and durations, never a score. | analytics, metric dashboard, report card |
| Archive | Archive | Archives | archive | Set aside without deleting; reversible. | trash, remove |
| Discard | Discard | Discards | discard | Move out of the inbox; recoverable from the Recovery Center. | delete, dismiss |
| Delete | Delete | Deletions | delete | Permanently remove. Some deletions are irreversible and say so. | destroy, purge |
| Restore | Restore | Restores | restore | Bring back a discarded, archived, or backed-up item. | undo delete, recover |
| Conflict | Conflict | Conflicts | — | A record changed differently on two devices; you choose which to keep. | merge error, collision |
| Synchronization | Sync | Syncs | sync | Keeping your local data and your account in agreement across devices. | cloud save, backup sync |

## Deprecated → canonical

`findDeprecated(text)` flags any deprecated alternative in copy. Replace, for
example, "task/todo/ticket" → **Next action**, "trash/remove" → **Archive**
(when reversible) or **Delete** (when permanent), "issue/warning" →
**Maintenance candidate**, "analytics/report card" → **Insight**.

## Microcopy rules

- State facts; never praise, shame, rank, or judge.
- No hype, gamification, streaks, confetti, or forced friendliness.
- No pseudo-philosophical slogans inside workflows (marketing lives outside core
  flows).
- No unexplained abbreviations or robotic system jargon (`null`, `undefined`,
  `exception`, `stack trace`) in user-facing copy.
- Errors follow the model in `errorCopy()`: what couldn't happen, whether data is
  safe, what to do, whether retry helps, where diagnostics live.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, and `V1_RELEASE_CHECKLIST.md`; the `/release` surface
shows live readiness. No new features were added in this sprint — only release
packaging and demonstrated fixes.
