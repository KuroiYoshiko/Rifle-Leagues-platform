"use server";

import { revalidatePath } from "next/cache";
import type { ClubTeam } from "@/lib/club-teams";
import { createClient } from "@/lib/supabase/server";

export type ClubTeamMutation = Pick<
  ClubTeam,
  "id" | "club_id" | "name" | "display_order" | "archived_at" | "updated_at"
> & Partial<Pick<ClubTeam, "competition_usage_count" | "submitted_usage_count" | "created_at">>;

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
}): Promise<ClubTeamActionState> {
  const clubId = positiveInteger(input?.clubId);
  const clubSlug = safeSlug(input?.clubSlug);
  const name = normalisedName(input?.name, true);
  if (!clubId || !clubSlug || name === undefined) {
    return { status: "error", message: "Enter a Team name of up to 120 characters." };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { data, error } = await supabase.rpc("create_club_team", {
    p_club_id: clubId,
    p_name: name,
  });
  if (error) return actionError(error.code, error.message, "The Club Team could not be created.");

  revalidateClubTeamRoutes(clubSlug);
  return {
    status: "success",
    message: `${(data as ClubTeamMutation).name} created.`,
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
    return { status: "error", message: "Enter a Team name of up to 120 characters." };
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
