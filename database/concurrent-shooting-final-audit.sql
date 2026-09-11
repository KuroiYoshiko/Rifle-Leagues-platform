-- Run after database/concurrent-shooting-management-ux.sql.
-- Final V1 integrity hardening: immutable shared provenance, archived score
-- locks, and lifecycle/score serialization. No existing rows are rewritten.

begin;

create or replace function private.protect_used_score_source_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.concurrent_shooting_round_id is not null then
      raise exception 'A physical Concurrent score source cannot be deleted.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if old.concurrent_shooting_round_id is not null and exists (
    select 1
    from public.concurrent_shooting_rounds as physical_round
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where physical_round.id = old.concurrent_shooting_round_id
      and group_row.status = 'archived'
  ) then
    raise exception 'Archived Concurrent score provenance is read-only.'
      using errcode = '22023';
  end if;

  if (new.shooter_profile_id, new.concurrent_shooting_round_id)
    is distinct from (old.shooter_profile_id, old.concurrent_shooting_round_id)
    and (old.concurrent_shooting_round_id is not null
      or new.concurrent_shooting_round_id is not null) then
    raise exception 'A physical Concurrent score source cannot be reassigned to another shooter or physical Concurrent Round.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_used_score_source_provenance
  on public.shooting_score_sources;
create trigger protect_used_score_source_provenance
  before delete or update
  on public.shooting_score_sources
  for each row execute function private.protect_used_score_source_provenance();

create or replace function private.protect_concurrent_score_usage_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_concurrent_round_id bigint;
  mapped_concurrent_round_id bigint;
  mapped_group_status text;
begin
  if tg_op = 'DELETE' then
    select source.concurrent_shooting_round_id
    into source_concurrent_round_id
    from public.shooting_score_sources as source
    where source.id = old.shooting_score_source_id;

    if source_concurrent_round_id is not null then
      raise exception 'Concurrent score usage provenance is immutable and cannot be unlinked.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (
    new.shooting_score_source_id,
    new.competition_id,
    new.competition_round_id,
    new.competition_entrant_participant_id,
    new.created_by,
    new.created_at
  ) is not distinct from (
    old.shooting_score_source_id,
    old.competition_id,
    old.competition_round_id,
    old.competition_entrant_participant_id,
    old.created_by,
    old.created_at
  ) then
    return new;
  end if;

  select source.concurrent_shooting_round_id
  into source_concurrent_round_id
  from public.shooting_score_sources as source
  where source.id = new.shooting_score_source_id;

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.shooting_score_sources as source
    where source.id in (old.shooting_score_source_id, new.shooting_score_source_id)
      and source.concurrent_shooting_round_id is not null
  ) then
    raise exception 'Concurrent score usage provenance is immutable and cannot be reassigned.'
      using errcode = '22023';
  end if;

  select mapping.concurrent_shooting_round_id, group_row.status
  into mapped_concurrent_round_id, mapped_group_status
  from public.concurrent_shooting_round_mappings as mapping
  join public.concurrent_shooting_rounds as physical_round
    on physical_round.id = mapping.concurrent_shooting_round_id
  join public.concurrent_shooting_groups as group_row
    on group_row.id = physical_round.concurrent_shooting_group_id
  where mapping.competition_id = new.competition_id
    and mapping.competition_round_id = new.competition_round_id
    and group_row.status in ('active', 'archived');

  if mapped_group_status = 'archived' then
    raise exception 'Archived Concurrent score provenance is read-only.'
      using errcode = '22023';
  end if;
  if mapped_group_status = 'active'
    and source_concurrent_round_id is distinct from mapped_concurrent_round_id then
    raise exception 'A mapped Concurrent Competition Round must use its physical Concurrent score source.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_concurrent_score_usage_provenance
  on public.competition_score_usages;
create trigger protect_concurrent_score_usage_provenance
  before insert or delete or update of shooting_score_source_id, competition_id,
    competition_round_id, competition_entrant_participant_id, created_by, created_at
  on public.competition_score_usages
  for each row execute function private.protect_concurrent_score_usage_provenance();

