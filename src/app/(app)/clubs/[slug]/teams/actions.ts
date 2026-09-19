"use server";

import { revalidatePath } from "next/cache";
import type { ClubTeam, ClubTeamUnitType } from "@/lib/club-teams";
import { createClient } from "@/lib/supabase/server";

export type ClubTeamMutation = ClubTeam;

export type ClubTeamActionState = {
  status?: "success" | "error";
  message?: string;
  team?: ClubTeamMutation;
};

const safeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function safeSlug(value: unknown) {
  return typeof value === "string" &&
    value.length <= 180 &&
    safeSlugPattern.test(value)
    ? value
    : null;
}

function normalisedName(value: unknown, optional = false) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (optional && !name) return null;
  return name.length >= 1 && name.length <= 120 ? name : undefined;
}

function validRoster(value: unknown, unitType: ClubTeamUnitType) {
  if (!Array.isArray(value)) return null;
  const roster = value.map(positiveInteger);
  if (roster.some((membershipId) => membershipId === null)) return null;
  const membershipIds = roster as number[];
  if (new Set(membershipIds).size !== membershipIds.length) return null;
  if (unitType === "pair" && membershipIds.length !== 2) return null;
  if (unitType === "team" && (membershipIds.length < 3 || membershipIds.length > 20)) {
    return null;
  }
  return membershipIds;
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, authenticated: !error && Boolean(data?.claims?.sub) };
}

function actionError(
  code: string | undefined,
  databaseMessage: string | undefined,
  fallback: string,
): ClubTeamActionState {
  if (code === "42501") {
    return {
      status: "error",
      message: "Only an active owner or official of this exact club can manage Club Teams.",
    };
  }
  if (code === "23505" || code === "22023" || code === "23514") {
    return { status: "error", message: databaseMessage || fallback };
  }
  if (code === "P0002") {
    return { status: "error", message: "That Club Team is no longer available." };
  }
  return { status: "error", message: fallback };
}

function revalidateClubTeamRoutes(slug: string) {
  revalidatePath("/", "layout");
  revalidatePath(`/clubs/${slug}`);
  revalidatePath(`/clubs/${slug}/teams`);
}

export async function createClubTeam(input: {
  clubId: number;
  clubSlug: string;
  name?: string | null;
  unitType: ClubTeamUnitType;
  rosterMembershipIds: number[];
}): Promise<ClubTeamActionState> {
  const clubId = positiveInteger(input?.clubId);
  const clubSlug = safeSlug(input?.clubSlug);
  const name = normalisedName(input?.name, true);
  const unitType = input?.unitType;
  const roster = unitType === "pair" || unitType === "team"
    ? validRoster(input?.rosterMembershipIds, unitType)
    : null;
  if (!clubId || !clubSlug || name === undefined || !roster) {
    return {
      status: "error",
      message: "Choose Pair or Team and complete its current roster before creating it.",
    };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { data, error } = await supabase.rpc("create_club_team", {
    p_club_id: clubId,
    p_name: name,
    p_unit_type: unitType,
    p_roster_membership_ids: roster,
  });
  if (error) return actionError(error.code, error.message, "The Club Pair or Team could not be created.");

  revalidateClubTeamRoutes(clubSlug);
  return {
    status: "success",
    message: `${(data as ClubTeamMutation).name} created.`,
    team: data as ClubTeamMutation,
  };
}

export async function updateClubTeam(input: {
  clubTeamId: number;
  clubSlug: string;
  name: string;
  unitType: ClubTeamUnitType;
  rosterMembershipIds: number[];
}): Promise<ClubTeamActionState> {
  const clubTeamId = positiveInteger(input?.clubTeamId);
  const clubSlug = safeSlug(input?.clubSlug);
  const name = normalisedName(input?.name);
  const unitType = input?.unitType;
  const roster = unitType === "pair" || unitType === "team"
    ? validRoster(input?.rosterMembershipIds, unitType)
    : null;
  if (!clubTeamId || !clubSlug || name === undefined || !roster) {
    return {
      status: "error",
      message: "Enter a name and complete the current Pair or Team roster.",
    };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { data, error } = await supabase.rpc("update_club_team", {
    p_club_team_id: clubTeamId,
    p_name: name,
    p_unit_type: unitType,
    p_roster_membership_ids: roster,
  });
  if (error) return actionError(error.code, error.message, "The Club Pair or Team could not be updated.");

  revalidateClubTeamRoutes(clubSlug);
  return {
    status: "success",
    message: "Current roster updated. Saved Competition participants were not changed.",
    team: data as ClubTeamMutation,
  };
}

export async function renameClubTeam(input: {
  clubTeamId: number;
  clubSlug: string;
  name: string;
}): Promise<ClubTeamActionState> {
  const clubTeamId = positiveInteger(input?.clubTeamId);
  const clubSlug = safeSlug(input?.clubSlug);
  const name = normalisedName(input?.name);
  if (!clubTeamId || !clubSlug || name === undefined) {
    return { status: "error", message: "Enter a Pair or Team name of up to 120 characters." };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { data, error } = await supabase.rpc("rename_club_team", {
    p_club_team_id: clubTeamId,
    p_name: name,
  });
  if (error) return actionError(error.code, error.message, "The Club Team could not be renamed.");

  revalidateClubTeamRoutes(clubSlug);
  return {
    status: "success",
    message: "Club Team renamed. Submitted Competition names are unchanged.",
    team: data as ClubTeamMutation,
  };
}

async function setClubTeamArchiveState(input: {
  clubTeamId: number;
  clubSlug: string;
  archived: boolean;
}): Promise<ClubTeamActionState> {
  const clubTeamId = positiveInteger(input?.clubTeamId);
  const clubSlug = safeSlug(input?.clubSlug);
  if (!clubTeamId || !clubSlug) {
    return { status: "error", message: "That Club Team could not be identified." };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { data, error } = await supabase.rpc(
    input.archived ? "archive_club_team" : "unarchive_club_team",
    { p_club_team_id: clubTeamId },
  );
  if (error) {
    return actionError(
      error.code,
      error.message,
      input.archived
        ? "The Club Team could not be archived."
        : "The Club Team could not be unarchived.",
    );
  }

  revalidateClubTeamRoutes(clubSlug);
  return {
    status: "success",
    message: input.archived ? "Club Team archived." : "Club Team returned to active use.",
    team: data as ClubTeamMutation,
  };
}

export async function archiveClubTeam(input: {
  clubTeamId: number;
  clubSlug: string;
}) {
  return setClubTeamArchiveState({ ...input, archived: true });
}

export async function unarchiveClubTeam(input: {
  clubTeamId: number;
  clubSlug: string;
}) {
  return setClubTeamArchiveState({ ...input, archived: false });
}
