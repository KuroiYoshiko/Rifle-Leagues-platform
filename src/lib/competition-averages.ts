import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCompetitionSeries } from "@/lib/competition-series";
import type {
  AverageConfiguration,
  AverageContext,
  AveragePolicy,
  AveragePolicyVersion,
  AverageSeriesManagementRow,
  CompetitionAverageManagement,
  SeriesAverageDefault,
  StartingAverageParticipant,
} from "@/lib/competition-average-types";

export * from "@/lib/competition-average-types";

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export const getAverageConfiguration = cache(async (
  organisationId: number,
): Promise<AverageConfiguration> => {
  const supabase = await createClient();
  const [contextResult, policyResult, versionResult] = await Promise.all([
    supabase.from("average_contexts")
      .select("id,organisation_id,name,basis_maximum,archived_at,created_at,updated_at")
      .eq("organisation_id", organisationId).order("name").order("id"),
    supabase.from("average_policies")
      .select("id,organisation_id,name,archived_at,created_at,updated_at")
      .eq("organisation_id", organisationId).order("name").order("id"),
    supabase.from("average_policy_versions")
      .select("id,average_policy_id,version_number,strategy,configuration,created_at")
      .order("version_number", { ascending: false }).order("id", { ascending: false }),
  ]);

  if (contextResult.error || policyResult.error || versionResult.error) {
    throw new Error("Average configuration could not be loaded.");
  }

  const contexts = (contextResult.data ?? []).map((row) => ({
    ...row,
    id: numberValue(row.id),
    organisation_id: numberValue(row.organisation_id),
    basis_maximum: numberValue(row.basis_maximum),
  })) as AverageContext[];
  const versions = (versionResult.data ?? []).map((row) => ({
    ...row,
    id: numberValue(row.id),
    average_policy_id: numberValue(row.average_policy_id),
    version_number: numberValue(row.version_number),
  })) as AveragePolicyVersion[];
  const versionsByPolicy = new Map<number, AveragePolicyVersion[]>();
  for (const version of versions) {
    const current = versionsByPolicy.get(version.average_policy_id) ?? [];
    current.push(version);
    versionsByPolicy.set(version.average_policy_id, current);
  }

  const policies = (policyResult.data ?? []).flatMap((row) => {
    const policyVersions = versionsByPolicy.get(numberValue(row.id)) ?? [];
    if (!policyVersions.length) return [];
    return [{
      ...row,
      id: numberValue(row.id),
      organisation_id: numberValue(row.organisation_id),
      versions: policyVersions,
      latestVersion: policyVersions[0],
    } as AveragePolicy];
  });

  return { contexts, policies };
});

export const getCompetitionSeriesAverageDefaults = cache(async (
  organisationId: number,
): Promise<SeriesAverageDefault[]> => {
  const [configuration, series] = await Promise.all([
    getAverageConfiguration(organisationId),
    getCompetitionSeries(organisationId),
  ]);
  if (!series.length) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competition_series_average_defaults")
    .select("competition_series_id,average_context_id,average_policy_version_id")
    .in("competition_series_id", series.map((item) => item.id));
  if (error) throw new Error("Competition Series Average defaults could not be loaded.");

  const contexts = new Map(configuration.contexts.map((item) => [item.id, item]));
  const versions = new Map(configuration.policies.flatMap((policy) =>
    policy.versions.map((version) => [version.id, { policy, version }] as const)));

  return (data ?? []).map((row) => {
    const versionRecord = versions.get(numberValue(row.average_policy_version_id));
    return {
      competition_series_id: numberValue(row.competition_series_id),
      average_context_id: numberValue(row.average_context_id),
      average_policy_version_id: numberValue(row.average_policy_version_id),
      context: contexts.get(numberValue(row.average_context_id)) ?? null,
      policy: versionRecord?.policy ?? null,
      policyVersion: versionRecord?.version ?? null,
    };
  });
});

