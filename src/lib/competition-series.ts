import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CompetitionEntryFormat, CompetitionRankingMethod, CompetitionStatus } from "@/lib/competitions";
import type { LeagueSeasonStatus } from "@/lib/league-seasons";

export const COMPETITION_DISCIPLINES = [
  "rifle_prone", "rifle_benchrest", "rifle_three_position", "air_pistol", "other",
] as const;
export type CompetitionDiscipline = (typeof COMPETITION_DISCIPLINES)[number];
export const competitionDisciplineLabels: Record<CompetitionDiscipline, string> = {
  rifle_prone: "Rifle — Prone",
  rifle_benchrest: "Rifle — Benchrest",
  rifle_three_position: "Rifle — 3 Position",
  air_pistol: "Air Pistol",
  other: "Other",
};

export type CompetitionSeries = {
  id: number;
  organisation_id: number;
  name: string;
  slug: string;
  archived_at: string | null;
  entry_format: CompetitionEntryFormat;
  team_size: number;
  discipline_code: CompetitionDiscipline | null;
  discipline_detail: string | null;
  sets_per_round: number;
  shots_per_round: number | null;
  identity_locked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CompetitionSeriesSources = {
  series: Pick<CompetitionSeries, "id" | "name" | "slug" | "identity_locked_at" | "discipline_code" | "discipline_detail">;
  cutoff: string;
  provisional_cutoff: boolean;
  recommended_source_id: number | null;
  selection_required: boolean;
  ambiguous_latest_date: boolean;
  sources: Array<{
    id: number;
    name: string;
    slug: string;
    status: CompetitionStatus;
    season_id: number;
    season_name: string;
    season_status: LeagueSeasonStatus;
    effective_starts_at: string | null;
    ranking_method: CompetitionRankingMethod;
    number_of_rounds: number;
    configuration_version: string;
  }>;
};

// Management loaders only: no public catalogue changes and no service-role client.
export const getCompetitionSeries = cache(async (organisationId: number) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("competition_series")
    .select("id,organisation_id,name,slug,archived_at,entry_format,team_size,discipline_code,discipline_detail,sets_per_round,shots_per_round,identity_locked_at,created_at,updated_at")
    .eq("organisation_id", organisationId).order("name").order("id");
  if (error) throw new Error("Competition Series could not be loaded.");
  return (data ?? []) as CompetitionSeries[];
});

export const getCompetitionSeriesSources = cache(async (
  organisationId: number, leagueSeasonId: number, competitionSeriesId: number, targetStartsAt: string | null = null,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_competition_series_sources", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    p_competition_series_id: competitionSeriesId,
    p_target_starts_at: targetStartsAt,
  });
  if (error) throw new Error("Competition Series source editions could not be loaded.");
  return data as CompetitionSeriesSources;
});
