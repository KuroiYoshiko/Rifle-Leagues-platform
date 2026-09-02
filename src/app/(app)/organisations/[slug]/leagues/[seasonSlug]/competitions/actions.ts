"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  COMPETITION_ENTRY_FORMATS,
  COMPETITION_SCORING_METHODS,
  COMPETITION_STATUSES,
  type CompetitionEntryFormat,
  type CompetitionScoringMethod,
  type CompetitionStatus,
} from "@/lib/competitions";
import { formatLeagueSeasonDate } from "@/lib/league-seasons";
import { createClient } from "@/lib/supabase/server";

export type CompetitionField =
  | "name"
  | "description"
  | "entryFormat"
  | "teamSize"
  | "scoringMethod"
  | "maximumScorePerRound"
  | "shotsPerRound"
  | "numberOfRounds"
  | "entryFee"
  | "roundSchedule";

export type CompetitionFormValues = {
  name: string;
  description: string;
  entryFormat: string;
  teamSize: string;
  scoringMethod: string;
  maximumScorePerRound: string;
  shotsPerRound: string;
  usesXScore: boolean;
  numberOfRounds: string;
  entryFee: string;
  roundDeadlines: string[];
};

export type CompetitionFormState = {
  status?: "success" | "error";
  message?: string;
  values?: CompetitionFormValues;
  fieldErrors?: Partial<Record<CompetitionField, string>>;
  publishErrors?: string[];
};

type CompetitionRpcResult = {
  id: number;
  organisation_slug: string;
  season_slug: string;
  competition_slug: string;
  status: CompetitionStatus;
};

type SeasonBoundaryContext = {
  name: string;
  starts_at: string | null;
  ends_at: string | null;
};

const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const moneyPattern = /^\d+(?:\.\d{1,2})?$/;
const earliestRoundDate = "1900-01-01";
const latestRoundDate = "2200-12-31";

function readPositiveInteger(value: FormDataEntryValue | null) {
  const rawValue = String(value ?? "").trim();
  const parsedValue = Number(rawValue);

  return /^\d+$/.test(rawValue) &&
    Number.isSafeInteger(parsedValue) &&
    parsedValue > 0
    ? parsedValue
    : null;
}

function readOptionalPositiveInteger(value: string) {
  if (!value) return null;
  return readPositiveInteger(value);
}

function readValues(formData: FormData): CompetitionFormValues {
  return {
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    entryFormat: String(formData.get("entry_format") ?? "individual").trim(),
    teamSize: String(formData.get("team_size") ?? "").trim(),
    scoringMethod: String(
      formData.get("scoring_method") ?? "points_dropped",
    ).trim(),
    maximumScorePerRound: String(
      formData.get("maximum_score_per_round") ?? "",
    ).trim(),
    shotsPerRound: String(formData.get("shots_per_round") ?? "").trim(),
    usesXScore: formData.get("uses_x_score") === "on",
    numberOfRounds: String(formData.get("number_of_rounds") ?? "10").trim(),
    entryFee: String(formData.get("entry_fee") ?? "").trim(),
    roundDeadlines: formData
      .getAll("round_deadline")
      .map((value) => String(value).trim()),
  };
}

