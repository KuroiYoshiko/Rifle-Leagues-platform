import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { DashboardClubMembership } from "@/components/dashboard-club-cards";
import {
  OverviewDashboard,
  type OverviewCompetitionGroups,
} from "@/components/overview-dashboard";
import type { ClubMembership } from "@/lib/clubs";
import { getClubOperationalSummaries } from "@/lib/club-operational-summaries";
import { sortClubOperationalSummaries } from "@/lib/club-operational-summary-presentation";
import {
  getMyShootingCompetitions,
  groupMyShootingCompetitions,
} from "@/lib/my-shooting-competitions";
import {
  getMyShooterAnalytics,
  parseShooterAnalyticsFilters,
} from "@/lib/shooter-analytics";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Overview",
};

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasClub(
  membership: ClubMembership,
): membership is DashboardClubMembership {
  return membership.club !== null;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) redirect("/login");

  const analyticsFilters = parseShooterAnalyticsFilters({}).rpc;
  const [
    profileResult,
    membershipsResult,
    competitionsResult,
    analyticsResult,
    managementResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name")
      .eq("id", claims.sub)
      .maybeSingle(),
    supabase
      .from("club_memberships")
      .select(`
        id,
        club_id,
        status,
        role,
        created_at,
        club:clubs!inner (
          id,
          name,
          slug,
          town,
          county,
          postcode,
          website
        )
      `)
      .eq("user_id", claims.sub)
      .eq("status", "active")
      .eq("club.status", "active")
      .order("created_at", { ascending: false }),
    getMyShootingCompetitions()
      .then((data) => ({ data, error: null }))
      .catch((error: unknown) => ({ data: null, error })),
    getMyShooterAnalytics(analyticsFilters)
      .then((data) => ({ data, error: null }))
      .catch((error: unknown) => ({ data: null, error })),
    getClubOperationalSummaries()
      .then((data) => ({ data, error: null }))
      .catch((error: unknown) => ({ data: null, error })),
  ]);

  const memberships = (
    membershipsResult.data as unknown as ClubMembership[] | null
  )?.filter(hasClub) ?? [];
  const activeMemberships = memberships.sort((left, right) =>
    left.club.name.localeCompare(right.club.name, "en-GB", {
      sensitivity: "base",
    }),
  );
  const managementSummaries = sortClubOperationalSummaries(
    managementResult.data ?? [],
  );
  const competitionGroups: OverviewCompetitionGroups | null =
    competitionsResult.data
      ? groupMyShootingCompetitions(competitionsResult.data)
      : null;
  const profile = profileResult.data as { first_name: string | null } | null;
  const firstName =
    profile?.first_name?.trim() ||
    metadataValue(claims.user_metadata, "first_name") ||
    "Shooter";

  return (
    <OverviewDashboard
      firstName={firstName}
      competitionGroups={competitionGroups}
      competitionAsOfDate={competitionsResult.data?.as_of_date ?? null}
      analytics={analyticsResult.data}
      memberships={activeMemberships}
      membershipsAvailable={!membershipsResult.error}
      managementSummaries={managementSummaries}
    />
  );
}
