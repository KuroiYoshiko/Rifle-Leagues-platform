"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { AveragePolicyStrategy } from "@/lib/competition-average-types";

export type AverageActionState = {
  status?: "success" | "error";
  message?: string;
};

export type StartingAveragePreviewRow = {
  competitionEntrantParticipantId: number;
  shooterProfileId: string;
  firstName: string | null;
  lastName: string | null;
  startingAverage: number | null;
  manualRequired: boolean;
  origin: "calculated" | "manual" | "no_history" | null;
  status: "provisional" | "frozen" | null;
  policyBranch: "current" | "preceding" | "manual" | null;
  qualifyingScoreCount: number;
  sourceCompetitionId: number | null;
  sourceCompetitionName: string | null;
  manualReason?: string | null;
};

export type StartingAverageCalculationState = AverageActionState & {
  rows?: StartingAveragePreviewRow[];
};

export type ManualStartingAverageState = AverageActionState & {
  startingAverage?: number | null;
  origin?: "manual" | "no_history";
  manualReason?: string | null;
};

type RpcError = { code?: string; message?: string };
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const decimalPattern = /^\d{1,7}(?:\.\d{1,6})?$/;

function positiveInteger(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  const number = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(number) && number > 0
    ? number : null;
}

function organisationSlug(formData: FormData) {
  const slug = String(formData.get("organisation_slug") ?? "").trim();
  return slug.length <= 180 && slugPattern.test(slug) ? slug : null;
}

async function prepare(formData: FormData) {
  const organisationId = positiveInteger(formData.get("organisation_id"));
  const slug = organisationSlug(formData);
  if (!organisationId || !slug) {
    return { error: "The Organisation could not be identified. Refresh and try again." } as const;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return { error: "Sign in again before managing Starting Averages." } as const;
  }
  return { organisationId, organisationSlug: slug, supabase } as const;
}

function averageError(error: RpcError, fallback: string) {
  if (error.code === "42501") {
    return "Active Organisation owner or manager access is required.";
  }
  if (error.code === "23505") {
    return "That name is already in use in this Organisation.";
  }
  const message = error.message ?? "";
  if (message.includes("exactly equal") || message.includes("does not normalise")) {
    return "The Competition’s shooter maximum must exactly match the selected Average Context. Scores are not converted between different Ex values.";
  }
  if (message.includes("Archived Average")) {
    return "Archived Average Contexts and Policies cannot be selected for new settings.";
  }
  if (message.includes("frozen")) {
    return "These settings cannot be changed because a Starting Average is frozen.";
  }
  if (message.includes("finalised")) {
    return "Starting Averages were already finalised for this Competition.";
  }
  if (message.includes("not found") || error.code === "P0002") {
    return "The selected Competition, Context, Policy, or Series is no longer available. Refresh and try again.";
  }
  return fallback;
}

function refreshManagement(slug: string) {
  revalidatePath(`/organisations/${slug}/management`);
  revalidatePath(`/organisations/${slug}/management/averages`);
  revalidatePath(`/organisations/${slug}/leagues`, "layout");
}

function competitionPath(formData: FormData) {
  const slug = organisationSlug(formData);
  const seasonSlug = String(formData.get("season_slug") ?? "").trim();
  const competitionSlug = String(formData.get("competition_slug") ?? "").trim();
  if (!slug || !slugPattern.test(seasonSlug) || !slugPattern.test(competitionSlug)) return null;
  return `/organisations/${slug}/leagues/${seasonSlug}/competitions/${competitionSlug}`;
}

function refreshCompetition(formData: FormData) {
  const path = competitionPath(formData);
  if (!path) return;
  revalidatePath(path);
  revalidatePath(`${path}/edit`);
  revalidatePath(`${path}/averages`);
  revalidatePath(`${path}/divisions`);
}

function policyDefinition(formData: FormData) {
  const strategy = String(formData.get("strategy") ?? "") as AveragePolicyStrategy;
  if (strategy === "manual") return { strategy, configuration: {} } as const;
  if (strategy !== "current_then_preceding") return null;
  const minimumCurrent = positiveInteger(formData.get("minimum_current_scores"));
  const minimumPreceding = positiveInteger(formData.get("minimum_preceding_scores"));
  if (!minimumCurrent || minimumCurrent > 999 || !minimumPreceding || minimumPreceding > 999) {
    return null;
  }
  return {
    strategy,
    configuration: {
      minimum_current_scores: minimumCurrent,
      minimum_preceding_scores: minimumPreceding,
      fallback: "manual",
    },
  } as const;
}

