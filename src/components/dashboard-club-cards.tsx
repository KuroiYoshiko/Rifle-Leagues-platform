import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import {
  getClubLocation,
  getClubRoleLabel,
  type Club,
  type ClubMembership,
} from "@/lib/clubs";

export type DashboardClubMembership = ClubMembership & { club: Club };

export function DashboardClubCards({
  memberships,
}: {
  memberships: DashboardClubMembership[];
}) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {memberships.map((membership) => {
        const location = getClubLocation(membership.club);

        return (
          <Card key={membership.id} className="min-w-0 p-4 sm:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-subtle text-xs font-bold text-brand-deep"
                aria-hidden="true"
              >
                {membership.club.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="min-w-0 break-words text-sm font-semibold text-foreground">
                    {membership.club.name}
                  </h3>
                  <Badge tone="neutral">{getClubRoleLabel(membership.role)}</Badge>
                </div>
                {location ? (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {location}
                  </p>
                ) : null}
                <Link
                  href={`/clubs/${membership.club.slug}`}
                  className="mt-3 inline-flex min-h-9 items-center text-xs font-semibold text-brand-strong transition hover:text-brand-deep hover:underline"
                >
                  View club <span className="ml-1.5" aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
