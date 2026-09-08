import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  getCompetitionById,
  getCompetitionScoreComponents,
} from "@/lib/competitions";
import type {
  CompetitionSeries,
  CompetitionSeriesScoreComponent,
  CompetitionSeriesSources,
} from "@/lib/competition-series-types";

export * from "@/lib/competition-series-types";

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

export const getCompetitionSeriesScoreComponents = cache(async (
  competitionSeriesId: number,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competition_series_score_components")
    .select("competition_series_id,position,short_label,maximum_score,score_method")
    .eq("competition_series_id", competitionSeriesId)
    .order("position");
  if (error) throw new Error("Competition Series format could not be loaded.");
  return (data ?? []) as CompetitionSeriesScoreComponent[];
});

export async function getCompetitionSeriesCreationOptions(
  organisationId: number,
  leagueSeasonId: number,
) {
  const activeSeries = (await getCompetitionSeries(organisationId)).filter(
    (series) => !series.archived_at,
  );

  return Promise.all(activeSeries.map(async (series) => {
    const [components, sourceInfo] = await Promise.all([
      getCompetitionSeriesScoreComponents(series.id),
      getCompetitionSeriesSources(organisationId, leagueSeasonId, series.id),
    ]);
    const sources = (await Promise.all(sourceInfo.sources.map(async (metadata) => {
      const [competition, sourceComponents] = await Promise.all([
        getCompetitionById(metadata.id),
        getCompetitionScoreComponents(metadata.id),
      ]);
      return competition
        ? { metadata, competition, components: sourceComponents }
        : null;
    }))).filter((source): source is NonNullable<typeof source> => Boolean(source));

    return { series, components, sourceInfo, sources };
  }));
}

export async function getCompetitionSeriesManagementRows(organisationId: number) {
  const series = await getCompetitionSeries(organisationId);
  if (!series.length) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competitions")
    .select("competition_series_id")
    .in("competition_series_id", series.map((item) => item.id));
  if (error) throw new Error("Competition Series editions could not be counted.");

  const counts = new Map<number, number>();
  for (const competition of data ?? []) {
    const seriesId = Number(competition.competition_series_id);
    if (Number.isSafeInteger(seriesId)) {
      counts.set(seriesId, (counts.get(seriesId) ?? 0) + 1);
    }
  }
  return series.map((item) => ({ ...item, edition_count: counts.get(item.id) ?? 0 }));
}
