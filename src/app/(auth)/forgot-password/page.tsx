import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { RecoveryForm } from "./recovery-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return <AuthShell eyebrow="Account recovery" title="Forgot password?" description="Enter your email address to request a password reset link."><RecoveryForm /></AuthShell>;
}