function isCalendarDate(value: string) {
  if (!calendarDatePattern.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateStructuralValues(values: CompetitionFormValues) {
  const fieldErrors: CompetitionFormState["fieldErrors"] = {};
  const nameLength = [...values.name].length;
  const descriptionLength = [...values.description].length;

  if (!values.name) fieldErrors.name = "Enter the competition name.";
  else if (nameLength < 2 || nameLength > 160) {
    fieldErrors.name = "Use between 2 and 160 characters.";
  }

  if (descriptionLength > 2000) {
    fieldErrors.description = "Use 2,000 characters or fewer.";
  }

  if (
    !COMPETITION_ENTRY_FORMATS.includes(
      values.entryFormat as CompetitionEntryFormat,
    )
  ) {
    fieldErrors.entryFormat = "Select an entry format.";
  } else if (values.entryFormat === "team") {
    const teamSize = readPositiveInteger(values.teamSize);
    if (!teamSize || teamSize < 3 || teamSize > 20) {
      fieldErrors.teamSize = "Team size must be between 3 and 20.";
    }
  }

  if (
    !COMPETITION_SCORING_METHODS.includes(
      values.scoringMethod as CompetitionScoringMethod,
    )
  ) {
    fieldErrors.scoringMethod = "Select a scoring method.";
  }

  const maximumScore = readOptionalPositiveInteger(
    values.maximumScorePerRound,
  );
  if (
    values.maximumScorePerRound &&
    (!maximumScore || maximumScore > 1_000_000)
  ) {
    fieldErrors.maximumScorePerRound =
      "Use a whole number from 1 to 1,000,000.";
  }

  const shotsPerRound = readOptionalPositiveInteger(values.shotsPerRound);
  if (values.shotsPerRound && (!shotsPerRound || shotsPerRound > 10_000)) {
    fieldErrors.shotsPerRound = "Use a whole number from 1 to 10,000.";
  }

  const numberOfRounds = readPositiveInteger(values.numberOfRounds);
  if (!numberOfRounds || numberOfRounds > 52) {
    fieldErrors.numberOfRounds = "Number of rounds must be between 1 and 52.";
  }

  if (values.entryFee) {
    const entryFee = Number(values.entryFee);
    if (
      !moneyPattern.test(values.entryFee) ||
      !Number.isFinite(entryFee) ||
      entryFee < 0 ||
      entryFee > 10_000
    ) {
      fieldErrors.entryFee =
        "Use an amount from £0 to £10,000 with up to two decimal places.";
    }
  }

  if (
    values.roundDeadlines.length > 0 &&
    numberOfRounds &&
    values.roundDeadlines.length !== numberOfRounds
  ) {
    fieldErrors.roundSchedule =
      "Regenerate the schedule after changing the number of rounds.";
  }

  let previousDeadline: string | null = null;
  for (const [index, deadline] of values.roundDeadlines.entries()) {
    if (!deadline) continue;

    if (
      !isCalendarDate(deadline) ||
      deadline < earliestRoundDate ||
      deadline > latestRoundDate
    ) {
      fieldErrors.roundSchedule = `Round ${index + 1} must use a valid date between 1900 and 2200.`;
      break;
    }

    if (previousDeadline && deadline < previousDeadline) {
      fieldErrors.roundSchedule = `Round ${index + 1} cannot be before an earlier round deadline.`;
      break;
    }

    previousDeadline = deadline;
  }

  return fieldErrors;
}

function getPublishErrors(
  values: CompetitionFormValues,
  season: SeasonBoundaryContext,
) {
  const errors: string[] = [];
  const numberOfRounds = readPositiveInteger(values.numberOfRounds);

  if (!values.maximumScorePerRound) {
    errors.push("Set the maximum score per round.");
  }

  if (!values.shotsPerRound) {
    errors.push("Set the shots per round.");
  }

  if (
    numberOfRounds &&
    (values.roundDeadlines.length !== numberOfRounds ||
      values.roundDeadlines.some((deadline) => !deadline))
  ) {
    errors.push(`Generate deadlines for all ${numberOfRounds} rounds.`);
  }

  for (const [index, deadline] of values.roundDeadlines.entries()) {
    if (!deadline || !isCalendarDate(deadline)) continue;

    if (season.starts_at && deadline < season.starts_at) {
      errors.push(
        `Round ${index + 1} must fall on or after ${formatLeagueSeasonDate(season.starts_at)} for the ${season.name} season.`,
      );
    }

    if (season.ends_at && deadline > season.ends_at) {
      errors.push(
        `Round ${index + 1} must fall on or before ${formatLeagueSeasonDate(season.ends_at)} for the ${season.name} season.`,
      );
    }
  }

  return errors;
}

function readRpcResult(value: unknown): CompetitionRpcResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const id = Number(candidate.id);
  const organisationSlug = candidate.organisation_slug;
  const seasonSlug = candidate.season_slug;
  const competitionSlug = candidate.competition_slug;
  const status = candidate.status;

  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof organisationSlug !== "string" ||
    typeof seasonSlug !== "string" ||
    typeof competitionSlug !== "string" ||
    organisationSlug.length > 180 ||
    seasonSlug.length > 180 ||
    competitionSlug.length > 180 ||
    !routeSafeSlugPattern.test(organisationSlug) ||
    !routeSafeSlugPattern.test(seasonSlug) ||
    !routeSafeSlugPattern.test(competitionSlug) ||
    typeof status !== "string" ||
    !COMPETITION_STATUSES.includes(status as CompetitionStatus)
  ) {
    return null;
  }

  return {
    id,
    organisation_slug: organisationSlug,
    season_slug: seasonSlug,
    competition_slug: competitionSlug,
    status: status as CompetitionStatus,
  };
}

