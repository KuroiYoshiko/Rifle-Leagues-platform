"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  LEAGUE_SEASON_STATUSES,
  type LeagueSeasonStatus,
} from "@/lib/league-seasons";
import { createClient } from "@/lib/supabase/server";

type LeagueSeasonField =
  | "name"
  | "entryOpensAt"
  | "entryClosesAt"
  | "startsAt"
  | "endsAt"
  | "status";

export type LeagueSeasonFormValues = Record<LeagueSeasonField, string>;

export type LeagueSeasonFormState = {
  status?: "success" | "error";
  message?: string;
  values?: LeagueSeasonFormValues;
  fieldErrors?: Partial<Record<LeagueSeasonField, string>>;
};

type LeagueSeasonRpcResult = {
  id: number;
  organisation_slug: string;
  season_slug: string;
  status: LeagueSeasonStatus;
};

const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function readPositiveInteger(value: FormDataEntryValue | null) {
  const rawValue = String(value ?? "").trim();
  const parsedValue = Number(rawValue);

  return /^\d+$/.test(rawValue) &&
    Number.isSafeInteger(parsedValue) &&
    parsedValue > 0
    ? parsedValue
    : null;
}

function readValues(formData: FormData): LeagueSeasonFormValues {
  return {
    name: String(formData.get("name") ?? "").trim(),
    entryOpensAt: String(formData.get("entry_opens_at") ?? "").trim(),
    entryClosesAt: String(formData.get("entry_closes_at") ?? "").trim(),
    startsAt: String(formData.get("starts_at") ?? "").trim(),
    endsAt: String(formData.get("ends_at") ?? "").trim(),
    status: String(formData.get("status") ?? "draft").trim(),
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

function validateValues(values: LeagueSeasonFormValues, editing: boolean) {
  const fieldErrors: LeagueSeasonFormState["fieldErrors"] = {};
  const nameLength = [...values.name].length;

  if (!values.name) fieldErrors.name = "Enter the league name.";
  else if (nameLength < 2 || nameLength > 160) {
    fieldErrors.name = "Use between 2 and 160 characters.";
  }

  const dateFields: Array<
    [Exclude<LeagueSeasonField, "name" | "status">, string]
  > = [
    ["entryOpensAt", "Entry opens"],
    ["entryClosesAt", "Entry closes"],
    ["startsAt", "Starts"],
    ["endsAt", "Ends"],
  ];

  for (const [field, label] of dateFields) {
    if (values[field] && !isCalendarDate(values[field])) {
      fieldErrors[field] = `${label} must be a valid date.`;
    }
  }

  if (
    !fieldErrors.entryOpensAt &&
    !fieldErrors.entryClosesAt &&
    values.entryOpensAt &&
    values.entryClosesAt &&
    values.entryClosesAt < values.entryOpensAt
  ) {
    fieldErrors.entryClosesAt =
      "Entry closes cannot be before entry opens.";
  }

  if (
    !fieldErrors.startsAt &&
    !fieldErrors.endsAt &&
    values.startsAt &&
    values.endsAt &&
    values.endsAt < values.startsAt
  ) {
    fieldErrors.endsAt = "Ends cannot be before starts.";
  }

  if (
    editing &&
    !LEAGUE_SEASON_STATUSES.includes(values.status as LeagueSeasonStatus)
  ) {
    fieldErrors.status = "Select an available league status.";
  }

  return fieldErrors;
}

function readRpcResult(value: unknown): LeagueSeasonRpcResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const id = Number(candidate.id);
  const organisationSlug = candidate.organisation_slug;
  const seasonSlug = candidate.season_slug;
  const status = candidate.status;

  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof organisationSlug !== "string" ||
    typeof seasonSlug !== "string" ||
    organisationSlug.length > 180 ||
    seasonSlug.length > 180 ||
    !routeSafeSlugPattern.test(organisationSlug) ||
    !routeSafeSlugPattern.test(seasonSlug) ||
    typeof status !== "string" ||
    !LEAGUE_SEASON_STATUSES.includes(status as LeagueSeasonStatus)
  ) {
    return null;
  }

  return {
    id,
    organisation_slug: organisationSlug,
    season_slug: seasonSlug,
    status: status as LeagueSeasonStatus,
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

function mutationErrorMessage(code: string | undefined, fallback: string) {
  if (code === "42501") {
    return "Only this organisation’s active owner can manage league seasons.";
  }

  if (code === "P0002") {
    return "That league or active organisation is no longer available. Refresh and try again.";
  }

  if (code === "23505") {
    return "A league season with this name already exists in this organisation.";
  }

  if (code === "22023" || code === "23514") {
    return "Some league details were not accepted. Review the form and status transition.";
  }

  return fallback;
}

function revalidateLeagueRoutes(result: LeagueSeasonRpcResult) {
  const organisationPath = `/organisations/${result.organisation_slug}`;
  const leaguePath = `${organisationPath}/leagues/${result.season_slug}`;

  revalidatePath(organisationPath);
  revalidatePath(`${organisationPath}/leagues`);
  revalidatePath(leaguePath);
  revalidatePath(`${leaguePath}/edit`);
}

export async function createLeagueSeason(
  _previousState: LeagueSeasonFormState,
  formData: FormData,
): Promise<LeagueSeasonFormState> {
  const organisationId = readPositiveInteger(formData.get("organisation_id"));
  const values = readValues(formData);
  values.status = "draft";
  const fieldErrors = validateValues(values, false);

  if (!organisationId) {
    return {
      status: "error",
      message: "The organisation could not be identified. Refresh and try again.",
      values,
    };
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Review the highlighted league details and try again.",
      fieldErrors,
      values,
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) {
    return {
      status: "error",
      message: "Sign in again before creating the league.",
      values,
    };
  }

  const { data, error } = await supabase.rpc("create_league_season", {
    p_organisation_id: organisationId,
    p_name: values.name,
    p_entry_opens_at: values.entryOpensAt || null,
    p_entry_closes_at: values.entryClosesAt || null,
    p_starts_at: values.startsAt || null,
    p_ends_at: values.endsAt || null,
  });

  if (error) {
    return {
      status: "error",
      message: mutationErrorMessage(
        error.code,
        "The league season could not be created. Check that the latest league season SQL has been run, then try again.",
      ),
      values,
    };
  }

  const result = readRpcResult(data);
  if (!result) {
    return {
      status: "error",
      message:
        "The league was created, but its page could not be opened automatically. Return to the organisation Leagues page to find it.",
      values,
    };
  }

  revalidateLeagueRoutes(result);
  redirect(
    `/organisations/${result.organisation_slug}/leagues/${result.season_slug}?created=1`,
  );
}

export async function updateLeagueSeason(
  _previousState: LeagueSeasonFormState,
  formData: FormData,
): Promise<LeagueSeasonFormState> {
  const organisationId = readPositiveInteger(formData.get("organisation_id"));
  const leagueSeasonId = readPositiveInteger(formData.get("league_season_id"));
  const values = readValues(formData);
  const fieldErrors = validateValues(values, true);

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
      message: "Review the highlighted league details and try again.",
      fieldErrors,
      values,
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) {
    return {
      status: "error",
      message: "Sign in again before saving the league.",
      values,
    };
  }

  const { data, error } = await supabase.rpc("update_league_season", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    p_name: values.name,
    p_entry_opens_at: values.entryOpensAt || null,
    p_entry_closes_at: values.entryClosesAt || null,
    p_starts_at: values.startsAt || null,
    p_ends_at: values.endsAt || null,
    p_status: values.status,
  });

  if (error) {
    return {
      status: "error",
      message: mutationErrorMessage(
        error.code,
        "The league season could not be saved. Please try again.",
      ),
      values,
    };
  }

  const result = readRpcResult(data);
  if (!result) {
    return {
      status: "error",
      message:
        "The league was saved, but the refreshed details could not be verified. Return to the Leagues page and open it again.",
      values,
    };
  }

  revalidateLeagueRoutes(result);
  return {
    status: "success",
    message: "League season saved.",
    values,
  };
}
