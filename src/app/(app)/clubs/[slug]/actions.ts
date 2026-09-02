"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ClubContentActionResult = {
  status: "success" | "error";
  message: string;
};

type AboutInput = {
  clubId: number;
  content: string;
};

const safeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readPositiveInteger(value: unknown) {
  const rawValue = String(value ?? "").trim();
  const parsedValue = Number(rawValue);

  return /^\d+$/.test(rawValue) && Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
}

function readRpcSlug(value: unknown) {
  const slug = typeof value === "string" ? value : "";
  return slug.length <= 180 && safeSlugPattern.test(slug) ? slug : null;
}

export async function updateClubAbout(input: AboutInput): Promise<ClubContentActionResult> {
  const clubId = readPositiveInteger(input?.clubId);
  const content = String(input?.content ?? "").trim();

  if (!clubId) {
    return { status: "error", message: "The club could not be identified. Refresh and try again." };
  }

  if ([...content].length > 20_000) {
    return { status: "error", message: "About content cannot exceed 20,000 characters." };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { data, error } = await supabase.rpc("update_club_about", {
    p_club_id: clubId,
    p_about_content: content || null,
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "Only this club’s active owner can change About information."
          : error.code === "P0002"
            ? "That active club is no longer available. Refresh and try again."
            : error.code === "22023" || error.code === "23514"
              ? "The submitted About content is invalid. Check the limit and try again."
              : "The About information could not be saved. Please try again.",
    };
  }

  const slug = readRpcSlug(data);
  if (slug) revalidatePath(`/clubs/${slug}`);

  return {
    status: "success",
    message: content ? "About information updated." : "About information cleared.",
  };
}
