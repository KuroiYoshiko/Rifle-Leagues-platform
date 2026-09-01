"use server";

import { revalidatePath } from "next/cache";
import type { MembershipStatus } from "@/lib/clubs";
import { createClient } from "@/lib/supabase/server";

export type MembershipRequestState = {
  status?: "success" | "error";
  membershipStatus?: MembershipStatus;
  message?: string;
};

export type LeaveClubState = {
  status?: "success" | "error";
  message?: string;
};

function existingMembershipMessage(status: MembershipStatus) {
  if (status === "active") {
    return "You are already an active member of this club.";
  }

  if (status === "pending") {
    return "Your membership request is already waiting for club approval.";
  }

  if (status === "left") {
    return "You previously left this club. You can request to join again.";
  }

  return "Your previous membership request was declined.";
}

function revalidateClubMembershipRoutes() {
  revalidatePath("/", "layout");
}

async function retryClosedMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clubId: number,
  userId: string,
): Promise<MembershipRequestState> {
  const { data, error } = await supabase
    .from("club_memberships")
    .update({ status: "pending" })
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .in("status", ["rejected", "left"])
    .select("status")
    .maybeSingle();

  if (error || data?.status !== "pending") {
    return {
      status: "error",
      message:
        "We could not send your membership request again. Refresh the page and retry.",
    };
  }

  revalidateClubMembershipRoutes();

  return {
    status: "success",
    membershipStatus: "pending",
    message: "Membership request sent again. It is now waiting for club approval.",
  };
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

  const { data: existingMembership, error: existingMembershipError } =
    await supabase
      .from("club_memberships")
      .select("status")
      .eq("club_id", clubId)
      .eq("user_id", userId)
      .maybeSingle();

  if (existingMembershipError) {
    return {
      status: "error",
      message: "We could not check your current membership status. Please try again.",
    };
  }

  const existingStatus = existingMembership?.status as MembershipStatus | undefined;

  if (existingStatus === "rejected" || existingStatus === "left") {
    return retryClosedMembership(supabase, clubId, userId);
  }

  if (existingStatus) {
    return {
      status: "success",
      membershipStatus: existingStatus,
      message: existingMembershipMessage(existingStatus),
    };
  }

  const { data, error } = await supabase
    .from("club_memberships")
    .insert({ club_id: clubId, user_id: userId })
    .select("status")
    .maybeSingle();

  if (error?.code === "23505") {
    const { data: concurrentMembership } = await supabase
      .from("club_memberships")
      .select("status")
      .eq("club_id", clubId)
      .eq("user_id", userId)
      .maybeSingle();
    const concurrentStatus = concurrentMembership?.status as
      | MembershipStatus
      | undefined;

    if (concurrentStatus === "rejected" || concurrentStatus === "left") {
      return retryClosedMembership(supabase, clubId, userId);
    }

    if (concurrentStatus) {
      return {
        status: "success",
        membershipStatus: concurrentStatus,
        message: existingMembershipMessage(concurrentStatus),
      };
    }
  }

  if (error || !data) {
    return {
      status: "error",
      message: "We could not send your membership request. Please try again.",
    };
  }

  revalidateClubMembershipRoutes();

  return {
    status: "success",
    membershipStatus: "pending",
    message: "Membership request sent. It is now waiting for club approval.",
  };
}

export async function leaveClubMembership(
  _previousState: LeaveClubState,
  formData: FormData,
): Promise<LeaveClubState> {
  const rawMembershipId = String(formData.get("membership_id") ?? "").trim();
  const membershipId = Number(rawMembershipId);

  if (
    !/^\d+$/.test(rawMembershipId) ||
    !Number.isSafeInteger(membershipId) ||
    membershipId < 1
  ) {
    return {
      status: "error",
      message: "That membership could not be identified. Refresh the page and try again.",
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

  const { data, error } = await supabase
    .from("club_memberships")
    .select("role")
    .eq("id", membershipId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    return {
      status: "error",
      message:
        "We could not leave this club. The membership may have changed; refresh the page and try again.",
    };
  }

  if (data.role === "owner") {
    return {
      status: "error",
      message: "Transfer club ownership to another active member before leaving.",
    };
  }

  const { data: updatedMembership, error: updateError } = await supabase
    .from("club_memberships")
    .update({ status: "left" })
    .eq("id", membershipId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select("id, status")
    .maybeSingle();

  if (updateError || updatedMembership?.status !== "left") {
    return {
      status: "error",
      message:
        "We could not leave this club. The membership may have changed; refresh the page and try again.",
    };
  }

  revalidateClubMembershipRoutes();

  return {
    status: "success",
    message: "You have left the club. You can request to join again later.",
  };
}
