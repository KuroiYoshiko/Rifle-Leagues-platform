import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function noStoreRedirect(url: URL) {
  const response = NextResponse.redirect(url, 303);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const code = request.nextUrl.searchParams.get("code");
  const recovery = type === "recovery" || request.nextUrl.searchParams.get("next") === "reset-password";
  const nextPath = request.nextUrl.searchParams.get("next") === "profile" || type === "email_change"
    ? "/profile"
    : "/dashboard";
  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (!error) {
      if (recovery) return recoveryRedirect(request, supabase);
      return noStoreRedirect(new URL(nextPath, request.url));
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      if (recovery) return recoveryRedirect(request, supabase);
      return noStoreRedirect(new URL(nextPath, request.url));
    }
  }

  return noStoreRedirect(new URL(recovery ? "/reset-password?error=invalid" : "/login?error=confirmation", request.url));
}

async function recoveryRedirect(request: NextRequest, supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.auth.getClaims();
  const sessionId = data?.claims?.session_id;
  if (error || !sessionId) return noStoreRedirect(new URL("/reset-password?error=invalid", request.url));
  const response = noStoreRedirect(new URL("/reset-password", request.url));
  response.cookies.set("rifle-recovery-session", sessionId, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/reset-password",
    maxAge: 15 * 60,
  });
  return response;
}
