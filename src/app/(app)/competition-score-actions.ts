"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CompetitionScoreActionState = {
  status?: "success" | "error";
  message?: string;
  errorKind?:
    | "stale"
    | "shared_authority"
    | "ambiguous_participant"
    | "source_conflict"
    | "validation"
    | "unavailable"
    | "unknown";
  sourceVersions?: Record<string, number | null>;
  shared?: boolean;
  linkedUsageCount?: number;
  sharedClearCount?: number;
  recordedParticipantCount?: number;
};

export type CompetitionScoreBatchInput = {
  organisationId: number;
  leagueSeasonId: number;
  competitionId: number;
  competitionRoundId: number;
  clubId: number | null;
  scores: Array<{
    participant_id: number;
    source_version?: number | null;
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
        (score.source_version === undefined ||
          score.source_version === null ||
          positiveInteger(score.source_version) !== null) &&
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
  const message = databaseMessage ?? "";

  if (/Archived Concurrent score provenance is read-only/i.test(message)) {
    return {
      status: "error",
      errorKind: "unavailable",
      message:
        "This Concurrent Shooting group was archived while you were editing. Its shared scores are now read-only; refresh the page to view the preserved result.",
    };
  }

  if (/ambiguous|appears more than once/i.test(message)) {
    return {
      status: "error",
      errorKind: "ambiguous_participant",
      message:
        "Shared scoring is blocked because a shooter appears more than once in a linked Competition. Organisation staff must resolve the participant data before scoring can continue.",
    };
  }

  if (/different score source|conflict(?:ing|s)?|provenance/i.test(message)) {
    return {
      status: "error",
      errorKind: "source_conflict",
      message:
        "Shared scoring is blocked by conflicting score data in a linked Competition. Organisation staff must resolve the conflict before scoring can continue.",
    };
  }

  if (code === "40001") {
    return {
      status: "error",
      errorKind: "stale",
      message:
        "This score was updated elsewhere after you opened this page. Refresh the latest score before editing again.",
    };
  }

  if (
    /Shared score requires Organisation scoring|outside (?:this )?club scope|outside local scoring authority|linked Competition.*cutoff/i.test(
      message,
    )
  ) {
    return {
      status: "error",
      errorKind: "shared_authority",
      message:
        "This shared score cannot be edited from this club account because one or more linked Competitions are outside your scoring permissions or scoring window. An Organisation scorer must make this change.",
    };
  }

  if (code === "42501") {
    return {
      status: "error",
      errorKind: "shared_authority",
      message:
        "You no longer have permission to edit scores in this scoring scope. Refresh the page or ask an Organisation scorer for help.",
    };
  }

  if (code === "P0002") {
    return {
      status: "error",
      errorKind: "unavailable",
      message:
        "That Competition or Round is no longer available for score entry. Refresh and try again.",
    };
  }

  if (/has not started|before the effective Competition Start/i.test(message)) {
    return {
      status: "error",
      errorKind: "unavailable",
      message:
        "Scores cannot be edited until every affected Competition is open for scoring. Refresh and try again after scoring opens.",
    };
  }

  if (/local score-entry cutoff|organisation score entry only/i.test(message)) {
    return {
      status: "error",
      errorKind: "shared_authority",
      message:
        "This score is outside the current account’s scoring permissions or scoring window. An Organisation scorer must make this change.",
    };
  }

  if (["22023", "23503", "23505", "23514"].includes(code ?? "")) {
    return {
      status: "error",
      errorKind: "validation",
      message:
        "The score form could not be saved. Review the entered values, refresh if participant data changed, and try again.",
    };
  }

  return {
    status: "error",
    errorKind: "unknown",
    message:
      "Scores could not be saved. Refresh the page and try again. If the problem continues, ask Organisation staff for help.",
  };
}

export async function saveCompetitionRoundScores(
  input: CompetitionScoreBatchInput,
): Promise<CompetitionScoreActionState> {
  if (!validBatch(input)) {
    return {
      status: "error",
      errorKind: "validation",
      message: "The score form contains an invalid value. Review it and try again.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    return {
      status: "error",
      errorKind: "unavailable",
      message: "Sign in again before saving scores.",
    };
  }

  const { data, error } = await supabase.rpc(
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

  const result = data && typeof data === "object" && !Array.isArray(data)
      ? (data as {
        shared?: boolean;
        shared_clear_count?: number;
        linked_usage_count?: number;
        recorded_participant_count?: number;
        source_versions?: Record<string, number | null>;
      })
    : {};

  revalidatePath("/organisations", "layout");
  revalidatePath("/clubs", "layout");

  return {
    status: "success",
    message:
      result.shared && (result.shared_clear_count ?? 0) > 0
        ? "Shared physical score cleared across every linked Competition."
        : result.shared
          ? "Shared round scores saved across linked Competitions."
          : "Round scores saved.",
    sourceVersions: result.source_versions,
    shared: result.shared,
    linkedUsageCount: result.linked_usage_count,
    sharedClearCount: result.shared_clear_count,
    recordedParticipantCount: result.recorded_participant_count,
  };
}
