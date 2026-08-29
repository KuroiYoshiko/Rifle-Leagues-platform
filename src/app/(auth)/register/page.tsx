import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create account",
};

export default async function RegisterPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims?.sub) {
    redirect("/dashboard");
  }

  return (
    <AuthShell
      eyebrow="Join RifleLeagues"
      title="Create account"
      description="Set up your sign-in now. Club and competition details will come later."
    >
      <RegisterForm />
    </AuthShell>
  );
}
