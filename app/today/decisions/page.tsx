"use client";

/**
 * `/today/decisions` — what Conqify cannot settle without you (LIFEOS-094).
 *
 * Under `/today` rather than at `/decisions`, and not because the shorter URL
 * was unavailable by accident: `/decisions` is the knowledge `Decision` record
 * type, and the command palette already has an "Open Decisions" entry pointing
 * at it. Two different nouns on one word is how a product stops meaning
 * anything. `/today/review` set the namespace precedent (LIFEOS-092) and this
 * follows it — the queue is about the state of your commitments now, which is
 * what `/today` is for.
 *
 * §25: no new top-level nav item. The audit did not show the queue earns one,
 * and Today, the evening close and the palette all reach it.
 */

import DecisionInbox from "@/components/today/DecisionInbox";

export default function DecisionInboxPage() {
  return <DecisionInbox />;
}
