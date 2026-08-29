-- Optional development/test data only.
-- Run database/organisations.sql first. This file is safe to rerun:
-- an existing organisation with the same slug is left unchanged.

begin;

insert into public.organisations (
  name,
  slug,
  short_name,
  description,
  website,
  contact_email
)
values (
  'Eastern Region Shooting Association',
  'eastern-region-shooting-association',
  'Eastern Region',
  'A regional league organisation supporting target shooting competitions and public league information.',
  'https://example.com/eastern-region',
  'leagues@example.com'
)
on conflict (slug) do nothing;

commit;
