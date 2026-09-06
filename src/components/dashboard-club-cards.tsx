import Link from "next/link";
import { LeaveClubButton } from "@/components/leave-club-button";
import { Badge, Card } from "@/components/ui";
import {
  getClubLocation,
  getClubRoleLabel,
  type Club,
  type ClubMembership,
} from "@/lib/clubs";
import type { ClubOperationalSummary } from "@/lib/club-operational-summaries";
import {
  clubOperationalStatusLabels,
  formatClubCutoffDate,
  formatClubCutoffDistance,
  getClubScoreManagementPath,
} from "@/lib/club-operational-summary-presentation";

export type DashboardClubMembership = ClubMembership & { club: Club };

const operationalStatusTones: Record<
  ClubOperationalSummary["attention_status"],
  "positive" | "warning" | "danger" | "neutral"
> = {
  all_on_track: "positive",
  action_needed: "warning",
  deadline_passed: "danger",
  no_active_scoring: "neutral",
};

export function DashboardClubCards({
  memberships,
  operationalSummaries = [],
}: {
  memberships: DashboardClubMembership[];
  operationalSummaries?: ClubOperationalSummary[];
}) {
  const hasMultipleClubs = memberships.length > 1;
  const summariesByClubId = new Map(
    operationalSummaries.map((summary) => [summary.club_id, summary]),
  );

  return (
    <div className={`grid gap-4 ${hasMultipleClubs ? "md:grid-cols-2" : ""}`}>
      {memberships.map((membership) => {
        const location = getClubLocation(membership.club);
        const summary = summariesByClubId.get(membership.club_id);
        const needsAttention =
          summary?.attention_status === "action_needed" ||
          summary?.attention_status === "deadline_passed";
        const managementPath = summary
          ? getClubScoreManagementPath(summary)
          : null;
        const statusTone = summary
          ? operationalStatusTones[summary.attention_status]
          : null;

        return (
          <Card
            key={membership.id}
            background="navigation"
            className="relative min-h-52 min-w-0 overflow-hidden border-0 p-5 text-white sm:p-6"
          >
            <div
              className={`target-mark pointer-events-none absolute aspect-square opacity-15 ${
                hasMultipleClubs
                  ? "-right-28 -top-24 w-80"
                  : "-right-36 -top-36 w-[31rem]"
              }`}
              aria-hidden="true"
            />
            <div className="relative flex h-full min-w-0 flex-col">
              <div className="flex min-h-11 flex-wrap items-start justify-between gap-2">
                <Badge tone="brand">{getClubRoleLabel(membership.role)}</Badge>
                <div className="flex items-start gap-1">
                  {summary && statusTone ? (
                    <Badge tone={statusTone}>
                      {clubOperationalStatusLabels[summary.attention_status]}
                    </Badge>
                  ) : null}
                  {membership.role === "owner" ? null : (
                    <LeaveClubButton
                      membershipId={membership.id}
                      clubName={membership.club.name}
                    />
                  )}
                </div>
              </div>
              <h2 className="mt-2 max-w-[88%] break-words text-xl font-semibold leading-7 tracking-[-0.025em] text-white">
                {membership.club.name}
              </h2>
              {location ? (
                <p className="mt-1.5 text-sm text-white/62">{location}</p>
              ) : null}
              {summary ? (
                <div className="mt-4 border-t border-white/10 pt-4">
                  {summary.attention_status === "no_active_scoring" ? (
                    <p className="text-sm text-white/60">No active Club scoring</p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-white">
                        {summary.incomplete_participant_count
                          ? `${summary.incomplete_participant_count} incomplete ${summary.incomplete_participant_count === 1 ? "participant" : "participants"}`
                          : "All required scores currently complete"}
                      </p>
                      {summary.competition_name && summary.round_number ? (
                        <p className="mt-1.5 text-xs font-medium text-white/72">
                          {summary.competition_name} · R{summary.round_number}
                        </p>
                      ) : null}
                      {summary.local_cutoff && summary.days_until_cutoff !== null ? (
                        <p className="mt-1 text-xs text-white/55">
                          {formatClubCutoffDate(summary.local_cutoff)} ·{" "}
                          {formatClubCutoffDistance(summary.days_until_cutoff)}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <Link
                  href={`/clubs/${membership.club.slug}`}
                  className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold shadow-sm shadow-black/10 transition ${
                    needsAttention && managementPath
                      ? "border border-white/15 bg-white/[.06] text-white hover:bg-white/[.12]"
                      : "bg-brand text-hero-background hover:bg-brand-subtle hover:text-brand-deep"
                  }`}
                >
                  View club <span className="ml-2" aria-hidden="true">→</span>
                </Link>
                {needsAttention && managementPath ? (
                  <Link
                    href={managementPath}
                    className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-hero-background shadow-sm shadow-black/10 transition hover:bg-brand-subtle hover:text-brand-deep"
                  >
                    Manage scores
                  </Link>
                ) : null}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