export const getAverageSeriesManagementRows = cache(async (
  organisationId: number,
): Promise<AverageSeriesManagementRow[]> => {
  const [series, defaults] = await Promise.all([
    getCompetitionSeries(organisationId),
    getCompetitionSeriesAverageDefaults(organisationId),
  ]);
  if (!series.length) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competition_series_score_components")
    .select("competition_series_id,maximum_score")
    .in("competition_series_id", series.map((item) => item.id));
  if (error) throw new Error("Competition Series score maximums could not be loaded.");

  const maximums = new Map<number, number>();
  for (const component of data ?? []) {
    const seriesId = numberValue(component.competition_series_id);
    maximums.set(seriesId, (maximums.get(seriesId) ?? 0) + numberValue(component.maximum_score));
  }
  const defaultsBySeries = new Map(defaults.map((item) => [item.competition_series_id, item]));

  return series.map((item) => ({
    id: item.id,
    name: item.name,
    archived_at: item.archived_at,
    shooterMaximum: maximums.has(item.id)
      ? item.sets_per_round * (maximums.get(item.id) ?? 0)
      : null,
    averageDefault: defaultsBySeries.get(item.id) ?? null,
  }));
});

export const getCompetitionAverageManagement = cache(async (
  organisationId: number,
  leagueSeasonId: number,
  competitionId: number,
  configuration: AverageConfiguration,
): Promise<CompetitionAverageManagement> => {
  const supabase = await createClient();
  const [settingResult, participantResult] = await Promise.all([
    supabase.from("competition_average_settings")
      .select("competition_id,average_context_id,average_policy_version_id,contributes_to_history")
      .eq("competition_id", competitionId).maybeSingle(),
    supabase.rpc("get_competition_starting_average_management", {
      p_organisation_id: organisationId,
      p_league_season_id: leagueSeasonId,
      p_competition_id: competitionId,
    }),
  ]);
  if (settingResult.error || participantResult.error) {
    throw new Error("Competition Starting Averages could not be loaded.");
  }

  const contexts = new Map(configuration.contexts.map((item) => [item.id, item]));
  const versionRecords = new Map(configuration.policies.flatMap((policy) =>
    policy.versions.map((version) => [version.id, { policy, version }] as const)));
  const settingRow = settingResult.data;
  const setting = settingRow ? (() => {
    const versionRecord = versionRecords.get(numberValue(settingRow.average_policy_version_id));
    return {
      competition_id: numberValue(settingRow.competition_id),
      average_context_id: numberValue(settingRow.average_context_id),
      average_policy_version_id: numberValue(settingRow.average_policy_version_id),
      contributes_to_history: Boolean(settingRow.contributes_to_history),
      context: contexts.get(numberValue(settingRow.average_context_id)) ?? null,
      policy: versionRecord?.policy ?? null,
      policyVersion: versionRecord?.version ?? null,
    };
  })() : null;

  const rpcData = participantResult.data as {
    participants?: Array<Record<string, unknown>>;
    finalised_at?: string | null;
    division_status?: "draft" | "published" | null;
  } | null;
  const participants = (rpcData?.participants ?? []).map((row): StartingAverageParticipant => ({
    competitionEntrantParticipantId: numberValue(row.competition_entrant_participant_id),
    competitionEntrantId: numberValue(row.competition_entrant_id),
    slotNumber: numberValue(row.slot_number),
    shooterProfileId: String(row.shooter_profile_id),
    firstName: row.first_name ? String(row.first_name) : null,
    lastName: row.last_name ? String(row.last_name) : null,
    startingAverage: row.starting_average === null ? null : numberValue(row.starting_average),
    origin: row.origin === "calculated" ? "calculated"
      : row.origin === "manual" ? "manual"
        : row.origin === "no_history" ? "no_history" : null,
    status: row.status === "frozen" ? "frozen" : row.status === "provisional" ? "provisional" : null,
    qualifyingScoreCount: numberValue(row.qualifying_score_count),
    sourceCompetitionId: row.source_competition_id === null ? null : numberValue(row.source_competition_id),
    sourceCompetitionName: row.source_competition_name ? String(row.source_competition_name) : null,
    manualReason: row.manual_reason ? String(row.manual_reason) : null,
  }));

  return {
    setting,
    participants,
    hasFrozenStartingAverages: participants.some((participant) => participant.status === "frozen"),
    finalisedAt: rpcData?.finalised_at ?? null,
    divisionStatus: rpcData?.division_status ?? null,
  };
});
