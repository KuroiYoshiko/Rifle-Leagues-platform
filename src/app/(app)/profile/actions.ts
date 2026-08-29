"use server";

import { revalidatePath } from "next/cache";
import { PROFILE_TITLES, type ProfileFormValues, type ProfileTitle } from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";

type ProfileField = keyof ProfileFormValues;

export type ProfileFormState = {
  status?: "success" | "error";
  message?: string;
  values?: ProfileFormValues;
  fieldErrors?: Partial<Record<ProfileField, string>>;
};

const fieldLimits: Partial<Record<ProfileField, number>> = {
  first_name: 100,
  last_name: 100,
  address: 500,
  town: 100,
  county: 100,
  postcode: 20,
  phone_number: 40,
};

const fieldLabels: Record<ProfileField, string> = {
  first_name: "First name",
  last_name: "Last name",
  title: "Title",
  address: "Address",
  town: "Town",
  county: "County",
  postcode: "Postcode",
  phone_number: "Phone number",
};

function readValues(formData: FormData): ProfileFormValues {
  return {
    first_name: String(formData.get("first_name") ?? "").trim(),
    last_name: String(formData.get("last_name") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    town: String(formData.get("town") ?? "").trim(),
    county: String(formData.get("county") ?? "").trim(),
    postcode: String(formData.get("postcode") ?? "").trim(),
    phone_number: String(formData.get("phone_number") ?? "").trim(),
  };
}

function validate(values: ProfileFormValues) {
  const fieldErrors: ProfileFormState["fieldErrors"] = {};

  if (!values.first_name) fieldErrors.first_name = "Enter your first name.";
  if (!values.last_name) fieldErrors.last_name = "Enter your last name.";

  if (
    values.title &&
    !PROFILE_TITLES.includes(values.title as ProfileTitle)
  ) {
    fieldErrors.title = "Choose a title from the list.";
  }

  for (const [field, limit] of Object.entries(fieldLimits) as Array<
    [ProfileField, number]
  >) {
    if (values[field].length > limit) {
      fieldErrors[field] = `${fieldLabels[field]} must be ${limit} characters or fewer.`;
    }
  }

  if (
    values.phone_number &&
    !/^[0-9+().\-\s]{7,40}$/.test(values.phone_number)
  ) {
    fieldErrors.phone_number =
      "Enter a valid phone number using numbers and common phone symbols.";
  }

  return fieldErrors;
}

function optional(value: string) {
  return value || null;
}

export async function updateProfile(
  _previousState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const values = readValues(formData);
  const fieldErrors = validate(values);

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Review the highlighted fields and try again.",
      values,
      fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return {
      status: "error",
      message: "Your session could not be verified. Sign in again and retry.",
      values,
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      first_name: values.first_name,
      last_name: values.last_name,
      title: optional(values.title),
      address: optional(values.address),
      town: optional(values.town),
      county: optional(values.county),
      postcode: optional(values.postcode),
      phone_number: optional(values.phone_number),
    })
    .eq("id", userId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return {
      status: "error",
      message: "We could not save your profile. Please try again.",
      values,
    };
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");

  return {
    status: "success",
    message: "Your profile has been saved.",
    values,
  };
}
