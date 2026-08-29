export const CLUB_STATUSES = ["active", "inactive"] as const;
export const MEMBERSHIP_STATUSES = ["pending", "active", "rejected"] as const;

export type ClubStatus = (typeof CLUB_STATUSES)[number];
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export type Club = {
  id: number;
  name: string;
  slug: string;
  town: string | null;
  county: string | null;
  postcode: string | null;
  website: string | null;
};

export type ClubMembership = {
  id: number;
  club_id: number;
  status: MembershipStatus;
  created_at: string;
  club: Club | null;
};

export type DashboardMembershipState =
  | { kind: "none" }
  | { kind: "pending"; membership: ClubMembership & { club: Club } }
  | { kind: "rejected"; membership: ClubMembership & { club: Club } }
  | { kind: "active"; membership: ClubMembership & { club: Club } };

export function getClubLocation(
  club: Pick<Club, "town" | "county">,
): string | null {
  return [club.town, club.county].filter(Boolean).join(", ") || null;
}

export function getDashboardMembershipState(
  memberships: ClubMembership[] | null | undefined,
): DashboardMembershipState {
  const activeMembership = memberships?.find(
    (membership) => membership.status === "active" && membership.club,
  );

  if (activeMembership?.club) {
    return {
      kind: "active",
      membership: activeMembership as ClubMembership & { club: Club },
    };
  }

  const pendingMembership = memberships?.find(
    (membership) => membership.status === "pending" && membership.club,
  );

  if (pendingMembership?.club) {
    return {
      kind: "pending",
      membership: pendingMembership as ClubMembership & { club: Club },
    };
  }

  const rejectedMembership = memberships?.find(
    (membership) => membership.status === "rejected" && membership.club,
  );

  if (rejectedMembership?.club) {
    return {
      kind: "rejected",
      membership: rejectedMembership as ClubMembership & { club: Club },
    };
  }

  return { kind: "none" };
}
