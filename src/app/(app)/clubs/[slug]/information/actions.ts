"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ClubInformationCardActionResult = {
  status: "success" | "error";
  message: string;
};

type CardMutationInput = {
  clubId: number;
  clubSlug: string;
  title: string;
  content: string;
};

type UpdateCardInput = CardMutationInput & { cardId: number };
type DeleteCardInput = Pick<UpdateCardInput, "clubId" | "clubSlug" | "cardId">;
type ReorderCardsInput = Pick<CardMutationInput, "clubId" | "clubSlug"> & { cardIds: number[] };

const safeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readPositiveInteger(value: unknown) {
  const rawValue = String(value ?? "").trim();
  const parsedValue = Number(rawValue);
  return /^\d+$/.test(rawValue) && Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
}

function readSlug(value: unknown) {
  const slug = String(value ?? "").trim();
  return slug.length <= 180 && safeSlugPattern.test(slug) ? slug : null;
}

function readCardContent(titleValue: unknown, contentValue: unknown) {
  const title = String(titleValue ?? "").trim();
  const content = String(contentValue ?? "").trim();

  if ([...title].length < 1 || [...title].length > 120) {
    return { valid: false as const, error: "Enter a title between 1 and 120 characters." };
  }

  if ([...content].length < 1 || [...content].length > 20_000) {
    return { valid: false as const, error: "Enter content between 1 and 20,000 characters." };
  }

  return { valid: true as const, title, content };
}

async function createAuthenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return { supabase, authenticated: !error && Boolean(data?.claims?.sub) };
}

function revalidateInformationRoutes(slug: string) {
  revalidatePath(`/clubs/${slug}/information`);
  revalidatePath(`/clubs/${slug}`);
  revalidatePath("/", "layout");
}

function writeErrorMessage(code: string | undefined, fallback: string) {
  if (code === "42501") return "Only this club’s active owner can change information cards.";
  if (code === "54000" || code === "23514" || code === "23505") {
    return "This club already has the maximum of five information cards.";
  }
  if (code === "P0002") {
    return "That information card or club is no longer available. Refresh and try again.";
  }
  if (code === "22023") {
    return "The submitted card information is invalid. Check the limits and try again.";
  }
  return fallback;
}

export async function createClubInformationCard(
  input: CardMutationInput,
): Promise<ClubInformationCardActionResult> {
  const clubId = readPositiveInteger(input?.clubId);
  const slug = readSlug(input?.clubSlug);
  const cardContent = readCardContent(input?.title, input?.content);

  if (!clubId || !slug || !cardContent.valid) {
    return {
      status: "error",
      message: !cardContent.valid
        ? cardContent.error
        : "The club could not be identified. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { error } = await supabase.rpc("create_club_information_card", {
    p_club_id: clubId,
    p_title: cardContent.title,
    p_content: cardContent.content,
  });

  if (error) {
    return { status: "error", message: writeErrorMessage(error.code, "The information card could not be added. Please try again.") };
  }

  revalidateInformationRoutes(slug);
  return { status: "success", message: "Information card added." };
}

export async function updateClubInformationCard(
  input: UpdateCardInput,
): Promise<ClubInformationCardActionResult> {
  const clubId = readPositiveInteger(input?.clubId);
  const cardId = readPositiveInteger(input?.cardId);
  const slug = readSlug(input?.clubSlug);
  const cardContent = readCardContent(input?.title, input?.content);

  if (!clubId || !cardId || !slug || !cardContent.valid) {
    return {
      status: "error",
      message: !cardContent.valid
        ? cardContent.error
        : "The information card could not be identified. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { error } = await supabase.rpc("update_club_information_card", {
    p_club_id: clubId,
    p_card_id: cardId,
    p_title: cardContent.title,
    p_content: cardContent.content,
  });

  if (error) {
    return { status: "error", message: writeErrorMessage(error.code, "The information card could not be updated. Please try again.") };
  }

  revalidateInformationRoutes(slug);
  return { status: "success", message: "Information card updated." };
}

export async function deleteClubInformationCard(
  input: DeleteCardInput,
): Promise<ClubInformationCardActionResult> {
  const clubId = readPositiveInteger(input?.clubId);
  const cardId = readPositiveInteger(input?.cardId);
  const slug = readSlug(input?.clubSlug);

  if (!clubId || !cardId || !slug) {
    return { status: "error", message: "The information card could not be identified. Refresh and try again." };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { error } = await supabase.rpc("delete_club_information_card", {
    p_club_id: clubId,
    p_card_id: cardId,
  });

  if (error) {
    return { status: "error", message: writeErrorMessage(error.code, "The information card could not be deleted. Please try again.") };
  }

  revalidateInformationRoutes(slug);
  return { status: "success", message: "Information card deleted." };
}

export async function reorderClubInformationCards(
  input: ReorderCardsInput,
): Promise<ClubInformationCardActionResult> {
  const clubId = readPositiveInteger(input?.clubId);
  const slug = readSlug(input?.clubSlug);
  const cardIds = Array.isArray(input?.cardIds) ? input.cardIds.map(readPositiveInteger) : [];

  if (
    !clubId ||
    !slug ||
    cardIds.length > 5 ||
    cardIds.some((id) => id === null) ||
    new Set(cardIds).size !== cardIds.length
  ) {
    return { status: "error", message: "The card order is invalid. Refresh and try again." };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();
  if (!authenticated) return { status: "error", message: "Sign in again before continuing." };

  const { error } = await supabase.rpc("reorder_club_information_cards", {
    p_club_id: clubId,
    p_card_ids: cardIds as number[],
  });

  if (error) {
    console.error("Club information card reorder RPC failed.", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      clubId,
      cardCount: cardIds.length,
    });
    return { status: "error", message: writeErrorMessage(error.code, "The card order could not be saved. Refresh and try again.") };
  }

  revalidateInformationRoutes(slug);
  return { status: "success", message: "Order saved." };
}
