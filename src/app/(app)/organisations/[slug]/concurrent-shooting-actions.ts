"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ConcurrentShootingActionState = {
  status?: "success" | "error";
  message?: string;
};

type PreparedAction = {
  organisationId: number;
  organisationSlug: string;
  groupId: number | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function positiveInteger(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  const parsed = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

async function prepare(formData: FormData, groupRequired = true): Promise<
  PreparedAction | { error: string }
> {
  const organisationId = positiveInteger(formData.get("organisation_id"));
  const groupId = positiveInteger(formData.get("concurrent_group_id"));
  const organisationSlug = String(formData.get("organisation_slug") ?? "");
  if (
    !organisationId ||
    !slugPattern.test(organisationSlug) ||
    (groupRequired && !groupId)
  ) {
    return { error: "The Concurrent Shooting group could not be identified. Refresh and try again." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return { error: "Sign in again before managing Concurrent Shooting." };
  }
  return { organisationId, organisationSlug, groupId, supabase };
}

function domainError(
  error: { code?: string; message?: string },
  fallback: string,
) {
  const message = error.message ?? "";
  if (error.code === "42501") {
    return "You no longer have permission to perform this Concurrent Shooting action.";
  }
  if (error.code === "P0002") {
    return "This Concurrent Shooting configuration changed or is no longer available. Refresh and try again.";
  }
  if (/already belongs/i.test(message)) {
    return "That Competition already belongs to another Concurrent Shooting group.";
  }
  if (/Course of Fire is incompatible|is incompatible/i.test(message)) {
    return "The Competition Course of Fire no longer matches this group. Review the compatibility details and try again.";
  }
  if (/must be published/i.test(message)) {
    return "Every linked Competition must be published before activation.";
  }
  if (/effective start|has started/i.test(message)) {
    return "A linked Competition has already started, so this group cannot be activated or cancelled.";
  }
  if (/already has score usage|score provenance exists/i.test(message)) {
    return "Existing score activity means this configuration can no longer be changed safely.";
  }
  if (/at least two member/i.test(message)) {
    return "Select at least two compatible Competitions before activation.";
  }
  if (/physical Round mappings|at least two Competitions/i.test(message)) {
    return "Every shared physical Round must explicitly map at least two Competitions.";
  }
  if (/Every member Competition must have/i.test(message)) {
    return "Every linked Competition needs at least one explicit shared Round mapping.";
  }
  if (/already mapped/i.test(message)) {
    return "That Competition Round is already used by another shared physical Round.";
  }
  if (/must be draft/i.test(message)) {
    return "This configuration is locked because the group is no longer Draft.";
  }
  if (error.code && ["22023", "23503", "23505", "23514"].includes(error.code)) {
    return fallback;
  }
  return fallback;
}

function refreshConcurrent(organisationSlug: string, groupId?: number | null) {
  const base = `/organisations/${organisationSlug}/management/concurrent-shooting`;
  revalidatePath(base);
  if (groupId) revalidatePath(`${base}/${groupId}`);
  revalidatePath(`/organisations/${organisationSlug}/leagues`, "layout");
}

export async function createConcurrentShootingGroup(
  _previousState: ConcurrentShootingActionState,
  formData: FormData,
): Promise<ConcurrentShootingActionState> {
  const prepared = await prepare(formData, false);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const seasonId = positiveInteger(formData.get("league_season_id"));
  const name = String(formData.get("group_name") ?? "").trim();
  if (!seasonId) return { status: "error", message: "Choose a Season." };
  if ([...name].length < 2 || [...name].length > 160) {
    return { status: "error", message: "Use a group name between 2 and 160 characters." };
  }
  const { data, error } = await prepared.supabase.rpc(
    "create_concurrent_shooting_group",
    {
      p_organisation_id: prepared.organisationId,
      p_league_season_id: seasonId,
      p_name: name,
    },
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return {
      status: "error",
      message: error
        ? domainError(error, "The Draft Concurrent Shooting group could not be created.")
        : "The Draft Concurrent Shooting group could not be created.",
    };
  }
  const groupId = Number((data as { id?: unknown }).id);
  if (!Number.isSafeInteger(groupId) || groupId <= 0) {
    return { status: "error", message: "The new group returned an invalid response. Refresh and try again." };
  }
  refreshConcurrent(prepared.organisationSlug, groupId);
  redirect(`/organisations/${prepared.organisationSlug}/management/concurrent-shooting/${groupId}`);
}

export async function mutateConcurrentShootingGroup(
  _previousState: ConcurrentShootingActionState,
  formData: FormData,
): Promise<ConcurrentShootingActionState> {
  const prepared = await prepare(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const groupId = prepared.groupId as number;
  const operation = String(formData.get("operation") ?? "");
  let result: { error: { code?: string; message?: string } | null };
  let success = "Concurrent Shooting Draft saved.";

  if (operation === "rename") {
    const name = String(formData.get("group_name") ?? "").trim();
    if ([...name].length < 2 || [...name].length > 160) {
      return { status: "error", message: "Use a group name between 2 and 160 characters." };
    }
    result = await prepared.supabase.rpc("rename_concurrent_shooting_group", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
      p_name: name,
    });
    success = "Group name saved.";
  } else if (operation === "add_competition" || operation === "remove_competition") {
    const competitionId = positiveInteger(formData.get("competition_id"));
    if (!competitionId) return { status: "error", message: "Choose a valid Competition." };
    result = await prepared.supabase.rpc(
      operation === "add_competition"
        ? "add_concurrent_shooting_group_competition"
        : "remove_concurrent_shooting_group_competition",
      {
        p_organisation_id: prepared.organisationId,
        p_concurrent_shooting_group_id: groupId,
        p_competition_id: competitionId,
      },
    );
    success = operation === "add_competition"
      ? "Competition added to the Draft."
      : "Competition removed from the Draft.";
  } else if (operation === "create_round") {
    const position = positiveInteger(formData.get("position"));
    const label = String(formData.get("round_label") ?? "").trim() || null;
    if (!position) return { status: "error", message: "The next shared Round position is invalid." };
    result = await prepared.supabase.rpc("create_concurrent_shooting_round", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
      p_position: position,
      p_label: label,
    });
    success = "Shared physical Round added.";
  } else if (operation === "update_round") {
    const physicalRoundId = positiveInteger(formData.get("physical_round_id"));
    const position = positiveInteger(formData.get("position"));
    const label = String(formData.get("round_label") ?? "").trim() || null;
    if (!physicalRoundId || !position) return { status: "error", message: "The shared Round is invalid." };
    result = await prepared.supabase.rpc("update_concurrent_shooting_round", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
      p_concurrent_shooting_round_id: physicalRoundId,
      p_position: position,
      p_label: label,
    });
    success = "Shared Round label saved.";
  } else if (operation === "delete_round") {
    const physicalRoundId = positiveInteger(formData.get("physical_round_id"));
    if (!physicalRoundId) return { status: "error", message: "The shared Round is invalid." };
    result = await prepared.supabase.rpc("delete_concurrent_shooting_round", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
      p_concurrent_shooting_round_id: physicalRoundId,
    });
    success = "Shared physical Round removed.";
  } else if (operation === "set_mapping") {
    const physicalRoundId = positiveInteger(formData.get("physical_round_id"));
    const competitionId = positiveInteger(formData.get("competition_id"));
    const competitionRoundId = positiveInteger(formData.get("competition_round_id"));
    if (!physicalRoundId || !competitionId) return { status: "error", message: "The Round mapping is invalid." };
    result = await prepared.supabase.rpc("set_concurrent_shooting_round_mapping", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
      p_concurrent_shooting_round_id: physicalRoundId,
      p_competition_id: competitionId,
      p_competition_round_id: competitionRoundId,
    });
    success = competitionRoundId ? "Competition Round mapping saved." : "Competition Round left independent.";
  } else if (operation === "activate") {
    result = await prepared.supabase.rpc("activate_concurrent_shooting_group", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
    });
    success = "Concurrent Shooting group activated.";
  } else if (operation === "cancel") {
    result = await prepared.supabase.rpc("cancel_concurrent_shooting_group_activation", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
    });
    success = "Activation cancelled. The group is Draft again.";
  } else if (operation === "archive") {
    result = await prepared.supabase.rpc("archive_concurrent_shooting_group", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
    });
    success = "Concurrent Shooting group archived.";
  } else if (operation === "delete_group") {
    result = await prepared.supabase.rpc("delete_draft_concurrent_shooting_group", {
      p_organisation_id: prepared.organisationId,
      p_concurrent_shooting_group_id: groupId,
    });
    if (!result.error) {
      refreshConcurrent(prepared.organisationSlug);
      redirect(`/organisations/${prepared.organisationSlug}/management/concurrent-shooting`);
    }
    success = "Draft group deleted.";
  } else {
    return { status: "error", message: "Unknown Concurrent Shooting action. Refresh and try again." };
  }

  if (result.error) {
    return {
      status: "error",
      message: domainError(result.error, "The Concurrent Shooting change could not be saved."),
    };
  }
  refreshConcurrent(prepared.organisationSlug, groupId);
  return { status: "success", message: success };
}
