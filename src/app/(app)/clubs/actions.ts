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

  return "Your previous membership request was declined.";
}

async function retryRejectedMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clubId: number,
  userId: string,
): Promise<MembershipRequestState> {
  const { data, error } = await supabase
    .from("club_memberships")
    .update({ status: "pending" })
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .eq("status", "rejected")
    .select("status")
    .maybeSingle();

  if (error || data?.status !== "pending") {
    return {
      status: "error",
      message:
        "We could not send your membership request again. Refresh the page and retry.",
    };
  }

  revalidatePath("/clubs");
  revalidatePath("/dashboard");

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

  if (existingStatus === "rejected") {
    return retryRejectedMembership(supabase, clubId, userId);
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

    if (concurrentStatus === "rejected") {
      return retryRejectedMembership(supabase, clubId, userId);
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

  revalidatePath("/clubs");
  revalidatePath("/dashboard");

  return {
    status: "success",
    membershipStatus: "pending",
    message: "Membership request sent. It is now waiting for club approval.",
  };
}
