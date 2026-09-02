import Link from "next/link";
import type { ReactNode } from "react";
import { LeaveClubButton } from "@/components/leave-club-button";
import { MembershipRequestButton } from "@/components/membership-request-button";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  getClubLocation,
  getClubRoleLabel,
  isClubManager,
  type Club,
  type ClubMembership,
  type MembershipStatus,
} from "@/lib/clubs";

export type ClubSection =
  | "overview"
  | "competitions"
  | "members"
  | "information"
  | "settings";

const sectionItems: Array<{
  id: ClubSection;
  label: string;
  suffix: string;
}> = [
  { id: "overview", label: "Overview", suffix: "" },
  { id: "competitions", label: "Competitions", suffix: "/competitions" },
  { id: "members", label: "Members", suffix: "/members" },
  { id: "information", label: "Information", suffix: "/information" },
  { id: "settings", label: "Club settings", suffix: "/settings" },
];

export function ClubPageFrame({
  club,
  membership,
  informationCardCount,
  currentSection,
  children,
}: {
  club: Club;
  membership: ClubMembership | null;
  informationCardCount: number;
  currentSection: ClubSection;
  children: ReactNode;
}) {
  const basePath = `/clubs/${club.slug}`;
  const membershipIsActive = membership?.status === "active";
  const membershipIsManager = isClubManager(membership);
  const membershipIsOwner = membershipIsActive && membership?.role === "owner";
  const location = getClubLocation(club);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-brand-strong">
            {membershipIsActive ? "Member club" : "Club information"}
          </p>
          <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
            {club.name}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {location ?? club.postcode ?? "Location not yet provided"}
          </p>
        </div>
        <Link
          href="/clubs"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
        >
          Browse clubs
        </Link>
      </div>

      {membershipIsActive ? (
        <nav
          className="club-section-navigation mt-8 overflow-x-auto rounded-2xl border border-border bg-surface p-2 shadow-xs"
          aria-label={`${club.name} sections`}
        >
          <div className="flex min-w-max gap-1">
            {sectionItems
              .filter(
                (item) =>
                  (item.id === "information"
                    ? membershipIsOwner || informationCardCount > 0
                    : membershipIsManager ||
                      (item.id !== "members" && item.id !== "settings")),
              )
              .map((item) => {
              const isActive = item.id === currentSection;

              return (
                <Link
                  key={item.id}
                  href={`${basePath}${item.suffix}`}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold transition ${
                    isActive
                      ? "bg-brand-subtle text-brand-deep"
                      : "text-neutral-strong hover:bg-brand-subtle hover:text-brand-deep"
                  }`}
                >
                  {item.label}
                </Link>
              );
              })}
          </div>
        </nav>
      ) : null}

      <div className="mt-8">{children}</div>
    </div>
  );
}

const membershipCopy: Record<
  Exclude<MembershipStatus, "active">,
  { title: string; description: string; mark: string }
> = {
  pending: {
    title: "Membership request pending",
    description:
      "Your request has been sent and is waiting for the club’s membership process.",
    mark: "P",
  },
  rejected: {
    title: "Membership request declined",
    description:
      "This request was not approved. You can send the request again when you are ready.",
    mark: "R",
  },
  left: {
    title: "Former membership",
    description:
      "You previously left this club. You can request to become a member again.",
    mark: "L",
  },
};

export function ClubMembershipPanel({
  club,
  membership,
}: {
  club: Club;
  membership: ClubMembership | null;
}) {
  if (membership?.status === "active") {
    return (
      <section aria-labelledby="club-membership-heading">
        <SectionHeader
          title="Membership"
          description="Your current relationship with this club"
        />
        <Card
          background="navigation"
          className="relative overflow-hidden border-0 p-6 text-white sm:p-8"
        >
          <div className="target-mark absolute -right-36 -top-36 aspect-square w-[31rem] opacity-15" />
          <div className="relative flex items-start justify-between gap-5">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="positive">Active</Badge>
                <Badge tone="brand">{getClubRoleLabel(membership.role)}</Badge>
              </div>
              <h2 id="club-membership-heading" className="mt-3 text-xl font-semibold">
                Active club membership
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/62">
                You can access this club’s member-facing Overview and Competitions
                areas.
              </p>
            </div>
            {membership.role === "owner" ? (
              <p className="max-w-52 text-right text-xs leading-5 text-white/55">
                Transfer ownership before leaving this club.
              </p>
            ) : (
              <LeaveClubButton
                membershipId={membership.id}
                clubName={club.name}
              />
            )}
          </div>
        </Card>
      </section>
    );
  }

  const state = membership
    ? membershipCopy[membership.status]
    : {
        title: "No membership",
        description:
          "You can review this club’s public details before requesting membership.",
        mark: "C",
      };

  return (
    <section aria-labelledby="club-membership-heading">
      <SectionHeader
        title="Membership"
        description="Your current relationship with this club"
      />
      <Card className="p-6 sm:p-8">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex items-start gap-4">
            <span
              className={`grid size-11 shrink-0 place-items-center rounded-xl text-sm font-bold ${
                membership?.status === "pending"
                  ? "bg-warning-subtle text-warning"
                  : membership?.status === "rejected"
                    ? "bg-danger-subtle text-danger"
                    : "bg-surface-muted text-neutral-strong"
              }`}
              aria-hidden="true"
            >
              {state.mark}
            </span>
            <div>
              <h2 id="club-membership-heading" className="font-semibold text-foreground">
                {state.title}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {state.description}
              </p>
            </div>
          </div>
          <MembershipRequestButton
            clubId={club.id}
            currentStatus={membership?.status}
            showDeclinedLabel={false}
          />
        </div>
      </Card>
    </section>
  );
}
