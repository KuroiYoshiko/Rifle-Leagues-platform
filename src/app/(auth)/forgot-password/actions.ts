"use server";

import { headers } from "next/headers";
import { getRegistrationConfirmationUrl } from "@/lib/server/site-url";
import { createClient } from "@/lib/supabase/server";

export type RecoveryRequestState = { status?: "success" | "error"; message?: string; fieldError?: string };
const successMessage = "If an account exists for this email, we've sent password reset instructions.";

export async function requestPasswordReset(
  _state: RecoveryRequestState,
  formData: FormData,
): Promise<RecoveryRequestState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", fieldError: "Enter a valid email address." };
  }
  try {
    const requestHeaders = await headers();
    const callbackUrl = new URL(getRegistrationConfirmationUrl({
      nodeEnv: process.env.NODE_ENV,
      configuredSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
      requestOrigin: requestHeaders.get("origin"),
    }));
    callbackUrl.searchParams.set("next", "reset-password");
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl.toString(),
    });
    if (error?.status === 429 || error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many requests. Wait a moment and try again." };
    }
    if (error && (!error.status || error.status >= 500)) {
      return { status: "error", message: "We could not send reset instructions right now. Please try again." };
    }
    // Other Auth rejections may depend on account state; keep the public result identical.
    return { status: "success", message: successMessage };
  } catch {
    return { status: "error", message: "We could not send reset instructions right now. Please try again." };
  }
}
