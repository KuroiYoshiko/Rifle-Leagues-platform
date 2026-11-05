"use client";

import { useActionState } from "react";
import { resetPassword, type ResetPasswordState } from "./actions";

export function ResetForm() {
  const [state, action, pending] = useActionState(resetPassword, {} as ResetPasswordState);
  return <form action={action} noValidate className="space-y-5">
    {state.message ? <p role="alert" className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger">{state.message}</p> : null}
    <div><label htmlFor="reset-password" className="text-sm font-semibold text-foreground">New password</label>
      <input id="reset-password" name="password" type="password" autoComplete="new-password" minLength={8} required disabled={pending} aria-invalid={Boolean(state.fieldErrors?.password)} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
      {state.fieldErrors?.password ? <p role="alert" className="mt-2 text-sm text-danger">{state.fieldErrors.password}</p> : <p className="mt-2 text-xs text-muted-foreground">At least 8 characters with uppercase, lowercase, and a number.</p>}
    </div>
    <div><label htmlFor="reset-confirm" className="text-sm font-semibold text-foreground">Confirm new password</label>
      <input id="reset-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required disabled={pending} aria-invalid={Boolean(state.fieldErrors?.confirmPassword)} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
      {state.fieldErrors?.confirmPassword ? <p role="alert" className="mt-2 text-sm text-danger">{state.fieldErrors.confirmPassword}</p> : null}
    </div>
    <button type="submit" disabled={pending} className="min-h-12 w-full rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-65">{pending ? "Resetting password…" : "Set new password"}</button>
  </form>;
}
