import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ClubMembershipPanel,
  ClubPageFrame,
} from "@/components/club-page-frame";
import { Badge, Card } from "@/components/ui";
import {
  getClubCompetitionEntries,
  getClubCompetitionEntryStatusLabel,
} from "@/lib/competition-entries";
import { getClubPageContextBySlug, isClubManager } from "@/lib/clubs";
import { getCompetitionEntryFormatLabel } from "@/lib/competitions";

export const metadata: Metadata = {
  title: "Club competitions",
};

export default async function ClubCompetitionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getClubPageContextBySlug(slug);

  if (!context) {
    notFound();
  }

  const { club, membership, informationCardCount } = context;
  const membershipIsActive = membership?.status === "active";
  const entries = membershipIsActive
    ? await getClubCompetitionEntries(club.id)
    : [];

  return (
    <ClubPageFrame
      club={club}
      membership={membership}
      informationCardCount={informationCardCount}
      currentSection="competitions"
    >
      {membershipIsActive ? (
        entries.length > 0 ? (
          <div className="space-y-4">
            {entries.map((entry) => {
              const competitionPath = `/organisations/${entry.organisation_slug}/leagues/${entry.league_season_slug}/competitions/${entry.competition_slug}`;
              const managementPath = `${competitionPath}/entry?entry=${entry.entry_id}`;
              const format = getCompetitionEntryFormatLabel(entry.entry_format);

              return (
                <Card key={entry.entry_id} className="p-6 sm:p-7">
                  <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <Badge tone={entry.entry_status === "submitted" ? "positive" : entry.entry_status === "draft" ? "warning" : "neutral"}>
                          {getClubCompetitionEntryStatusLabel(entry.entry_status)}
                        </Badge>
                        {entry.entry_window_state === "closed" ? <Badge tone="neutral">Entry closed</Badge> : null}
                        {entry.is_user_entered && entry.entry_status === "submitted" ? <Badge tone="brand">You are entered</Badge> : null}
                      </div>
                      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">{entry.league_season_name}</p>
                      <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-foreground">{entry.competition_name}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">{entry.organisation_name}</p>
                      <p className="mt-3 text-sm text-neutral-strong">
                        {format}{entry.entry_format === "team" ? ` · ${entry.team_size} per team` : ""} · {entry.participant_count} shooter{entry.participant_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3 sm:justify-end">
                      <Link href={competitionPath} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle">
                        View competition
                      </Link>
                      {entry.can_manage ? (
                        <Link href={managementPath} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep">
                          {entry.entry_window_state === "open" && entry.entry_status !== "withdrawn" ? "Manage entry" : "View entry"}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="p-6 sm:p-8">
            <Badge tone="positive">Membership active</Badge>
            <h2 className="mt-3 font-semibold text-foreground">No competition entries yet</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {isClubManager(membership)
                ? "Entries you start for this club will appear here. Browse a published competition to begin."
                : "Submitted competitions for this club will appear here when an owner or official completes the entry."}
            </p>
          </Card>
        )
      ) : (
        <>
          <ClubMembershipPanel club={club} membership={membership} />
          <Card className="mt-6 bg-surface-muted p-6 sm:p-8">
            <h2 className="font-semibold text-foreground">
              Club competitions require active membership
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              This member-facing area becomes available when your membership in
              this club is active.
            </p>
            <Link
              href={`/clubs/${club.slug}`}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
            >
              Return to club overview
            </Link>
          </Card>
        </>
      )}
    </ClubPageFrame>
  );
}
