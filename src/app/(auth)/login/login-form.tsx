"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};
const inputClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/65 focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-65";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const message = state.message ?? initialError;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {message ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm leading-6 text-danger"
        >
          {message}
        </div>
      ) : null}

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
          defaultValue={state.email}
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
          disabled={pending}
          className={inputClassName}
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="mt-2 text-sm text-danger">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="password" className="text-sm font-semibold text-foreground">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
          disabled={pending}
          className={inputClassName}
        />
        {state.fieldErrors?.password ? (
          <p id="password-error" className="mt-2 text-sm text-danger">
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-65"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        New to RifleLeagues?{" "}
        <Link href="/register" className="font-semibold text-brand-strong hover:text-brand-deep">
          Create an account
        </Link>
      </p>
    </form>
  );
}
