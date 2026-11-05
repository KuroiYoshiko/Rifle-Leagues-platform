"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type RecoveryRequestState } from "./actions";

export function RecoveryForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, {} as RecoveryRequestState);
  return <form action={action} noValidate className="space-y-5">
    {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${state.status === "error" ? "border-danger/20 bg-danger-subtle text-danger" : "border-success/20 bg-success-subtle text-success"}`}>{state.message}</p> : null}
    <div>
      <label htmlFor="recovery-email" className="text-sm font-semibold text-foreground">Email address</label>
      <input id="recovery-email" name="email" type="email" autoComplete="email" required disabled={pending} aria-invalid={Boolean(state.fieldError)} aria-describedby={state.fieldError ? "recovery-email-error" : undefined} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
      {state.fieldError ? <p id="recovery-email-error" className="mt-2 text-sm text-danger">{state.fieldError}</p> : null}
    </div>
    <button type="submit" disabled={pending} className="min-h-12 w-full rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-65">{pending ? "Sending…" : "Send reset instructions"}</button>
    <p className="text-center text-sm"><Link href="/login" className="font-semibold text-brand-strong">Back to sign in</Link></p>
  </form>;
}
