/**
 * Backup / export / import / restore / recovery self-tests (LIFEOS-040).
 *
 * Deterministic assertions: manifest checksums, export contains no secrets and
 * reconciles record counts, verification catches tampering, import validates
 * version and detects duplicates, dry-run changes nothing, destructive restore
 * requires explicit confirmation, and recovery projects the right candidates.
 */

import type { StoreState } from "@/types/mvp";
import { buildManifest, fnv1a, canonicalJson, manifestMatches } from "@/lib/backup/manifest";
import { buildAccountArchive, serializeArchive, collectionToCsv, assertNoSecrets, streamArchiveLines } from "@/lib/backup/export";
import { verifyArchive, verifyArchiveText } from "@/lib/backup/verify";
import { previewImport, applyImport, requiresExplicitConfirmation } from "@/lib/backup/import-preview";
import { restore } from "@/lib/backup/restore";
import { buildRecovery } from "@/lib/backup/recovery";
import { isArchiveVersionSupported } from "@/lib/backup/versioning";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  const base: Record<string, unknown[]> = {};
  for (const d of ["captures", "proposals", "beliefs", "sources", "feedback", "comparisons", "inquiries", "megathreads", "reflections", "practices", "reviews", "reasonings", "embeddings", "decisions", "formationSessions", "concepts", "conceptRelationships", "principles", "frameworks", "knowledgeProjects", "researchProjects", "dialogueSessions", "tensions", "syntheses", "recommendations", "documents", "citations", "workspaces", "sessions", "goals", "projects", "dailyReviews", "nextActions", "actionDependencies", "actionTemplates", "planningAssignments", "focusSessions", "maintenanceEvents", "duplicateCandidates", "savedInsightViews"]) base[d] = [];
  return base as unknown as StoreState;
}

function seeded(): StoreState {
  const s = emptyState() as unknown as Record<string, unknown[]>;
  s.captures = [{ id: "c1", text: "Idea", processingStatus: "inbox" }, { id: "c2", text: "Gone", processingStatus: "discarded" }];
  s.projects = [{ id: "p1", title: "Launch", status: "active" }, { id: "p2", title: "Old", status: "archived" }];
  s.documents = [{ id: "d1", title: "Book", status: "reading" }];
  s.citations = [{ id: "cit1", documentId: "d1" }, { id: "cit2", documentId: "dGONE" }];
  return s as unknown as StoreState;
}

