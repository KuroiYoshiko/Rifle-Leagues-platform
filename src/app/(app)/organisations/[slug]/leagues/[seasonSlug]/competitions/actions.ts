"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  COMPETITION_ENTRY_FORMATS,
  COMPETITION_ENTRY_WINDOW_MODES,
  COMPETITION_RANKING_METHODS,
  COMPETITION_SCORING_METHODS,
  COMPETITION_START_DATE_MODES,
  COMPETITION_STATUSES,
  type CompetitionEntryFormat,
  type CompetitionEntryWindowMode,
  type CompetitionRankingMethod,
  type CompetitionScoringMethod,
  type CompetitionStartDateMode,
  type CompetitionStatus,
} from "@/lib/competitions";
import { formatLeagueSeasonDate } from "@/lib/league-seasons";
import { createClient } from "@/lib/supabase/server";

export type CompetitionField =
  | "name" | "description" | "entryFormat" | "teamSize" | "entryWindow"
  | "competitionStart" | "setsPerRound" | "scoreComponents"
  | "shotsPerRound" | "numberOfRounds" | "entryFee" | "rankingMethod"
  | "bestRoundsCount" | "scoringAccess" | "xScoring" | "roundSchedule";

export type CompetitionScoreComponentValue = {
  shortLabel: string;
  maximumScore: string;
  scoreMethod: string;
};

export type CompetitionFormValues = {
  name: string;
  description: string;
  entryFormat: string;
  teamSize: string;
  entryWindowMode: string;
  customEntryOpensAt: string;
  customEntryClosesAt: string;
  startDateMode: string;
  customStartsAt: string;
  setsPerRound: string;
  scoreComponents: CompetitionScoreComponentValue[];
  shotsPerRound: string;
  usesXScore: boolean;
  numberOfRounds: string;
  entryFee: string;
  rankingMethod: string;
  bestRoundsCount: string;
  localScoringEnabled: boolean;
  roundDeadlines: string[];
  roundShootByDates: string[];
};

export type CompetitionFormState = {
  status?: "success" | "error";
  message?: string;
  values?: CompetitionFormValues;
  fieldErrors?: Partial<Record<CompetitionField, string>>;
  publishErrors?: string[];
};

export type CompetitionLifecycleActionState = {
  status?: "error";
  message?: string;
};

type CompetitionRpcResult = {
  id: number;
  organisation_slug: string;
  season_slug: string;
  competition_slug: string;
  status: CompetitionStatus;
};

type CompetitionLifecycleRpcResult = Omit<CompetitionRpcResult, "status"> & {
  status?: CompetitionStatus;
};

