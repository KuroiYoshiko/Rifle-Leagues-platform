import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { AuthShell } from "@/components/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Set new password" };

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const cookieStore = await cookies();
  const supabase = await createClient();
  const { data, error: sessionError } = await supabase.auth.getClaims();
  const valid = !error && !sessionError && Boolean(data?.claims?.session_id) &&
    cookieStore.get("rifle-recovery-session")?.value === data?.claims?.session_id;
  return <AuthShell eyebrow="Account recovery" title={valid ? "Set new password" : "Reset link unavailable"} description={valid ? "Choose a new password for your account." : "This password reset link is invalid or has expired."}>
    {valid ? <ResetForm /> : <Link href="/forgot-password" className="font-semibold text-brand-strong">Request a new password reset</Link>}
  </AuthShell>;
}
