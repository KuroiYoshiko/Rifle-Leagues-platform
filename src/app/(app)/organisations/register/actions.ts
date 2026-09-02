"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ORGANISATION_TYPES,
  type OrganisationType,
} from "@/lib/organisations";
import {
  normaliseOrganisationContactValues,
  validateOrganisationContact,
} from "@/lib/organisation-contact";
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

const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readRegistrationValues(formData: FormData): OrganisationRegistrationValues {
  const contactValues = normaliseOrganisationContactValues({
    address: formData.get("address"),
    postcode: formData.get("postcode"),
    telephone: formData.get("telephone"),
    contactEmail: formData.get("contact_email"),
    website: formData.get("website"),
  });

  return {
    name: String(formData.get("name") ?? "").trim(),
    shortName: String(formData.get("short_name") ?? "").trim(),
    organisationType: String(formData.get("organisation_type") ?? "").trim(),
    ...contactValues,
  };
}

function validateRegistration(values: OrganisationRegistrationValues) {
  const fieldErrors: OrganisationRegistrationState["fieldErrors"] = {
    ...validateOrganisationContact(values),
  };

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
