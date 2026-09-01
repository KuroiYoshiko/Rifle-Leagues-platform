import Link from "next/link";
import { LeaveClubButton } from "@/components/leave-club-button";
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
  const hasMultipleClubs = memberships.length > 1;

  return (
    <div className={`grid gap-4 ${hasMultipleClubs ? "md:grid-cols-2" : ""}`}>
      {memberships.map((membership) => {
        const location = getClubLocation(membership.club);

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
              <div className="self-start">
                <Badge tone="brand">{getClubRoleLabel(membership.role)}</Badge>
              </div>
              {membership.role === "owner" ? null : (
                <div className="absolute right-0 top-0 z-10">
                  <LeaveClubButton
                    membershipId={membership.id}
                    clubName={membership.club.name}
                  />
                </div>
              )}
              <h2 className="mt-4 max-w-[88%] break-words text-xl font-semibold leading-7 tracking-[-0.025em] text-white">
                {membership.club.name}
              </h2>
              {location ? (
                <p className="mt-1.5 text-sm text-white/62">{location}</p>
              ) : null}
              <Link
                href={`/clubs/${membership.club.slug}`}
                className="mt-6 inline-flex min-h-11 items-center self-start rounded-xl bg-brand px-4 text-sm font-semibold text-hero-background shadow-sm shadow-black/10 transition hover:bg-brand-subtle hover:text-brand-deep"
              >
                View club
                <span className="ml-2" aria-hidden="true">
                  →
                </span>
              </Link>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
