import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const LEAGUE_SEASON_STATUSES = [
  "draft",
  "open",
  "active",
  "completed",
] as const;

export type LeagueSeasonStatus = (typeof LEAGUE_SEASON_STATUSES)[number];

export type LeagueSeason = {
  id: number;
  organisation_id: number;
  name: string;
  slug: string;
  status: LeagueSeasonStatus;
  entry_opens_at: string | null;
  entry_closes_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

const leagueSeasonColumns =
  "id, organisation_id, name, slug, status, entry_opens_at, entry_closes_at, starts_at, ends_at, created_at, updated_at";
const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const statusLabels: Record<LeagueSeasonStatus, string> = {
  draft: "Draft",
  open: "Open",
  active: "Active",
  completed: "Completed",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export const getLeagueSeasons = cache(async (organisationId: number) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("league_seasons")
    .select(leagueSeasonColumns)
    .eq("organisation_id", organisationId)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("League seasons could not be loaded.");
  }

  return (data ?? []) as LeagueSeason[];
});

export const getLeagueSeasonBySlug = cache(
  async (organisationId: number, seasonSlug: string) => {
    if (
      seasonSlug.length > 180 ||
      !routeSafeSlugPattern.test(seasonSlug)
    ) {
      return null;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("league_seasons")
      .select(leagueSeasonColumns)
      .eq("organisation_id", organisationId)
      .eq("slug", seasonSlug)
      .maybeSingle();

    if (error) {
      throw new Error("The league season could not be loaded.");
    }

    return data as LeagueSeason | null;
  },
);

export function getLeagueSeasonStatusLabel(status: LeagueSeasonStatus) {
  return statusLabels[status];
}

export function formatLeagueSeasonDate(value: string | null) {
  return value ? dateFormatter.format(new Date(`${value}T00:00:00Z`)) : null;
}