create or replace function private.protect_archived_concurrent_score_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id bigint := case when tg_op = 'DELETE'
    then old.shooting_score_source_id else new.shooting_score_source_id end;
begin
  if exists (
    select 1
    from public.shooting_score_sources as source
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = source.concurrent_shooting_round_id
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where source.id = source_id
      and group_row.status = 'archived'
  ) then
    raise exception 'Archived Concurrent score provenance is read-only.'
      using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_archived_concurrent_score_value
  on public.shooting_score_values;
create trigger protect_archived_concurrent_score_value
  before insert or update or delete on public.shooting_score_values
  for each row execute function private.protect_archived_concurrent_score_value();

-- Preserve the deployed Stage 2 implementations as private bases, then keep
-- their public signatures behind final lifecycle guards. The DO blocks make
-- this migration rerunnable.
do $$
begin
  if pg_catalog.to_regprocedure(
    'private.get_individual_competition_score_entry_base(bigint,bigint,bigint,bigint,bigint)'
  ) is null then
    alter function public.get_individual_competition_score_entry(
      bigint, bigint, bigint, bigint, bigint
    ) set schema private;
    alter function private.get_individual_competition_score_entry(
      bigint, bigint, bigint, bigint, bigint
    ) rename to get_individual_competition_score_entry_base;
  end if;
end;
$$;

create or replace function public.get_individual_competition_score_entry(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint,
  p_club_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  archived_mapping record;
begin
  result := private.get_individual_competition_score_entry_base(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_competition_round_id, p_club_id
  );

  select group_row.id as group_id, group_row.name as group_name,
    physical_round.id as physical_round_id,
    physical_round.label as physical_round_label
  into archived_mapping
  from public.concurrent_shooting_round_mappings as mapping
  join public.concurrent_shooting_rounds as physical_round
    on physical_round.id = mapping.concurrent_shooting_round_id
  join public.concurrent_shooting_groups as group_row
    on group_row.id = physical_round.concurrent_shooting_group_id
  where mapping.competition_id = p_competition_id
    and mapping.competition_round_id = p_competition_round_id
    and group_row.organisation_id = p_organisation_id
    and group_row.league_season_id = p_league_season_id
    and group_row.status = 'archived';

  if found then
    result := jsonb_set(result, '{can_edit}', 'false'::jsonb);
    result := jsonb_set(result, '{concurrent_shooting}', jsonb_build_object(
      'shared', true,
      'archived', true,
      'group_id', archived_mapping.group_id,
      'group_name', archived_mapping.group_name,
      'physical_round_id', archived_mapping.physical_round_id,
      'physical_round_label', archived_mapping.physical_round_label,
      'linked_competitions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'competition_id', linked.competition_id,
          'competition_name', competition.name,
          'competition_round_id', linked.competition_round_id,
          'round_number', round_row.round_number
        ) order by linked.competition_id)
        from public.concurrent_shooting_round_mappings as linked
        join public.competitions as competition on competition.id = linked.competition_id
        join public.competition_rounds as round_row on round_row.id = linked.competition_round_id
        where linked.concurrent_shooting_round_id = archived_mapping.physical_round_id
      ), '[]'::jsonb)
    ));
  end if;
  return result;
end;
$$;

do $$
begin
  if pg_catalog.to_regprocedure(
    'private.save_individual_competition_round_scores_base(bigint,bigint,bigint,bigint,bigint,jsonb)'
  ) is null then
    alter function public.save_individual_competition_round_scores(
      bigint, bigint, bigint, bigint, bigint, jsonb
    ) set schema private;
    alter function private.save_individual_competition_round_scores(
      bigint, bigint, bigint, bigint, bigint, jsonb
    ) rename to save_individual_competition_round_scores_base;
  end if;
end;
$$;

