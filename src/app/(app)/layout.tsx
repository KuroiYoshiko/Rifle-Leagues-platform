import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { SidebarClub } from "@/lib/clubs";
import type { SidebarOrganisation } from "@/lib/organisations";
import type { Profile } from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default async function ApplicationLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    redirect("/login");
  }

  const [
    profileResult,
    myOrganisationsResult,
    clubMembershipsResult,
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", claims.sub)
        .maybeSingle(),
      supabase.rpc("get_my_organisations"),
      supabase
        .from("club_memberships")
        .select(`
        role,
        club:clubs!inner (
          id,
          name,
          slug
        )
      `)
        .eq("user_id", claims.sub)
        .eq("status", "active")
        .eq("club.status", "active"),
    ]);
  const profileData = profileResult.data;
  const profile = profileData as Pick<
    Profile,
    "first_name" | "last_name"
  > | null;
  if (myOrganisationsResult.error) {
    throw new Error("Organisation navigation could not be loaded.");
  }

  const myOrganisationRows = (myOrganisationsResult.data ?? []) as Array<{
    id: number;
    name: string;
    slug: string;
    management_role: SidebarOrganisation["managementRole"];
  }>;
  const organisations = myOrganisationRows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    managementRole: row.management_role,
  }));
  const clubMembershipRows = (clubMembershipsResult.data ?? []) as unknown as Array<{
    role: SidebarClub["role"];
    club: Pick<SidebarClub, "id" | "name" | "slug"> | null;
  }>;
  const clubIds = clubMembershipRows.flatMap((row) =>
    row.club ? [row.club.id] : [],
  );
  const informationCardsResult =
    clubIds.length > 0
      ? await supabase
          .from("club_information_cards")
          .select("club_id")
          .in("club_id", clubIds)
      : { data: [], error: null };

  if (informationCardsResult.error) {
    throw new Error("Club information navigation could not be loaded.");
  }

  const informationCountByClub = new Map<number, number>();
  for (const card of informationCardsResult.data ?? []) {
    const clubId = card.club_id as number;
    informationCountByClub.set(
      clubId,
      (informationCountByClub.get(clubId) ?? 0) + 1,
    );
  }

  const clubs = clubMembershipRows
    .map((row) =>
      row.club
        ? {
            id: row.club.id,
            name: row.club.name,
            slug: row.club.slug,
            role: row.role,
            informationCardCount: informationCountByClub.get(row.club.id) ?? 0,
          }
        : null,
    )
    .filter((club): club is SidebarClub => Boolean(club))
    .sort((left, right) => left.name.localeCompare(right.name));
  const firstName =
    profile?.first_name?.trim() ||
    metadataValue(claims.user_metadata, "first_name");
  const lastName =
    profile?.last_name?.trim() ||
    metadataValue(claims.user_metadata, "last_name");
  const email = typeof claims.email === "string" ? claims.email : "";
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") || email || "RifleLeagues user";
  const initials =
    [firstName, lastName]
      .filter(Boolean)
      .map((name) => name![0])
      .join("")
      .toUpperCase() || email.slice(0, 2).toUpperCase() || "RL";

  return (
    <AppShell
      user={{ displayName, email, initials }}
      organisations={organisations}
      clubs={clubs}
    >
      {children}
    </AppShell>
  );
}
