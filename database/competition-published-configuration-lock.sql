-- Run AFTER database/competition-series-management.sql.
--
-- Published Competitions may still receive administrative/content edits through
-- the canonical update RPC, but their sporting configuration must first pass
-- through the controlled Return to Draft lifecycle. This applies equally to
-- one-off, historical/unlinked, and Competition Series editions.

begin;

create or replace function private.protect_published_competition_configuration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'published'
    and (
      new.entry_format,
      new.team_size,
      new.discipline_code,
      new.discipline_detail,
      new.sets_per_round,
      new.shots_per_round,
      new.scoring_method,
      new.maximum_score_per_round,
      new.ranking_method,
      new.best_rounds_count,
      new.uses_x_score,
      new.number_of_rounds
    ) is distinct from (
      old.entry_format,
      old.team_size,
      old.discipline_code,
      old.discipline_detail,
      old.sets_per_round,
      old.shots_per_round,
      old.scoring_method,
      old.maximum_score_per_round,
      old.ranking_method,
      old.best_rounds_count,
      old.uses_x_score,
      old.number_of_rounds
    ) then
    raise exception 'Published Competition sporting configuration is locked. Return the Competition to draft before changing it.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function private.protect_published_competition_configuration()
  from public, anon, authenticated;

drop trigger if exists protect_published_competition_configuration
  on public.competitions;
create trigger protect_published_competition_configuration
  before update of
    entry_format,
    team_size,
    discipline_code,
    discipline_detail,
    sets_per_round,
    shots_per_round,
    scoring_method,
    maximum_score_per_round,
    ranking_method,
    best_rounds_count,
    uses_x_score,
    number_of_rounds
  on public.competitions
  for each row execute function private.protect_published_competition_configuration();

-- The parent-status lookup must not disappear behind a caller's RLS-visible
-- subset. The fixed search path and fully qualified relation keep this narrow
-- SECURITY DEFINER trigger independent of application read permissions.
create or replace function private.protect_published_competition_component()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and (
      new.competition_id,
      new.position,
      new.short_label,
      new.maximum_score,
      new.score_method
    ) is not distinct from (
      old.competition_id,
      old.position,
      old.short_label,
      old.maximum_score,
      old.score_method
    ) then
    return new;
  end if;

  perform competition.id
  from public.competitions as competition
  where competition.status = 'published'
    and competition.id = any (
      case tg_op
        when 'INSERT' then array[new.competition_id]
        when 'DELETE' then array[old.competition_id]
        else array[old.competition_id, new.competition_id]
      end
    )
  for share;

  if found then
    raise exception 'Published Competition Course of Fire is locked. Return the Competition to draft before changing it.'
      using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function private.protect_published_competition_component()
  from public, anon, authenticated;

drop trigger if exists protect_published_competition_component
  on public.competition_score_components;
create trigger protect_published_competition_component
  before insert or update or delete
  on public.competition_score_components
  for each row execute function private.protect_published_competition_component();

comment on function private.protect_published_competition_configuration() is
  'Blocks sporting-column changes while a Competition is published; status-only Return to Draft and administrative/content edits remain available.';
comment on function private.protect_published_competition_component() is
  'Blocks Course-of-Fire structure, order, label, maximum, and scoring-method changes while a Competition is published.';

commit;