async function createAuthenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return {
    supabase,
    authenticated: !error && Boolean(data?.claims?.sub),
  };
}

async function getSeasonBoundaryContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: number,
  leagueSeasonId: number,
) {
  const { data, error } = await supabase
    .from("league_seasons")
    .select("name, starts_at, ends_at")
    .eq("id", leagueSeasonId)
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as SeasonBoundaryContext;
}

function mutationErrorMessage(
  code: string | undefined,
  databaseMessage: string | undefined,
  fallback: string,
) {
  if (code === "42501") {
    return "Only this organisation’s active owner can manage competitions.";
  }

  if (code === "P0002") {
    return "That competition, league season, or active organisation is no longer available. Refresh and try again.";
  }

  if (code === "23505") {
    return "A competition with this name already exists in this league season.";
  }

  if ((code === "22023" || code === "23514") && databaseMessage) {
    return databaseMessage;
  }

  return fallback;
}

function getRpcValues(values: CompetitionFormValues) {
  const entryFormat = values.entryFormat as CompetitionEntryFormat;
  const teamSize =
    entryFormat === "individual"
      ? 1
      : entryFormat === "pairs"
        ? 2
        : Number(values.teamSize);

  return {
    p_name: values.name,
    p_description: values.description || null,
    p_entry_format: entryFormat,
    p_team_size: teamSize,
    p_scoring_method: values.scoringMethod as CompetitionScoringMethod,
    p_maximum_score_per_round: values.maximumScorePerRound
      ? Number(values.maximumScorePerRound)
      : null,
    p_shots_per_round: values.shotsPerRound
      ? Number(values.shotsPerRound)
      : null,
    p_uses_x_score: values.usesXScore,
    p_number_of_rounds: Number(values.numberOfRounds),
    p_entry_fee: values.entryFee ? Number(values.entryFee) : null,
    p_round_deadlines:
      values.roundDeadlines.length > 0
        ? values.roundDeadlines.map((deadline) => deadline || null)
        : [],
  };
}

function revalidateCompetitionRoutes(result: CompetitionRpcResult) {
  const organisationPath = `/organisations/${result.organisation_slug}`;
  const leaguePath = `${organisationPath}/leagues/${result.season_slug}`;
  const competitionPath = `${leaguePath}/competitions/${result.competition_slug}`;

  revalidatePath(organisationPath);
  revalidatePath(`${organisationPath}/leagues`);
  revalidatePath(leaguePath);
  revalidatePath(competitionPath);
  revalidatePath(`${competitionPath}/edit`);
}

