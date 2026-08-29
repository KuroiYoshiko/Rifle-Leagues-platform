import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
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

  const firstName = metadataValue(claims.user_metadata, "first_name");
  const lastName = metadataValue(claims.user_metadata, "last_name");
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
    <AppShell user={{ displayName, email, initials }}>
      {children}
    </AppShell>
  );
}
