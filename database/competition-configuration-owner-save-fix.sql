-- Run after database/competition-configuration-save-fix.sql.
--
-- The schedule validator is a deferred constraint trigger. It can therefore
-- fire after the public SECURITY DEFINER Competition RPC has returned, when
-- the active role is authenticated again. Run the existing, fully qualified
-- validator with its owner's privileges so it can call the deliberately
-- private effective-date helper without granting private-schema access to
-- application roles.

begin;

alter function private.validate_final_competition_schedule()
  security definer;

alter function private.validate_final_competition_schedule()
  set search_path = '';

revoke execute on function private.validate_final_competition_schedule()
  from public, anon, authenticated;

comment on function private.validate_final_competition_schedule() is
  'Deferred Competition schedule validation. Runs as its owner because deferred execution occurs after the public RPC security context has ended.';

commit;
