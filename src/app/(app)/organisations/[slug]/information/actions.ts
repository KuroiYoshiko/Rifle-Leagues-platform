"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type InformationCardActionResult = {
  status: "success" | "error";
  message: string;
};

type CardMutationInput = {
  organisationId: number;
  organisationSlug: string;
  title: string;
  content: string;
};

type UpdateCardInput = CardMutationInput & { cardId: number };

type DeleteCardInput = Pick<
  UpdateCardInput,
  "organisationId" | "organisationSlug" | "cardId"
>;

type ReorderCardsInput = Pick<
  CardMutationInput,
  "organisationId" | "organisationSlug"
> & { cardIds: number[] };

const safeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readPositiveInteger(value: unknown) {
  const rawValue = String(value ?? "").trim();
  const parsedValue = Number(rawValue);

  return /^\d+$/.test(rawValue) &&
    Number.isSafeInteger(parsedValue) &&
    parsedValue > 0
    ? parsedValue
    : null;
}

function readSlug(value: unknown) {
  const slug = String(value ?? "").trim();
  return slug.length <= 180 && safeSlugPattern.test(slug) ? slug : null;
}

function readCardContent(
  titleValue: unknown,
  contentValue: unknown,
):
  | { valid: true; title: string; content: string }
  | { valid: false; error: string } {
  const title = String(titleValue ?? "").trim();
  const content = String(contentValue ?? "").trim();
  const titleLength = [...title].length;
  const contentLength = [...content].length;

  if (titleLength < 1 || titleLength > 120) {
    return {
      valid: false,
      error: "Enter a title between 1 and 120 characters.",
    };
  }

  if (contentLength < 1 || contentLength > 20_000) {
    return {
      valid: false,
      error: "Enter content between 1 and 20,000 characters.",
    };
  }

  return { valid: true, title, content };
}

async function createAuthenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return {
    supabase,
    authenticated: !error && Boolean(data?.claims?.sub),
  };
}

function revalidateInformationPage(slug: string) {
  revalidatePath(`/organisations/${slug}/information`);
}

function writeErrorMessage(code: string | undefined, fallback: string) {
  if (code === "42501") {
    return "Only this organisation’s active owner can change information cards.";
  }

  if (code === "54000" || code === "23514" || code === "23505") {
    return "This organisation already has the maximum of five information cards.";
  }

  if (code === "P0002") {
    return "That information card or organisation is no longer available. Refresh and try again.";
  }

  if (code === "22023") {
    return "The submitted card information is invalid. Check the limits and try again.";
  }

  return fallback;
}

export async function createOrganisationInformationCard(
  input: CardMutationInput,
): Promise<InformationCardActionResult> {
  const organisationId = readPositiveInteger(input?.organisationId);
  const slug = readSlug(input?.organisationSlug);
  const cardContent = readCardContent(input?.title, input?.content);

  if (!organisationId || !slug || !cardContent.valid) {
    return {
      status: "error",
      message:
        !cardContent.valid
          ? cardContent.error
          : "The organisation could not be identified. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc(
    "create_organisation_information_card",
    {
      p_organisation_id: organisationId,
      p_title: cardContent.title,
      p_content: cardContent.content,
    },
  );

  if (error) {
    return {
      status: "error",
      message: writeErrorMessage(
        error.code,
        "The information card could not be added. Please try again.",
      ),
    };
  }

  revalidateInformationPage(slug);
  return { status: "success", message: "Information card added." };
}

export async function updateOrganisationInformationCard(
  input: UpdateCardInput,
): Promise<InformationCardActionResult> {
  const organisationId = readPositiveInteger(input?.organisationId);
  const cardId = readPositiveInteger(input?.cardId);
  const slug = readSlug(input?.organisationSlug);
  const cardContent = readCardContent(input?.title, input?.content);

  if (!organisationId || !cardId || !slug || !cardContent.valid) {
    return {
      status: "error",
      message:
        !cardContent.valid
          ? cardContent.error
          : "The information card could not be identified. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc(
    "update_organisation_information_card",
    {
      p_organisation_id: organisationId,
      p_card_id: cardId,
      p_title: cardContent.title,
      p_content: cardContent.content,
    },
  );

  if (error) {
    return {
      status: "error",
      message: writeErrorMessage(
        error.code,
        "The information card could not be updated. Please try again.",
      ),
    };
  }

  revalidateInformationPage(slug);
  return { status: "success", message: "Information card updated." };
}

export async function deleteOrganisationInformationCard(
  input: DeleteCardInput,
): Promise<InformationCardActionResult> {
  const organisationId = readPositiveInteger(input?.organisationId);
  const cardId = readPositiveInteger(input?.cardId);
  const slug = readSlug(input?.organisationSlug);

  if (!organisationId || !cardId || !slug) {
    return {
      status: "error",
      message: "The information card could not be identified. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc(
    "delete_organisation_information_card",
    {
      p_organisation_id: organisationId,
      p_card_id: cardId,
    },
  );

  if (error) {
    return {
      status: "error",
      message: writeErrorMessage(
        error.code,
        "The information card could not be deleted. Please try again.",
      ),
    };
  }

  revalidateInformationPage(slug);
  return { status: "success", message: "Information card deleted." };
}

export async function reorderOrganisationInformationCards(
  input: ReorderCardsInput,
): Promise<InformationCardActionResult> {
  const organisationId = readPositiveInteger(input?.organisationId);
  const slug = readSlug(input?.organisationSlug);
  const cardIds = Array.isArray(input?.cardIds)
    ? input.cardIds.map(readPositiveInteger)
    : [];

  if (
    !organisationId ||
    !slug ||
    cardIds.length > 5 ||
    cardIds.some((id) => id === null) ||
    new Set(cardIds).size !== cardIds.length
  ) {
    return {
      status: "error",
      message: "The card order is invalid. Refresh and try again.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { error } = await supabase.rpc(
    "reorder_organisation_information_cards",
    {
      p_organisation_id: organisationId,
      p_card_ids: cardIds as number[],
    },
  );

  if (error) {
    return {
      status: "error",
      message: writeErrorMessage(
        error.code,
        "The card order could not be saved. Refresh and try again.",
      ),
    };
  }

  revalidateInformationPage(slug);
  return { status: "success", message: "Order saved." };
}
