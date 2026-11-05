"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { validatePassword } from "@/lib/auth-validation";
import { getRegistrationConfirmationUrl } from "@/lib/server/site-url";
import { createClient } from "@/lib/supabase/server";

type AuthErrorLike = { code?: string; status?: number };

export type EmailChangeState = {
  status?: "error" | "pending" | "success";
  message?: string;
  fieldError?: string;
};

export type PasswordChangeState = {
  status?: "error" | "reauthentication" | "success";
  message?: string;
  fieldErrors?: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword" | "nonce", string>>;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sessionMessage = "Your session could not be verified. Sign in again and retry.";
const rateLimitMessage = "Too many attempts. Wait a moment and try again.";

function isRateLimited(error: AuthErrorLike) {
  return error.status === 429 || error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit";
}

function emailError(error: AuthErrorLike): EmailChangeState {
  if (isRateLimited(error)) return { status: "error", message: rateLimitMessage };
  if (error.code === "email_exists" || error.code === "user_already_exists") {
    return { status: "error", fieldError: "That email address is already in use." };
  }
  if (error.code === "email_address_invalid" || error.code === "validation_failed") {
    return { status: "error", fieldError: "Enter a valid email address." };
  }
  if (error.code === "email_address_not_authorized") {
    return { status: "error", message: "We could not send a confirmation email to that address. Please contact support." };
  }
  return { status: "error", message: "We could not request the email change. Please try again." };
}

function passwordError(error: AuthErrorLike): PasswordChangeState {
  if (isRateLimited(error)) return { status: "error", message: rateLimitMessage };
  if (error.code === "current_password_invalid" || error.code === "current_password_mismatch" || error.code === "invalid_credentials") {
    return { status: "error", fieldErrors: { currentPassword: "The current password is incorrect." } };
  }
  if (error.code === "current_password_required") {
    return { status: "error", fieldErrors: { currentPassword: "Enter your current password." } };
  }
  if (error.code === "weak_password") {
    return { status: "error", fieldErrors: { newPassword: "Choose a stronger password." } };
  }
  if (error.code === "same_password") {
    return { status: "error", fieldErrors: { newPassword: "Choose a password you have not used for this account." } };
  }
  if (error.code === "reauthentication_not_valid") {
    return { status: "reauthentication", fieldErrors: { nonce: "That code is invalid or expired. Try again." } };
  }
  return { status: "error", message: "We could not change your password. Please try again." };
}

export async function changeEmail(
  _previousState: EmailChangeState,
  formData: FormData,
): Promise<EmailChangeState> {
  const email = String(formData.get("newEmail") ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !emailPattern.test(email)) {
    return { status: "error", fieldError: "Enter a valid email address." };
  }

  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return { status: "error", message: sessionMessage };

    if (email === userData.user.email?.toLowerCase()) {
      return { status: "error", fieldError: "Enter a different email address." };
    }

    const requestHeaders = await headers();
    const confirmationUrl = new URL(getRegistrationConfirmationUrl({
      nodeEnv: process.env.NODE_ENV,
      configuredSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
      requestOrigin: requestHeaders.get("origin"),
    }));
    confirmationUrl.searchParams.set("next", "profile");
    const { data, error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: confirmationUrl.toString() },
    );
    if (error) return emailError(error);

    revalidatePath("/profile");
    if (data.user?.email?.toLowerCase() === email && !data.user.new_email) {
      return { status: "success", message: "Your email address has changed." };
    }
    return {
      status: "pending",
      message: "Check your new email to confirm the change. If Secure Email Change is enabled, also confirm the message sent to your current email.",
    };
  } catch {
    return { status: "error", message: "We could not request the email change. Please try again." };
  }
}

export async function changePassword(
  _previousState: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const nonce = String(formData.get("nonce") ?? "").trim();
  const fieldErrors: PasswordChangeState["fieldErrors"] = {};

  if (!currentPassword) fieldErrors.currentPassword = "Enter your current password.";
  if (!newPassword) fieldErrors.newPassword = "Enter a new password.";
  else fieldErrors.newPassword = validatePassword(newPassword);
  if (!confirmPassword) fieldErrors.confirmPassword = "Confirm your new password.";
  else if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = "The new passwords do not match.";
  }
  if (_previousState.status === "reauthentication" && !nonce) {
    fieldErrors.nonce = "Enter the verification code we sent you.";
  }
  if (Object.values(fieldErrors).some(Boolean)) {
    return { status: _previousState.status === "reauthentication" ? "reauthentication" : "error", fieldErrors };
  }

  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return { status: "error", message: sessionMessage };

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      current_password: currentPassword,
      ...(nonce ? { nonce } : {}),
    });
    if (error?.code === "reauthentication_needed") {
      const { error: sendError } = await supabase.auth.reauthenticate();
      if (sendError) return passwordError(sendError);
      return {
        status: "reauthentication",
        message: "Check your email for a verification code, then enter it with your password details to finish the change.",
      };
    }
    if (error) return passwordError(error);

    return { status: "success", message: "Your password has changed." };
  } catch {
    return { status: "error", message: "We could not change your password. Please try again." };
  }
}
