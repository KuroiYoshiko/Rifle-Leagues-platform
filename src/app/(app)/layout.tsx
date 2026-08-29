import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
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

  const [profileResult, organisationsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", claims.sub)
      .maybeSingle(),
    supabase
      .from("user_organisations")
      .select(`
        organisation:organisations!inner (
          id,
          name,
          slug
        )
      `)
      .eq("user_id", claims.sub),
  ]);
  const profileData = profileResult.data;
  const profile = profileData as Pick<
    Profile,
    "first_name" | "last_name"
  > | null;
  const organisationRows = (organisationsResult.data ?? []) as unknown as Array<{
    organisation: SidebarOrganisation | null;
  }>;
  const organisations = organisationRows
    .map((row) => row.organisation)
    .filter((organisation): organisation is SidebarOrganisation =>
      Boolean(organisation),
    )
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
    >
      {children}
    </AppShell>
  );
}
