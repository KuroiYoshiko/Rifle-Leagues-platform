import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const CLUB_STATUSES = ["active", "inactive"] as const;
export const MEMBERSHIP_STATUSES = [
  "pending",
  "active",
  "rejected",
  "left",
] as const;

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

export type SidebarClub = Pick<Club, "id" | "name" | "slug">;

export type ClubPageContext = {
  club: Club;
  membership: ClubMembership | null;
};

export const clubColumns =
  "id, name, slug, town, county, postcode, website";

const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  // The schema supports multiple clubs per user. Until a club switcher exists,
  // the dashboard presents the first row in the highest-priority current state.
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

export const getClubPageContextBySlug = cache(async (slug: string) => {
  if (slug.length > 180 || !routeSafeSlugPattern.test(slug)) {
    return null;
  }

  const supabase = await createClient();
  const [claimsResult, clubResult] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("clubs")
      .select(clubColumns)
      .eq("slug", slug)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const userId = claimsResult.data?.claims?.sub;

  if (claimsResult.error || !userId) {
    throw new Error("Your session could not be verified.");
  }

  if (clubResult.error) {
    throw new Error("The club could not be loaded.");
  }

  if (!clubResult.data) {
    return null;
  }

  const club = clubResult.data as Club;
  const { data: membershipData, error: membershipError } = await supabase
    .from("club_memberships")
    .select("id, club_id, status, created_at")
    .eq("club_id", club.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error("Your club membership status could not be loaded.");
  }

  const membership = membershipData
    ? ({ ...membershipData, club } as ClubMembership)
    : null;

  return { club, membership } satisfies ClubPageContext;
});