type SeasonBoundaryContext = {
  name: string;
  entry_opens_at: string | null;
  entry_closes_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const moneyPattern = /^\d+(?:\.\d{1,2})?$/;
const scorePattern = /^\d{1,7}(?:\.\d{1,2})?$/;
const earliestDate = "1900-01-01";
const latestDate = "2200-12-31";

function readPositiveInteger(value: FormDataEntryValue | string | null) {
  const raw = String(value ?? "").trim();
  const number = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

function isCalendarDate(value: string) {
  if (!calendarDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function readValues(formData: FormData): CompetitionFormValues {
  const labels = formData.getAll("component_label").map(String);
  const maxima = formData.getAll("component_maximum").map(String);
  const methods = formData.getAll("component_method").map(String);
  const componentCount = Math.max(labels.length, maxima.length, methods.length);
  return {
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    entryFormat: String(formData.get("entry_format") ?? "individual").trim(),
    teamSize: String(formData.get("team_size") ?? "").trim(),
    entryWindowMode: String(formData.get("entry_window_mode") ?? "season_default").trim(),
    customEntryOpensAt: String(formData.get("custom_entry_opens_at") ?? "").trim(),
    customEntryClosesAt: String(formData.get("custom_entry_closes_at") ?? "").trim(),
    startDateMode: String(formData.get("start_date_mode") ?? "season_default").trim(),
    customStartsAt: String(formData.get("custom_starts_at") ?? "").trim(),
    setsPerRound: String(formData.get("sets_per_round") ?? "1").trim(),
    scoreComponents: Array.from({ length: componentCount }, (_, index) => ({
      shortLabel: String(labels[index] ?? "").trim(),
      maximumScore: String(maxima[index] ?? "").trim(),
      scoreMethod: String(methods[index] ?? "").trim(),
    })),
    shotsPerRound: String(formData.get("shots_per_round") ?? "").trim(),
    usesXScore: formData.get("uses_x_score") === "true",
    numberOfRounds: String(formData.get("number_of_rounds") ?? "10").trim(),
    entryFee: String(formData.get("entry_fee") ?? "").trim(),
    rankingMethod: String(formData.get("ranking_method") ?? "aggregate").trim(),
    bestRoundsCount: String(formData.get("best_rounds_count") ?? "").trim(),
    localScoringEnabled: formData.get("local_scoring_enabled") !== "false",
    roundDeadlines: formData.getAll("round_deadline").map((value) => String(value).trim()),
    roundShootByDates: formData.getAll("round_shoot_by_date").map((value) => String(value).trim()),
  };
}

function effectiveDates(values: CompetitionFormValues, season: SeasonBoundaryContext) {
  return {
    entryOpens: values.entryWindowMode === "custom"
      ? values.customEntryOpensAt || null : season.entry_opens_at,
    entryCloses: values.entryWindowMode === "custom"
      ? values.customEntryClosesAt || null : season.entry_closes_at,
    starts: values.startDateMode === "custom"
      ? values.customStartsAt || null : season.starts_at,
  };
}

function validateStructuralValues(values: CompetitionFormValues, season: SeasonBoundaryContext) {
  const errors: CompetitionFormState["fieldErrors"] = {};
  const nameLength = [...values.name].length;
  if (!values.name) errors.name = "Enter the competition name.";
  else if (nameLength < 2 || nameLength > 160) errors.name = "Use between 2 and 160 characters.";
  if ([...values.description].length > 2000) errors.description = "Use 2,000 characters or fewer.";

  if (!COMPETITION_ENTRY_FORMATS.includes(values.entryFormat as CompetitionEntryFormat)) {
    errors.entryFormat = "Select an entry format.";
  } else if (values.entryFormat === "team") {
    const size = readPositiveInteger(values.teamSize);
    if (!size || size < 3 || size > 20) errors.teamSize = "Team size must be between 3 and 20.";
  }

  if (!COMPETITION_ENTRY_WINDOW_MODES.includes(values.entryWindowMode as CompetitionEntryWindowMode)) {
    errors.entryWindow = "Select how the entry window is set.";
  }
  if (values.entryWindowMode === "custom") {
    for (const date of [values.customEntryOpensAt, values.customEntryClosesAt]) {
      if (date && (!isCalendarDate(date) || date < earliestDate || date > latestDate)) {
        errors.entryWindow = "Use valid custom entry dates between 1900 and 2200.";
      }
    }
    if (values.customEntryOpensAt && values.customEntryClosesAt && values.customEntryClosesAt < values.customEntryOpensAt) {
      errors.entryWindow = "Entries close must be on or after Entries open.";
    }
  }

  if (!COMPETITION_START_DATE_MODES.includes(values.startDateMode as CompetitionStartDateMode)) {
    errors.competitionStart = "Select how Competition Start is set.";
  } else if (values.startDateMode === "custom" && values.customStartsAt &&
    (!isCalendarDate(values.customStartsAt) || values.customStartsAt < earliestDate || values.customStartsAt > latestDate)) {
    errors.competitionStart = "Use a valid Competition Start between 1900 and 2200.";
  }

  const sets = readPositiveInteger(values.setsPerRound);
  if (!sets || sets > 100) errors.setsPerRound = "Sets per round must be between 1 and 100.";
  if (values.scoreComponents.length > 20) {
    errors.scoreComponents = "Use no more than 20 score components per set.";
  } else {
    for (const [index, component] of values.scoreComponents.entries()) {
      const maximum = Number(component.maximumScore);
      if ([...component.shortLabel].length > 30) {
        errors.scoreComponents = `Score ${index + 1} label must be 30 characters or fewer.`;
        break;
      }
      if (!scorePattern.test(component.maximumScore) || !Number.isFinite(maximum) || maximum < 0.01 || maximum > 1_000_000) {
        errors.scoreComponents = `Score ${index + 1} needs a maximum from 0.01 to 1,000,000 with up to two decimal places.`;
        break;
      }
      if (!COMPETITION_SCORING_METHODS.includes(component.scoreMethod as CompetitionScoringMethod)) {
        errors.scoreComponents = `Score ${index + 1} needs a scoring method.`;
        break;
      }
    }
  }

  if (values.shotsPerRound) {
    const shots = readPositiveInteger(values.shotsPerRound);
    if (!shots || shots > 10_000) errors.shotsPerRound = "Shots per round must be between 1 and 10,000.";
  }
  const rounds = readPositiveInteger(values.numberOfRounds);
  if (!rounds || rounds > 100) errors.numberOfRounds = "Number of rounds must be between 1 and 100.";
  if (values.entryFee) {
    const fee = Number(values.entryFee);
    if (!moneyPattern.test(values.entryFee) || !Number.isFinite(fee) || fee > 10_000) {
      errors.entryFee = "Use an amount from £0 to £10,000 with up to two decimal places.";
    }
  }

  if (!COMPETITION_RANKING_METHODS.includes(values.rankingMethod as CompetitionRankingMethod)) {
    errors.rankingMethod = "Select a ranking method.";
  }
  const best = values.bestRoundsCount ? readPositiveInteger(values.bestRoundsCount) : null;
  if (values.rankingMethod === "best_n_average" && (!best || rounds === null || best > rounds)) {
    errors.bestRoundsCount = `Must be between 1 and ${rounds ?? 100}.`;
  }
  if (values.rankingMethod === "best_n_average" && values.usesXScore) {
    errors.xScoring = "X-based ranking is not currently defined for Best N Average competitions.";
  }

  if ((values.roundDeadlines.length > 0 && values.roundDeadlines.length !== rounds) ||
    (values.roundShootByDates.length > 0 && values.roundShootByDates.length !== rounds)) {
    errors.roundSchedule = "Regenerate the schedule after changing the number of rounds.";
  }
  const resolved = effectiveDates(values, season);
  let previousEnd: string | null = null;
  for (let index = 0; index < values.roundDeadlines.length; index += 1) {
    const end = values.roundDeadlines[index];
    const shootBy = values.roundShootByDates[index] ?? "";
    if (end && (!isCalendarDate(end) || end < earliestDate || end > latestDate)) {
      errors.roundSchedule = `Round ${index + 1} needs a valid Round End.`;
      break;
    }
    if (previousEnd && end && end < previousEnd) {
      errors.roundSchedule = `Round ${index + 1} cannot end before an earlier round.`;
      break;
    }
    if (end && resolved.starts && ((index === 0 && end <= resolved.starts) || (index > 0 && end < resolved.starts))) {
      errors.roundSchedule = index === 0
        ? `Round 1 End must be after the effective Competition Start (${formatLeagueSeasonDate(resolved.starts)}).`
        : `Round ${index + 1} cannot end before the effective Competition Start (${formatLeagueSeasonDate(resolved.starts)}).`;
      break;
    }
    if (end && season.ends_at && end > season.ends_at) {
      errors.roundSchedule = `Round ${index + 1} cannot end after the Season ends (${formatLeagueSeasonDate(season.ends_at)}).`;
      break;
    }
    if (shootBy && (!isCalendarDate(shootBy) || !end || shootBy > end)) {
      errors.roundSchedule = `Round ${index + 1} Shoot-by must be a valid date on or before Round End.`;
      break;
    }
    if (end) previousEnd = end;
  }
  return errors;
}

function getPublishErrors(values: CompetitionFormValues, season: SeasonBoundaryContext) {
  const errors: string[] = [];
  const resolved = effectiveDates(values, season);
  const rounds = readPositiveInteger(values.numberOfRounds);
  if (!resolved.entryOpens || !resolved.entryCloses) errors.push("Set a complete effective Competition entry window.");
  if (resolved.entryOpens && resolved.entryCloses && resolved.entryCloses < resolved.entryOpens) errors.push("Entries close must be on or after Entries open.");
  if (!resolved.starts) errors.push("Set an effective Competition Start date.");
  if (values.rankingMethod === "round_robin" && resolved.entryCloses && resolved.starts && resolved.entryCloses >= resolved.starts) {
    errors.push("Round Robin requires time to finalise divisions after entries close. Competition Start must be after the Entry Close date.");
  }
  if (values.scoreComponents.length === 0) errors.push("Add at least one Course of Fire score component.");
  if (values.rankingMethod === "best_n_average" && values.usesXScore) errors.push("Turn off X scoring for Best N rounds average.");
  if (rounds && (values.roundDeadlines.length !== rounds || values.roundDeadlines.some((date) => !date))) {
    errors.push(`Set a Round End for all ${rounds} rounds.`);
  }
  return errors;
}

function getRpcValues(values: CompetitionFormValues) {
  const entryFormat = values.entryFormat as CompetitionEntryFormat;
  return {
    p_name: values.name,
    p_description: values.description || null,
    p_entry_format: entryFormat,
    p_team_size: entryFormat === "individual" ? 1 : entryFormat === "pairs" ? 2 : Number(values.teamSize),
    p_shots_per_round: values.shotsPerRound ? Number(values.shotsPerRound) : null,
    p_uses_x_score: values.usesXScore,
    p_number_of_rounds: Number(values.numberOfRounds),
    p_entry_fee: values.entryFee ? Number(values.entryFee) : null,
    p_entry_window_mode: values.entryWindowMode as CompetitionEntryWindowMode,
    p_custom_entry_opens_at: values.entryWindowMode === "custom" ? values.customEntryOpensAt || null : null,
    p_custom_entry_closes_at: values.entryWindowMode === "custom" ? values.customEntryClosesAt || null : null,
    p_start_date_mode: values.startDateMode as CompetitionStartDateMode,
    p_custom_starts_at: values.startDateMode === "custom" ? values.customStartsAt || null : null,
    p_sets_per_round: Number(values.setsPerRound),
    p_score_components: values.scoreComponents.map((component) => ({
      short_label: component.shortLabel || null,
      maximum_score: component.maximumScore,
      score_method: component.scoreMethod,
    })),
    p_ranking_method: values.rankingMethod as CompetitionRankingMethod,
    p_best_rounds_count: values.rankingMethod === "best_n_average" && values.bestRoundsCount ? Number(values.bestRoundsCount) : null,
    p_local_scoring_enabled: values.localScoringEnabled,
    p_round_deadlines: values.roundDeadlines.map((date) => date || null),
    p_round_shoot_by_dates: values.roundShootByDates.map((date) => date || null),
  };
}

function readRpcResult(value: unknown): CompetitionRpcResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = Number(item.id);
  if (!Number.isSafeInteger(id) || id <= 0 ||
    typeof item.organisation_slug !== "string" || typeof item.season_slug !== "string" ||
    typeof item.competition_slug !== "string" || !routeSafeSlugPattern.test(item.organisation_slug) ||
    !routeSafeSlugPattern.test(item.season_slug) || !routeSafeSlugPattern.test(item.competition_slug) ||
    !COMPETITION_STATUSES.includes(item.status as CompetitionStatus)) return null;
  return item as CompetitionRpcResult;
}

function readLifecycleRpcResult(
  value: unknown,
): CompetitionLifecycleRpcResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = Number(item.id);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof item.organisation_slug !== "string" ||
    typeof item.season_slug !== "string" ||
    typeof item.competition_slug !== "string" ||
    !routeSafeSlugPattern.test(item.organisation_slug) ||
    !routeSafeSlugPattern.test(item.season_slug) ||
    !routeSafeSlugPattern.test(item.competition_slug) ||
    (item.status !== undefined &&
      !COMPETITION_STATUSES.includes(item.status as CompetitionStatus))
  ) {
    return null;
  }
  return item as CompetitionLifecycleRpcResult;
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, authenticated: !error && Boolean(data?.claims?.sub) };
}

