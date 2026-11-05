"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  changeEmail,
  changePassword,
  type EmailChangeState,
  type PasswordChangeState,
} from "./credential-actions";

const inputClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/65 focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-65";
const buttonClassName =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-65 sm:w-auto";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="mt-2 text-sm text-danger">{message}</p> : null;
}

function ResultMessage({ state }: { state: EmailChangeState | PasswordChangeState }) {
  if (!state.message) return null;
  const error = state.status === "error";
  return (
    <p
      role={error ? "alert" : "status"}
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 text-sm leading-6 ${error
        ? "border-danger/20 bg-danger-subtle text-danger"
        : "border-success/20 bg-success-subtle text-success"}`}
    >
      {state.message}
    </p>
  );
}

export function AccountSecurity({ email }: { email: string }) {
  const router = useRouter();
  const emailFormRef = useRef<HTMLFormElement>(null);
  const passwordFormRef = useRef<HTMLFormElement>(null);
  const [emailState, emailAction, emailPending] = useActionState(changeEmail, {} as EmailChangeState);
  const [passwordState, passwordAction, passwordPending] = useActionState(changePassword, {} as PasswordChangeState);

  useEffect(() => {
    if (emailState.status === "success") {
      emailFormRef.current?.reset();
      router.refresh();
    } else if (emailState.status === "pending") {
      emailFormRef.current?.reset();
    }
  }, [emailState, router]);

  useEffect(() => {
    if (passwordState.status === "success") passwordFormRef.current?.reset();
  }, [passwordState]);

  return (
    <div className="mt-10 space-y-10 border-t border-border pt-8">
      <section aria-labelledby="account-information-heading">
        <div className="border-b border-border pb-4">
          <h2 id="account-information-heading" className="text-lg font-semibold tracking-[-0.025em] text-foreground">
            Account information
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Use your email address to sign in.
          </p>
        </div>
        <div className="mt-5 max-w-xl rounded-xl bg-surface-muted px-4 py-3.5">
          <span className="block text-xs font-medium text-muted-foreground">Email address</span>
          <span className="mt-1 block break-all text-sm font-semibold text-foreground">{email}</span>
        </div>
        <form ref={emailFormRef} action={emailAction} noValidate className="mt-6 max-w-xl space-y-4">
          <fieldset disabled={emailPending} className="space-y-4">
            <legend className="text-sm font-semibold text-foreground">Change email</legend>
            <div>
              <label htmlFor="newEmail" className="text-sm font-semibold text-foreground">New email address</label>
              <input
                id="newEmail"
                name="newEmail"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                aria-invalid={Boolean(emailState.fieldError)}
                aria-describedby={emailState.fieldError ? "new-email-error" : undefined}
                className={inputClassName}
              />
              <FieldError id="new-email-error" message={emailState.fieldError} />
            </div>
            <ResultMessage state={emailState} />
            <button type="submit" disabled={emailPending} className={buttonClassName}>
              {emailPending ? "Requesting email change…" : "Change email"}
            </button>
          </fieldset>
        </form>
      </section>

      <section aria-labelledby="password-heading">
        <div className="border-b border-border pb-4">
          <h2 id="password-heading" className="text-lg font-semibold tracking-[-0.025em] text-foreground">
            Password
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Choose a new password to keep your account secure.
          </p>
        </div>
        <form ref={passwordFormRef} action={passwordAction} noValidate className="mt-5 max-w-xl space-y-5">
          <fieldset disabled={passwordPending} className="space-y-5">
            <div>
              <label htmlFor="currentPassword" className="text-sm font-semibold text-foreground">Current password</label>
              <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required
                aria-invalid={Boolean(passwordState.fieldErrors?.currentPassword)}
                aria-describedby={passwordState.fieldErrors?.currentPassword ? "current-password-error" : undefined}
                className={inputClassName} />
              <FieldError id="current-password-error" message={passwordState.fieldErrors?.currentPassword} />
            </div>
            <div>
              <label htmlFor="newPassword" className="text-sm font-semibold text-foreground">New password</label>
              <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required
                aria-invalid={Boolean(passwordState.fieldErrors?.newPassword)}
                aria-describedby={passwordState.fieldErrors?.newPassword ? "new-password-error" : "new-password-hint"}
                className={inputClassName} />
              {passwordState.fieldErrors?.newPassword
                ? <FieldError id="new-password-error" message={passwordState.fieldErrors.newPassword} />
                : <p id="new-password-hint" className="mt-2 text-xs leading-5 text-muted-foreground">At least 8 characters with uppercase, lowercase, and a number.</p>}
            </div>
            <div>
              <label htmlFor="confirmPassword" className="text-sm font-semibold text-foreground">Confirm new password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required
                aria-invalid={Boolean(passwordState.fieldErrors?.confirmPassword)}
                aria-describedby={passwordState.fieldErrors?.confirmPassword ? "confirm-new-password-error" : undefined}
                className={inputClassName} />
              <FieldError id="confirm-new-password-error" message={passwordState.fieldErrors?.confirmPassword} />
            </div>
            {passwordState.status === "reauthentication" ? (
              <div>
                <label htmlFor="nonce" className="text-sm font-semibold text-foreground">Verification code</label>
                <input id="nonce" name="nonce" type="text" inputMode="numeric" autoComplete="one-time-code" required
                  aria-invalid={Boolean(passwordState.fieldErrors?.nonce)}
                  aria-describedby={passwordState.fieldErrors?.nonce ? "nonce-error" : undefined}
                  className={inputClassName} />
                <FieldError id="nonce-error" message={passwordState.fieldErrors?.nonce} />
              </div>
            ) : null}
            <ResultMessage state={passwordState} />
            <button type="submit" disabled={passwordPending} className={buttonClassName}>
              {passwordPending ? "Changing password…" : "Change password"}
            </button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
