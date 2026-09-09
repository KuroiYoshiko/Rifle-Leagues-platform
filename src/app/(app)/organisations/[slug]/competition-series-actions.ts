"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CompetitionSeriesActionState = {
  status?: "success" | "error";
  message?: string;
};

function positiveInteger(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  const parsed = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

async function prepare(formData: FormData) {
  const organisationId = positiveInteger(formData.get("organisation_id"));
  const seriesId = positiveInteger(formData.get("competition_series_id"));
  const organisationSlug = String(formData.get("organisation_slug") ?? "");
  if (!organisationId || !seriesId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organisationSlug)) {
    return { error: "The Series could not be identified. Refresh and try again." } as const;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return { error: "Sign in again before managing Competition Series." } as const;
  }
  return { organisationId, seriesId, organisationSlug, supabase } as const;
}

function errorMessage(error: { code?: string; message?: string }, fallback: string) {
  if (error.code === "42501") return "Only this organisation’s active owner can manage Competition Series.";
  if ((error.code === "22023" || error.code === "23514") && error.message) return error.message;
  return fallback;
}

function refresh(organisationSlug: string) {
  revalidatePath(`/organisations/${organisationSlug}/management`);
  revalidatePath(`/organisations/${organisationSlug}/management/series`);
  revalidatePath(`/organisations/${organisationSlug}/leagues`, "layout");
}

export async function renameCompetitionSeries(
  _previousState: CompetitionSeriesActionState,
  formData: FormData,
): Promise<CompetitionSeriesActionState> {
  const prepared = await prepare(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const name = String(formData.get("series_name") ?? "").trim();
  if ([...name].length < 2 || [...name].length > 160) {
    return { status: "error", message: "Use a Series name between 2 and 160 characters." };
  }
  const { error } = await prepared.supabase.rpc("rename_competition_series", {
    p_organisation_id: prepared.organisationId,
    p_competition_series_id: prepared.seriesId,
    p_name: name,
  });
  if (error) return { status: "error", message: errorMessage(error, "The Series could not be renamed.") };
  refresh(prepared.organisationSlug);
  return { status: "success", message: "Series name saved." };
}

export async function setCompetitionSeriesArchived(
  _previousState: CompetitionSeriesActionState,
  formData: FormData,
): Promise<CompetitionSeriesActionState> {
  const prepared = await prepare(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const archived = formData.get("archived") === "true";
  const { error } = await prepared.supabase.rpc("set_competition_series_archived", {
    p_organisation_id: prepared.organisationId,
    p_competition_series_id: prepared.seriesId,
    p_archived: archived,
  });
  if (error) return { status: "error", message: errorMessage(error, "The Series archive state could not be changed.") };
  refresh(prepared.organisationSlug);
  return { status: "success", message: archived ? "Series archived." : "Series restored." };
}

export async function deleteEmptyCompetitionSeries(
  _previousState: CompetitionSeriesActionState,
  formData: FormData,
): Promise<CompetitionSeriesActionState> {
  const prepared = await prepare(formData);
  if ("error" in prepared) return { status: "error", message: prepared.error };
  const { error } = await prepared.supabase.rpc("delete_empty_competition_series", {
    p_organisation_id: prepared.organisationId,
    p_competition_series_id: prepared.seriesId,
  });
  if (error) return { status: "error", message: errorMessage(error, "The empty Series could not be deleted.") };
  refresh(prepared.organisationSlug);
  return { status: "success", message: "Empty Series deleted." };
}
