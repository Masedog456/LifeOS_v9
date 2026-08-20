# Closed-beta observation

One observation per entry. Copy the block.

The discipline that makes this useful is keeping **FACT** and **INTERPRETATION**
apart. A fact is what happened; an interpretation is a story about why. Collapsing
them is how a single confused tester becomes "users want X" and then becomes a
sprint.

`POTENTIAL DECISION` stays **blank** while observing. Fill it only in a separate
review pass, after several observations exist.

---

```
DATE:
TESTER:
SURFACE:

FACT:
  What literally happened. Observable. No motive, no cause, no "because".

INTERPRETATION:
  What it might mean. Explicitly a guess. Multiple readings are fine — write them all.

USER WORDS:
  Verbatim, if they said something. Their words, not a paraphrase.

WORKAROUND:
  What they did instead, if anything. Often more informative than the complaint.

FREQUENCY:
  First time seen / seen before / how many testers.

POTENTIAL DECISION:
  (leave blank during observation)
```

---

## Example

```
FACT:
  Tester answered 3 questions, clicked "Stop here and review", then closed the tab
  without deciding on any of the 4 proposals.

INTERPRETATION:
  Could be fatigue. Could be that the proposals were not good enough to act on.
  Could be that "Stop here and review" reads as "save and exit" rather than
  "see suggestions now". Do not know which.

USER WORDS:
  "I thought I was done."

WORKAROUND:
  None — did not return to the interview.

FREQUENCY:
  1 tester, first time.

POTENTIAL DECISION:
```
