-- LIFEOS-076 — stale-write protection for the two proven P1 classes.
--
-- ## What this exists to stop
--
-- F-1: device A completes an action; device B, holding a copy from before that,
--      defers it and its push lands second. The completion, its timestamp and
--      its history entry were all erased. A finished life fact became unfinished.
--
-- F-2: two devices edit the same note body. One entire user-authored body became
--      unrecoverable — absent from the server, from the winner AND from the
--      device that wrote it, because adoption is remote-wins-by-id and a Note
--      carries no history, no revisions and nowhere for a loser to live.
--
-- Both were decided by NETWORK ARRIVAL ORDER, not by which write was newer.
--
-- ## The invariant, and where it lives
--
--   an UPDATE to a protected row must set sync_version = old sync_version + 1
--
-- It is enforced by a TRIGGER, deliberately, not by the client choosing to call
-- a well-behaved function. Any writer — the current client, a future one, an
-- outdated one still doing a plain upsert, psql — is held to it. A guard that
-- only applies when the caller opts in is not a guard.
--
-- ## Why an old client cannot slip past it
--
-- PostgREST's upsert only assigns the columns present in the payload, so a
-- client that knows nothing about `sync_version` leaves it untouched: NEW equals
-- OLD, which is not OLD + 1, and the write is refused. An outdated client
-- therefore gets a write FAILURE rather than the power to overwrite newer
-- durable state. That is the intended trade and it is proved in the rehearsal.
--
-- ## What this is NOT
--
-- Not a merge engine. `merge.ts`, `conflicts.ts` and the six `merge-rules.ts`
-- modules (D-8) remain dormant. Nothing here resolves a conflict; it only
-- refuses to let a stale write destroy a durable fact, and hands the rejected
-- intent back so the person can decide.

-- ---------------------------------------------------------------- columns ----
-- Additive, with a default, so every existing row is immediately at version 1
-- and keeps reading exactly as before. No user data is rewritten.
alter table public.next_actions add column if not exists sync_version bigint not null default 1;
alter table public.notes        add column if not exists sync_version bigint not null default 1;

-- A version is a positive counter. Postgres owns monotonicity; a client can
-- never propose zero, a negative, or an arbitrary jump.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'next_actions_sync_version_positive') then
    alter table public.next_actions add constraint next_actions_sync_version_positive check (sync_version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_sync_version_positive') then
    alter table public.notes add constraint notes_sync_version_positive check (sync_version > 0);
  end if;
end $$;

-- ---------------------------------------------------------------- trigger ----
create or replace function public.enforce_sync_version()
returns trigger
language plpgsql
as $$
begin
  -- Exactly one step forward. This single comparison covers every failure mode:
  --   * an outdated client that omits the column  → NEW = OLD        → refused
  --   * a stale client proposing a version the server has already passed → refused
  --   * any arbitrary jump, backwards or forwards → refused
  if NEW.sync_version is distinct from OLD.sync_version + 1 then
    raise exception
      'LIFEOS_STALE_WRITE: % expected sync_version %, received %',
      TG_TABLE_NAME, OLD.sync_version + 1, NEW.sync_version
      using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

-- BEFORE UPDATE only. Inserts are untouched, so creating a record — including a
-- recurring action — works normally and starts at version 1.
drop trigger if exists next_actions_sync_version_guard on public.next_actions;
create trigger next_actions_sync_version_guard
  before update on public.next_actions
  for each row execute function public.enforce_sync_version();

drop trigger if exists notes_sync_version_guard on public.notes;
create trigger notes_sync_version_guard
  before update on public.notes
  for each row execute function public.enforce_sync_version();

-- -------------------------------------------------------------------- RPC ----
-- The trigger is the authority; this exists only so that ONE stale row does not
-- fail an entire batch. A plain bulk upsert is a single statement, so the
-- trigger's exception would roll back every unrelated current row with it —
-- undoing the per-domain isolation LIFEOS-074 D-22 established. This applies
-- rows one at a time and reports each outcome.
--
-- SECURITY INVOKER: it runs as the caller, so RLS remains the ownership
-- boundary exactly as it is for every other write. This function adds a
-- concurrency condition, never authority. There is no SECURITY DEFINER
-- anywhere in it and no path by which it can reach another user's row.
create or replace function public.push_guarded_rows(target text, payload jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  item        jsonb;
  merged      jsonb;
  current_row jsonb;
  accepted    jsonb := '[]'::jsonb;
  stale       jsonb := '[]'::jsonb;
  rec_id      uuid;
  hit         int;
begin
  if target not in ('next_actions', 'notes') then
    raise exception 'LIFEOS_UNGUARDED_TARGET: %', target using errcode = 'P0001';
  end if;

  for item in select * from jsonb_array_elements(payload) loop
    rec_id := (item->>'id')::uuid;

    -- Read the current row FIRST, under this caller's RLS, for two reasons:
    -- the payload is merged onto it so a partial update cannot null out columns
    -- it never mentioned, and it is the "current" value handed back when the
    -- write turns out to be stale — with no second round trip.
    execute format('select to_jsonb(t) from public.%I t where t.id = $1', target)
      into current_row using rec_id;
    merged := coalesce(current_row, '{}'::jsonb) || item;

    begin
      -- ON CONFLICT routes an existing id to the UPDATE branch, where the
      -- trigger judges it. An existing id carrying a wrong expected version can
      -- therefore never become an INSERT — the row is found, the update is
      -- attempted, and it is refused. That is invariant §14.
      --
      -- A brand-new row must arrive complete; the client's row mappers already
      -- emit every column, and `jsonb_populate_record` cannot fall back to a
      -- column default for a key it has been handed.
      execute format(
        'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)
         on conflict (id) do update set %s',
        target, target, public.guarded_assignments(target))
        using merged;

      get diagnostics hit = row_count;
      if hit = 1 then
        accepted := accepted || to_jsonb(rec_id);
      else
        -- RLS filtered it: not this user's row, so not ours to write.
        stale := stale || jsonb_build_object('id', rec_id, 'current', current_row);
      end if;
    exception when others then
      if sqlerrm like 'LIFEOS_STALE_WRITE%' then
        stale := stale || jsonb_build_object('id', rec_id, 'current', current_row);
      else
        raise;   -- a real failure is a real failure; never disguised as stale
      end if;
    end;
  end loop;

  return jsonb_build_object('accepted', accepted, 'stale', stale);
end;
$$;

-- Builds `col = excluded.col` for every column except the primary key and
-- user_id, which must never be reassigned by a payload.
create or replace function public.guarded_assignments(target text)
returns text
language sql
stable
as $$
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
  from information_schema.columns
  where table_schema = 'public' and table_name = target
    and column_name not in ('id', 'user_id');
$$;

revoke all on function public.push_guarded_rows(text, jsonb) from public;
grant execute on function public.push_guarded_rows(text, jsonb) to authenticated;
revoke all on function public.guarded_assignments(text) from public;
grant execute on function public.guarded_assignments(text) to authenticated;
