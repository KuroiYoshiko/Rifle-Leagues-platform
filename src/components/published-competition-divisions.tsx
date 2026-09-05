import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  getDivisionParticipantName,
  type PublishedCompetitionDivisions,
} from "@/lib/competition-division-types";

export function PublishedCompetitionDivisionsView({
  data,
  collapseRoster = false,
}: {
  data: PublishedCompetitionDivisions;
  collapseRoster?: boolean;
}) {
  const visibleDivisions = data.divisions.filter(
    (division) => division.entrants.length > 0,
  );
  const entrantCount = visibleDivisions.reduce(
    (total, division) => total + division.entrants.length,
    0,
  );
  const yourDivision = visibleDivisions.find((division) =>
    division.entrants.some((entrant) => entrant.is_current_user),
  );
  const description = `${visibleDivisions.length} published division${visibleDivisions.length === 1 ? "" : "s"} · ${entrantCount} entrant${entrantCount === 1 ? "" : "s"}${yourDivision ? ` · Your division: ${yourDivision.name}` : ""}`;

  const rosters = visibleDivisions.length ? (
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
      {visibleDivisions.map((division) => (
        <Card key={division.id} className="min-w-0 p-4 shadow-none sm:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold text-foreground">{division.name}</h3>
            <span className="text-xs text-muted-foreground">
              {division.entrants.length} entrant
              {division.entrants.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {division.entrants.map((entrant) => (
              <li key={entrant.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {entrant.participants
                      .map(getDivisionParticipantName)
                      .join(" · ")}
                  </span>
                  {entrant.is_current_user ? (
                    <Badge tone="brand">You</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {entrant.club_name}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  ) : (
    <Card className="p-5 text-sm text-muted-foreground">
      No published division entrants yet.
    </Card>
  );

  return (
    <section className="mt-8" aria-label="Published divisions">
      <SectionHeader title="Divisions" description={description} />
      {collapseRoster && visibleDivisions.length ? (
        <Card className="overflow-hidden">
          <details className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-sm font-semibold text-brand-deep outline-none transition hover:bg-brand-subtle/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
              <span>View division rosters</span>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="size-5 shrink-0 transition-transform group-open:rotate-180"
              >
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <div className="border-t border-border bg-surface-muted/35 p-3 sm:p-4">
              {rosters}
            </div>
          </details>
        </Card>
      ) : (
        rosters
      )}
    </section>
  );
}