create or replace function public.save_individual_competition_round_scores(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint,
  p_club_id bigint,
  p_scores jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from private.require_individual_score_entry_context(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_competition_round_id, p_club_id
  );
  if exists (
    select 1
    from public.concurrent_shooting_round_mappings as mapping
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = mapping.concurrent_shooting_round_id
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where mapping.competition_id = p_competition_id
      and mapping.competition_round_id = p_competition_round_id
      and group_row.organisation_id = p_organisation_id
      and group_row.league_season_id = p_league_season_id
      and group_row.status = 'archived'
  ) then
    raise exception 'Archived Concurrent score provenance is read-only.'
      using errcode = '22023';
  end if;
  return private.save_individual_competition_round_scores_base(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_competition_round_id, p_club_id, p_scores
  );
end;
$$;

create or replace function public.cancel_concurrent_shooting_group_activation(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  physical_round_id bigint;
begin
  perform private.require_competition_author(p_organisation_id, true);
  if not exists (
    select 1 from public.concurrent_shooting_groups as group_row
    where group_row.id = p_concurrent_shooting_group_id
      and group_row.organisation_id = p_organisation_id
      and group_row.status = 'active'
  ) then
    raise exception 'Concurrent Shooting group must be active.' using errcode = '22023';
  end if;

  for physical_round_id in
    select physical_round.id
    from public.concurrent_shooting_rounds as physical_round
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    order by physical_round.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'concurrent-score:' || physical_round_id::text, 0
    ));
  end loop;

  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, true, 'active'
  );
  if exists (
    select 1
    from public.concurrent_shooting_group_competitions as member
    cross join lateral private.get_competition_effective_dates(member.competition_id) as effective
    where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and (effective.effective_starts_at is null or effective.effective_starts_at <= current_date)
  ) then
    raise exception 'Activation cannot be cancelled after a member Competition has started.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.shooting_score_sources as source
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = source.concurrent_shooting_round_id
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) or exists (
    select 1 from public.concurrent_shooting_round_mappings as mapping
    join public.competition_score_usages as usage
      on usage.competition_id = mapping.competition_id
      and usage.competition_round_id = mapping.competition_round_id
    where mapping.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) then
    raise exception 'Activation cannot be cancelled after score provenance exists.'
      using errcode = '22023';
  end if;
  update public.concurrent_shooting_groups
  set status = 'draft', compatibility_version = null,
    compatibility_signature = null, activated_at = null,
    updated_by = (select auth.uid())
  where id = p_concurrent_shooting_group_id;
end;
$$;

create or replace function public.archive_concurrent_shooting_group(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  physical_round_id bigint;
begin
  perform private.require_competition_author(p_organisation_id, true);
  if not exists (
    select 1 from public.concurrent_shooting_groups as group_row
    where group_row.id = p_concurrent_shooting_group_id
      and group_row.organisation_id = p_organisation_id
      and group_row.status = 'active'
  ) then
    raise exception 'Concurrent Shooting group must be active.' using errcode = '22023';
  end if;

  for physical_round_id in
    select physical_round.id
    from public.concurrent_shooting_rounds as physical_round
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    order by physical_round.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'concurrent-score:' || physical_round_id::text, 0
    ));
  end loop;

  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, true, 'active'
  );
  update public.concurrent_shooting_groups
  set status = 'archived', archived_at = clock_timestamp(),
    updated_by = (select auth.uid())
  where id = p_concurrent_shooting_group_id;
end;
$$;

revoke execute on function private.protect_used_score_source_provenance(),
  private.protect_concurrent_score_usage_provenance(),
  private.protect_archived_concurrent_score_value(),
  private.get_individual_competition_score_entry_base(bigint, bigint, bigint, bigint, bigint),
  private.save_individual_competition_round_scores_base(bigint, bigint, bigint, bigint, bigint, jsonb)
  from public, anon, authenticated;

revoke execute on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) to authenticated;

revoke execute on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) to authenticated;

revoke execute on function public.cancel_concurrent_shooting_group_activation(bigint, bigint),
  public.archive_concurrent_shooting_group(bigint, bigint)
  from public, anon;
grant execute on function public.cancel_concurrent_shooting_group_activation(bigint, bigint),
  public.archive_concurrent_shooting_group(bigint, bigint)
  to authenticated;

comment on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) is 'Authorised participant score entry with Active Concurrent sharing and explicit read-only Archived Concurrent metadata.';
comment on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) is 'Authorised score save; Archived Concurrent mapped Rounds are read-only and Active shared writes retain the Stage 2 transaction contract.';

commit;
