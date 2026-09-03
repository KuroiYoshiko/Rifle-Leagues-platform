import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  getDivisionParticipantName,
  type PublishedCompetitionDivisions,
} from "@/lib/competition-division-types";

export function PublishedCompetitionDivisionsView({
  data,
}: {
  data: PublishedCompetitionDivisions;
}) {
  const visibleDivisions = data.divisions.filter(
    (division) => division.entrants.length > 0,
  );
  const yourDivision = visibleDivisions.find((division) =>
    division.entrants.some((entrant) => entrant.is_current_user),
  );

  return (
    <section className="mt-10" aria-label="Published divisions">
      <SectionHeader
        title="Divisions"
        description={
          yourDivision
            ? `Your division: ${yourDivision.name}`
            : "Complete published competition allocation"
        }
      />
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {visibleDivisions.map((division) => (
          <Card key={division.id} className="min-w-0 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-foreground">
                {division.name}
              </h3>
              <Badge tone="positive">Published</Badge>
            </div>
            <ul className="mt-4 space-y-2">
              {division.entrants.map((entrant) => (
                <li key={entrant.id} className="rounded-xl bg-surface-muted px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {entrant.participants.map(getDivisionParticipantName).join(" · ")}
                    </span>
                    {entrant.is_current_user ? <Badge tone="brand">You</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entrant.club_name}</p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </section>
  );
}