export async function createAverageContext(
  _state: AverageActionState,
  formData: FormData,
): Promise<AverageActionState> {
  const prepared = await prepare(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const name = String(formData.get("name") ?? "").trim();
  const maximumText = String(formData.get("basis_maximum") ?? "").trim();
  const maximum = Number(maximumText);
  if ([...name].length < 2 || [...name].length > 160) {
    return { status: "error", message: "Use an Average Context name between 2 and 160 characters." };
  }
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(maximumText) || maximum < 0.01 || maximum > 1_000_000) {
    return { status: "error", message: "Maximum score must be from 0.01 to 1,000,000 with up to two decimal places." };
  }
  const { error } = await prepared.supabase.rpc("create_average_context", {
    p_organisation_id: prepared.organisationId,
    p_name: name,
    p_basis_maximum: maximum,
  });
  if (error) return { status: "error", message: averageError(error, "The Average Context could not be created.") };
  refreshManagement(prepared.organisationSlug);
  return { status: "success", message: "Average Context created." };
}

export async function setAverageContextArchived(
  _state: AverageActionState,
  formData: FormData,
): Promise<AverageActionState> {
  const prepared = await prepare(formData);
  const contextId = positiveInteger(formData.get("average_context_id"));
  if ("error" in prepared || !contextId) return { status: "error", message: "The Average Context could not be identified." };
  const archived = formData.get("archived") === "true";
  const { error } = await prepared.supabase.rpc("set_average_context_archived", {
    p_organisation_id: prepared.organisationId,
    p_average_context_id: contextId,
    p_archived: archived,
  });
  if (error) return { status: "error", message: averageError(error, "The Average Context archive state could not be changed.") };
  refreshManagement(prepared.organisationSlug);
  return { status: "success", message: archived ? "Average Context archived." : "Average Context restored." };
}

