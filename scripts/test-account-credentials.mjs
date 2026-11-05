import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const validation = await loadModule("src/lib/auth-validation.ts");
const siteUrl = await loadModule("src/lib/server/site-url.ts", { "server-only": {} });

async function actionsFor({
  user = { id: "user-1", email: "old@example.org" },
  userError = null,
  updateResult = { data: { user: { email: "old@example.org", new_email: "new@example.org" } }, error: null },
  sendResult = { error: null },
} = {}) {
  const calls = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: userError }),
      updateUser: async (...args) => {
        calls.push({ method: "updateUser", args });
        return updateResult;
      },
      reauthenticate: async () => {
        calls.push({ method: "reauthenticate" });
        return sendResult;
      },
    },
  };
  const actions = await loadModule("src/app/(app)/profile/credential-actions.ts", {
    "next/cache": { revalidatePath: (path) => calls.push({ method: "revalidatePath", path }) },
    "next/headers": { headers: async () => new Headers({ origin: "https://rifle.example.org" }) },
    "@/lib/auth-validation": validation,
    "@/lib/server/site-url": siteUrl,
    "@/lib/supabase/server": { createClient: async () => client },
  });
  return { actions, calls };
}

function emailForm(value) {
  const form = new FormData();
  form.set("newEmail", value);
  return form;
}

function passwordForm({ current = "OldPassword9", next = "NewPassword9", confirm = next, nonce } = {}) {
  const form = new FormData();
  form.set("currentPassword", current);
  form.set("newPassword", next);
  form.set("confirmPassword", confirm);
  if (nonce !== undefined) form.set("nonce", nonce);
  return form;
}

test("email change validates format and rejects the signed-in user's current address", async () => {
  const { actions, calls } = await actionsFor();
  assert.match((await actions.changeEmail({}, emailForm("not-an-email"))).fieldError, /valid email/);
  assert.match((await actions.changeEmail({}, emailForm(" OLD@example.org "))).fieldError, /different email/);
  assert.equal(calls.length, 0);
});

test("email change uses the current session and reports pending confirmation", async () => {
  const { actions, calls } = await actionsFor();
  const result = await actions.changeEmail({}, emailForm(" NEW@example.org "));
  assert.equal(result.status, "pending");
  assert.match(result.message, /new email/);
  assert.match(result.message, /current email/);
  assert.deepEqual(calls[0], {
    method: "updateUser",
    args: [{ email: "new@example.org" }, { emailRedirectTo: "https://rifle.example.org/auth/confirm?next=profile" }],
  });
});

test("email change reports an applied address only when Auth returns it", async () => {
  const { actions } = await actionsFor({
    updateResult: { data: { user: { email: "new@example.org" } }, error: null },
  });
  const result = await actions.changeEmail({}, emailForm("new@example.org"));
  assert.equal(result.status, "success");
  assert.match(result.message, /has changed/);
});

test("email errors use safe messages without exposing Auth internals", async () => {
  for (const [error, expected] of [
    [{ code: "email_exists", message: "auth.users duplicate email" }, /already in use/],
    [{ code: "email_address_invalid", message: "auth.users invalid" }, /valid email/],
    [{ code: "over_email_send_rate_limit", status: 429, message: "private SMTP" }, /Too many attempts/],
    [{ code: "unknown", message: "auth.users private_details" }, /could not request/],
  ]) {
    const { actions } = await actionsFor({ updateResult: { data: { user: null }, error } });
    const result = await actions.changeEmail({}, emailForm("new@example.org"));
    assert.equal(result.status, "error");
    assert.match(result.message ?? result.fieldError, expected);
    assert.doesNotMatch(JSON.stringify(result), /auth\.users|private_details|private SMTP/);
  }
});

test("credential actions reject an unverified session", async () => {
  const { actions, calls } = await actionsFor({ user: null, userError: { code: "bad_jwt" } });
  assert.match((await actions.changeEmail({}, emailForm("new@example.org"))).message, /Sign in again/);
  assert.match((await actions.changePassword({}, passwordForm())).message, /Sign in again/);
  assert.equal(calls.length, 0);
});

test("password form validates mismatch and project password rules before Auth requests", async () => {
  const { actions, calls } = await actionsFor();
  const mismatch = await actions.changePassword({}, passwordForm({ confirm: "OtherPassword9" }));
  assert.match(mismatch.fieldErrors.confirmPassword, /do not match/);
  const weak = await actions.changePassword({}, passwordForm({ next: "short", confirm: "short" }));
  assert.match(weak.fieldErrors.newPassword, /8 characters/);
  assert.equal(calls.length, 0);
});

test("password change sends current_password and clears all secret values from returned state", async () => {
  const { actions, calls } = await actionsFor({ updateResult: { data: { user: {} }, error: null } });
  const result = await actions.changePassword({}, passwordForm());
  assert.equal(result.status, "success");
  assert.deepEqual(calls[0], { method: "updateUser", args: [{ password: "NewPassword9", current_password: "OldPassword9" }] });
  assert.doesNotMatch(JSON.stringify(result), /OldPassword9|NewPassword9/);
});

