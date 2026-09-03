"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EntryMemberSearchResult } from "@/lib/competition-entries";
import { createClient } from "@/lib/supabase/server";

export type CompetitionEntryActionState = {
  status?: "success" | "error";
  message?: string;
  errors?: string[];
};

type EntryCompositionInput = {
  entryId: number;
  entrants: Array<Array<number | null>>;
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

function validComposition(input: EntryCompositionInput) {
  return (
    positiveInteger(input?.entryId) !== null &&
    Array.isArray(input?.entrants) &&
    input.entrants.length <= 1000 &&
    input.entrants.every(
      (entrant) =>
        Array.isArray(entrant) &&
        entrant.length <= 20 &&
        entrant.every(
          (membershipId) =>
            membershipId === null || positiveInteger(membershipId) !== null,
        ),
    )
  );
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, authenticated: !error && Boolean(data?.claims?.sub) };
}

function parseValidationErrors(details: string | undefined) {
  if (!details) return undefined;

  try {
    const value: unknown = JSON.parse(details);
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function entryError(
  code: string | undefined,
  databaseMessage: string | undefined,
  details: string | undefined,
  fallback: string,
): CompetitionEntryActionState {
  const validationErrors = parseValidationErrors(details);

  if (code === "42501") {
    return {
      status: "error",
      message: "Only an active owner or official of this exact club can manage its entry.",
    };
  }

  if (code === "P0002") {
    return {
      status: "error",
      message: "That club competition entry is no longer available. Refresh and try again.",
    };
  }

  if (code === "23505") {
    return {
      status: "error",
      message: "A shooter can only be selected once in this club entry.",
    };
  }

  if (code === "22023" || code === "23514") {
    return {
      status: "error",
      message: databaseMessage || fallback,
      errors: validationErrors,
    };
  }

  return { status: "error", message: fallback };
}

function revalidateEntryViews() {
  revalidatePath("/", "layout");
  revalidatePath("/clubs", "layout");
  revalidatePath("/organisations", "layout");
}

export async function startClubCompetitionEntry(
  _previousState: CompetitionEntryActionState,
  formData: FormData,
): Promise<CompetitionEntryActionState> {
  const competitionId = positiveInteger(formData.get("competition_id"));
  const clubId = positiveInteger(formData.get("club_id"));

  if (!competitionId || !clubId) {
    return {
      status: "error",
      message: "Choose a valid club and try again.",
    };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { data, error } = await supabase.rpc("start_club_competition_entry", {
    p_competition_id: competitionId,
    p_club_id: clubId,
  });

  if (error) {
    return entryError(
      error.code,
      error.message,
      error.details,
      "The club entry could not be started. Check that the latest competition entry SQL has been run, then try again.",
    );
  }

  const result = data as Record<string, unknown> | null;
  const entryId = positiveInteger(result?.id);
  const organisationSlug = safeSlug(result?.organisation_slug);
  const seasonSlug = safeSlug(result?.season_slug);
  const competitionSlug = safeSlug(result?.competition_slug);

  if (!entryId || !organisationSlug || !seasonSlug || !competitionSlug) {
    return {
      status: "error",
      message: "The entry was started, but its management page could not be opened. Refresh and try again.",
    };
  }

  revalidateEntryViews();
  redirect(
    `/organisations/${organisationSlug}/leagues/${seasonSlug}/competitions/${competitionSlug}/entry?entry=${entryId}`,
  );
}

export async function saveClubCompetitionEntry(
  input: EntryCompositionInput,
): Promise<CompetitionEntryActionState> {
  if (!validComposition(input)) {
    return {
      status: "error",
      message: "The entrant list is invalid. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before saving." };
  }

  const { error } = await supabase.rpc("save_club_competition_entry", {
    p_club_competition_entry_id: input.entryId,
    p_entrants: input.entrants,
  });

  if (error) {
    return entryError(
      error.code,
      error.message,
      error.details,
      "The competition entry could not be saved. Please try again.",
    );
  }

  revalidateEntryViews();
  return {
    status: "success",
    message: "Entry saved as a draft. Submit it when the roster is ready.",
  };
}

export async function submitClubCompetitionEntry(
  input: EntryCompositionInput,
): Promise<CompetitionEntryActionState> {
  if (!validComposition(input)) {
    return {
      status: "error",
      message: "The entrant list is invalid. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before submitting." };
  }

  const { error } = await supabase.rpc(
    "save_and_submit_club_competition_entry",
    {
      p_club_competition_entry_id: input.entryId,
      p_entrants: input.entrants,
    },
  );

  if (error) {
    return entryError(
      error.code,
      error.message,
      error.details,
      "The competition entry could not be submitted. Please try again.",
    );
  }

  revalidateEntryViews();
  return { status: "success", message: "Club entry submitted." };
}

export async function withdrawClubCompetitionEntry(
  entryIdValue: number,
): Promise<CompetitionEntryActionState> {
  const entryId = positiveInteger(entryIdValue);
  if (!entryId) {
    return { status: "error", message: "The entry could not be identified." };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before withdrawing." };
  }

  const { error } = await supabase.rpc("withdraw_club_competition_entry", {
    p_club_competition_entry_id: entryId,
  });

  if (error) {
    return entryError(
      error.code,
      error.message,
      error.details,
      "The competition entry could not be withdrawn. Please try again.",
    );
  }

  revalidateEntryViews();
  return { status: "success", message: "Club entry withdrawn." };
}

export async function searchCompetitionEntryMembers(input: {
  entryId: number;
  query: string;
}): Promise<{
  status: "success" | "error";
  message?: string;
  members: EntryMemberSearchResult[];
}> {
  const entryId = positiveInteger(input?.entryId);
  const query = String(input?.query ?? "").trim().slice(0, 160);

  if (!entryId) {
    return { status: "error", message: "The entry could not be identified.", members: [] };
  }

  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again to search members.", members: [] };
  }

  const { data, error } = await supabase.rpc(
    "search_club_competition_entry_members",
    {
      p_club_competition_entry_id: entryId,
      p_query: query,
      p_limit: 30,
    },
  );

  if (error) {
    return {
      status: "error",
      message: "Eligible club members could not be loaded.",
      members: [],
    };
  }

  return { status: "success", members: (data ?? []) as EntryMemberSearchResult[] };
}
