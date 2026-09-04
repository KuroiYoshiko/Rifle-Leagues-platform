-- Run after database/competition-scores.sql.
--
-- The score save RPC is SECURITY DEFINER, but its initially deferred X-total
-- constraint trigger fires at the end of the transaction as the role that
-- queued it. Authenticated clients intentionally have no direct privileges on
-- the source-score tables, so the trigger's validation query otherwise fails
-- with SQLSTATE 42501 after an otherwise-authorised save.

begin;

alter function private.validate_shooting_score_x_total()
  security definer;

-- Retain the hardened lookup environment explicitly for rerunnable installs.
alter function private.validate_shooting_score_x_total()
  set search_path = '';

revoke execute on function private.validate_shooting_score_x_total()
  from public, anon, authenticated;

commit;
