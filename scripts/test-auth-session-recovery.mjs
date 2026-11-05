import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const siteUrl = await loadModule("src/lib/server/site-url.ts", { "server-only": {} });
const validation = await loadModule("src/lib/auth-validation.ts");
const recovery = await loadModule("src/lib/auth-recovery.ts");

function form(values) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }

test("recovery request uses canonical callback and non-enumerating success", async () => {
  const calls = [];
  const actions = await loadModule("src/app/(auth)/forgot-password/actions.ts", {
    "next/headers": { headers: async () => new Headers({ origin: "https://preview.example.org" }) },
    "@/lib/server/site-url": siteUrl,
    "@/lib/supabase/server": { createClient: async () => ({ auth: { resetPasswordForEmail: async (...args) => { calls.push(args); return { error: null }; } } }) },
  });
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://rifle.example.org";
  try {
    const result = await actions.requestPasswordReset({}, form({ email: " MEMBER@example.org " }));
    assert.equal(result.status, "success");
    assert.match(result.message, /If an account exists/);
    assert.deepEqual(calls[0], ["member@example.org", { redirectTo: "https://rifle.example.org/auth/confirm?next=reset-password" }]);
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = previous; }
});

test("recovery request validates email and hides raw errors", async () => {
  const actions = await loadModule("src/app/(auth)/forgot-password/actions.ts", {
    "next/headers": { headers: async () => new Headers({ origin: "http://localhost:3000" }) },
    "@/lib/server/site-url": siteUrl,
    "@/lib/supabase/server": { createClient: async () => ({ auth: { resetPasswordForEmail: async () => ({ error: { code: "unexpected_failure", message: "private auth.users" } }) } }) },
  });
  assert.match((await actions.requestPasswordReset({}, form({ email: "bad" }))).fieldError, /valid email/);
  const result = await actions.requestPasswordReset({}, form({ email: "member@example.org" }));
  assert.doesNotMatch(JSON.stringify(result), /auth\.users/);
});

test("recovery request does not reveal an unknown account", async () => {
  const actions = await loadModule("src/app/(auth)/forgot-password/actions.ts", {
    "next/headers": { headers: async () => new Headers({ origin: "http://localhost:3000" }) },
    "@/lib/server/site-url": siteUrl,
    "@/lib/supabase/server": { createClient: async () => ({ auth: { resetPasswordForEmail: async () => ({ error: { code: "user_not_found", status: 404 } }) } }) },
  });
  const result = await actions.requestPasswordReset({}, form({ email: "missing@example.org" }));
  assert.equal(result.status, "success");
  assert.match(result.message, /If an account exists/);
});

test("reset validates mismatch before Auth and signs out after successful update", async () => {
  const calls = [];
  const cookies = { get: () => ({ value: "session-1" }), delete: (name) => calls.push(["delete", name]) };
  const actions = await loadModule("src/app/(auth)/reset-password/actions.ts", {
    "next/headers": { cookies: async () => cookies },
    "next/cache": { revalidatePath: () => {} },
    "next/navigation": { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
    "@/lib/auth-validation": validation,
    "@/lib/auth-recovery": recovery,
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      getClaims: async () => ({ data: { claims: { session_id: "session-1", amr: [{ method: "recovery" }] } }, error: null }),
      updateUser: async (args) => { calls.push(["update", args]); return { error: null }; },
      signOut: async (args) => { calls.push(["signout", args]); return { error: null }; },
    } }) },
  });
  const mismatch = await actions.resetPassword({}, form({ password: "NewPassword9", confirmPassword: "Different9" }));
  assert.match(mismatch.fieldErrors.confirmPassword, /do not match/);
  assert.equal(calls.length, 0);
  await assert.rejects(actions.resetPassword({}, form({ password: "NewPassword9", confirmPassword: "NewPassword9" })), /REDIRECT:\/login\?message=password-reset/);
  assert.deepEqual(calls, [["update", { password: "NewPassword9" }], ["signout", { scope: "local" }], ["delete", "rifle-recovery-session"]]);
});

test("reset rejects a missing recovery marker", async () => {
  const actions = await loadModule("src/app/(auth)/reset-password/actions.ts", {
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "next/cache": {}, "next/navigation": {}, "@/lib/auth-validation": validation,
    "@/lib/auth-recovery": recovery,
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { session_id: "session-1", amr: [{ method: "recovery" }] } }, error: null }) } }) },
  });
  const result = await actions.resetPassword({}, form({ password: "NewPassword9", confirmPassword: "NewPassword9" }));
  assert.match(result.message, /invalid or has expired/);
  assert.doesNotMatch(JSON.stringify(result), /NewPassword9/);
});

test("an ordinary signed-in session cannot use the recovery form", () => {
  assert.equal(recovery.isRecoverySession({ amr: [{ method: "password" }] }), false);
  assert.equal(recovery.isRecoverySession({ amr: [{ method: "recovery" }] }), true);
});

