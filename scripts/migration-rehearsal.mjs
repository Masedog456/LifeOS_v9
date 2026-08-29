#!/usr/bin/env node
/**
 * Migration rehearsal (LIFEOS-042, Feature 4).
 *
 * Stands up a throwaway PostgreSQL 16 cluster and rehearses the complete
 * migration chain against it:
 *
 *   - clean apply 0001 -> 0039 in order
 *   - repeated application (idempotency) x3 on the same database
 *   - upgrade from every representative checkpoint (pre-reading ... current)
 *   - constraint + index + RLS survival after the full chain
 *   - RLS enabled on every user-owned table with the required policies
 *   - a LIVE two-user isolation probe: as a non-superuser role, user B can
 *     neither see, update, nor delete user A's rows
 *
 * It NEVER modifies historical migrations and NEVER touches a real database.
 * Postgres refuses to run as root, so every step runs as the `postgres` OS user.
 * Emits a concise PASS/FAIL report; exit 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migDir = join(root, "supabase", "migrations");
const PGBIN = "/usr/lib/postgresql/16/bin";
const DATADIR = "/tmp/pg-rc-rehearsal/data";
const PORT = "54329";
const PGUSER = "postgres";

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail: cond ? "" : detail }); };

function asPostgres(cmd, args, opts = {}) {
  return execFileSync("sudo", ["-n", "-u", PGUSER, cmd, ...args], { encoding: "utf8", ...opts });
}
/** Run SQL text through psql on our cluster; returns stdout. Throws on error. */
function psql(db, sql, extra = []) {
  return asPostgres(join(PGBIN, "psql"), ["-p", PORT, "-h", "/tmp/pg-rc-rehearsal", "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq", ...extra, "-c", sql]);
}
function psqlFile(db, file) {
  return asPostgres(join(PGBIN, "psql"), ["-p", PORT, "-h", "/tmp/pg-rc-rehearsal", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", file]);
}

function migrationFiles() {
  return readdirSync(migDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
}

/** Bootstrap the auth shim every migration expects (auth.users + auth.uid()). */
const AUTH_BOOTSTRAP = `
-- Supabase API roles. Modelled here (like auth and storage below) so the
-- REVOKEs in 0042 are actually exercised rather than skipped: the point of
-- those statements is that anon and authenticated end up with no grant on the
-- private credential schema, and that is only provable if the roles exist.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;
`;

/**
 * Bootstrap the STORAGE shim (LIFEOS-054d).
 *
 * Migrations 0032+ target Supabase, which provides a managed `storage` schema
 * that stock Postgres does not have — so the rehearsal previously died at 0032
 * on `relation "storage.buckets" does not exist` and could never reach the
 * migrations this release actually adds (0035–0037). The gate was reported as
 * "cannot run" for that reason alone.
 *
 * This is scaffolding of exactly the same kind as AUTH_BOOTSTRAP above: the
 * smallest surface 0032 touches, created in a THROWAWAY cluster only. It proves
 * our migration chain applies cleanly, idempotently and in order; it does NOT
 * substitute for a rehearsal against a real copy of the production Supabase
 * schema, because it models Supabase's storage tables rather than reproducing
 * them.
 */
const STORAGE_BOOTSTRAP = `
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid, created_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;
`;

function setup() {
  rmSync("/tmp/pg-rc-rehearsal", { recursive: true, force: true });
  mkdirSync("/tmp/pg-rc-rehearsal", { recursive: true });
  execFileSync("chown", ["-R", "postgres:postgres", "/tmp/pg-rc-rehearsal"]);
  asPostgres(join(PGBIN, "initdb"), ["-D", DATADIR, "-A", "trust", "--username", PGUSER], { stdio: "ignore" });
  asPostgres(join(PGBIN, "pg_ctl"), ["-D", DATADIR, "-o", `-p ${PORT} -k /tmp/pg-rc-rehearsal -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
}
function teardown() {
  try { asPostgres(join(PGBIN, "pg_ctl"), ["-D", DATADIR, "-w", "-m", "immediate", "stop"], { stdio: "ignore" }); } catch { /* ignore */ }
  rmSync("/tmp/pg-rc-rehearsal", { recursive: true, force: true });
}

function createDbWithAuth(name) {
  psql("postgres", `drop database if exists ${name} with (force);`).trim();
  psql("postgres", `create database ${name};`);
  // pgvector is a local stub (domain over text); similarity operators are only
  // referenced inside SQL function bodies, so skip body validation — exactly as
  // the stub's own documentation prescribes. Schema/DDL is still fully applied.
  psql("postgres", `alter database ${name} set check_function_bodies = off;`);
  psql(name, AUTH_BOOTSTRAP);
  psql(name, STORAGE_BOOTSTRAP);
}

function applyChain(db, files) {
  for (const f of files) psqlFile(db, join(migDir, f));
}

function run() {
  const files = migrationFiles();
  ok("migration files present", files.length === 44, `found ${files.length} migration files, expected 44`);

  // 1) Clean apply 0001 -> 0039 on a fresh database.
  createDbWithAuth("rc_clean");
  applyChain("rc_clean", files);
  const tableCount = Number(psql("rc_clean", "select count(*) from pg_tables where schemaname='public';").trim());
  // 62 since LIFEOS-061 added exactly two: `events` and `recurrence_completions`.
  // LIFEOS-067's 0041 adds COLUMNS to `events` and no table at all — a provider
  // is transport, not a life concept, so there is no second event table.
  // LIFEOS-068's 0042 adds TWO public tables (integration_accounts,
  // integration_oauth_states) and one PRIVATE one, which is not counted here
  // because it is deliberately outside `public` — see the credential checks below.
  ok("clean apply 0001->0042 (64 public tables)", tableCount === 64, `got ${tableCount} public tables`);

  // 2) Idempotency: re-apply the whole chain twice more on the same DB.
  applyChain("rc_clean", files);
  applyChain("rc_clean", files);
  const tableCount3 = Number(psql("rc_clean", "select count(*) from pg_tables where schemaname='public';").trim());
  ok("idempotent x3 (stable table count)", tableCount3 === 64, `after 3x got ${tableCount3}`);

  // 3) RLS enabled on every public table + each has policies.
  const noRls = psql("rc_clean", `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity=false order by 1;`).trim();
  ok("RLS enabled on every public table", noRls === "", `tables missing RLS: ${noRls.replace(/\n/g, ", ")}`);
  const noPolicy = psql("rc_clean", `select t.tablename from pg_tables t where t.schemaname='public' and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.tablename) order by 1;`).trim();
  ok("every public table has >=1 policy", noPolicy === "", `tables without policy: ${noPolicy.replace(/\n/g, ", ")}`);

  // 4) Ownership defaults: user_id columns default to auth.uid().
  const ownedNoDefault = psql("rc_clean", `select table_name from information_schema.columns where table_schema='public' and column_name='user_id' and (column_default is null or column_default not like '%auth.uid()%') order by 1;`).trim();
  ok("user_id columns default to auth.uid()", ownedNoDefault === "", `user_id without auth.uid() default: ${ownedNoDefault.replace(/\n/g, ", ")}`);

  // 5) Constraints + indexes survive (spot-check core tables exist with PKs + indexes).
  const pkCount = Number(psql("rc_clean", "select count(*) from pg_constraint where contype='p' and connamespace='public'::regnamespace;").trim());
  ok("primary keys preserved (>=56)", pkCount >= 56, `found ${pkCount} PKs`);
  const idxCount = Number(psql("rc_clean", "select count(*) from pg_indexes where schemaname='public';").trim());
  ok("indexes preserved (>=56)", idxCount >= 56, `found ${idxCount} indexes`);
  for (const t of ["captures", "reading_documents", "document_passages", "document_citations", "workspaces", "goals", "projects", "next_actions", "daily_reviews", "planning_assignments", "focus_sessions", "maintenance_events", "saved_insight_views", "sync_tombstones", "sanitized_error_events"]) {
    const exists = psql("rc_clean", `select to_regclass('public.${t}') is not null;`).trim();
    ok(`table present: ${t}`, exists === "t", `to_regclass returned ${exists}`);
  }

  // 6) Checkpoint upgrades: for each checkpoint, apply through N on a fresh DB,
  //    then apply the remainder — must reach 60 tables cleanly.
  const checkpoints = [
    ["pre-reading", 20], ["pre-workspaces", 21], ["pre-actions", 26],
    ["pre-planning", 27], ["pre-maintenance", 28], ["pre-security", 30],
    ["pre-reading-ingestion", 31], ["pre-reading-originals", 32], ["pre-reading-semantic", 33], ["pre-constitution", 37], ["pre-successor-cascade", 38],
  ];
  for (const [id, through] of checkpoints) {
    const db = `rc_cp_${through}`;
    createDbWithAuth(db);
    const first = files.filter((f) => Number(f.slice(0, 4)) <= through);
    const rest = files.filter((f) => Number(f.slice(0, 4)) > through);
    applyChain(db, first);
    applyChain(db, rest);
    const c = Number(psql(db, "select count(*) from pg_tables where schemaname='public';").trim());
    // The property under test never changes — an upgraded database must reach
    // exactly the same table count as a clean install — only the number moves as
    // planned migrations add tables. 64 since LIFEOS-068's 0042 added
    // `integration_accounts` and `integration_oauth_states`.
    ok(`checkpoint upgrade ${id} (through ${through})`, c === 64, `reached ${c} tables`);
    psql("postgres", `drop database if exists ${db} with (force);`);
  }

  // 7) LIVE two-user isolation on a representative table (captures), as a
  //    non-superuser role so RLS is enforced.
  psql("rc_clean", `
    do $$ begin if not exists (select 1 from pg_roles where rolname='rc_app') then create role rc_app nologin; end if; end $$;
    grant usage on schema public to rc_app;
    grant select, insert, update, delete on all tables in schema public to rc_app;
  `);
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";
  psql("rc_clean", `insert into auth.users(id) values ('${A}'), ('${B}') on conflict do nothing;`);
  // User A inserts a capture (user_id auto-fills from auth.uid()).
  psql("rc_clean", `set role rc_app; set app.uid='${A}'; insert into public.captures(id, text) values (gen_random_uuid(), 'A private note');`);
  // User B must see zero of A's captures.
  const bSees = psql("rc_clean", `set role rc_app; set app.uid='${B}'; select count(*) from public.captures;`).trim();
  ok("isolation: B cannot SELECT A's rows", bSees === "0", `B saw ${bSees} rows`);
  // User B cannot update A's rows.
  const bUpd = psql("rc_clean", `set role rc_app; set app.uid='${B}'; with u as (update public.captures set text='hacked' returning 1) select count(*) from u;`).trim();
  ok("isolation: B cannot UPDATE A's rows", bUpd === "0", `B updated ${bUpd} rows`);
  // User B cannot delete A's rows.
  const bDel = psql("rc_clean", `set role rc_app; set app.uid='${B}'; with d as (delete from public.captures returning 1) select count(*) from d;`).trim();
  ok("isolation: B cannot DELETE A's rows", bDel === "0", `B deleted ${bDel} rows`);
  // A still sees exactly its own row.
  const aSees = psql("rc_clean", `set role rc_app; set app.uid='${A}'; select count(*) from public.captures;`).trim();
  ok("isolation: A still sees its own row", aSees === "1", `A saw ${aSees} rows`);
  // 7b) LIFEOS-056D — the Constitution deletion-privacy cascade, probed against
  //     real Postgres. A conceptual revision spans two elements: the transition
  //     row is OWNED by the predecessor but carries the SUCCESSOR's wording.
  //     Deleting the successor must take that row with it, or the deleted
  //     statement survives in the predecessor's history.
  {
    const EA = "aaaaaaaa-0000-0000-0000-00000000000a";  // predecessor
    const EB = "bbbbbbbb-0000-0000-0000-00000000000b";  // successor
    const SECRET = "SECRET SUCCESSOR WORDING";
    const asA = (sql) => psql("rc_clean", `set role rc_app; set app.uid='${A}'; ${sql}`);
    asA(`
      insert into public.constitution_elements(id, kind, statement, status, adopted_at)
        values ('${EA}', 'principle', 'Original constitutional wording', 'retired', now());
      insert into public.constitution_elements(id, kind, statement, status, adopted_at, supersedes_id)
        values ('${EB}', 'principle', '${SECRET}', 'active', now(), '${EA}');
      -- unrelated predecessor history that must survive
      insert into public.constitution_revisions(id, element_id, change_kind, new_statement)
        values (gen_random_uuid(), '${EA}', 'created', 'Original constitutional wording');
      -- the transition: owned by A, carries B's wording, points at B
      insert into public.constitution_revisions(id, element_id, successor_id, change_kind, previous_statement, new_statement)
        values (gen_random_uuid(), '${EA}', '${EB}', 'revised', 'Original constitutional wording', '${SECRET}');
      -- the successor's own history
      insert into public.constitution_revisions(id, element_id, change_kind, new_statement)
        values (gen_random_uuid(), '${EB}', 'adopted', '${SECRET}');
    `);
    const before = asA(`select count(*) from public.constitution_revisions where new_statement like '%SECRET SUCCESSOR%';`).trim();
    ok("056D: the successor's wording is present before deletion", before === "2", `found ${before} rows`);

    asA(`delete from public.constitution_elements where id = '${EB}';`);

    const bGone = asA(`select count(*) from public.constitution_elements where id = '${EB}';`).trim();
    ok("056D: the successor row is gone", bGone === "0", `${bGone} rows remain`);
    const leaked = asA(`select count(*) from public.constitution_revisions where new_statement like '%SECRET SUCCESSOR%';`).trim();
    ok("056D: NO deleted wording remains in constitution_revisions", leaked === "0", `${leaked} row(s) still hold it`);
    const bySuccessor = asA(`select count(*) from public.constitution_revisions where successor_id = '${EB}';`).trim();
    ok("056D: the transition cascaded via successor_id", bySuccessor === "0", `${bySuccessor} rows remain`);
    const aAlive = asA(`select count(*) from public.constitution_elements where id = '${EA}';`).trim();
    ok("056D: the predecessor survives", aAlive === "1", `${aAlive} rows`);
    const aHistory = asA(`select count(*) from public.constitution_revisions where element_id = '${EA}';`).trim();
    ok("056D: the predecessor's unrelated history survives", aHistory === "1", `${aHistory} rows`);
    // Deleting the predecessor must still take its own history with it.
    asA(`delete from public.constitution_elements where id = '${EA}';`);
    const aHistAfter = asA(`select count(*) from public.constitution_revisions where element_id = '${EA}';`).trim();
    ok("056D: deleting the predecessor cascades its own history", aHistAfter === "0", `${aHistAfter} rows`);
  }

  // 0040 — Time foundation (LIFEOS-061). The constraints and the cascade are
  //        product guarantees, so they are proved against real Postgres rather
  //        than trusted to the client that writes the rows.
  {
    const AID = "cccccccc-0000-0000-0000-00000000000c";
    const asA = (sql) => psql("rc_clean", `set role rc_app; set app.uid='${A}'; ${sql}`);
    const tryA = (sql) => {
      try { psql("rc_clean", `set role rc_app; set app.uid='${A}'; ${sql}`); return true; }
      catch { return false; }
    };

    asA(`insert into public.next_actions(id, title, due_date) values ('${AID}', 'Refill medication box', current_date);`);

    // A due TIME needs a due DATE — the constraint, not just the TypeScript.
    ok("061: due_time with a due_date is accepted",
      tryA(`update public.next_actions set due_time = '09:00' where id = '${AID}';`));
    ok("061: due_time WITHOUT a due_date is refused",
      !tryA(`insert into public.next_actions(id, title, due_time) values (gen_random_uuid(), 'no day', '09:00');`));
    ok("061: a malformed due_time is refused",
      !tryA(`update public.next_actions set due_time = '25:99' where id = '${AID}';`));
    ok("061: 24:00 is refused (it names a different day than 00:00)",
      !tryA(`update public.next_actions set due_time = '24:00' where id = '${AID}';`));
    ok("061: 23:59 is accepted",
      tryA(`update public.next_actions set due_time = '23:59' where id = '${AID}';`));

    // 0043 (LIFEOS-074): a RECURRENCE RULE also names the day.
    //
    // The 0040 check encoded "a time with no day names no moment" and predated
    // LIFEOS-063 R-2, which made "every day at 8" a first-class shape — a time
    // with a rule and no standalone date. The mismatch was invisible only
    // because the Supabase mapper never wrote either column; once it did, this
    // row was the one that would have wedged sync.
    ok("074: due_time with a RECURRENCE and no due_date is accepted",
      tryA(`insert into public.next_actions(id, title, due_time, recurrence)
            values (gen_random_uuid(), 'every day at 8', '08:00', '{"frequency":"daily","interval":1}'::jsonb);`));
    // …and the shape that is still meaningless is still refused. 0043 adds one
    // disjunct; it does not legitimize a time attached to nothing.
    ok("074: due_time with NEITHER a due_date nor a recurrence is still refused",
      !tryA(`insert into public.next_actions(id, title, due_time)
             values (gen_random_uuid(), 'no day at all', '09:00');`));
    ok("074: …and a malformed time is still refused even WITH a recurrence",
      !tryA(`insert into public.next_actions(id, title, due_time, recurrence)
             values (gen_random_uuid(), 'bad time', '25:99', '{"frequency":"daily","interval":1}'::jsonb);`));
    // Exactly one constraint of this name survives the chain — the drop/recreate
    // in 0043 must not leave the 0040 version behind alongside it.
    const dueTimeChecks = asA(`select count(*) from pg_constraint
      where conname = 'next_actions_due_time_needs_date';`).trim();
    ok("074: exactly one due_time constraint exists after the chain",
      dueTimeChecks === "1", `found ${dueTimeChecks}`);

    // 0040's cascade, stated as a fact the APP must match (LIFEOS-074 §2).
    // `recurrence_completions.action_id` references `next_actions` ON DELETE
    // CASCADE, so a completion whose action is gone cannot be inserted at all.
    // That is what makes a locally-orphaned completion row dangerous: adoption
    // re-adds it as "local-only by id" and the next push is rejected forever.
    ok("074: a completion for a NON-EXISTENT action is refused",
      !tryA(`insert into public.recurrence_completions(id, action_id, occurrence_date)
             values (gen_random_uuid(), gen_random_uuid(), date '2026-08-25');`));

    // 0044 (LIFEOS-074): the three execution pointers a session already kept.
    // SOFT references, matching 0027's rule — plain uuids with no foreign key,
    // so deleting a project never cascades away a session and the client's bulk
    // array upsert cannot be rejected on row order.
    const sessCols = asA(`select count(*) from information_schema.columns
      where table_schema='public' and table_name='workspace_sessions'
        and column_name in ('goal_id','project_id','current_action_id');`).trim();
    ok("074: workspace_sessions carries all three execution pointers",
      sessCols === "3", `found ${sessCols}`);
    const sessFks = asA(`select count(*) from information_schema.table_constraints tc
      join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name
      where tc.table_name='workspace_sessions' and tc.constraint_type='FOREIGN KEY'
        and k.column_name in ('goal_id','project_id','current_action_id');`).trim();
    ok("074: …as soft references, with no foreign key", sessFks === "0", `found ${sessFks}`);

    // ---- LIFEOS-075 C-2: ONE tombstone on the parent is enough --------------
    //
    // The repair mints a single `documents` tombstone when a reading is
    // deleted, on the argument that the database already owns every child row.
    // §2 of the brief says to prove that rather than assume it, because "the
    // cascade handles it" is exactly the kind of belief that produced D-24.
    // So: build a full reading — section, passage, highlight, annotation,
    // citation, and a file-metadata row — delete ONLY the parent, and count.
    const DOCID = "11111111-1111-4111-8111-111111111111";
    const SECID = "22222222-2222-4222-8222-222222222222";
    const PASID = "33333333-3333-4333-8333-333333333333";
    const HLID  = "44444444-4444-4444-8444-444444444444";
    // user_id auto-fills from the auth.uid() column default, as everywhere else here.
    asA(`insert into public.reading_documents(id, title, kind, status, authors, tags, notes, source_metadata, progress)
         values ('${DOCID}', 'Being and Time', 'book', 'reading', '{}', '{}', '', '{}'::jsonb, '{}'::jsonb);`);
    asA(`insert into public.document_sections(id, document_id, title, "order")
         values ('${SECID}', '${DOCID}', 'I', 1);`);
    asA(`insert into public.document_passages(id, document_id, section_id, text, "order")
         values ('${PASID}', '${DOCID}', '${SECID}', 'Dasein', 1);`);
    asA(`insert into public.document_highlights(id, document_id, passage_id, color, text, start_offset, end_offset)
         values ('${HLID}', '${DOCID}', '${PASID}', 'yellow', 'Dasein', 0, 6);`);
    asA(`insert into public.document_annotations(id, document_id, passage_id, text)
         values (gen_random_uuid(), '${DOCID}', '${PASID}', 'note to self');`);
    asA(`insert into public.document_citations(id, document_id, passage_id, record_kind, record_id)
         values (gen_random_uuid(), '${DOCID}', '${PASID}', 'belief', 'b1');`);
    asA(`insert into public.reading_document_files(id, document_id, storage_path, filename, checksum)
         values (gen_random_uuid(), '${DOCID}', '${A}/${DOCID}/being.pdf', 'being.pdf', repeat('a', 64));`);

    const childCount = () => Number(asA(`select
        (select count(*) from public.document_sections    where document_id = '${DOCID}')
      + (select count(*) from public.document_passages    where document_id = '${DOCID}')
      + (select count(*) from public.document_highlights  where document_id = '${DOCID}')
      + (select count(*) from public.document_annotations where document_id = '${DOCID}')
      + (select count(*) from public.document_citations   where document_id = '${DOCID}');`).trim());
    ok("075: a reading with all five child kinds is set up", childCount() === 5, `found ${childCount()}`);

    // Delete ONLY the parent row — exactly what the adapter now does.
    asA(`delete from public.reading_documents where id = '${DOCID}';`);
    ok("075: deleting the reading cascades away every child row",
      childCount() === 0, `${childCount()} child rows survived the parent delete`);

    // And the one row that does NOT cascade, stated rather than assumed:
    // `reading_document_files.document_id` is a SOFT reference (0032 declares no
    // foreign key), so the app deletes it explicitly in removeOriginalsForDocument.
    const fileRows = asA(`select count(*) from public.reading_document_files where document_id = '${DOCID}';`).trim();
    ok("075: file metadata does NOT cascade — the app owns that cleanup",
      fileRows === "1", `found ${fileRows}`);
    const fileFks = asA(`select count(*) from information_schema.table_constraints tc
      join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name
      where tc.table_name='reading_document_files' and tc.constraint_type='FOREIGN KEY'
        and k.column_name = 'document_id';`).trim();
    ok("075: …because document_id carries no foreign key (0027 soft-reference doctrine)",
      fileFks === "0", `found ${fileFks}`);
    asA(`delete from public.reading_document_files where document_id = '${DOCID}';`);

    // C-4: the checksum column must hold a 64-character SHA-256 hex digest.
    // Checked before writing any code that assumed it — the alternative was a
    // migration, and the brief's rule is zero migrations unless forced.
    const sumType = asA(`select data_type from information_schema.columns
      where table_schema='public' and table_name='reading_document_files' and column_name='checksum';`).trim();
    ok("075: checksum is an unbounded text column, so SHA-256 needs no migration",
      sumType === "text", `type is ${sumType}`);
    ok("075: …and a full 64-character digest is accepted",
      tryA(`insert into public.reading_document_files(id, document_id, storage_path, filename, checksum)
            values (gen_random_uuid(), gen_random_uuid(), '${A}/x/y.pdf', 'y.pdf', repeat('9', 64));`));

    // Occurrence identity: the anti-duplicate guarantee.
    asA(`insert into public.recurrence_completions(id, action_id, occurrence_date) values (gen_random_uuid(), '${AID}', date '2026-08-23');`);
    ok("061: a duplicate (action, occurrence) completion is refused",
      !tryA(`insert into public.recurrence_completions(id, action_id, occurrence_date) values (gen_random_uuid(), '${AID}', date '2026-08-23');`));
    const one = asA(`select count(*) from public.recurrence_completions where action_id = '${AID}';`).trim();
    ok("061: exactly one completion row survives the duplicate attempt", one === "1", `${one} rows`);

    // Deleting the source takes its derived history with it — the deliberate
    // privacy position of §6 of the continuation brief.
    asA(`delete from public.next_actions where id = '${AID}';`);
    const after = asA(`select count(*) from public.recurrence_completions where action_id = '${AID}';`).trim();
    ok("061: deleting a recurring action cascades its completion history", after === "0", `${after} rows`);

    // Events: constraints, and a malformed rule that must still LOAD.
    const EV = "dddddddd-0000-0000-0000-00000000000d";
    ok("061: an event with a start and a later end is accepted",
      tryA(`insert into public.events(id, title, date, start_time, end_time) values ('${EV}', 'Class', current_date, '09:00', '10:30');`));
    ok("061: an overnight event is refused rather than reordered",
      !tryA(`insert into public.events(id, title, date, start_time, end_time) values (gen_random_uuid(), 'Party', current_date, '23:00', '01:00');`));
    ok("061: an all-day event with a start time is refused",
      !tryA(`insert into public.events(id, title, date, all_day, start_time) values (gen_random_uuid(), 'Holiday', current_date, true, '09:00');`));
    ok("061: an end time with no start is refused",
      !tryA(`insert into public.events(id, title, date, end_time) values (gen_random_uuid(), 'Dangling', current_date, '10:00');`));
    // Malformed recurrence JSONB is a LOAD-PATH concern, not a write barrier:
    // the row must be storable and readable so the client can ignore the rule
    // and keep the event (§9 of the continuation brief).
    ok("061: an event with a malformed recurrence rule still stores",
      tryA(`insert into public.events(id, title, date, recurrence) values (gen_random_uuid(), 'Broken rule', current_date, '{"frequency":"fortnightly"}'::jsonb);`));
    const loads = asA(`select count(*) from public.events;`).trim();
    ok("061: and every event row still loads", Number(loads) >= 2, `${loads} rows`);

    // 0041 — external calendar identity (LIFEOS-067). Both guarantees are
    // enforced in the DATABASE, because the TypeScript that writes these rows is
    // exactly the thing a bug would live in.
    //
    // The unique index is only meaningful if identity is COMPLETE: Postgres
    // treats NULLs as distinct, so a row with a null calendar id would import
    // twice and the index would not notice. That is what the CHECK prevents.
    ok("067: a complete external identity is accepted",
      tryA(`insert into public.events(id, title, date, all_day, external_provider, external_calendar_id, external_event_id)
            values (gen_random_uuid(), 'Dentist', current_date, true, 'google', 'primary@example.com', 'evt-1');`));
    ok("067: provider + event id with NO calendar id is refused",
      !tryA(`insert into public.events(id, title, date, all_day, external_provider, external_event_id)
             values (gen_random_uuid(), 'Half', current_date, true, 'google', 'evt-2');`));
    ok("067: a calendar id with no provider is refused",
      !tryA(`insert into public.events(id, title, date, all_day, external_calendar_id)
             values (gen_random_uuid(), 'Half', current_date, true, 'primary@example.com');`));
    ok("067: an external_updated_at with no identity is refused",
      !tryA(`insert into public.events(id, title, date, all_day, external_updated_at)
             values (gen_random_uuid(), 'Orphan stamp', current_date, true, now());`));
    ok("067: importing the SAME external event twice is refused",
      !tryA(`insert into public.events(id, title, date, all_day, external_provider, external_calendar_id, external_event_id)
             values (gen_random_uuid(), 'Dentist again', current_date, true, 'google', 'primary@example.com', 'evt-1');`));
    ok("067: the same event id in a DIFFERENT calendar is a different event",
      tryA(`insert into public.events(id, title, date, all_day, external_provider, external_calendar_id, external_event_id)
            values (gen_random_uuid(), 'Work dentist', current_date, true, 'google', 'work@example.com', 'evt-1');`));
    // The partial index must not constrain purely local events, which are the
    // overwhelming majority and all carry four NULLs.
    ok("067: two local events with no identity never collide",
      tryA(`insert into public.events(id, title, date, all_day) values (gen_random_uuid(), 'Local A', current_date, true);`)
      && tryA(`insert into public.events(id, title, date, all_day) values (gen_random_uuid(), 'Local B', current_date, true);`));
    // Unlinking (disconnect) must be a legal transition, not a constraint fight.
    ok("067: clearing identity on disconnect is accepted",
      tryA(`update public.events set external_provider = null, external_calendar_id = null,
            external_event_id = null, external_updated_at = null where external_event_id = 'evt-1' and external_calendar_id = 'work@example.com';`));
    // And a token must never end up here. Asserted as an absence of columns.
    const tokenCols = asA(`select count(*) from information_schema.columns
      where table_schema='public' and table_name='events'
      and (column_name ilike '%token%' or column_name ilike '%secret%' or column_name ilike '%refresh%');`).trim();
    ok("067: no credential-shaped column exists on events", tokenCols === "0", `${tokenCols} columns`);

    // 0042 — integration account linking (LIFEOS-068). The guarantees that
    // matter here are about REACHABILITY and SECRETS, so they are proved
    // against real Postgres rather than trusted to the client.
    const IA = "eeeeeeee-0000-0000-0000-00000000000e";

    // The credential table lives OUTSIDE `public`, which is the whole point:
    // PostgREST exposes `public`, so a table that is not in it has no REST path.
    const credInPublic = asA(`select count(*) from information_schema.tables
      where table_schema='public' and table_name='integration_credentials';`).trim();
    ok("068: the credential table is NOT in the public schema", credInPublic === "0", `${credInPublic} found`);
    // Asked as the SUPERUSER, because `information_schema` only shows what the
    // querying role may reach — and the app role deliberately may not reach this
    // table at all. That invisibility is asserted separately, just below.
    const credExists = psql("rc_clean", `select count(*) from pg_tables
      where schemaname='private' and tablename='integration_credentials';`).trim();
    ok("068: …it exists in the private schema", credExists === "1", `${credExists} found`);
    // The app role cannot even SEE it — the strongest form of the guarantee.
    const credVisible = asA(`select count(*) from information_schema.tables
      where table_schema='private' and table_name='integration_credentials';`).trim();
    ok("068: …and the application role cannot see it at all", credVisible === "0", `${credVisible} visible`);
    ok("068: …nor select from it",
      !tryA(`select count(*) from private.integration_credentials;`));

    // No plaintext token column can exist even by mistake.
    const plaintextCols = asA(`select count(*) from information_schema.columns
      where table_schema='private' and table_name='integration_credentials'
      and column_name in ('access_token','refresh_token','id_token','client_secret','token','secret');`).trim();
    ok("068: no plaintext token column exists on the credential table", plaintextCols === "0", `${plaintextCols} columns`);
    const publicSecretCols = asA(`select count(*) from information_schema.columns
      where table_schema='public'
      and (column_name in ('access_token','refresh_token','id_token','client_secret')
           or column_name ilike '%client_secret%');`).trim();
    ok("068: no secret-shaped column exists anywhere in public", publicSecretCols === "0", `${publicSecretCols} columns`);

    // The API roles must not be able to reach the private schema at all.
    const anonUsage = asA(`select count(*) from information_schema.role_usage_grants
      where object_schema='private' and grantee in ('anon','authenticated');`).trim();
    ok("068: the API roles hold no grant on the private schema", anonUsage === "0", `${anonUsage} grants`);
    const credGrants = asA(`select count(*) from information_schema.role_table_grants
      where table_schema='private' and grantee in ('anon','authenticated');`).trim();
    ok("068: …and none on the credential table", credGrants === "0", `${credGrants} grants`);

    // Status is a closed set, and `connected` must be fully identified.
    asA(`insert into public.integration_accounts(id, provider, status) values ('${IA}', 'google', 'pending');`);
    ok("068: a pending integration with no provider account id is legal",
      asA(`select count(*) from public.integration_accounts where id = '${IA}';`).trim() === "1");
    ok("068: an unknown status is refused",
      !tryA(`update public.integration_accounts set status = 'banana' where id = '${IA}';`));
    ok("068: connecting without a provider account id is refused",
      !tryA(`update public.integration_accounts set status = 'connected' where id = '${IA}';`));
    ok("068: connecting WITH an identity and a date is accepted",
      tryA(`update public.integration_accounts set status='connected', provider_account_id='goog-1', connected_at=now() where id = '${IA}';`));

    // One canonical link per provider account (§18).
    ok("068: a second link to the SAME provider account is refused",
      !tryA(`insert into public.integration_accounts(id, provider, provider_account_id, status, connected_at)
             values (gen_random_uuid(), 'google', 'goog-1', 'connected', now());`));
    ok("068: a different provider account is a different link",
      tryA(`insert into public.integration_accounts(id, provider, provider_account_id, status, connected_at)
            values (gen_random_uuid(), 'google', 'goog-2', 'connected', now());`));
    ok("068: several pending rows can coexist",
      tryA(`insert into public.integration_accounts(id, provider, status) values (gen_random_uuid(), 'google', 'pending');`)
      && tryA(`insert into public.integration_accounts(id, provider, status) values (gen_random_uuid(), 'google', 'pending');`));

    // OAuth state: hashed, expiring, one-time.
    const SH = "a".repeat(64);
    ok("068: a state row requires a sha256-shaped hash",
      !tryA(`insert into public.integration_oauth_states(state_hash, provider, verifier_ciphertext, verifier_iv, verifier_tag, verifier_key_version, expires_at)
             values ('not-a-hash', 'google', 'c', 'i', 't', 1, now() + interval '10 minutes');`));
    ok("068: a valid state row is accepted",
      tryA(`insert into public.integration_oauth_states(state_hash, provider, verifier_ciphertext, verifier_iv, verifier_tag, verifier_key_version, expires_at)
            values ('${SH}', 'google', 'c', 'i', 't', 1, now() + interval '10 minutes');`));
    ok("068: a state that expires before it was created is refused",
      !tryA(`insert into public.integration_oauth_states(state_hash, provider, verifier_ciphertext, verifier_iv, verifier_tag, verifier_key_version, expires_at)
             values ('${"b".repeat(64)}', 'google', 'c', 'i', 't', 1, now() - interval '1 minute');`));
    // The atomic claim: exactly one of two identical statements can win.
    const first = asA(`update public.integration_oauth_states set consumed_at = now()
      where state_hash = '${SH}' and consumed_at is null and expires_at > now() returning state_hash;`).trim();
    const second = asA(`update public.integration_oauth_states set consumed_at = now()
      where state_hash = '${SH}' and consumed_at is null and expires_at > now() returning state_hash;`).trim();
    ok("068: a state can be claimed exactly once", first !== "" && second === "", `first='${first}' second='${second}'`);

    // §16/§29. Deleting the user takes metadata, states and credentials with it.
    // Seeded as the SUPERUSER on purpose: the application role cannot reach this
    // schema, which is the guarantee asserted above. A privileged connection is
    // what a future credential vault would use, and it is what the cascade
    // behaviour below has to be proved against.
    const asSuper = (sql) => psql("rc_clean", sql);
    const trySuper = (sql) => { try { psql("rc_clean", sql); return true; } catch { return false; } };
    asSuper(`insert into private.integration_credentials(integration_account_id, access_ciphertext, access_iv, access_tag, key_version)
             values ('${IA}', 'c', 'i', 't', 1);`);
    ok("068: a refresh envelope must be complete or absent",
      !trySuper(`update private.integration_credentials set refresh_ciphertext = 'c' where integration_account_id = '${IA}';`));
    ok("068: …and a complete one is accepted",
      trySuper(`update private.integration_credentials
                set refresh_ciphertext='c', refresh_iv='i', refresh_tag='t' where integration_account_id = '${IA}';`));
    psql("rc_clean", `delete from auth.users where id = '${A}';`);
    const leftAccounts = psql("rc_clean", `select count(*) from public.integration_accounts;`).trim();
    const leftStates = psql("rc_clean", `select count(*) from public.integration_oauth_states;`).trim();
    const leftCreds = psql("rc_clean", `select count(*) from private.integration_credentials;`).trim();
    ok("068: deleting the user removes integration metadata", leftAccounts === "0", `${leftAccounts} rows`);
    ok("068: …and their pending OAuth states", leftStates === "0", `${leftStates} rows`);
    ok("068: …and every credential — no orphaned secret survives", leftCreds === "0", `${leftCreds} rows`);
    ok("061: a non-object recurrence is refused",
      !tryA(`insert into public.events(id, title, date, recurrence) values (gen_random_uuid(), 'Bad type', current_date, '"weekly"'::jsonb);`));

    // Two-user isolation on both new tables.
    const asB = (sql) => psql("rc_clean", `set role rc_app; set app.uid='${B}'; ${sql}`);
    const bSeesEvents = asB(`select count(*) from public.events;`).trim();
    ok("061: user B sees none of user A's events", bSeesEvents === "0", `${bSeesEvents} rows`);
    const bSeesCompletions = asB(`select count(*) from public.recurrence_completions;`).trim();
    ok("061: user B sees none of user A's completion history", bSeesCompletions === "0", `${bSeesCompletions} rows`);

    asA(`delete from public.events where id is not null;`);
  }

  // Every user-owned policy references auth.uid() (isolation is by policy, not luck).
  const weakPolicies = psql("rc_clean", `select distinct tablename from pg_policies where schemaname='public' and coalesce(qual,'')||coalesce(with_check,'') not like '%uid%' order by 1;`).trim();
  ok("every policy scopes to auth.uid()", weakPolicies === "", `policies not scoped by uid: ${weakPolicies.replace(/\n/g, ", ")}`);
}

let failed = false;
try {
  setup();
  run();
} catch (e) {
  failed = true;
  console.error("REHEARSAL ERROR:", e.message);
  if (e.stderr) console.error(String(e.stderr).slice(0, 2000));
} finally {
  teardown();
}

for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : " — " + r.detail}`);
const passed = results.filter((r) => r.pass).length;
const allPass = !failed && passed === results.length && results.length > 0;
console.log(`\n${allPass ? "MIGRATION REHEARSAL PASS" : "MIGRATION REHEARSAL FAIL"} — ${passed}/${results.length} checks`);
process.exit(allPass ? 0 : 1);
