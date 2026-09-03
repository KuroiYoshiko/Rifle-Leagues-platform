"use server";

import { revalidatePath } from "next/cache";
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

function divisionError(
  code: string | undefined,
  databaseMessage: string | undefined,
  fallback: string,
): DivisionActionState {
  if (code === "42501") {
    return {
      status: "error",
      message:
        "Only an active owner or manager of this exact organisation can manage these divisions.",
    };
  }

  if (code === "22023" || code === "23505" || code === "23514") {
    return { status: "error", message: databaseMessage || fallback };
  }

  return { status: "error", message: fallback };
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

  const { error } = await supabase.rpc("save_competition_division_draft", {
    p_organisation_id: input.organisationId,
    p_league_season_id: input.leagueSeasonId,
    p_competition_id: input.competitionId,
    p_target_size: input.targetSize,
    p_divisions: input.divisions,
  });

  if (error) {
    return divisionError(
      error.code,
      error.message,
      "The division draft could not be saved. Check that the latest division SQL has been run, then try again.",
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

  const { error } = await supabase.rpc("save_and_publish_competition_divisions", {
    p_organisation_id: input.organisationId,
    p_league_season_id: input.leagueSeasonId,
    p_competition_id: input.competitionId,
    p_target_size: input.targetSize,
    p_divisions: input.divisions,
  });

  if (error) {
    return divisionError(
      error.code,
      error.message,
      "The divisions could not be published. Please try again.",
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
      error.code,
      error.message,
      "The divisions could not be returned to draft.",
    );
  }

  revalidateDivisionViews();
  return { status: "success", message: "Divisions are editable again." };
}