export async function createCompetition(
  _previousState: CompetitionFormState,
  formData: FormData,
): Promise<CompetitionFormState> {
  const organisationId = readPositiveInteger(formData.get("organisation_id"));
  const leagueSeasonId = readPositiveInteger(formData.get("league_season_id"));
  const values = readValues(formData);
  const fieldErrors = validateStructuralValues(values);

  if (!organisationId || !leagueSeasonId) {
    return {
      status: "error",
      message: "The league season could not be identified. Refresh and try again.",
      values,
    };
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Review the highlighted competition details and try again.",
      fieldErrors,
      values,
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) {
    return {
      status: "error",
      message: "Sign in again before creating the competition.",
      values,
    };
  }

  const season = await getSeasonBoundaryContext(
    supabase,
    organisationId,
    leagueSeasonId,
  );
  if (!season) {
    return {
      status: "error",
      message: "The league season could not be loaded. Refresh and try again.",
      values,
    };
  }

  const boundaryErrors = getPublishErrors(
    { ...values, maximumScorePerRound: "1", shotsPerRound: "1" },
    season,
  ).filter((error) => error.startsWith("Round "));

  if (boundaryErrors.length > 0) {
    return {
      status: "error",
      message: "Review the round schedule and try again.",
      fieldErrors: { roundSchedule: boundaryErrors[0] },
      values,
    };
  }

  const { data, error } = await supabase.rpc("create_competition", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    ...getRpcValues(values),
  });

  if (error) {
    return {
      status: "error",
      message: mutationErrorMessage(
        error.code,
        error.message,
        "The competition could not be created. Check that the latest competition SQL has been run, then try again.",
      ),
      values,
    };
  }

  const result = readRpcResult(data);
  if (!result) {
    return {
      status: "error",
      message:
        "The competition was created, but its page could not be opened automatically. Return to the league season to find it.",
      values,
    };
  }

  revalidateCompetitionRoutes(result);
  redirect(
    `/organisations/${result.organisation_slug}/leagues/${result.season_slug}/competitions/${result.competition_slug}?created=1`,
  );
}

export async function updateCompetition(
  _previousState: CompetitionFormState,
  formData: FormData,
): Promise<CompetitionFormState> {
  const organisationId = readPositiveInteger(formData.get("organisation_id"));
  const leagueSeasonId = readPositiveInteger(formData.get("league_season_id"));
  const competitionId = readPositiveInteger(formData.get("competition_id"));
  const currentStatus = String(formData.get("current_status") ?? "draft");
  const intent = String(formData.get("intent") ?? "save");
  const desiredStatus: CompetitionStatus =
    intent === "publish" || currentStatus === "published"
      ? "published"
      : "draft";
  const values = readValues(formData);
  const fieldErrors = validateStructuralValues(values);

  if (!organisationId || !leagueSeasonId || !competitionId) {
    return {
      status: "error",
      message: "The competition could not be identified. Refresh and try again.",
      values,
    };
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message:
        desiredStatus === "published"
          ? "This competition isn't ready to publish."
          : "Review the highlighted competition details and try again.",
      fieldErrors,
      values,
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) {
    return {
      status: "error",
      message: "Sign in again before saving the competition.",
      values,
    };
  }

  const season = await getSeasonBoundaryContext(
    supabase,
    organisationId,
    leagueSeasonId,
  );
  if (!season) {
    return {
      status: "error",
      message: "The league season could not be loaded. Refresh and try again.",
      values,
    };
  }

  const publishErrors = getPublishErrors(values, season);
  const boundaryErrors = publishErrors.filter((error) =>
    error.startsWith("Round "),
  );

  if (desiredStatus === "published" && publishErrors.length > 0) {
    return {
      status: "error",
      message: "This competition isn't ready to publish.",
      publishErrors,
      fieldErrors:
        boundaryErrors.length > 0
          ? { roundSchedule: boundaryErrors[0] }
          : undefined,
      values,
    };
  }

  if (boundaryErrors.length > 0) {
    return {
      status: "error",
      message: "Review the round schedule and try again.",
      fieldErrors: { roundSchedule: boundaryErrors[0] },
      values,
    };
  }

  const { data, error } = await supabase.rpc("update_competition", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    p_competition_id: competitionId,
    ...getRpcValues(values),
    p_status: desiredStatus,
  });

  if (error) {
    return {
      status: "error",
      message: mutationErrorMessage(
        error.code,
        error.message,
        "The competition could not be saved. Please try again.",
      ),
      values,
    };
  }

  const result = readRpcResult(data);
  if (!result) {
    return {
      status: "error",
      message:
        "The competition was saved, but the refreshed details could not be verified. Return to the league season and open it again.",
      values,
    };
  }

  revalidateCompetitionRoutes(result);

  if (intent === "publish") {
    redirect(
      `/organisations/${result.organisation_slug}/leagues/${result.season_slug}/competitions/${result.competition_slug}?published=1`,
    );
  }

  return {
    status: "success",
    message:
      desiredStatus === "published"
        ? "Published competition saved."
        : "Draft competition saved.",
    values,
  };
}
