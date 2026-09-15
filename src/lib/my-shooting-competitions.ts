import { cache } from "react";
import { getCompetitionAggregateResults } from "@/lib/competition-aggregate-results";
import { getCompetitionBestNAverageResults } from "@/lib/competition-best-n-average-results";
import { getCompetitionGunScoreResults } from "@/lib/competition-gun-score-results";
import { getCompetitionResultAverages } from "@/lib/competition-result-averages";
import { getCompetitionRoundRobinResults } from "@/lib/competition-round-robin-results";
import type {
  CompetitionEntryFormat,
  CompetitionRankingMethod,
} from "@/lib/competitions";
import {
  getLeagueSeasonPresentationPhase,
  type LeagueSeasonStatus,
} from "@/lib/league-seasons";
import { createClient } from "@/lib/supabase/server";

export type MyShootingCompetitionTab = "active" | "upcoming" | "completed";

export type MyShootingRound = {
  id: number;
  round_number: number;
  deadline: string;
  shoot_by_date: string | null;
  released: boolean;
};

export type MyShootingParticipant = {
  slot_number: number;
  first_name: string | null;
  last_name: string | null;
  is_current_user: boolean;
};

export type MyShootingCompetitionResult = {
  position: number | null;
  tied: boolean;
  released_round_count: number;
  value_label: string;
  value: number | null;
  starting_average: number | null;
  running_average: number | null;
};

export type MyShootingCompetition = {
  competition_entrant_participant_id: number;
  slot_number: number;
  competition_entrant_id: number;
  entrant_position: number;
  entrant_label: string;
  club_team_id: number | null;
  club_team_name_snapshot: string | null;
  club_competition_entry_id: number;
  entry_status: "submitted";
  submitted_at: string;
  club: { id: number; name: string; slug: string };
  competition: {
    id: number;
    name: string;
    slug: string;
    entry_format: CompetitionEntryFormat;
    team_size: number;
    ranking_method: CompetitionRankingMethod;
    number_of_rounds: number;
    effective_starts_at: string | null;
  };
  season: {
    id: number;
    name: string;
    slug: string;
    status: LeagueSeasonStatus;
    starts_at: string | null;
    ends_at: string | null;
  };
  organisation: { id: number; name: string; slug: string };
  division: { id: number; name: string; position: number } | null;
  participants: MyShootingParticipant[];
  rounds: MyShootingRound[];
  has_released_results: boolean;
  result?: MyShootingCompetitionResult | null;
};

export type MyShootingCompetitions = {
  as_of_date: string;
  competitions: MyShootingCompetition[];
};

type AuthoritativeEntrant = {
  entrant_id: number;
  position?: number | string | null;
  tied?: boolean;
  total_points?: number | string | null;
  qualifying_average?: number | string | null;
  gun_total?: number | string | null;
  total_match_points?: number | string | null;
};

type AuthoritativeResults = {
  status: "ready" | "awaiting_divisions";
  released_round_count?: number;
  groups: Array<{
    entrants: AuthoritativeEntrant[];
  }>;
};

function numericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export const getMyShootingCompetitions = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_shooting_competitions");

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Your competitions could not be loaded.");
  }

  return data as MyShootingCompetitions;
});

export function classifyMyShootingCompetition(
  participation: MyShootingCompetition,
  today: string,
): MyShootingCompetitionTab {
  const seasonPhase = getLeagueSeasonPresentationPhase(
    {
      status: participation.season.status,
      starts_at: participation.competition.effective_starts_at,
      ends_at: participation.season.ends_at,
    },
    today,
  );
  const scheduleCompleted =
    participation.rounds.length > 0 &&
    participation.rounds.every((round) => round.released);

  if (seasonPhase === "completed" || scheduleCompleted) return "completed";
  if (seasonPhase === "upcoming") return "upcoming";
  return "active";
}

export function getNextRelevantRound(participation: MyShootingCompetition) {
  return participation.rounds.find((round) => !round.released) ?? null;
}

export function getMyShootingRoundStatus(
  round: MyShootingRound,
  today: string,
) {
  if (round.deadline === today) return "Round ends today";
  if (!round.shoot_by_date) return "Round in progress";
  if (round.shoot_by_date === today) return "Shoot by today";
  if (round.shoot_by_date < today) return "Shoot-by date passed";
  return "Shoot-by date upcoming";
}

