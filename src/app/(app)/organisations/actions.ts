"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type OrganisationDashboardState = {
  status?: "success" | "error";
  isAdded?: boolean;
  message?: string;
};

function refreshOrganisationNavigation() {
  revalidatePath("/organisations");
  revalidatePath("/(app)", "layout");
}

export async function updateOrganisationDashboard(
  previousState: OrganisationDashboardState,
  formData: FormData,
): Promise<OrganisationDashboardState> {
  const rawOrganisationId = String(formData.get("organisation_id") ?? "").trim();
  const organisationId = Number(rawOrganisationId);
  const intent = formData.get("intent");

  if (
    !/^\d+$/.test(rawOrganisationId) ||
    !Number.isSafeInteger(organisationId) ||
    organisationId < 1
  ) {
    return {
      status: "error",
      isAdded: previousState.isAdded,
      message:
        "That organisation could not be identified. Refresh the page and try again.",
    };
  }

  if (intent !== "add" && intent !== "remove") {
    return {
      status: "error",
      isAdded: previousState.isAdded,
      message: "That dashboard change was not recognised. Refresh and try again.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return {
      status: "error",
      isAdded: previousState.isAdded,
      message: "Your session could not be verified. Sign in again and retry.",
    };
  }

  if (intent === "remove") {
    const { error } = await supabase
      .from("user_organisations")
      .delete()
      .eq("user_id", userId)
      .eq("organisation_id", organisationId);

    if (error) {
      return {
        status: "error",
        isAdded: true,
        message:
          "We could not remove this organisation from your dashboard. Please try again.",
      };
    }

    refreshOrganisationNavigation();

    return {
      status: "success",
      isAdded: false,
      message: "Organisation removed from your dashboard.",
    };
  }

  const { data: organisation, error: organisationError } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .eq("status", "active")
    .maybeSingle();

  if (organisationError || !organisation) {
    return {
      status: "error",
      isAdded: previousState.isAdded,
      message: "This organisation is no longer available to add.",
    };
  }

  const { error } = await supabase.from("user_organisations").insert({
    user_id: userId,
    organisation_id: organisationId,
  });

  if (error && error.code !== "23505") {
    return {
      status: "error",
      isAdded: previousState.isAdded,
      message: "We could not add this organisation. Please try again.",
    };
  }

  refreshOrganisationNavigation();

  return {
    status: "success",
    isAdded: true,
    message:
      error?.code === "23505"
        ? "This organisation is already on your dashboard."
        : "Organisation added to your dashboard.",
  };
}
