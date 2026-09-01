"use server";

import { revalidatePath } from "next/cache";
import type { OrganisationStaffStatus } from "@/lib/organisations";
import { createClient } from "@/lib/supabase/server";

export type ManagementAccessActionState = {
  status?: "success" | "error";
  accessStatus?: OrganisationStaffStatus;
  message?: string;
};

export type OrganisationStaffActionState = {
  status?: "success" | "error";
  message?: string;
};

const safeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readPositiveInteger(value: FormDataEntryValue | null) {
  const rawValue = String(value ?? "").trim();
  const parsedValue = Number(rawValue);

  return /^\d+$/.test(rawValue) &&
    Number.isSafeInteger(parsedValue) &&
    parsedValue > 0
    ? parsedValue
    : null;
}

function readOrganisationSlug(formData: FormData) {
  const slug = String(formData.get("organisation_slug") ?? "").trim();
  return slug.length <= 180 && safeSlugPattern.test(slug) ? slug : null;
}

async function createAuthenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return {
    supabase,
    authenticated: !error && Boolean(data?.claims?.sub),
  };
}

function revalidateOrganisationManagement(slug: string) {
  revalidatePath(`/organisations/${slug}/management`);
  revalidatePath("/(app)", "layout");
}

export async function requestOrganisationManagementAccess(
  previousState: ManagementAccessActionState,
  formData: FormData,
): Promise<ManagementAccessActionState> {
  const organisationId = readPositiveInteger(formData.get("organisation_id"));

  if (!organisationId) {
    return {
      status: "error",
      accessStatus: previousState.accessStatus,
      message:
        "That organisation could not be identified. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return {
      status: "error",
      accessStatus: previousState.accessStatus,
      message: "Sign in again before requesting management access.",
    };
  }

  const { data, error } = await supabase.rpc(
    "request_organisation_management_access",
    { p_organisation_id: organisationId },
  );

  if (error) {
    return {
      status: "error",
      accessStatus: previousState.accessStatus,
      message:
        error.code === "P0002"
          ? "This organisation is no longer available for management requests."
          : error.code === "22023"
            ? "You already have active access or this request cannot be repeated."
          : "Management access could not be requested. Please try again.",
    };
  }

  const accessStatus = data === "active" ? "active" : "pending";
  revalidatePath("/organisations/access");
  revalidatePath("/(app)", "layout");

  return {
    status: "success",
    accessStatus,
    message:
      accessStatus === "active"
        ? "You already have active management access."
        : "Management access requested. The organisation owner can now review it.",
  };
}

export async function processOrganisationManagementRequest(
  _previousState: OrganisationStaffActionState,
  formData: FormData,
): Promise<OrganisationStaffActionState> {
  const staffId = readPositiveInteger(formData.get("staff_id"));
  const decision = String(formData.get("decision") ?? "");
  const slug = readOrganisationSlug(formData);

  if (!staffId || !slug || !["active", "rejected"].includes(decision)) {
    return {
      status: "error",
      message: "That request could not be processed. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc(
    "process_organisation_management_request",
    { p_staff_id: staffId, p_decision: decision },
  );

  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "Only this organisation’s current owner can process requests."
          : "The request may already have changed. Refresh and try again.",
    };
  }

  revalidateOrganisationManagement(slug);
  return {
    status: "success",
    message:
      decision === "active"
        ? "Management access approved."
        : "Management access request rejected.",
  };
}

export async function removeOrganisationManagerAccess(
  _previousState: OrganisationStaffActionState,
  formData: FormData,
): Promise<OrganisationStaffActionState> {
  const staffId = readPositiveInteger(formData.get("staff_id"));
  const slug = readOrganisationSlug(formData);

  if (!staffId || !slug) {
    return {
      status: "error",
      message: "Manager access could not be removed. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc(
    "remove_organisation_manager_access",
    { p_staff_id: staffId },
  );

  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "Only this organisation’s current owner can remove manager access."
          : "That manager’s access may already have changed. Refresh and try again.",
    };
  }

  revalidateOrganisationManagement(slug);
  return { status: "success", message: "Management access removed." };
}

export async function transferOrganisationOwnership(
  _previousState: OrganisationStaffActionState,
  formData: FormData,
): Promise<OrganisationStaffActionState> {
  const organisationId = readPositiveInteger(formData.get("organisation_id"));
  const targetStaffId = readPositiveInteger(formData.get("target_staff_id"));
  const slug = readOrganisationSlug(formData);

  if (!organisationId || !targetStaffId || !slug) {
    return {
      status: "error",
      message: "Ownership could not be transferred. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc("transfer_organisation_ownership", {
    p_organisation_id: organisationId,
    p_target_staff_id: targetStaffId,
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "Only this organisation’s current owner can transfer ownership."
          : "The target must still be another active manager in this organisation.",
    };
  }

  revalidateOrganisationManagement(slug);
  return {
    status: "success",
    message: "Organisation ownership transferred. You are now a manager.",
  };
}
