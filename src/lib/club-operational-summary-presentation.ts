import type {
  ClubOperationalStatus,
  ClubOperationalSummary,
} from "@/lib/club-operational-summaries";

const statusPriority: Record<ClubOperationalStatus, number> = {
  deadline_passed: 0,
  action_needed: 1,
  all_on_track: 2,
  no_active_scoring: 3,
};

const cutoffFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export const clubOperationalStatusLabels: Record<
  ClubOperationalStatus,
  string
> = {
  all_on_track: "All on track",
  action_needed: "Action needed",
  deadline_passed: "Deadline passed",
  no_active_scoring: "No active scoring",
};

export function sortClubOperationalSummaries(
  summaries: ClubOperationalSummary[],
) {
  return [...summaries].sort(
    (left, right) =>
      statusPriority[left.attention_status] -
        statusPriority[right.attention_status] ||
      (left.local_cutoff ?? "9999-12-31").localeCompare(
        right.local_cutoff ?? "9999-12-31",
      ) ||
      left.club_name.localeCompare(right.club_name, "en-GB", {
        sensitivity: "base",
      }),
  );
}

export function formatClubCutoffDate(value: string) {
  return cutoffFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function formatClubCutoffDistance(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  if (days === -1) return "passed yesterday";
  return `passed ${Math.abs(days)} days ago`;
}

export function getClubScoreManagementPath(
  summary: ClubOperationalSummary,
) {
  if (
    !summary.organisation_slug ||
    !summary.league_season_slug ||
    !summary.competition_slug ||
    !summary.competition_round_id
  ) {
    return null;
  }

  return `/organisations/${summary.organisation_slug}/leagues/${summary.league_season_slug}/competitions/${summary.competition_slug}/scores?club=${summary.club_id}&round=${summary.competition_round_id}`;
}