export function runBackupSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });
  const NOW = "2026-07-31T12:00:00.000Z";

  // ---- 1. Manifest & checksums ----
  ok("1.1 fnv1a deterministic", fnv1a("abc") === fnv1a("abc") && fnv1a("abc") !== fnv1a("abd"));
  ok("1.2 canonical json key-order stable", canonicalJson({ b: 1, a: 2 }) === canonicalJson({ a: 2, b: 1 }));
  {
    const m = buildManifest({ captures: [{ id: "c1" }], projects: [] });
    ok("1.3 manifest counts", m.totalRecords === 1 && m.entries.find((e) => e.collection === "captures")?.count === 1);
    ok("1.4 manifest matches self", manifestMatches({ captures: [{ id: "c1" }], projects: [] }, m).ok);
    ok("1.5 manifest detects tampering", !manifestMatches({ captures: [{ id: "c1" }, { id: "c2" }], projects: [] }, m).ok);
  }

  // ---- 2. Export ----
  {
    const archive = buildAccountArchive(seeded(), { appVersion: "1.0.0", now: NOW, timezone: "UTC", pendingMutations: 3 });
    ok("2.1 metadata present", archive.metadata.archiveVersion >= 1 && archive.metadata.generatedAt === NOW);
    ok("2.2 pending mutations disclosed", archive.metadata.pendingMutations === 3);
    ok("2.3 counts reconcile", archive.metadata.recordCounts.captures === 2 && archive.metadata.recordCounts.projects === 2);
    ok("2.4 no secrets", assertNoSecrets(archive).ok, assertNoSecrets(archive).problems.join(","));
    ok("2.5 deterministic bytes", serializeArchive(buildAccountArchive(seeded(), { now: NOW })) === serializeArchive(buildAccountArchive(seeded(), { now: NOW })));
    const withToken = buildAccountArchive({ ...seeded(), captures: [{ id: "x", access_token: "eyJabc.def.ghi" }] } as unknown as StoreState, { now: NOW });
    ok("2.6 secret detector catches injected token", !assertNoSecrets(withToken).ok);
    ok("2.7 csv from tabular", collectionToCsv([{ id: "1", title: "A" }, { id: "2", title: "B,C" }]).includes('"B,C"'));
    const lines = [...streamArchiveLines(seeded(), { now: NOW })];
    ok("2.8 stream yields metadata + collections + manifest", lines[0].includes("metadata") && lines.some((l) => l.includes("\"manifest\"")));
  }

  // ---- 3. Verify ----
  {
    const archive = buildAccountArchive(seeded(), { now: NOW });
    const r = verifyArchive(archive);
    ok("3.1 valid archive verifies", r.ok, r.problems.join(","));
    ok("3.2 dangling citation noted, not error", r.ok && r.notes.some((n) => /citation/.test(n)));
    // tamper: change a record after manifest built
    const tampered = JSON.parse(serializeArchive(archive));
    tampered.collections.captures.push({ id: "sneaky" });
    ok("3.3 tampered archive fails verify", !verifyArchive(tampered).ok);
    ok("3.4 bad JSON fails verify", !verifyArchiveText("{not json").ok);
    ok("3.5 unsupported version fails", !verifyArchive({ ...archive, metadata: { ...archive.metadata, archiveVersion: 999 } }).ok);
    ok("3.6 version support check", isArchiveVersionSupported(1) && !isArchiveVersionSupported(999));
  }

  // ---- 4. Import preview / dry run ----
  {
    const current = seeded();
    const incoming = buildAccountArchive({ ...emptyState(), captures: [{ id: "c1", text: "changed", processingStatus: "inbox" }, { id: "c3", text: "new", processingStatus: "inbox" }] } as unknown as StoreState, { now: NOW });
    const preview = previewImport(current, incoming, "merge");
    const capPlan = preview.plans.find((p) => p.domain === "captures")!;
    ok("4.1 duplicate detected", capPlan.duplicateIds === 1, JSON.stringify(capPlan));
    ok("4.2 new id detected", capPlan.newIds === 1);
    ok("4.3 merge overwriting dup is destructive", preview.destructive && requiresExplicitConfirmation(preview));
    // dry-run applyImport does not mutate current
    const before = current.captures.length;
    const next = applyImport(current, incoming, "merge");
    ok("4.4 apply is pure", current.captures.length === before && next.captures.length === 3);
    ok("4.5 replace removes existing", (() => { const rep = previewImport(current, incoming, "replace").plans.find((p) => p.domain === "captures")!; return rep.removed === 2; })());
    ok("4.6 import version validated", !previewImport(current, { ...incoming, metadata: { ...incoming.metadata, archiveVersion: 999 } }).importable);
  }

  // ---- 5. Restore safety ----
  {
    const current = seeded();
    const incoming = buildAccountArchive({ ...emptyState(), captures: [{ id: "c1", text: "changed" }] } as unknown as StoreState, { now: NOW });
    const blocked = restore(current, incoming, { mode: "merge" }); // destructive (overwrites c1), no confirm
    ok("5.1 destructive restore blocked without confirm", !blocked.applied && /confirmation/i.test(blocked.reason ?? ""));
    const dry = restore(current, incoming, { mode: "merge", confirmDestructive: true, dryRun: true });
    ok("5.2 dry run changes nothing", !dry.applied && dry.report.recordsUpdated === 1);
    const applied = restore(current, incoming, { mode: "merge", confirmDestructive: true });
    ok("5.3 confirmed restore applies + rollback kept", applied.applied && !!applied.rollback && applied.nextState!.captures.length === 2);
    const nonDestructive = restore(emptyState(), incoming, { mode: "merge" });
    ok("5.4 non-destructive restore applies without confirm", nonDestructive.applied);
  }

  // ---- 6. Recovery ----
  {
    const rec = buildRecovery({ state: seeded(), unresolvedConflicts: [{ id: "cf1", domain: "beliefs" }], corruptPrefsKey: "lifeos.prefs.v1", incompleteMigration: { from: 0, to: 1 } });
    ok("6.1 discarded capture recoverable", rec.candidates.some((c) => c.kind === "discarded-capture" && c.id === "c2"));
    ok("6.2 archived project recoverable", rec.candidates.some((c) => c.kind === "archived-record" && c.id === "p2"));
    ok("6.3 sync conflict listed", rec.candidates.some((c) => c.kind === "sync-conflict"));
    ok("6.4 corrupt prefs listed", rec.candidates.some((c) => c.kind === "corrupt-preferences"));
    ok("6.5 incomplete migration listed", rec.candidates.some((c) => c.kind === "incomplete-migration"));
    ok("6.6 every candidate has impact preview", rec.candidates.every((c) => c.impact.length > 0));
  }

  // ---- 7. Performance (large export/verify) ----
  {
    const big = emptyState() as unknown as Record<string, unknown[]>;
    big.nextActions = Array.from({ length: 20000 }, (_, i) => ({ id: `a${i}`, title: `A${i}`, status: "open" }));
    big.captures = Array.from({ length: 10000 }, (_, i) => ({ id: `c${i}`, text: "x" }));
    const tExp = Date.now(); const archive = buildAccountArchive(big as unknown as StoreState, { now: NOW }); const expMs = Date.now() - tExp;
    const tVer = Date.now(); const vr = verifyArchive(archive); const verMs = Date.now() - tVer;
    ok(`7.1 export 30k records < 1500ms (${expMs}ms)`, expMs < 1500, `${expMs}ms`);
    ok(`7.2 verify 30k records < 1500ms (${verMs}ms)`, verMs < 1500 && vr.ok, `${verMs}ms`);
    ok("7.3 big counts reconcile", archive.metadata.recordCounts.nextActions === 20000);
  }

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
