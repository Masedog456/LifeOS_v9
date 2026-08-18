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
  ok("migration files present", files.length === 39, `found ${files.length} migration files, expected 39`);

  // 1) Clean apply 0001 -> 0039 on a fresh database.
  createDbWithAuth("rc_clean");
  applyChain("rc_clean", files);
  const tableCount = Number(psql("rc_clean", "select count(*) from pg_tables where schemaname='public';").trim());
  ok("clean apply 0001->0039 (60 public tables)", tableCount === 60, `got ${tableCount} public tables`);

  // 2) Idempotency: re-apply the whole chain twice more on the same DB.
  applyChain("rc_clean", files);
  applyChain("rc_clean", files);
  const tableCount3 = Number(psql("rc_clean", "select count(*) from pg_tables where schemaname='public';").trim());
  ok("idempotent x3 (stable table count)", tableCount3 === 60, `after 3x got ${tableCount3}`);

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
    // 60, not 58: LIFEOS-056 added `constitution_elements` and
    // `constitution_revisions` (0038). The property under test is unchanged — an upgraded
    // database must reach exactly the same table count as a clean install.
    ok(`checkpoint upgrade ${id} (through ${through})`, c === 60, `reached ${c} tables`);
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