test("Login and Profile guards share verified claims, with Profile retaining access on user lookup failure", async () => {
  const profile = await loadModule("src/app/(app)/profile/page.tsx", {
    "next/navigation": { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
    "@/components/ui": { Card: ({ children }) => createElement("div", null, children) },
    "@/lib/profiles": { profileToFormValues: () => ({}) },
    "@/lib/supabase/server": { createClient: async () => ({
      auth: {
        getClaims: async () => ({ data: { claims: { sub: "user-1", email: "verified@example.org" } }, error: null }),
        getUser: async () => ({ data: { user: null }, error: { status: 503 } }),
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "user-1" }, error: null }) }) }) }),
    }) },
    "./account-security": { AccountSecurity: ({ email }) => createElement("div", null, email) },
    "./profile-form": { ProfileForm: () => createElement("div") },
  });
  assert.match(renderToStaticMarkup(await profile.default()), /verified@example\.org/);
  const login = await read("src/app/(auth)/login/page.tsx");
  assert.match(login, /supabase\.auth\.getClaims\(\)/);
  assert.match(await read("src/app/(app)/profile/page.tsx"), /supabase\.auth\.getClaims\(\)/);
});

test("recovery callback, Login notices, logout and proxy cookie propagation stay connected", async () => {
  const callback = await read("src/app/auth/confirm/route.ts");
  const login = await read("src/app/(auth)/login/login-form.tsx");
  const logout = await read("src/app/auth/signout/route.ts");
  const proxy = await read("src/lib/supabase/proxy.ts");
  assert.match(callback, /type === "recovery"/);
  assert.match(callback, /rifle-recovery-session/);
  assert.match(callback, /reset-password\?error=invalid/);
  assert.match(login, /Forgot password\?/);
  assert.match(await read("src/app/(auth)/login/page.tsx"), /password-changed[\s\S]*password-reset/);
  assert.match(logout, /signOut\(\{ scope: "local" \}\)/);
  assert.match(proxy, /request\.cookies\.set/);
  assert.match(proxy, /response\.cookies\.set/);
});

test("recovery callback accepts a verified link and rejects an expired one", async () => {
  const makeResponse = (url, status) => ({ url: String(url), status, headers: new Headers(), cookies: { set(name, value) { this[name] = value; } } });
  for (const [verificationError, destination] of [[null, "/reset-password"], [{ code: "otp_expired" }, "/reset-password?error=invalid"]]) {
    const route = await loadModule("src/app/auth/confirm/route.ts", {
      "next/server": { NextResponse: { redirect: makeResponse } },
      "@/lib/auth-recovery": recovery,
      "@/lib/supabase/server": { createClient: async () => ({ auth: {
        verifyOtp: async () => ({ error: verificationError }),
        getClaims: async () => ({ data: { claims: { session_id: "session-1", amr: [{ method: "recovery" }] } }, error: null }),
      } }) },
    });
    const url = new URL("https://rifle.example.org/auth/confirm?token_hash=secret&type=recovery&next=reset-password");
    const response = await route.GET({ url: url.toString(), nextUrl: url });
    assert.equal(response.url, `https://rifle.example.org${destination}`);
    assert.equal(response.cookies["rifle-recovery-session"], verificationError ? undefined : "session-1");
  }
});

test("Login redirects an authenticated session while Profile rejects an unauthenticated one", async () => {
  const redirect = (path) => { throw new Error(`REDIRECT:${path}`); };
  const login = await loadModule("src/app/(auth)/login/page.tsx", {
    "next/navigation": { redirect },
    "@/components/auth-shell": { AuthShell: () => createElement("div") },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } }, error: null }) } }) },
    "./login-form": { LoginForm: () => createElement("div") },
  });
  await assert.rejects(login.default({ searchParams: Promise.resolve({}) }), /REDIRECT:\/dashboard/);
  const profile = await loadModule("src/app/(app)/profile/page.tsx", {
    "next/navigation": { redirect },
    "@/components/ui": {}, "@/lib/profiles": {},
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: null }, error: null }) } }) },
    "./account-security": {}, "./profile-form": {},
  });
  await assert.rejects(profile.default(), /REDIRECT:\/login/);
});

test("proxy sends refreshed cookies to both the protected render and browser", async () => {
  const requestCookies = new Map([["old", "stale"]]);
  let forwardedHeaders;
  const proxy = await loadModule("src/lib/supabase/proxy.ts", {
    "@supabase/ssr": { createServerClient: (_url, _key, options) => ({ auth: {
      getClaims: async () => {
        options.cookies.setAll([{ name: "auth", value: "refreshed", options: { httpOnly: true } }], {});
        return { data: { claims: { sub: "user-1" } }, error: null };
      },
    } }) },
    "next/server": { NextResponse: { next: ({ request }) => {
      forwardedHeaders = request.headers;
      const responseCookies = new Map();
      return { cookies: { set: (name, value) => responseCookies.set(name, value), get: (name) => responseCookies.get(name) }, headers: new Headers() };
    } } },
  });
  const response = await proxy.updateSession({
    headers: new Headers(),
    cookies: { getAll: () => [...requestCookies].map(([name, value]) => ({ name, value })), set: (name, value) => requestCookies.set(name, value) },
  });
  assert.equal(requestCookies.get("auth"), "refreshed");
  assert.equal(response.cookies.get("auth"), "refreshed");
  assert.equal(forwardedHeaders.get("x-rifleleagues-public-results"), "0");
});
