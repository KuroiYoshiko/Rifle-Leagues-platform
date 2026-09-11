import { cache } from "react";
import type {
  CompetitionEntryFormat,
  CompetitionRankingMethod,
  CompetitionRound,
  CompetitionStatus,
} from "@/lib/competitions";
import { getCompetitionRounds } from "@/lib/competitions";
import { createClient } from "@/lib/supabase/server";

export type ConcurrentShootingStatus = "draft" | "active" | "archived";

export type ConcurrentShootingGroupListItem = {
  id: number;
  league_season_id: number;
  name: string;
  status: ConcurrentShootingStatus;
  member_count: number;
  physical_round_count: number;
};

export type ConcurrentShootingMember = {
  competition_id: number;
  name: string;
  entry_format: CompetitionEntryFormat;
  status: CompetitionStatus;
  compatibility_signature: Record<string, unknown>;
  compatibility_mismatches: string[];
};

export type ConcurrentShootingPhysicalRound = {
  id: number;
  position: number;
  label: string | null;
  mappings: Array<{
    competition_id: number;
    competition_round_id: number;
    round_number: number;
  }>;
};

export type ConcurrentShootingGroupDetails = {
  group: {
    id: number;
    organisation_id: number;
    league_season_id: number;
    name: string;
    status: ConcurrentShootingStatus;
    compatibility_version: number | null;
    compatibility_signature: Record<string, unknown> | null;
    activated_at: string | null;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
  };
  members: ConcurrentShootingMember[];
  physical_rounds: ConcurrentShootingPhysicalRound[];
};

export type ConcurrentShootingCandidate = {
  competition_id: number;
  name: string;
  slug: string;
  status: CompetitionStatus;
  entry_format: CompetitionEntryFormat;
  ranking_method: CompetitionRankingMethod;
  number_of_rounds: number;
  selected: boolean;
  existing_group_id: number | null;
  existing_group_name: string | null;
  existing_group_status: ConcurrentShootingStatus | null;
  compatible: boolean;
  compatibility_mismatches: string[];
  has_course_of_fire: boolean;
  physical_details_configured: boolean;
  effective_starts_at: string | null;
  has_started: boolean;
  selectable: boolean;
};

export type ConcurrentShootingLifecycle = {
  can_activate: boolean;
  activation_block_reasons: Array<
    | "member_count"
    | "competition_started"
    | "competition_not_published"
    | "physical_details"
    | "incompatible"
    | "rounds_missing"
    | "round_not_ready"
    | "member_unmapped"
    | "score_provenance"
  >;
  can_cancel_activation: boolean;
  cancel_block_reason:
    | "not_active"
    | "competition_started"
    | "score_provenance"
    | null;
  has_score_provenance: boolean;
};

export type CompetitionConcurrentShootingSummary = {
  group_id: number;
  group_name: string;
  status: ConcurrentShootingStatus;
  activated_at: string | null;
  season_id: number;
  season_name: string;
  shared_round_count: number;
  linked_competitions: Array<{
    competition_id: number;
    name: string;
    entry_format: CompetitionEntryFormat;
  }>;
};

export type ConcurrentShootingWorkspace = ConcurrentShootingGroupDetails & {
  candidates: ConcurrentShootingCandidate[];
  lifecycle: ConcurrentShootingLifecycle;
  roundsByCompetition: Record<string, CompetitionRound[]>;
};

export const getConcurrentShootingGroups = cache(async (
  organisationId: number,
  leagueSeasonId: number | null = null,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_concurrent_shooting_groups", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
  });
  if (error || !Array.isArray(data)) {
    throw new Error("Concurrent Shooting groups could not be loaded.");
  }
  return data as ConcurrentShootingGroupListItem[];
});

export const getConcurrentShootingGroupLifecycle = cache(async (
  organisationId: number,
  groupId: number,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_concurrent_shooting_group_lifecycle",
    {
      p_organisation_id: organisationId,
      p_concurrent_shooting_group_id: groupId,
    },
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Concurrent Shooting lifecycle could not be loaded.");
  }
  return data as ConcurrentShootingLifecycle;
});

export const getConcurrentShootingWorkspace = cache(async (
  organisationId: number,
  groupId: number,
) => {
  const supabase = await createClient();
  const [detailResult, candidateResult, lifecycleResult] = await Promise.all([
    supabase.rpc("get_concurrent_shooting_group_management", {
      p_organisation_id: organisationId,
      p_concurrent_shooting_group_id: groupId,
    }),
    supabase.rpc("get_concurrent_shooting_competition_candidates", {
      p_organisation_id: organisationId,
      p_concurrent_shooting_group_id: groupId,
    }),
    getConcurrentShootingGroupLifecycle(organisationId, groupId),
  ]);
  if (detailResult.error || candidateResult.error) {
    throw new Error("Concurrent Shooting group details could not be loaded.");
  }
  if (!detailResult.data || typeof detailResult.data !== "object" || Array.isArray(detailResult.data)) {
    throw new Error("Concurrent Shooting group details returned an invalid response.");
  }
  const details = detailResult.data as ConcurrentShootingGroupDetails;
  const rounds = await Promise.all(
    details.members.map(async (member) => [
      String(member.competition_id),
      await getCompetitionRounds(member.competition_id),
    ] as const),
  );
  return {
    ...details,
    candidates: (candidateResult.data ?? []) as ConcurrentShootingCandidate[],
    lifecycle: lifecycleResult,
    roundsByCompetition: Object.fromEntries(rounds),
  } satisfies ConcurrentShootingWorkspace;
});

export const getCompetitionConcurrentShootingSummary = cache(async (
  organisationId: number,
  competitionId: number,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_competition_concurrent_shooting_summary",
    {
      p_organisation_id: organisationId,
      p_competition_id: competitionId,
    },
  );
  if (error) throw new Error("Concurrent Shooting membership could not be loaded.");
  return data as CompetitionConcurrentShootingSummary | null;
});
