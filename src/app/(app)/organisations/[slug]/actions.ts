"use server";

import { revalidatePath } from "next/cache";
import {
  normaliseOrganisationContactValues,
  validateOrganisationContact,
  type OrganisationContactFieldErrors,
  type OrganisationContactValues,
} from "@/lib/organisation-contact";
import { createClient } from "@/lib/supabase/server";

export type OrganisationContentActionResult = {
  status: "success" | "error";
  message: string;
};

export type OrganisationContactActionResult = OrganisationContentActionResult & {
  fieldErrors?: OrganisationContactFieldErrors;
};

type AboutInput = {
  organisationId: number;
  content: string;
};

type ContactInput = {
  organisationId: number;
} & OrganisationContactValues;

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

function readRpcSlug(value: unknown) {
  const slug = typeof value === "string" ? value : "";
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

function mutationErrorMessage(
  code: string | undefined,
  invalidMessage: string,
  fallback: string,
) {
  if (code === "42501") {
    return "Only this organisation’s active owner can make this change.";
  }

  if (code === "P0002") {
    return "That active organisation is no longer available. Refresh and try again.";
  }

  if (code === "22023" || code === "23514") {
    return invalidMessage;
  }

  return fallback;
}

export async function updateOrganisationAbout(
  input: AboutInput,
): Promise<OrganisationContentActionResult> {
  const organisationId = readPositiveInteger(input?.organisationId);
  const content = String(input?.content ?? "").trim();

  if (!organisationId) {
    return {
      status: "error",
      message: "The organisation could not be identified. Refresh and try again.",
    };
  }

  if ([...content].length > 20_000) {
    return {
      status: "error",
      message: "About content cannot exceed 20,000 characters.",
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { data, error } = await supabase.rpc("update_organisation_about", {
    p_organisation_id: organisationId,
    p_about_content: content || null,
  });

  if (error) {
    return {
      status: "error",
      message: mutationErrorMessage(
        error.code,
        "The submitted About content is invalid. Check the limit and try again.",
        "The About information could not be saved. Please try again.",
      ),
    };
  }

  const slug = readRpcSlug(data);
  if (slug) revalidatePath(`/organisations/${slug}`);

  return {
    status: "success",
    message: content ? "About information updated." : "About information cleared.",
  };
}

export async function updateOrganisationContactDetails(
  input: ContactInput,
): Promise<OrganisationContactActionResult> {
  const organisationId = readPositiveInteger(input?.organisationId);
  const values = normaliseOrganisationContactValues({
    address: input?.address,
    postcode: input?.postcode,
    telephone: input?.telephone,
    contactEmail: input?.contactEmail,
    website: input?.website,
  });
  const fieldErrors = validateOrganisationContact(values);

  if (!organisationId) {
    return {
      status: "error",
      message: "The organisation could not be identified. Refresh and try again.",
    };
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Review the highlighted contact details and try again.",
      fieldErrors,
    };
  }

  const { supabase, authenticated } = await createAuthenticatedClient();

  if (!authenticated) {
    return { status: "error", message: "Sign in again before continuing." };
  }

  const { data, error } = await supabase.rpc(
    "update_organisation_contact_details",
    {
      p_organisation_id: organisationId,
      p_address: values.address || null,
      p_postcode: values.postcode || null,
      p_telephone: values.telephone || null,
      p_contact_email: values.contactEmail || null,
      p_website: values.website || null,
    },
  );

  if (error) {
    return {
      status: "error",
      message: mutationErrorMessage(
        error.code,
        "The submitted contact details are invalid. Review the fields and try again.",
        "The contact details could not be saved. Please try again.",
      ),
    };
  }

  const slug = readRpcSlug(data);
  if (slug) {
    revalidatePath(`/organisations/${slug}/contact`);
    revalidatePath("/organisations");
    revalidatePath("/organisations/access");
  }

  return { status: "success", message: "Contact details updated." };
}