async function getSeason(supabase: Awaited<ReturnType<typeof createClient>>, organisationId: number, leagueSeasonId: number) {
  const { data, error } = await supabase.from("league_seasons")
    .select("name, entry_opens_at, entry_closes_at, starts_at, ends_at")
    .eq("id", leagueSeasonId).eq("organisation_id", organisationId).maybeSingle();
  return error || !data ? null : (data as SeasonBoundaryContext);
}

type CompetitionMutationError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function mutationMessage(error: CompetitionMutationError, fallback: string) {
  if (error.code === "42501" && (
    error.message === "Only this organisation owner can create competitions." ||
    error.message === "Only this organisation owner can edit competitions."
  )) {
    return "Only this organisation’s active owner can manage competitions.";
  }
  if (error.code === "42501" && error.message === "Authentication is required.") {
    return "Sign in again before saving the Competition.";
  }
  if (error.code === "P0002") return "That Competition, Season, or organisation is no longer available. Refresh and try again.";
  if (error.code === "23505") return "A competition with this name already exists in this Season.";
  if ((error.code === "22023" || error.code === "23514") && error.message) return error.message;
  return fallback;
}

async function reportMutationError(
  operation: "create" | "update",
  error: CompetitionMutationError,
  supabase: Awaited<ReturnType<typeof createClient>>,
  context: {
    organisationId: number;
    leagueSeasonId: number;
    competitionId?: number;
  },
) {
  if (process.env.NODE_ENV === "production") return;

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const authUserId = claimsData?.claims?.sub;
  const [seasonResult, staffResult, competitionResult] = await Promise.all([
    supabase
      .from("league_seasons")
      .select("id, organisation_id")
      .eq("id", context.leagueSeasonId)
      .maybeSingle(),
    authUserId
      ? supabase
        .from("organisation_staff")
        .select("organisation_id, user_id, role, status")
        .eq("organisation_id", context.organisationId)
        .eq("user_id", authUserId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    context.competitionId
      ? supabase
        .from("competitions")
        .select("id, league_season_id")
        .eq("id", context.competitionId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  console.error(`[competition:${operation}] RPC failed`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
    authorizationContext: {
      authUserId: authUserId ?? null,
      submittedOrganisationId: context.organisationId,
      submittedSeasonId: context.leagueSeasonId,
      submittedCompetitionId: context.competitionId ?? null,
      resolvedSeasonOrganisationId:
        seasonResult.data?.organisation_id ?? null,
      resolvedCompetitionSeasonId:
        competitionResult.data?.league_season_id ?? null,
      activeStaffRowFound: staffResult.data?.status === "active",
      resolvedStaffOrganisationId:
        staffResult.data?.organisation_id ?? null,
      resolvedStaffRole: staffResult.data?.role ?? null,
      resolvedStaffStatus: staffResult.data?.status ?? null,
      diagnosticErrors: {
        claims: claimsError?.message ?? null,
        season: seasonResult.error?.message ?? null,
        staff: staffResult.error?.message ?? null,
        competition: competitionResult.error?.message ?? null,
      },
    },
  });
}

function revalidateCompetitionRoutes(result: CompetitionRpcResult) {
  const organisationPath = `/organisations/${result.organisation_slug}`;
  const seasonPath = `${organisationPath}/leagues/${result.season_slug}`;
  const competitionPath = `${seasonPath}/competitions/${result.competition_slug}`;
  revalidatePath(organisationPath);
  revalidatePath(`${organisationPath}/leagues`);
  revalidatePath(seasonPath);
  revalidatePath(competitionPath);
  revalidatePath(`${competitionPath}/edit`);
  revalidatePath("/clubs", "layout");
}

function lifecycleErrorMessage(
  error: CompetitionMutationError,
  fallback: string,
) {
  if (
    error.code === "42501" &&
    error.message ===
      "Only this organisation owner can manage this Competition lifecycle."
  ) {
    return "Only this organisation’s active owner can manage this Competition lifecycle.";
  }
  if (error.code === "42501" && error.message === "Authentication is required.") {
    return "Sign in again before continuing.";
  }
  if (error.code === "P0002") {
    return "That Competition, Season, or organisation is no longer available. Refresh and try again.";
  }
  if ((error.code === "22023" || error.code === "23514") && error.message) {
    return error.message;
  }
  return fallback;
}

async function prepareLifecycleMutation(formData: FormData) {
  const organisationId = readPositiveInteger(formData.get("organisation_id"));
  const leagueSeasonId = readPositiveInteger(formData.get("league_season_id"));
  const competitionId = readPositiveInteger(formData.get("competition_id"));
  if (!organisationId || !leagueSeasonId || !competitionId) {
    return {
      error: "The Competition could not be identified. Refresh and try again.",
    } as const;
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { error: "Sign in again before continuing." } as const;
  }

  return {
    organisationId,
    leagueSeasonId,
    competitionId,
    supabase,
  } as const;
}

function reportLifecycleError(
  operation: "publish" | "return-to-draft" | "delete",
  error: CompetitionMutationError,
) {
  if (process.env.NODE_ENV === "production") return;
  console.error(`[competition:${operation}] lifecycle RPC failed`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

function revalidateLifecycleResult(result: CompetitionLifecycleRpcResult) {
  const organisationPath = `/organisations/${result.organisation_slug}`;
  const seasonPath = `${organisationPath}/leagues/${result.season_slug}`;
  const competitionPath = `${seasonPath}/competitions/${result.competition_slug}`;
  revalidatePath(organisationPath);
  revalidatePath(`${organisationPath}/leagues`);
  revalidatePath(seasonPath);
  revalidatePath(competitionPath);
  revalidatePath(`${competitionPath}/edit`);
  revalidatePath("/clubs", "layout");
}

async function prepare(formData: FormData) {
  const organisationId = readPositiveInteger(formData.get("organisation_id"));
  const leagueSeasonId = readPositiveInteger(formData.get("league_season_id"));
  const values = readValues(formData);
  if (!organisationId || !leagueSeasonId) return { error: "The Season could not be identified. Refresh and try again.", values } as const;
  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) return { error: "Sign in again before saving the Competition.", values } as const;
  const season = await getSeason(supabase, organisationId, leagueSeasonId);
  if (!season) return { error: "The Season could not be loaded. Refresh and try again.", values } as const;
  return { organisationId, leagueSeasonId, values, supabase, season } as const;
}

export async function createCompetition(_previousState: CompetitionFormState, formData: FormData): Promise<CompetitionFormState> {
  const prepared = await prepare(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error, values: prepared.values };
  const { organisationId, leagueSeasonId, values, supabase, season } = prepared;
  const fieldErrors = validateStructuralValues(values, season);
  if (Object.keys(fieldErrors).length) return { status: "error", message: "Review the highlighted Competition details and try again.", fieldErrors, values };
  const { data, error } = await supabase.rpc("create_competition", {
    p_organisation_id: organisationId, p_league_season_id: leagueSeasonId, ...getRpcValues(values),
  });
  if (error) {
    await reportMutationError("create", error, supabase, {
      organisationId,
      leagueSeasonId,
    });
    return { status: "error", message: mutationMessage(error, "The Competition could not be created. Check the development server log for the database error."), values };
  }
  const result = readRpcResult(data);
  if (!result) return { status: "error", message: "The Competition was created, but its page could not be opened automatically.", values };
  revalidateCompetitionRoutes(result);
  redirect(`/organisations/${result.organisation_slug}/leagues/${result.season_slug}/competitions/${result.competition_slug}?created=1`);
}

export async function updateCompetition(_previousState: CompetitionFormState, formData: FormData): Promise<CompetitionFormState> {
  const competitionId = readPositiveInteger(formData.get("competition_id"));
  const currentStatus = String(formData.get("current_status") ?? "draft");
  const intent = String(formData.get("intent") ?? "save");
  const desiredStatus: CompetitionStatus = intent === "publish" || currentStatus === "published" ? "published" : "draft";
  const prepared = await prepare(formData);
  if ("error" in prepared || !competitionId) {
    return { status: "error", message: "error" in prepared ? prepared.error : "The Competition could not be identified.", values: prepared.values };
  }
  const { organisationId, leagueSeasonId, values, supabase, season } = prepared;
  const fieldErrors = validateStructuralValues(values, season);
  const publishErrors = desiredStatus === "published" ? getPublishErrors(values, season) : [];
  if (Object.keys(fieldErrors).length || publishErrors.length) {
    return { status: "error", message: desiredStatus === "published" ? "This Competition isn’t ready to publish." : "Review the highlighted Competition details and try again.", fieldErrors, publishErrors, values };
  }
  const { data, error } = await supabase.rpc("update_competition", {
    p_organisation_id: organisationId, p_league_season_id: leagueSeasonId,
    p_competition_id: competitionId, ...getRpcValues(values), p_status: desiredStatus,
  });
  if (error) {
    await reportMutationError("update", error, supabase, {
      organisationId,
      leagueSeasonId,
      competitionId,
    });
    return { status: "error", message: mutationMessage(error, "The Competition could not be saved. Check the development server log for the database error."), values };
  }
  const result = readRpcResult(data);
  if (!result) return { status: "error", message: "The Competition was saved, but the refreshed details could not be verified.", values };
  revalidateCompetitionRoutes(result);
  const successQuery = intent === "publish" ? "published=1" : "saved=1";
  redirect(`/organisations/${result.organisation_slug}/leagues/${result.season_slug}/competitions/${result.competition_slug}?${successQuery}`);
}

export async function publishCompetitionFromDetail(
  _previousState: CompetitionLifecycleActionState,
  formData: FormData,
): Promise<CompetitionLifecycleActionState> {
  const prepared = await prepareLifecycleMutation(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const { organisationId, leagueSeasonId, competitionId, supabase } = prepared;
  const { data, error } = await supabase.rpc("publish_competition", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    p_competition_id: competitionId,
  });
  if (error) {
    reportLifecycleError("publish", error);
    return {
      status: "error",
      message: lifecycleErrorMessage(
        error,
        "The Competition could not be published. Please try again.",
      ),
    };
  }
  const result = readLifecycleRpcResult(data);
  if (!result || result.status !== "published") {
    return {
      status: "error",
      message: "The Competition was published, but its refreshed details could not be verified.",
    };
  }
  revalidateLifecycleResult(result);
  redirect(
    `/organisations/${result.organisation_slug}/leagues/${result.season_slug}/competitions/${result.competition_slug}?published=1`,
  );
}

export async function returnCompetitionToDraft(
  _previousState: CompetitionLifecycleActionState,
  formData: FormData,
): Promise<CompetitionLifecycleActionState> {
  const prepared = await prepareLifecycleMutation(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const { organisationId, leagueSeasonId, competitionId, supabase } = prepared;
  const { data, error } = await supabase.rpc("return_competition_to_draft", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    p_competition_id: competitionId,
  });
  if (error) {
    reportLifecycleError("return-to-draft", error);
    return {
      status: "error",
      message: lifecycleErrorMessage(
        error,
        "The Competition could not be returned to draft. Please try again.",
      ),
    };
  }
  const result = readLifecycleRpcResult(data);
  if (!result || result.status !== "draft") {
    return {
      status: "error",
      message: "The Competition changed, but its refreshed details could not be verified.",
    };
  }
  revalidateLifecycleResult(result);
  redirect(
    `/organisations/${result.organisation_slug}/leagues/${result.season_slug}/competitions/${result.competition_slug}?drafted=1`,
  );
}

export async function deleteCompetitionFromDetail(
  _previousState: CompetitionLifecycleActionState,
  formData: FormData,
): Promise<CompetitionLifecycleActionState> {
  const prepared = await prepareLifecycleMutation(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const { organisationId, leagueSeasonId, competitionId, supabase } = prepared;
  const { data, error } = await supabase.rpc("delete_competition", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    p_competition_id: competitionId,
  });
  if (error) {
    reportLifecycleError("delete", error);
    return {
      status: "error",
      message: lifecycleErrorMessage(
        error,
        "The Competition could not be deleted. Please try again.",
      ),
    };
  }
  const result = readLifecycleRpcResult(data);
  if (!result) {
    return {
      status: "error",
      message: "The Competition was deleted, but the Season page could not be opened automatically.",
    };
  }
  revalidateLifecycleResult(result);
  redirect(
    `/organisations/${result.organisation_slug}/leagues/${result.season_slug}?competitionDeleted=1`,
  );
}
