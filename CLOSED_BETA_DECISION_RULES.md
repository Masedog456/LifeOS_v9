# Closed-beta decision rules

Written **before** the evidence arrives, so the evidence cannot be read to suit
whatever we already wanted to build. If a rule turns out to be wrong, change it
deliberately and say why — do not quietly reinterpret it after the fact.

Nothing here is automated. These are commitments about how a human reads a
number, not code.

---

## Stop-the-line

**If any tester reports something entering their Constitution without explicitly
adding it — or the canary at `/dev/beta-evidence` reports `VIOLATION`:**
→ **Stop all feature development.** Investigate immediately. Do not ship, do not
continue the beta, do not repair it quietly. This is the one invariant the whole
Constitution layer exists to protect.

---

## Interview pacing

**If testers routinely stop before the review because of question fatigue**
(early review rate high, average questions before review low, or feedback in the
`too_many_questions` bucket):
→ Examine interview pacing and the follow-up cap **before** expanding domains.
Do not add breadth to something people already leave.

**If take-stock is started but rarely reaches review, while struggle mode does:**
→ The problem is the 14-domain walk, not the interview. Look at ordering and
exit points before touching the question bank.

## Proposal quality

**If most adopted proposals are `substantial` rewrites:**
→ The model's wording is not carrying its weight. Make it quieter or drop
suggestion wording entirely. **Do not** add more AI machinery on top of prose
people are already discarding.

**If dismissal rate is high and concentrated in one kind:**
→ Suspect kind selection, not proposal quality. Look at how that kind is
described before changing the synthesis prompt.

**If proposals are produced but few decisions of any sort are recorded:**
→ People are not engaging with the review at all. That is an IA problem, not a
prompt problem.

## Conceptual clarity

**If 3+ testers independently confuse Constitution elements with tasks, actions,
goals or protocols:**
→ Investigate routing and information architecture **before** adding any new
Constitution feature. The philosophy/operations distinction is not landing, and
more Constitution surface would make that worse.

**If testers do not understand draft vs adopt:**
→ Look at the review screen's labels first. Do not add a third state.

## Trust

**If nobody uses `excludeFromAi`:**
→ Investigate discoverability and whether people believe it, **before**
expanding permission semantics. An unused control is not evidence that people
don't want the guarantee.

**If testers report privacy or trust concerns (`privacy_trust` feedback):**
→ Read every one individually. Do not aggregate. A single specific trust
complaint outweighs ten vague satisfied ones.

## Roadmap pull

**If testers repeatedly ask for Calendar without being prompted:**
→ Calendar moves up the roadmap. "Repeatedly" means unprompted, from more than
one tester.

**If testers repeatedly ask for recurrence or reminders:**
→ Time-model expansion moves up.

**If testers ask for something not on the roadmap at all:**
→ Record it in the observation log. Do not act on a single request.

---

## What is explicitly NOT a decision rule

- Number of sessions, time in app, or any engagement measure. We do not collect
  these and would not act on them.
- Anything derived from what a tester wrote. We do not have it.
- Any score about a person.
