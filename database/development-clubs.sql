-- Optional development/test data only.
-- Run database/clubs-and-memberships.sql first. This file is safe to rerun:
-- existing rows with the same slug are left unchanged.

begin;

insert into public.clubs (name, slug, town, county, postcode, website)
values
  (
    'Basildon Rifle and Pistol Club',
    'basildon-rifle-and-pistol-club',
    'Basildon',
    'Essex',
    'SS14 1DL',
    null
  ),
  (
    'Northbridge Target Shooting Club',
    'northbridge-target-shooting-club',
    'Northbridge',
    'North Yorkshire',
    'NB1 4RL',
    'https://example.com/northbridge'
  ),
  (
    'Westmere Smallbore Rifle Club',
    'westmere-smallbore-rifle-club',
    'Westmere',
    'Cumbria',
    'WM2 7TS',
    'https://example.com/westmere'
  )
on conflict (slug) do nothing;

commit;
