-- Run after database/competition-configuration-refactor.sql.
--
-- Focused, rerunnable repair for the deferred schedule validator. The same
-- trigger function is attached to both competitions and competition_rounds,
-- so it must only access fields that exist on the table currently firing it.

begin;

create or replace function private.validate_final_competition_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competition_id bigint;
  v_number_of_rounds integer;
  v_effective_starts_at date;
begin
  if tg_table_name = 'competitions' then
    v_competition_id := coalesce(new.id, old.id);
  else
    v_competition_id := coalesce(new.competition_id, old.competition_id);
  end if;

  select competition.number_of_rounds, effective.effective_starts_at
  into v_number_of_rounds, v_effective_starts_at
  from public.competitions as competition
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where competition.id = v_competition_id;

  if v_number_of_rounds is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if exists (
    select 1
    from (
      select round.round_number, round.deadline,
        lag(round.deadline) over (order by round.round_number) as previous_deadline
      from public.competition_rounds as round
      where round.competition_id = v_competition_id
    ) as schedule
    where schedule.round_number > v_number_of_rounds
      or (schedule.previous_deadline is not null and schedule.deadline < schedule.previous_deadline)
      or (
        v_effective_starts_at is not null
        and (
          (schedule.round_number = 1 and schedule.deadline <= v_effective_starts_at)
          or (schedule.round_number > 1 and schedule.deadline < v_effective_starts_at)
        )
      )
  ) then
    raise exception 'The final round schedule is outside the Competition bounds or moves backwards.'
      using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function private.validate_final_competition_schedule()
  from public, anon, authenticated;

comment on function private.validate_final_competition_schedule() is
  'Deferred schedule validation shared safely by competitions and competition_rounds triggers.';

-- Exercise the competitions-specific trigger branch without touching any
-- persisted Competition. The temporary table deliberately shares the table
-- name used by TG_TABLE_NAME; public lookups inside the function stay qualified.
create temporary table competitions (id bigint) on commit drop;
create trigger verify_competition_schedule_trigger_branch
  after update on competitions
  for each row execute function private.validate_final_competition_schedule();
insert into competitions (id) values (0);
update competitions set id = id;
drop table competitions;

commit;
