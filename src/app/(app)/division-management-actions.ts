"use server";

import { revalidatePath } from "next/cache";
import {
  resolveDatabaseError,
  type SafeDomainErrorRule,
} from "@/lib/server/database-errors";
import { createClient } from "@/lib/supabase/server";

export type DivisionActionState = {
  status?: "success" | "error";
  message?: string;
};

export type DivisionDraftInput = {
  organisationId: number;
  leagueSeasonId: number;
  competitionId: number;
  targetSize: number;
  startingAverageFingerprint: string | null;
  divisions: Array<{ name: string; entrant_ids: number[] }>;
};

type DivisionIdentity = Pick<
  DivisionDraftInput,
  "organisationId" | "leagueSeasonId" | "competitionId"
>;

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, authenticated: !error && Boolean(data?.claims?.sub) };
}

function validIdentity(input: DivisionIdentity) {
  return (
    positiveInteger(input?.organisationId) !== null &&
    positiveInteger(input?.leagueSeasonId) !== null &&
    positiveInteger(input?.competitionId) !== null
  );
}

function validDraft(input: DivisionDraftInput) {
  const names = new Set<string>();

  return (
    validIdentity(input) &&
    positiveInteger(input.targetSize) !== null &&
    input.targetSize <= 1000 &&
    (input.startingAverageFingerprint === null ||
      /^[0-9a-f]{32}$/.test(input.startingAverageFingerprint)) &&
    Array.isArray(input.divisions) &&
    input.divisions.length <= 200 &&
    input.divisions.every((division) => {
      const name = String(division?.name ?? "").trim();
      const normalisedName = name.toLocaleLowerCase("en-GB");
      const valid =
        name.length >= 1 &&
        name.length <= 80 &&
        !names.has(normalisedName) &&
        Array.isArray(division.entrant_ids) &&
        division.entrant_ids.length <= 20000 &&
        division.entrant_ids.every(
          (entrantId) => positiveInteger(entrantId) !== null,
        );
      names.add(normalisedName);
      return valid;
    }) &&
    input.divisions.reduce(
      (total, division) => total + division.entrant_ids.length,
      0,
    ) <= 20000
  );
}

const divisionDomainErrors: readonly SafeDomainErrorRule[] = [
  {
    code: "40001",
    message: /.+/,
    userMessage:
      "Starting Averages changed since this layout was reviewed. Refresh, review the values, and save again.",
  },
  ...[
    "Save a division draft before publishing.",
    "Divisions cannot be published until the competition entry window has closed.",
    "At least one submitted entrant unit is required before publishing.",
    "Create at least one division before publishing.",
    "Every currently submitted entrant unit must be assigned to exactly one division before publishing.",
    "Target division size must be between 1 and 1,000 entrant units.",
    "Divisions must be supplied as a list.",
    "A competition cannot contain more than 200 divisions.",
    "Choose Edit divisions before changing a published allocation.",
    "Every division needs a name between 1 and 80 characters and an entrant list.",
    "Division names must be unique within the competition.",
    "A division draft cannot contain more than 20,000 assignments.",
    "Every assignment must reference a valid entrant unit.",
    "An entrant unit can only appear in one division.",
    "Only currently submitted entrant units from this exact competition may be assigned.",
  ].map((message) => ({
    code: ["22023", "23505", "23514"] as const,
    message,
    userMessage: message,
  })),
];

function divisionError(
  error: { code?: string; message?: string },
  fallback: string,
  operation: string,
  identity: DivisionIdentity,
): DivisionActionState {
  return {
    status: "error",
    message: resolveDatabaseError(error, {
      operation,
      entityIds: {
        organisationId: identity.organisationId,
        leagueSeasonId: identity.leagueSeasonId,
        competitionId: identity.competitionId,
      },
      authorizationMessage:
        "Only an active owner or manager of this exact organisation can manage these divisions.",
      missingMessage:
        "That Competition or its Division setup is no longer available. Refresh and try again.",
      unexpectedMessage: fallback,
      safeDomainErrors: divisionDomainErrors,
    }).message,
  };
}

function revalidateDivisionViews() {
  revalidatePath("/organisations", "layout");
  revalidatePath("/clubs", "layout");
}

export async function saveCompetitionDivisionDraft(
  input: DivisionDraftInput,
): Promise<DivisionActionState> {
  if (!validDraft(input)) {
    return {
      status: "error",
      message: "The division layout is invalid. Review it and try again.",
    };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before saving." };
  }

  const { error } = await supabase.rpc("save_competition_division_draft_with_average_review", {
    p_organisation_id: input.organisationId,
    p_league_season_id: input.leagueSeasonId,
    p_competition_id: input.competitionId,
    p_target_size: input.targetSize,
    p_divisions: input.divisions,
    p_starting_average_fingerprint: input.startingAverageFingerprint,
  });

  if (error) {
    return divisionError(
      error,
      "The division draft could not be saved. Please try again.",
      "competition-divisions.save-draft",
      input,
    );
  }

  revalidateDivisionViews();
  return { status: "success", message: "Division draft saved." };
}

export async function publishCompetitionDivisions(
  input: DivisionDraftInput,
): Promise<DivisionActionState> {
  if (!validDraft(input)) {
    return {
      status: "error",
      message: "The division layout is invalid. Review it and try again.",
    };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before publishing." };
  }

  const { error } = await supabase.rpc("save_and_publish_competition_divisions_with_average_review", {
    p_organisation_id: input.organisationId,
    p_league_season_id: input.leagueSeasonId,
    p_competition_id: input.competitionId,
    p_target_size: input.targetSize,
    p_divisions: input.divisions,
    p_starting_average_fingerprint: input.startingAverageFingerprint,
  });

  if (error) {
    return divisionError(
      error,
      "The divisions could not be published. Please try again.",
      "competition-divisions.publish",
      input,
    );
  }

  revalidateDivisionViews();
  return { status: "success", message: "Divisions published." };
}

export async function editCompetitionDivisions(
  input: DivisionIdentity,
): Promise<DivisionActionState> {
  if (!validIdentity(input)) {
    return { status: "error", message: "The competition could not be identified." };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before editing." };
  }

  const { error } = await supabase.rpc("edit_competition_divisions", {
    p_organisation_id: input.organisationId,
    p_league_season_id: input.leagueSeasonId,
    p_competition_id: input.competitionId,
  });

  if (error) {
    return divisionError(
      error,
      "The divisions could not be returned to draft.",
      "competition-divisions.edit",
      input,
    );
  }

  revalidateDivisionViews();
  return { status: "success", message: "Divisions are editable again." };
}
