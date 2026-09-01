"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ClubManagementActionState = {
  status?: "success" | "error";
  message?: string;
};

const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readPositiveInteger(value: FormDataEntryValue | null) {
  const rawValue = String(value ?? "").trim();
  const parsedValue = Number(rawValue);

  return /^\d+$/.test(rawValue) &&
    Number.isSafeInteger(parsedValue) &&
    parsedValue > 0
    ? parsedValue
    : null;
}

function readClubSlug(formData: FormData) {
  const slug = String(formData.get("club_slug") ?? "").trim();
  return slug.length <= 180 && routeSafeSlugPattern.test(slug) ? slug : null;
}

async function createAuthenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return {
    supabase,
    authenticated: !error && Boolean(data?.claims?.sub),
  };
}

function revalidateClubManagementRoutes(slug: string) {
  revalidatePath("/", "layout");
  revalidatePath(`/clubs/${slug}`);
}

export async function processMembershipRequest(
  _previousState: ClubManagementActionState,
  formData: FormData,
): Promise<ClubManagementActionState> {
  const membershipId = readPositiveInteger(formData.get("membership_id"));
  const slug = readClubSlug(formData);
  const decision = String(formData.get("decision") ?? "");

  if (!membershipId || !slug || !["active", "rejected"].includes(decision)) {
    return {
      status: "error",
      message: "That membership request could not be processed. Refresh and retry.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc("process_club_membership_request", {
    p_membership_id: membershipId,
    p_decision: decision,
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "You no longer have permission to process this request."
          : "The request may already have changed. Refresh the page and try again.",
    };
  }

  revalidateClubManagementRoutes(slug);
  return {
    status: "success",
    message:
      decision === "active"
        ? "Membership request approved."
        : "Membership request rejected.",
  };
}

export async function changeClubMemberRole(
  _previousState: ClubManagementActionState,
  formData: FormData,
): Promise<ClubManagementActionState> {
  const membershipId = readPositiveInteger(formData.get("membership_id"));
  const slug = readClubSlug(formData);
  const role = String(formData.get("role") ?? "");

  if (!membershipId || !slug || !["member", "official"].includes(role)) {
    return {
      status: "error",
      message: "That role change could not be processed. Refresh and retry.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc("set_club_member_role", {
    p_membership_id: membershipId,
    p_role: role,
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "Only this club’s current owner can change official access."
          : "The member’s role may already have changed. Refresh and try again.",
    };
  }

  revalidateClubManagementRoutes(slug);
  return {
    status: "success",
    message:
      role === "official"
        ? "Official access granted."
        : "Official access removed.",
  };
}

export async function transferClubOwnership(
  _previousState: ClubManagementActionState,
  formData: FormData,
): Promise<ClubManagementActionState> {
  const clubId = readPositiveInteger(formData.get("club_id"));
  const targetMembershipId = readPositiveInteger(
    formData.get("target_membership_id"),
  );
  const slug = readClubSlug(formData);

  if (!clubId || !targetMembershipId || !slug) {
    return {
      status: "error",
      message: "Ownership could not be transferred. Refresh and retry.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc("transfer_club_ownership", {
    p_club_id: clubId,
    p_target_membership_id: targetMembershipId,
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "Only this club’s current owner can transfer ownership."
          : "The target must still be another active member. Refresh and retry.",
    };
  }

  revalidateClubManagementRoutes(slug);
  return {
    status: "success",
    message: "Club ownership transferred. You are now a club official.",
  };
}

function readOptionalText(formData: FormData, name: string, maximum: number) {
  return String(formData.get(name) ?? "").trim().slice(0, maximum + 1);
}

export async function updateClubDetails(
  _previousState: ClubManagementActionState,
  formData: FormData,
): Promise<ClubManagementActionState> {
  const clubId = readPositiveInteger(formData.get("club_id"));
  const slug = readClubSlug(formData);
  const name = readOptionalText(formData, "name", 160);
  const town = readOptionalText(formData, "town", 100);
  const county = readOptionalText(formData, "county", 100);
  const postcode = readOptionalText(formData, "postcode", 20);
  const website = readOptionalText(formData, "website", 2048);

  if (!clubId || !slug || name.length < 2 || name.length > 160) {
    return {
      status: "error",
      message: "Enter a club name between 2 and 160 characters.",
    };
  }

  if (
    town.length > 100 ||
    county.length > 100 ||
    postcode.length > 20 ||
    website.length > 2048
  ) {
    return { status: "error", message: "One or more fields are too long." };
  }

  if (website && !/^https?:\/\//i.test(website)) {
    return {
      status: "error",
      message: "Website must start with http:// or https://.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc("update_club_details", {
    p_club_id: clubId,
    p_name: name,
    p_town: town,
    p_county: county,
    p_postcode: postcode,
    p_website: website,
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "You no longer have permission to edit this club."
          : "The club details could not be saved. Check each field and try again.",
    };
  }

  revalidateClubManagementRoutes(slug);
  return { status: "success", message: "Club details saved." };
}