function compareNullableDate(
  left: string | null,
  right: string | null,
  descending = false,
) {
  if (left && right) {
    return descending ? right.localeCompare(left) : left.localeCompare(right);
  }
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function competitionNameOrder(
  left: MyShootingCompetition,
  right: MyShootingCompetition,
) {
  return (
    left.competition.name.localeCompare(right.competition.name, "en-GB", {
      sensitivity: "base",
    }) || left.competition_entrant_id - right.competition_entrant_id
  );
}

export function groupMyShootingCompetitions(
  data: MyShootingCompetitions,
) {
  const grouped: Record<MyShootingCompetitionTab, MyShootingCompetition[]> = {
    active: [],
    upcoming: [],
    completed: [],
  };

  for (const participation of data.competitions) {
    grouped[classifyMyShootingCompetition(participation, data.as_of_date)].push(
      participation,
    );
  }

  grouped.active.sort(
    (left, right) =>
      compareNullableDate(
        getNextRelevantRound(left)?.deadline ?? null,
        getNextRelevantRound(right)?.deadline ?? null,
      ) || competitionNameOrder(left, right),
  );
  grouped.upcoming.sort(
    (left, right) =>
      compareNullableDate(
        left.competition.effective_starts_at,
        right.competition.effective_starts_at,
      ) || competitionNameOrder(left, right),
  );
  grouped.completed.sort(
    (left, right) =>
      compareNullableDate(
        left.rounds.at(-1)?.deadline ?? left.season.ends_at,
        right.rounds.at(-1)?.deadline ?? right.season.ends_at,
        true,
      ) || competitionNameOrder(left, right),
  );

  return grouped;
}

async function getAuthoritativeResults(
  participation: MyShootingCompetition,
): Promise<AuthoritativeResults | null> {
  const parameters = [
    participation.organisation.id,
    participation.season.id,
    participation.competition.id,
  ] as const;

  switch (participation.competition.ranking_method) {
    case "best_n_average":
      return getCompetitionBestNAverageResults(...parameters) as Promise<AuthoritativeResults | null>;
    case "gun_score":
      return getCompetitionGunScoreResults(...parameters) as Promise<AuthoritativeResults | null>;
    case "round_robin":
      return getCompetitionRoundRobinResults(...parameters) as Promise<AuthoritativeResults | null>;
    default:
      return getCompetitionAggregateResults(...parameters) as Promise<AuthoritativeResults | null>;
  }
}

function rankingValue(
  method: CompetitionRankingMethod,
  entrant: AuthoritativeEntrant,
) {
  switch (method) {
    case "best_n_average":
      return {
        label: "Best-N average",
        value: numericValue(entrant.qualifying_average),
      };
    case "gun_score":
      return { label: "Gun score", value: numericValue(entrant.gun_total) };
    case "round_robin":
      return {
        label: "Match points",
        value: numericValue(entrant.total_match_points),
      };
    default:
      return {
        label: "Competition points",
        value: numericValue(entrant.total_points),
      };
  }
}

export async function loadMyShootingCompetitionResult(
  participation: MyShootingCompetition,
): Promise<MyShootingCompetitionResult | null> {
  const [results, averages] = await Promise.all([
    getAuthoritativeResults(participation),
    getCompetitionResultAverages(
      participation.organisation.id,
      participation.season.id,
      participation.competition.id,
    ),
  ]);

  if (!results || results.status !== "ready") return null;

  const entrant = results.groups
    .flatMap((group) => group.entrants)
    .find((candidate) => candidate.entrant_id === participation.competition_entrant_id);
  if (!entrant) return null;

  const average = averages?.participants.find(
    (candidate) =>
      candidate.entrant_id === participation.competition_entrant_id &&
      candidate.slot_number === participation.slot_number,
  );
  const ranking = rankingValue(participation.competition.ranking_method, entrant);

  return {
    position: numericValue(entrant.position),
    tied: Boolean(entrant.tied),
    released_round_count: results.released_round_count ?? 0,
    value_label: ranking.label,
    value: ranking.value,
    starting_average:
      participation.competition.entry_format === "individual"
        ? (average?.starting_average ?? null)
        : null,
    running_average: average?.running_average ?? null,
  };
}

export async function addCompletedCompetitionResults(
  participations: MyShootingCompetition[],
) {
  return Promise.all(
    participations.map(async (participation) => ({
      ...participation,
      result: await loadMyShootingCompetitionResult(participation),
    })),
  );
}
