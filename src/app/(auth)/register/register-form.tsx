"use client";

import Link from "next/link";
import { useActionState } from "react";
import { register, type RegisterState } from "./actions";

const initialState: RegisterState = {};
const inputClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/65 focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-65";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-2 text-sm text-danger">
      {message}
    </p>
  ) : null;
}

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(register, initialState);

  if (state.status === "check-email") {
    return (
      <div className="py-2 text-center" role="status">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand-subtle text-2xl text-brand-deep">
          ✓
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-foreground">
          Check your email
        </h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          We sent a confirmation link to{" "}
          <strong className="font-semibold text-foreground">{state.email}</strong>.
          Open it to activate your account, then you can continue to your dashboard.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          If it is not in your inbox, check your spam folder.
        </p>
        <Link
          href="/login"
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
        >
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm leading-6 text-danger"
        >
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className="text-sm font-semibold text-foreground">
            First name
          </label>
          <input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={100}
            defaultValue={state.values?.firstName}
            aria-invalid={Boolean(state.fieldErrors?.firstName)}
            aria-describedby={state.fieldErrors?.firstName ? "first-name-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="first-name-error" message={state.fieldErrors?.firstName} />
        </div>
        <div>
          <label htmlFor="lastName" className="text-sm font-semibold text-foreground">
            Last name
          </label>
          <input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            maxLength={100}
            defaultValue={state.values?.lastName}
            aria-invalid={Boolean(state.fieldErrors?.lastName)}
            aria-describedby={state.fieldErrors?.lastName ? "last-name-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="last-name-error" message={state.fieldErrors?.lastName} />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="text-sm font-semibold text-foreground">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email}
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "register-email-error" : undefined}
          disabled={pending}
          className={inputClassName}
        />
        <FieldError id="register-email-error" message={state.fieldErrors?.email} />
      </div>

      <div>
        <label htmlFor="password" className="text-sm font-semibold text-foreground">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={state.fieldErrors?.password ? "register-password-error" : "password-hint"}
          disabled={pending}
          className={inputClassName}
        />
        {state.fieldErrors?.password ? (
          <FieldError id="register-password-error" message={state.fieldErrors.password} />
        ) : (
          <p id="password-hint" className="mt-2 text-xs leading-5 text-muted-foreground">
            At least 8 characters with uppercase, lowercase, and a number.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="text-sm font-semibold text-foreground">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
          aria-describedby={state.fieldErrors?.confirmPassword ? "confirm-password-error" : undefined}
          disabled={pending}
          className={inputClassName}
        />
        <FieldError id="confirm-password-error" message={state.fieldErrors?.confirmPassword} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-65"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand-strong hover:text-brand-deep">
          Sign in
        </Link>
      </p>
    </form>
  );
}
