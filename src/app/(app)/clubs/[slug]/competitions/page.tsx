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
  type ClubCompetitionEntryCard,
} from "@/lib/competition-entries";
import { getClubPageContextBySlug, isClubManager } from "@/lib/clubs";
import { getCompetitionEntryFormatLabel } from "@/lib/competitions";
import {
  getLeagueSeasonPresentationPhase,
  getLeagueToday,
} from "@/lib/league-seasons";

export const metadata: Metadata = {
  title: "Club competitions",
};

const pastCompetitionsPerPage = 5;

function compareText(left: string, right: string) {
  return left.localeCompare(right, "en-GB", { sensitivity: "base" });
}

function compareEntriesByName(
  left: ClubCompetitionEntryCard,
  right: ClubCompetitionEntryCard,
) {
  return (
    compareText(left.competition_name, right.competition_name) ||
    left.entry_id - right.entry_id
  );
}

function compareNullableDateAscending(
  left: string | null,
  right: string | null,
) {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function compareNullableDateDescending(
  left: string | null,
  right: string | null,
) {
  if (left && right) return right.localeCompare(left);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function getRequestedPage(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^\d+$/.test(candidate)) return 1;

  const page = Number(candidate);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function paginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "end-ellipsis", totalPages] as const;
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "start-ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "start-ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "end-ellipsis",
    totalPages,
  ] as const;
}

