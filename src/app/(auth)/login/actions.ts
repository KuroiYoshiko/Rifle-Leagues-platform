"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  message?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
  };
  email?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fieldErrors: LoginState["fieldErrors"] = {};

  if (!email) {
    fieldErrors.email = "Enter your email address.";
  } else if (!emailPattern.test(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (!password) {
    fieldErrors.password = "Enter your password.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        message: "Confirm your email address before signing in.",
        email,
      };
    }

    if (error.status === 429) {
      return {
        message: "Too many sign-in attempts. Wait a moment and try again.",
        email,
      };
    }

    return {
      message: "The email or password is incorrect.",
      email,
    };
  }

  redirect("/dashboard");
}
