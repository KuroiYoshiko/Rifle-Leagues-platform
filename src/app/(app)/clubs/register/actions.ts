"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type RegistrationField = "name" | "town" | "county" | "postcode" | "website";

export type ClubRegistrationValues = Record<RegistrationField, string>;

export type ClubRegistrationState = {
  status?: "error";
  message?: string;
  values?: ClubRegistrationValues;
  fieldErrors?: Partial<Record<RegistrationField, string>>;
};

const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readValues(formData: FormData): ClubRegistrationValues {
  return {
    name: String(formData.get("name") ?? "").trim(),
    town: String(formData.get("town") ?? "").trim(),
    county: String(formData.get("county") ?? "").trim(),
    postcode: String(formData.get("postcode") ?? "").trim(),
    website: String(formData.get("website") ?? "").trim(),
  };
}

function validate(values: ClubRegistrationValues) {
  const fieldErrors: ClubRegistrationState["fieldErrors"] = {};

  if (!values.name) fieldErrors.name = "Enter the club name.";
  else if (values.name.length < 2 || values.name.length > 160) {
    fieldErrors.name = "Use between 2 and 160 characters.";
  }

  if (values.town.length > 100) fieldErrors.town = "Use 100 characters or fewer.";
  if (values.county.length > 100) fieldErrors.county = "Use 100 characters or fewer.";
  if (values.postcode.length > 20) fieldErrors.postcode = "Use 20 characters or fewer.";
  if (values.website.length > 2048) fieldErrors.website = "Use 2,048 characters or fewer.";
  else if (values.website && !/^https?:\/\/[^\s]+$/i.test(values.website)) {
    fieldErrors.website = "Enter a complete address beginning with http:// or https://.";
  }

  return fieldErrors;
}

export async function registerClub(
  _previousState: ClubRegistrationState,
  formData: FormData,
): Promise<ClubRegistrationState> {
  const values = readValues(formData);
  const fieldErrors = validate(values);

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

  const { data, error } = await supabase.rpc("register_club", {
    p_name: values.name,
    p_town: values.town || null,
    p_county: values.county || null,
    p_postcode: values.postcode || null,
    p_website: values.website || null,
  });

  if (error) {
    return {
      status: "error",
      message:
        error.code === "23505"
          ? "A club with this name appears to already be registered. Search for the existing club and request membership instead."
          : error.code === "42501"
            ? "Your session could not be verified. Sign in again and retry."
            : error.code === "22023" || error.code === "23514"
              ? "Some club details were not accepted. Review the form and try again."
              : "The club could not be registered. Check that the latest club foundation SQL has been run, then try again.",
      values,
    };
  }

  const slug = typeof data === "string" ? data : "";

  if (!routeSafeSlugPattern.test(slug)) {
    return {
      status: "error",
      message: "The club was registered, but its page could not be opened automatically. Return to Browse clubs to find it.",
      values,
    };
  }

  revalidatePath("/clubs");
  revalidatePath("/", "layout");
  redirect(`/clubs/${slug}?registered=1`);
}
