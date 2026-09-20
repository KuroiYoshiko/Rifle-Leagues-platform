-- Canonical fresh-install schema: profiles.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table "public"."profiles" (
  "id" uuid not null,
  "first_name" text,
  "last_name" text,
  "title" text,
  "address" text,
  "town" text,
  "county" text,
  "postcode" text,
  "phone_number" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

CREATE OR REPLACE FUNCTION private.handle_new_user_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    left(nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''), 100),
    left(nullif(btrim(new.raw_user_meta_data ->> 'last_name'), ''), 100)
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.set_profile_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


commit;

