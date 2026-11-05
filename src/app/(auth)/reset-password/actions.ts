"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validatePassword } from "@/lib/auth-validation";
import { isRecoverySession } from "@/lib/auth-recovery";
import { createClient } from "@/lib/supabase/server";

export type ResetPasswordState = {
  status?: "error";
  message?: string;
  fieldErrors?: { password?: string; confirmPassword?: string };
};

export async function resetPassword(
  _state: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const fieldErrors: ResetPasswordState["fieldErrors"] = {};
  fieldErrors.password = validatePassword(password);
  if (password !== confirmPassword) fieldErrors.confirmPassword = "The new passwords do not match.";
  if (Object.values(fieldErrors).some(Boolean)) return { status: "error", fieldErrors };

  try {
    const cookieStore = await cookies();
    const supabase = await createClient();
    const { data, error: sessionError } = await supabase.auth.getClaims();
    const sessionId = data?.claims?.session_id;
    if (sessionError || !sessionId || !isRecoverySession(data?.claims) || cookieStore.get("rifle-recovery-session")?.value !== sessionId) {
      return { status: "error", message: "This password reset link is invalid or has expired. Request a new password reset." };
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error?.code === "weak_password") return { status: "error", fieldErrors: { password: "Choose a stronger password." } };
    if (error?.status === 429) return { status: "error", message: "Too many attempts. Wait a moment and try again." };
    if (error) return { status: "error", message: "We could not reset your password. Please request a new link and try again." };
    await supabase.auth.signOut({ scope: "local" });
    cookieStore.delete("rifle-recovery-session");
  } catch {
    return { status: "error", message: "We could not reset your password. Please try again." };
  }
  revalidatePath("/", "layout");
  redirect("/login?message=password-reset");
}
