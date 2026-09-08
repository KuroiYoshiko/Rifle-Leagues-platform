-- Stage 2 UI support. Run AFTER database/competition-series-management.sql.
-- Adds only the owner-authorised Series rename operation needed by management UI.
begin;

create or replace function public.rename_competition_series(
  p_organisation_id bigint,
  p_competition_series_id bigint,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_result jsonb;
begin
  v_actor_id := private.require_competition_author(p_organisation_id, true);

  if char_length(v_name) not between 2 and 160 then
    raise exception 'Series name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  update public.competition_series
  set name = v_name,
      updated_by = v_actor_id
  where id = p_competition_series_id
    and organisation_id = p_organisation_id
  returning jsonb_build_object('id', id, 'name', name) into v_result;

  if v_result is null then
    raise exception 'Series not found in this Organisation.' using errcode = '22023';
  end if;

  return v_result;
end;
$$;

revoke all on function public.rename_competition_series(bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function public.rename_competition_series(bigint, bigint, text)
  to authenticated;

comment on function public.rename_competition_series(bigint, bigint, text) is
  'Renames a Competition Series after exact active Organisation owner authorisation. Its immutable slug and sporting identity are unchanged.';

commit;
