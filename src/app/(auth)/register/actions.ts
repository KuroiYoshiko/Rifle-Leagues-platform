"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DATABASE_SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/server/database-errors";
import { getRegistrationConfirmationUrl } from "@/lib/server/site-url";
import {
  createServerErrorDiagnostic,
  reportUnexpectedServerError,
} from "@/lib/server/unexpected-error";
import { createClient } from "@/lib/supabase/server";

type RegisterField =
  | "firstName"
  | "lastName"
  | "email"
  | "password"
  | "confirmPassword";

export type RegisterState = {
  status?: "check-email";
  message?: string;
  email?: string;
  values?: Partial<Record<"firstName" | "lastName" | "email", string>>;
  fieldErrors?: Partial<Record<RegisterField, string>>;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(password: string) {
  if (password.length < 8) {
    return "Use at least 8 characters.";
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Include an uppercase letter, a lowercase letter, and a number.";
  }

  return undefined;
}

async function getConfirmationUrl() {
  const requestHeaders = await headers();
  return getRegistrationConfirmationUrl({
    nodeEnv: process.env.NODE_ENV,
    configuredSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    requestOrigin: requestHeaders.get("origin"),
  });
}

export async function register(
  _previousState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const values = { firstName, lastName, email };
  const fieldErrors: RegisterState["fieldErrors"] = {};

  if (!firstName) fieldErrors.firstName = "Enter your first name.";
  else if (firstName.length > 100) fieldErrors.firstName = "Use 100 characters or fewer.";
  if (!lastName) fieldErrors.lastName = "Enter your last name.";
  else if (lastName.length > 100) fieldErrors.lastName = "Use 100 characters or fewer.";
  if (!email) {
    fieldErrors.email = "Enter your email address.";
  } else if (!emailPattern.test(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (!password) {
    fieldErrors.password = "Create a password.";
  } else {
    const passwordError = validatePassword(password);
    if (passwordError) fieldErrors.password = passwordError;
  }

  if (!confirmPassword) {
    fieldErrors.confirmPassword = "Confirm your password.";
  } else if (password !== confirmPassword) {
    fieldErrors.confirmPassword = "The passwords do not match.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values };
  }

  let emailRedirectTo: string;
  try {
    emailRedirectTo = await getConfirmationUrl();
  } catch (error) {
    reportUnexpectedServerError(createServerErrorDiagnostic({
      operation: "auth.register-confirmation-url",
      category: "deployment",
      code: error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "SITE_URL_INVALID",
    }));
    return { message: DATABASE_SERVICE_UNAVAILABLE_MESSAGE, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
      },
      emailRedirectTo,
    },
  });

  if (error) {
    if (error.status === 429) {
      return {
        message: "Too many registration attempts. Wait a moment and try again.",
        values,
      };
    }

    if (error.code === "weak_password") {
      return {
        fieldErrors: { password: "Choose a stronger password." },
        values,
      };
    }

    return {
      message: "We could not create the account. Please review your details and try again.",
      values,
    };
  }

  if (data.session) {
    redirect("/dashboard");
  }

  return { status: "check-email", email };
}