export async function createAveragePolicy(
  _state: AverageActionState,
  formData: FormData,
): Promise<AverageActionState> {
  const prepared = await prepare(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const name = String(formData.get("name") ?? "").trim();
  const definition = policyDefinition(formData);
  if ([...name].length < 2 || [...name].length > 160) {
    return { status: "error", message: "Use an Average Policy name between 2 and 160 characters." };
  }
  if (!definition) return { status: "error", message: "Choose a valid calculation method and score minimums from 1 to 999." };
  const { error } = await prepared.supabase.rpc("create_average_policy", {
    p_organisation_id: prepared.organisationId,
    p_name: name,
    p_strategy: definition.strategy,
    p_configuration: definition.configuration,
  });
  if (error) return { status: "error", message: averageError(error, "The Average Policy could not be created.") };
  refreshManagement(prepared.organisationSlug);
  return { status: "success", message: "Average Policy created." };
}

export async function createAveragePolicyVersion(
  _state: AverageActionState,
  formData: FormData,
): Promise<AverageActionState> {
  const prepared = await prepare(formData);
  const policyId = positiveInteger(formData.get("average_policy_id"));
  const definition = policyDefinition(formData);
  if ("error" in prepared || !policyId) return { status: "error", message: "The Average Policy could not be identified." };
  if (!definition) return { status: "error", message: "Choose valid score minimums from 1 to 999." };
  const { error } = await prepared.supabase.rpc("create_average_policy_version", {
    p_organisation_id: prepared.organisationId,
    p_average_policy_id: policyId,
    p_strategy: definition.strategy,
    p_configuration: definition.configuration,
  });
  if (error) return { status: "error", message: averageError(error, "A new Average Policy version could not be created.") };
  refreshManagement(prepared.organisationSlug);
  return { status: "success", message: "New immutable Policy version created." };
}

export async function setAveragePolicyArchived(
  _state: AverageActionState,
  formData: FormData,
): Promise<AverageActionState> {
  const prepared = await prepare(formData);
  const policyId = positiveInteger(formData.get("average_policy_id"));
  if ("error" in prepared || !policyId) return { status: "error", message: "The Average Policy could not be identified." };
  const archived = formData.get("archived") === "true";
  const { error } = await prepared.supabase.rpc("set_average_policy_archived", {
    p_organisation_id: prepared.organisationId,
    p_average_policy_id: policyId,
    p_archived: archived,
  });
  if (error) return { status: "error", message: averageError(error, "The Average Policy archive state could not be changed.") };
  refreshManagement(prepared.organisationSlug);
  return { status: "success", message: archived ? "Average Policy archived." : "Average Policy restored." };
}

export async function setCompetitionSeriesAverageDefaults(
  _state: AverageActionState,
  formData: FormData,
): Promise<AverageActionState> {
  const prepared = await prepare(formData);
  const seriesId = positiveInteger(formData.get("competition_series_id"));
  const enabled = formData.get("average_setup") === "configured";
  const contextId = enabled ? positiveInteger(formData.get("average_context_id")) : null;
  const versionId = enabled ? positiveInteger(formData.get("average_policy_version_id")) : null;
  if ("error" in prepared || !seriesId || (enabled && (!contextId || !versionId))) {
    return { status: "error", message: "Choose both an Average Context and Average Policy, or choose no setup." };
  }
  const { error } = await prepared.supabase.rpc("set_competition_series_average_defaults", {
    p_organisation_id: prepared.organisationId,
    p_competition_series_id: seriesId,
    p_average_context_id: contextId,
    p_average_policy_version_id: versionId,
  });
  if (error) return { status: "error", message: averageError(error, "The Series defaults could not be saved.") };
  refreshManagement(prepared.organisationSlug);
  return { status: "success", message: enabled ? "Series Starting Average defaults saved." : "Series Starting Average defaults cleared." };
}

async function preparedCompetition(formData: FormData) {
  const prepared = await prepare(formData);
  const seasonId = positiveInteger(formData.get("league_season_id"));
  const competitionId = positiveInteger(formData.get("competition_id"));
  if ("error" in prepared || !seasonId || !competitionId || !competitionPath(formData)) {
    return { error: "The Competition could not be identified. Refresh and try again." } as const;
  }
  return { ...prepared, seasonId, competitionId } as const;
}

export async function setCompetitionAverageSettings(
  _state: AverageActionState,
  formData: FormData,
): Promise<AverageActionState> {
  const prepared = await preparedCompetition(formData);
  const contextId = positiveInteger(formData.get("average_context_id"));
  const versionId = positiveInteger(formData.get("average_policy_version_id"));
  if ("error" in prepared || !contextId || !versionId) {
    return { status: "error", message: "Choose both an Average Context and Average Policy." };
  }
  const { error } = await prepared.supabase.rpc("set_competition_average_settings", {
    p_organisation_id: prepared.organisationId,
    p_league_season_id: prepared.seasonId,
    p_competition_id: prepared.competitionId,
    p_average_context_id: contextId,
    p_average_policy_version_id: versionId,
    p_contributes_to_history: formData.get("contributes_to_history") === "true",
  });
  if (error) return { status: "error", message: averageError(error, "The Competition Average settings could not be saved.") };
  refreshCompetition(formData);
  return { status: "success", message: "Competition Average settings saved. Existing provisional values were cleared if the setup changed." };
}

export async function calculateCompetitionStartingAverages(
  _state: StartingAverageCalculationState,
  formData: FormData,
): Promise<StartingAverageCalculationState> {
  const prepared = await preparedCompetition(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const { data, error } = await prepared.supabase.rpc("calculate_competition_starting_averages", {
    p_organisation_id: prepared.organisationId,
    p_league_season_id: prepared.seasonId,
    p_competition_id: prepared.competitionId,
  });
  if (error) return { status: "error", message: averageError(error, "Starting Averages could not be calculated. Check the Competition setup and try again.") };
  const rawRows = Array.isArray(data) ? data : [];
  const sourceIds = [...new Set(rawRows.flatMap((row) => {
    if (row.source_competition_id === null || row.source_competition_id === undefined) return [];
    const id = Number(row.source_competition_id);
    return Number.isSafeInteger(id) && id > 0 ? [id] : [];
  }))];
  const sourceResult = sourceIds.length
    ? await prepared.supabase.from("competitions").select("id,name").in("id", sourceIds)
    : { data: [], error: null };
  if (sourceResult.error) return { status: "error", message: "Starting Averages were calculated, but their source Competition names could not be loaded. Refresh and try again." };
  const names = new Map((sourceResult.data ?? []).map((row) => [Number(row.id), String(row.name)]));
  const rows = rawRows.map((row): StartingAveragePreviewRow => {
    const sourceId = row.source_competition_id === null ? null : Number(row.source_competition_id);
    return {
      competitionEntrantParticipantId: Number(row.competition_entrant_participant_id),
      shooterProfileId: String(row.shooter_profile_id),
      firstName: row.first_name ? String(row.first_name) : null,
      lastName: row.last_name ? String(row.last_name) : null,
      startingAverage: row.starting_average === null ? null : Number(row.starting_average),
      manualRequired: Boolean(row.manual_required),
      origin: row.origin === "calculated" ? "calculated"
        : row.origin === "manual" ? "manual"
          : row.origin === "no_history" ? "no_history" : null,
      status: row.status === "frozen" ? "frozen" : row.status === "provisional" ? "provisional" : null,
      policyBranch: row.policy_branch === "current" ? "current"
        : row.policy_branch === "preceding" ? "preceding"
          : row.policy_branch === "manual" ? "manual" : null,
      qualifyingScoreCount: Number(row.qualifying_score_count ?? 0),
      sourceCompetitionId: sourceId,
      sourceCompetitionName: sourceId ? names.get(sourceId) ?? null : null,
      manualReason: null,
    };
  });
  refreshCompetition(formData);
  return { status: "success", message: rows.length ? "Provisional Starting Averages recalculated." : "There are no submitted participants to calculate.", rows };
}

export async function setManualStartingAverage(
  _state: ManualStartingAverageState,
  formData: FormData,
): Promise<ManualStartingAverageState> {
  const prepared = await preparedCompetition(formData);
  const participantId = positiveInteger(formData.get("competition_entrant_participant_id"));
  const averageText = String(formData.get("starting_average") ?? "").trim();
  const startingAverage = averageText ? Number(averageText) : null;
  const reasonText = String(formData.get("manual_reason") ?? "").trim();
  if ("error" in prepared || !participantId) return { status: "error", message: "The participant could not be identified." };
  if (averageText && (!decimalPattern.test(averageText) || !Number.isFinite(startingAverage))) {
    return { status: "error", message: "Enter a numeric Starting Average with up to six decimal places." };
  }
  if (reasonText.length > 500) return { status: "error", message: "Manual reason must be 500 characters or fewer." };
  const { data, error } = await prepared.supabase.rpc("set_manual_competition_starting_average", {
    p_organisation_id: prepared.organisationId,
    p_league_season_id: prepared.seasonId,
    p_competition_id: prepared.competitionId,
    p_competition_entrant_participant_id: participantId,
    p_starting_average: startingAverage,
    p_manual_reason: reasonText || null,
  });
  if (error) return { status: "error", message: averageError(error, "The manual Starting Average could not be saved. Check the Context scale and try again.") };
  const result = data as {
    starting_average?: number | string | null;
    origin?: "manual" | "no_history";
    manual_reason?: string | null;
  } | null;
  const savedAverage = result?.starting_average === null || result?.starting_average === undefined
    ? null : Number(result.starting_average);
  const savedOrigin = result?.origin === "manual" ? "manual" : "no_history";
  refreshCompetition(formData);
  return {
    status: "success",
    message: savedOrigin === "manual"
      ? "Manual provisional Starting Average saved."
      : "No previous Starting Average recorded for this entrant.",
    startingAverage: savedAverage,
    origin: savedOrigin,
    manualReason: result?.manual_reason ?? (reasonText || null),
  };
}

export async function finaliseCompetitionStartingAverages(
  _state: AverageActionState,
  formData: FormData,
): Promise<AverageActionState> {
  const prepared = await preparedCompetition(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const { error } = await prepared.supabase.rpc("finalise_competition_starting_averages", {
    p_organisation_id: prepared.organisationId,
    p_league_season_id: prepared.seasonId,
    p_competition_id: prepared.competitionId,
  });
  if (error) {
    return {
      status: "error",
      message: averageError(
        error,
        "Starting Averages could not be finalised. Resolve every participant value and try again.",
      ),
    };
  }
  refreshCompetition(formData);
  return { status: "success", message: "Starting Averages finalised." };
}