function ClubCompetitionCard({
  entry,
  today,
  compact = false,
}: {
  entry: ClubCompetitionEntryCard;
  today: string;
  compact?: boolean;
}) {
  const competitionPath = `/organisations/${entry.organisation_slug}/leagues/${entry.league_season_slug}/competitions/${entry.competition_slug}`;
  const managementPath = `${competitionPath}/entry?entry=${entry.entry_id}`;
  const format = getCompetitionEntryFormatLabel(entry.entry_format);
  const scoreableSubmitted =
    entry.competition_status === "published" &&
    entry.entry_status === "submitted" &&
    entry.can_manage;
  const competitionStarted = Boolean(
    entry.competition_effective_starts_at &&
      today >= entry.competition_effective_starts_at,
  );
  const editableScoreRound = entry.score_rounds.find(
    (round) => today <= (round.shoot_by_date ?? round.deadline),
  );
  const viewScoreRound = entry.score_rounds.at(-1);
  const scoreRound = editableScoreRound ?? viewScoreRound;
  const scoreAction =
    scoreableSubmitted &&
    entry.local_scoring_enabled &&
    competitionStarted &&
    scoreRound
      ? editableScoreRound
        ? "manage"
        : "view"
      : null;
  const scoreManagementPath = scoreRound
    ? `${competitionPath}/scores?club=${entry.club_id}&round=${scoreRound.id}`
    : null;

  return (
    <Card className={compact ? "p-5 sm:p-6" : "p-6 sm:p-7"}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge
              tone={
                entry.entry_status === "submitted"
                  ? "positive"
                  : entry.entry_status === "draft"
                    ? "warning"
                    : "neutral"
              }
            >
              {getClubCompetitionEntryStatusLabel(entry.entry_status)}
            </Badge>
            {entry.entry_window_state === "closed" ? (
              <Badge tone="neutral">Entry closed</Badge>
            ) : null}
            {entry.is_user_entered && entry.entry_status === "submitted" ? (
              <Badge tone="brand">You are entered</Badge>
            ) : null}
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">
            {entry.league_season_name}
          </p>
          <h3 className="mt-1 break-words text-xl font-semibold tracking-[-0.025em] text-foreground">
            {entry.competition_name}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {entry.organisation_name}
          </p>
          <p className="mt-3 text-sm text-neutral-strong">
            {format}
            {entry.entry_format === "team"
              ? ` · ${entry.team_size} per team`
              : ""}
            {` · ${entry.entrant_count} entrant${entry.entrant_count === 1 ? "" : "s"}`}
            {` · ${entry.participant_count} shooter${entry.participant_count === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <Link
            href={competitionPath}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle sm:w-auto"
          >
            View competition
          </Link>
          {entry.can_manage ? (
            <Link
              href={managementPath}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep sm:w-auto"
            >
              {entry.entry_window_state === "open"
                ? entry.entry_status === "draft"
                  ? "Continue entry"
                  : "Manage entry"
                : "View entry"}
            </Link>
          ) : null}
          {scoreAction && scoreManagementPath ? (
            <Link
              href={scoreManagementPath}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep sm:w-auto"
            >
              {scoreAction === "manage" ? "Manage scores" : "View scores"}
            </Link>
          ) : null}
        </div>
      </div>
      {scoreableSubmitted && !entry.local_scoring_enabled ? (
        <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
          Scores for this Competition are entered by the organisation.
        </p>
      ) : scoreableSubmitted && !competitionStarted ? (
        <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
          Club score entry opens when the Competition starts.
        </p>
      ) : null}
    </Card>
  );
}

function CompetitionSection({
  id,
  title,
  description,
  entries,
  today,
  compact = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  entries: ClubCompetitionEntryCard[];
  today: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby={id}>
      <div className="mb-4">
        <h2
          id={id}
          className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground"
        >
          {title}
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="space-y-3">
        {entries.map((entry) => (
          <ClubCompetitionCard
            key={entry.entry_id}
            entry={entry}
            today={today}
            compact={compact}
          />
        ))}
      </div>
      {children}
    </section>
  );
}

function PastCompetitionPagination({
  clubSlug,
  currentPage,
  totalPages,
}: {
  clubSlug: string;
  currentPage: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const pageHref = (page: number) =>
    page === 1
      ? `/clubs/${clubSlug}/competitions`
      : `/clubs/${clubSlug}/competitions?pastPage=${page}`;
  const navigationClass =
    "inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-neutral-strong transition hover:bg-surface-muted";
  const disabledClass =
    "inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-neutral-strong opacity-45";

  return (
    <nav
      className="mt-5 flex flex-wrap items-center justify-center gap-2"
      aria-label="Past competitions pagination"
    >
      {currentPage > 1 ? (
        <Link href={pageHref(currentPage - 1)} className={navigationClass}>
          Previous
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true">
          Previous
        </span>
      )}
      {paginationItems(currentPage, totalPages).map((item) =>
        typeof item === "number" ? (
          <Link
            key={item}
            href={pageHref(item)}
            aria-label={`Go to past competitions page ${item}`}
            aria-current={item === currentPage ? "page" : undefined}
            className={`grid min-h-10 min-w-10 place-items-center rounded-xl border px-2 text-xs font-semibold transition ${
              item === currentPage
                ? "border-primary bg-primary text-primary-foreground!"
                : "border-border bg-surface text-neutral-strong hover:bg-surface-muted"
            }`}
          >
            {item}
          </Link>
        ) : (
          <span
            key={item}
            className="grid min-h-10 min-w-6 place-items-center text-xs text-muted-foreground"
            aria-hidden="true"
          >
            …
          </span>
        ),
      )}
      {currentPage < totalPages ? (
        <Link href={pageHref(currentPage + 1)} className={navigationClass}>
          Next
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}

export default async function ClubCompetitionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ pastPage?: string | string[] }>;
}) {
  const { slug } = await params;
  const { pastPage } = await searchParams;
  const context = await getClubPageContextBySlug(slug);

  if (!context) {
    notFound();
  }

  const { club, membership, informationCardCount } = context;
  const membershipIsActive = membership?.status === "active";
  const clubManager = isClubManager(membership);
  const entries = membershipIsActive
    ? await getClubCompetitionEntries(club.id)
    : [];
  const visibleEntries = entries.filter(
    (entry) => entry.entry_status !== "withdrawn",
  );
  const draftEntries = clubManager
    ? visibleEntries
        .filter((entry) => entry.entry_status === "draft" && entry.can_manage)
        .sort(
          (left, right) =>
            right.entry_updated_at.localeCompare(left.entry_updated_at) ||
            compareEntriesByName(left, right),
        )
    : [];
  const submittedEntries = visibleEntries.filter(
    (entry) => entry.entry_status === "submitted",
  );
  const today = getLeagueToday();
  const ongoingEntries: ClubCompetitionEntryCard[] = [];
  const upcomingEntries: ClubCompetitionEntryCard[] = [];
  const pastEntries: ClubCompetitionEntryCard[] = [];

  for (const entry of submittedEntries) {
    const phase = getLeagueSeasonPresentationPhase(
      {
        starts_at: entry.league_season_starts_at,
        ends_at: entry.league_season_ends_at,
      },
      today,
    );

    if (phase === "ended") {
      pastEntries.push(entry);
    } else if (phase === "upcoming") {
      upcomingEntries.push(entry);
    } else {
      // A submitted entry remains useful when one or both date boundaries
      // are absent. Keep it current without manufacturing presentation dates.
      ongoingEntries.push(entry);
    }
  }

  ongoingEntries.sort(
    (left, right) =>
      compareNullableDateAscending(
        left.league_season_ends_at,
        right.league_season_ends_at,
      ) || compareEntriesByName(left, right),
  );
  upcomingEntries.sort(
    (left, right) =>
      compareNullableDateAscending(
        left.league_season_starts_at,
        right.league_season_starts_at,
      ) || compareEntriesByName(left, right),
  );
  pastEntries.sort(
    (left, right) =>
      compareNullableDateDescending(
        left.league_season_ends_at,
        right.league_season_ends_at,
      ) || compareEntriesByName(left, right),
  );

  const totalPastPages = Math.ceil(
    pastEntries.length / pastCompetitionsPerPage,
  );
  const currentPastPage = Math.min(
    getRequestedPage(pastPage),
    Math.max(totalPastPages, 1),
  );
  const visiblePastEntries = pastEntries.slice(
    (currentPastPage - 1) * pastCompetitionsPerPage,
    currentPastPage * pastCompetitionsPerPage,
  );
  const hasVisibleEntries =
    draftEntries.length > 0 || submittedEntries.length > 0;

  return (
    <ClubPageFrame
      club={club}
      membership={membership}
      informationCardCount={informationCardCount}
      currentSection="competitions"
    >
      {membershipIsActive ? (
        hasVisibleEntries ? (
          <div className="space-y-10">
            {clubManager ? (
              <CompetitionSection
                id="entry-drafts-heading"
                title="Entry drafts"
                description="Private entries still being prepared by club management"
                entries={draftEntries}
                today={today}
              />
            ) : null}
            <CompetitionSection
              id="ongoing-competitions-heading"
              title="Ongoing competitions"
              description="Submitted entries in competitions currently in progress"
              entries={ongoingEntries}
              today={today}
            />
            <CompetitionSection
              id="upcoming-competitions-heading"
              title="Upcoming competitions"
              description="Submitted entries in competitions scheduled to start"
              entries={upcomingEntries}
              today={today}
            />
            <CompetitionSection
              id="past-competitions-heading"
              title="Past competitions"
              description="Submitted entries from completed seasons"
              entries={visiblePastEntries}
              today={today}
              compact
            >
              <PastCompetitionPagination
                clubSlug={club.slug}
                currentPage={currentPastPage}
                totalPages={totalPastPages}
              />
            </CompetitionSection>
          </div>
        ) : (
          <Card className="p-6 sm:p-8">
            <Badge tone="positive">Membership active</Badge>
            <h2 className="mt-3 font-semibold text-foreground">
              No competition entries yet
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {clubManager
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
