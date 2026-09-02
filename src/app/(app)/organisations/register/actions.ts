"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ORGANISATION_TYPES,
  type OrganisationType,
} from "@/lib/organisations";
import { createClient } from "@/lib/supabase/server";

type RegistrationField =
  | "name"
  | "shortName"
  | "organisationType"
  | "address"
  | "postcode"
  | "telephone"
  | "contactEmail"
  | "website";

export type OrganisationRegistrationValues = Record<RegistrationField, string>;

export type OrganisationRegistrationState = {
  status?: "error";
  message?: string;
  values?: OrganisationRegistrationValues;
  fieldErrors?: Partial<Record<RegistrationField, string>>;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readRegistrationValues(formData: FormData): OrganisationRegistrationValues {
  return {
    name: String(formData.get("name") ?? "").trim(),
    shortName: String(formData.get("short_name") ?? "").trim(),
    organisationType: String(formData.get("organisation_type") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    postcode: String(formData.get("postcode") ?? "").trim(),
    telephone: String(formData.get("telephone") ?? "").trim(),
    contactEmail: String(formData.get("contact_email") ?? "")
      .trim()
      .toLowerCase(),
    website: String(formData.get("website") ?? "").trim(),
  };
}

function validateRegistration(values: OrganisationRegistrationValues) {
  const fieldErrors: OrganisationRegistrationState["fieldErrors"] = {};

  if (!values.name) fieldErrors.name = "Enter the organisation name.";
  else if (values.name.length < 2 || values.name.length > 160) {
    fieldErrors.name = "Use between 2 and 160 characters.";
  }

  if (values.shortName.length > 100) {
    fieldErrors.shortName = "Use 100 characters or fewer.";
  }

  if (!ORGANISATION_TYPES.includes(values.organisationType as OrganisationType)) {
    fieldErrors.organisationType = "Select an organisation type.";
  }

  if (values.address.length > 1000) {
    fieldErrors.address = "Use 1000 characters or fewer.";
  }

  if (values.postcode.length > 20) {
    fieldErrors.postcode = "Use 20 characters or fewer.";
  }

  if (
    values.telephone &&
    (values.telephone.length < 3 || values.telephone.length > 50)
  ) {
    fieldErrors.telephone = "Use between 3 and 50 characters.";
  }

  if (values.contactEmail && !emailPattern.test(values.contactEmail)) {
    fieldErrors.contactEmail = "Enter a valid email address.";
  } else if (values.contactEmail.length > 320) {
    fieldErrors.contactEmail = "Use 320 characters or fewer.";
  }

  if (values.website) {
    try {
      const url = new URL(values.website);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        fieldErrors.website = "Use a website beginning with http:// or https://.";
      }
    } catch {
      fieldErrors.website = "Enter a complete website address.";
    }

    if (values.website.length > 2048) {
      fieldErrors.website = "Use 2048 characters or fewer.";
    }
  }

  return fieldErrors;
}

export async function registerOrganisation(
  _previousState: OrganisationRegistrationState,
  formData: FormData,
): Promise<OrganisationRegistrationState> {
  const values = readRegistrationValues(formData);
  const fieldErrors = validateRegistration(values);

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors, values };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    return {
      status: "error",
      message: "Your session could not be verified. Sign in again and retry.",
      values,
    };
  }

  const { data, error } = await supabase.rpc("register_organisation", {
    p_name: values.name,
    p_short_name: values.shortName || null,
    p_organisation_type: values.organisationType,
    p_address: values.address || null,
    p_postcode: values.postcode || null,
    p_telephone: values.telephone || null,
    p_contact_email: values.contactEmail || null,
    p_website: values.website || null,
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "23505"
          ? "An organisation with this name appears to already be registered. Request management access instead, or check the name."
          : error.code === "42501"
            ? "Your session could not be verified. Sign in again and retry."
            : error.code === "22023" || error.code === "23514"
              ? "Some organisation details were not accepted. Review the form and try again."
              : "The organisation could not be registered. Check that the latest organisation registration SQL has been run, then try again.",
      values,
    };
  }

  const slug = typeof data === "string" ? data : "";

  if (!routeSafeSlugPattern.test(slug)) {
    return {
      status: "error",
      message:
        "The organisation was registered, but its page could not be opened automatically. Return to Browse organisations to find it.",
      values,
    };
  }

  revalidatePath("/organisations");
  revalidatePath("/(app)", "layout");
  redirect(`/organisations/${slug}?registered=1`);
}
