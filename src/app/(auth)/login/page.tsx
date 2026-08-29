import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Login",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims?.sub) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const initialError =
    error === "confirmation"
      ? "We could not confirm that email link. It may have expired or already been used."
      : undefined;

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in"
      description="Use your email and password to continue to your dashboard."
    >
      <LoginForm initialError={initialError} />
    </AuthShell>
  );
}
