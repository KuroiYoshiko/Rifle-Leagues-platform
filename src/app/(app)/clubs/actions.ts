"use server";

import { revalidatePath } from "next/cache";
import type { MembershipStatus } from "@/lib/clubs";
import { createClient } from "@/lib/supabase/server";

export type MembershipRequestState = {
  status?: "success" | "error";
  membershipStatus?: MembershipStatus;
  message?: string;
};

function existingMembershipMessage(status: MembershipStatus) {
  if (status === "active") {
    return "You are already an active member of this club.";
  }

  if (status === "pending") {
    return "Your membership request is already waiting for club approval.";
  }

  return "A previous request was not approved. New requests after rejection are not available yet.";
}

export async function requestClubMembership(
  _previousState: MembershipRequestState,
  formData: FormData,
): Promise<MembershipRequestState> {
  const rawClubId = String(formData.get("club_id") ?? "").trim();
  const clubId = Number(rawClubId);

  if (!/^\d+$/.test(rawClubId) || !Number.isSafeInteger(clubId) || clubId < 1) {
    return {
      status: "error",
      message: "That club could not be identified. Refresh the page and try again.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return {
      status: "error",
      message: "Your session could not be verified. Sign in again and retry.",
    };
  }

  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .select("id")
    .eq("id", clubId)
    .eq("status", "active")
    .maybeSingle();

  if (clubError || !club) {
    return {
      status: "error",
      message: "This club is no longer available for membership requests.",
    };
  }

  const { data, error } = await supabase
    .from("club_memberships")
    .insert({ club_id: clubId, user_id: userId })
    .select("status")
    .maybeSingle();

  if (error?.code === "23505") {
    const { data: existingMembership } = await supabase
      .from("club_memberships")
      .select("status")
      .eq("club_id", clubId)
      .eq("user_id", userId)
      .maybeSingle();
    const existingStatus = existingMembership?.status as MembershipStatus | undefined;

    if (existingStatus) {
      return {
        status: existingStatus === "rejected" ? "error" : "success",
        membershipStatus: existingStatus,
        message: existingMembershipMessage(existingStatus),
      };
    }
  }

  if (error || !data) {
    return {
      status: "error",
      message: "We could not send your membership request. Please try again.",
    };
  }

  revalidatePath("/clubs");
  revalidatePath("/dashboard");

  return {
    status: "success",
    membershipStatus: "pending",
    message: "Membership request sent. It is now waiting for club approval.",
  };
}
