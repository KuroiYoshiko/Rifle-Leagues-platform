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
    .select("id,organisation_id,name,slug,archived_at,entry_format,team_size,sets_per_round,shots_per_round,shooting_details_version,equipment_type_code,organisation_equipment_type_id,identity_locked_at,created_at,updated_at")
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
    .select("competition_series_id,position,short_label,maximum_score,score_method,shooting_position_mode,shooting_position_code,organisation_shooting_position_id,distance_mode,distance_value,distance_unit,shots")
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
  if (!activeSeries.length) return [];

  const supabase = await createClient();
  const { data: targetEditions, error: targetEditionsError } = await supabase
    .from("competitions")
    .select("id,name,slug,competition_series_id")
    .eq("league_season_id", leagueSeasonId)
    .in("competition_series_id", activeSeries.map((series) => series.id))
    .order("id");
  if (targetEditionsError) {
    throw new Error("Existing Competition Series editions could not be loaded.");
  }
  const targetEditionBySeries = new Map<number, { id: number; name: string; slug: string }>();
  for (const edition of targetEditions ?? []) {
    const seriesId = Number(edition.competition_series_id);
    if (!targetEditionBySeries.has(seriesId)) {
      targetEditionBySeries.set(seriesId, {
        id: Number(edition.id),
        name: String(edition.name),
        slug: String(edition.slug),
      });
    }
  }

  return Promise.all(activeSeries.map(async (series) => {
    const [components, sourceInfo] = await Promise.all([
      getCompetitionSeriesScoreComponents(series.id),
      getCompetitionSeriesSources(organisationId, leagueSeasonId, series.id),
    ]);
    const eligibleSourceInfo = {
      ...sourceInfo,
      recommended_source_id: sourceInfo.sources.some((source) =>
        source.id === sourceInfo.recommended_source_id && source.season_id !== leagueSeasonId)
        ? sourceInfo.recommended_source_id
        : null,
      sources: sourceInfo.sources.filter((source) => source.season_id !== leagueSeasonId),
    };
    const sources = (await Promise.all(eligibleSourceInfo.sources.map(async (metadata) => {
      const [competition, sourceComponents] = await Promise.all([
        getCompetitionById(metadata.id),
        getCompetitionScoreComponents(metadata.id),
      ]);
      return competition
        ? { metadata, competition, components: sourceComponents }
        : null;
    }))).filter((source): source is NonNullable<typeof source> => Boolean(source));

    return {
      series,
      targetEdition: targetEditionBySeries.get(series.id) ?? null,
      components,
      sourceInfo: {
        ...eligibleSourceInfo,
        selection_required: eligibleSourceInfo.recommended_source_id === null,
      },
      sources,
    };
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