test("secure password change requests a code and passes the nonce back to Auth", async () => {
  const { actions, calls } = await actionsFor({ updateResult: { data: { user: null }, error: { code: "reauthentication_needed" } } });
  const state = await actions.changePassword({}, passwordForm());
  assert.equal(state.status, "reauthentication");
  assert.equal(calls[1].method, "reauthenticate");
  const missingCode = await actions.changePassword(state, passwordForm());
  assert.match(missingCode.fieldErrors.nonce, /verification code/);
  assert.equal(calls.length, 2);

  const invalid = await actionsFor({ updateResult: { data: { user: null }, error: { code: "reauthentication_not_valid", message: "secret nonce" } } });
  const result = await invalid.actions.changePassword(state, passwordForm({ nonce: "123456" }));
  assert.equal(result.status, "reauthentication");
  assert.match(result.fieldErrors.nonce, /invalid or expired/);
  assert.equal(invalid.calls[0].args[0].nonce, "123456");
  assert.doesNotMatch(JSON.stringify(result), /123456|secret nonce/);
});

test("password Auth failures use safe field and status messages", async () => {
  for (const [error, expected] of [
    [{ code: "current_password_invalid", message: "OldPassword9" }, /current password is incorrect/],
    [{ code: "current_password_mismatch", message: "OldPassword9" }, /current password is incorrect/],
    [{ code: "current_password_required", message: "OldPassword9" }, /Enter your current password/],
    [{ code: "weak_password", message: "NewPassword9" }, /stronger password/],
    [{ code: "same_password", message: "NewPassword9" }, /Choose a password/],
    [{ code: "over_request_rate_limit", status: 429, message: "internal" }, /Too many attempts/],
    [{ code: "unexpected_failure", message: "private_table" }, /could not change/],
  ]) {
    const { actions } = await actionsFor({ updateResult: { data: { user: null }, error } });
    const result = await actions.changePassword({}, passwordForm());
    assert.match(JSON.stringify(result), expected);
    assert.doesNotMatch(JSON.stringify(result), /OldPassword9|NewPassword9|private_table|internal/);
  }
});

test("credential actions never log submitted passwords or verification codes", async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...parts) => logged.push(parts);
  try {
    const { actions } = await actionsFor({
      updateResult: { data: { user: null }, error: { code: "reauthentication_not_valid", message: "secret internals" } },
    });
    const result = await actions.changePassword({ status: "reauthentication" }, passwordForm({ nonce: "987654" }));
    assert.doesNotMatch(JSON.stringify(result), /OldPassword9|NewPassword9|987654|secret internals/);
    assert.equal(logged.length, 0);
  } finally {
    console.error = originalError;
  }
});

test("Profile renders authenticated current email and both credential forms", async () => {
  const credentialActions = { changeEmail: async () => ({}), changePassword: async () => ({}) };
  const component = await loadModule("src/app/(app)/profile/account-security.tsx", {
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "./credential-actions": credentialActions,
  });
  const html = renderToStaticMarkup(createElement(component.AccountSecurity, { email: "current@example.org" }));
  for (const expected of ["current@example.org", "Change email", "Current password", "New password", "Confirm new password"]) {
    assert.ok(html.includes(expected), expected);
  }
  assert.doesNotMatch(html, /Email and password changes are not available in this version/);

  const pageSource = await read("src/app/(app)/profile/page.tsx");
  assert.match(pageSource, /supabase\.auth\.getUser\(\)/);
  assert.match(pageSource, /<AccountSecurity email=\{user\.email \?\? ""\}/);
});

test("Profile reads the current address from Auth rather than a stale token claim", async () => {
  const page = await loadModule("src/app/(app)/profile/page.tsx", {
    "next/navigation": { redirect: () => { throw new Error("Unexpected redirect"); } },
    "@/components/ui": { Card: ({ children }) => createElement("div", null, children) },
    "@/lib/profiles": { profileToFormValues: () => ({ first_name: "Jo", last_name: "Doe" }) },
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "confirmed@example.org" } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "user-1" }, error: null }) }) }) }),
    }) },
    "./profile-form": { ProfileForm: () => createElement("div", null, "Personal form") },
    "./account-security": { AccountSecurity: ({ email }) => createElement("div", null, email) },
  });
  const html = renderToStaticMarkup(await page.default());
  assert.match(html, /confirmed@example\.org/);
});

test("email-change confirmation returns to Profile after successful verification", async () => {
  const route = await loadModule("src/app/auth/confirm/route.ts", {
    "next/server": { NextResponse: { redirect: (url, status) => ({
      url: String(url), status, headers: new Headers(),
    }) } },
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { verifyOtp: async () => ({ error: null }) },
    }) },
  });
  const requestUrl = new URL("https://rifle.example.org/auth/confirm?token_hash=secret&type=email_change&next=profile");
  const response = await route.GET({ nextUrl: requestUrl, url: requestUrl.toString() });
  assert.equal(response.url, "https://rifle.example.org/profile");
  assert.equal(response.status, 303);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
});

test("general Settings link is gone while functional Club settings route remains", async () => {
  const shell = await read("src/components/app-shell.tsx");
  const profile = await read("src/app/(app)/profile/profile-form.tsx");
  assert.doesNotMatch(shell, /dashboard#settings|utilityNavigationItems/);
  assert.doesNotMatch(profile, /Email and password changes are not available in this version/);
  assert.match(shell, /Club settings/);
  assert.match(await read("src/app/(app)/clubs/[slug]/settings/page.tsx"), /ClubSettingsForm/);
});
