"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CompetitionScoreActionState = {
  status?: "success" | "error";
  message?: string;
};

export type CompetitionScoreBatchInput = {
  organisationId: number;
  leagueSeasonId: number;
  competitionId: number;
  competitionRoundId: number;
  clubId: number | null;
  scores: Array<{
    participant_id: number;
    values: Array<{
      set_number: number;
      component_position: number;
      entered_score: string | null;
      x_count: number | null;
    }>;
  }>;
};

const scorePattern = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/;

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validBatch(input: CompetitionScoreBatchInput) {
  return (
    positiveInteger(input?.organisationId) !== null &&
    positiveInteger(input?.leagueSeasonId) !== null &&
    positiveInteger(input?.competitionId) !== null &&
    positiveInteger(input?.competitionRoundId) !== null &&
    (input.clubId === null || positiveInteger(input.clubId) !== null) &&
    Array.isArray(input.scores) &&
    input.scores.length <= 20_000 &&
    input.scores.every(
      (score) =>
        positiveInteger(score?.participant_id) !== null &&
        Array.isArray(score.values) &&
        score.values.length <= 2_000 &&
        score.values.every(
          (value) =>
            positiveInteger(value?.set_number) !== null &&
            value.set_number <= 100 &&
            positiveInteger(value?.component_position) !== null &&
            value.component_position <= 20 &&
            (value.entered_score === null ||
              (typeof value.entered_score === "string" &&
                scorePattern.test(value.entered_score))) &&
            (value.x_count === null ||
              (Number.isSafeInteger(value.x_count) &&
                value.x_count >= 0 &&
                value.x_count <= 10_000)),
        ),
    )
  );
}

function scoreError(
  code: string | undefined,
  databaseMessage: string | undefined,
): CompetitionScoreActionState {
  if (code === "42501") {
    return {
      status: "error",
      message:
        "You no longer have permission to manage scores in this exact Competition scope.",
    };
  }

  if (code === "P0002") {
    return {
      status: "error",
      message:
        "That Competition or Round is no longer available for score entry. Refresh and try again.",
    };
  }

  if (["22023", "23503", "23505", "23514"].includes(code ?? "")) {
    return {
      status: "error",
      message: databaseMessage || "The score batch is invalid.",
    };
  }

  return {
    status: "error",
    message:
      "Scores could not be saved. Check that the Competition Scores SQL has been run, then try again.",
  };
}

export async function saveIndividualCompetitionRoundScores(
  input: CompetitionScoreBatchInput,
): Promise<CompetitionScoreActionState> {
  if (!validBatch(input)) {
    return {
      status: "error",
      message: "The score form contains an invalid value. Review it and try again.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    return { status: "error", message: "Sign in again before saving scores." };
  }

  const { error } = await supabase.rpc(
    "save_individual_competition_round_scores",
    {
      p_organisation_id: input.organisationId,
      p_league_season_id: input.leagueSeasonId,
      p_competition_id: input.competitionId,
      p_competition_round_id: input.competitionRoundId,
      p_club_id: input.clubId,
      p_scores: input.scores,
    },
  );

  if (error) return scoreError(error.code, error.message);

  revalidatePath("/organisations", "layout");
  revalidatePath("/clubs", "layout");

  return {
    status: "success",
    message: "Round scores saved.",
  };
}
