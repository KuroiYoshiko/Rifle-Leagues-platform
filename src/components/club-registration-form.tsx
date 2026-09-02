"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  registerClub,
  type ClubRegistrationState,
} from "@/app/(app)/clubs/register/actions";

const initialState: ClubRegistrationState = {};
const inputClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-2 text-sm text-danger">
      {message}
    </p>
  ) : null;
}

export function ClubRegistrationForm() {
  const [state, formAction, pending] = useActionState(registerClub, initialState);

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

      <div>
        <label htmlFor="club-name" className="text-sm font-semibold text-foreground">
          Club name <span aria-hidden="true">*</span>
        </label>
        <input
          id="club-name"
          name="name"
          autoComplete="organization"
          required
          minLength={2}
          maxLength={160}
          defaultValue={state.values?.name}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={state.fieldErrors?.name ? "club-name-error" : undefined}
          disabled={pending}
          className={inputClassName}
        />
        <FieldError id="club-name-error" message={state.fieldErrors?.name} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="club-town" className="text-sm font-semibold text-foreground">
            Town
          </label>
          <input
            id="club-town"
            name="town"
            autoComplete="address-level2"
            maxLength={100}
            defaultValue={state.values?.town}
            aria-invalid={Boolean(state.fieldErrors?.town)}
            aria-describedby={state.fieldErrors?.town ? "club-town-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="club-town-error" message={state.fieldErrors?.town} />
        </div>
        <div>
          <label htmlFor="club-county" className="text-sm font-semibold text-foreground">
            County
          </label>
          <input
            id="club-county"
            name="county"
            autoComplete="address-level1"
            maxLength={100}
            defaultValue={state.values?.county}
            aria-invalid={Boolean(state.fieldErrors?.county)}
            aria-describedby={state.fieldErrors?.county ? "club-county-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="club-county-error" message={state.fieldErrors?.county} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="club-postcode" className="text-sm font-semibold text-foreground">
            Postcode
          </label>
          <input
            id="club-postcode"
            name="postcode"
            autoComplete="postal-code"
            maxLength={20}
            defaultValue={state.values?.postcode}
            aria-invalid={Boolean(state.fieldErrors?.postcode)}
            aria-describedby={state.fieldErrors?.postcode ? "club-postcode-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="club-postcode-error" message={state.fieldErrors?.postcode} />
        </div>
        <div>
          <label htmlFor="club-website" className="text-sm font-semibold text-foreground">
            Website
          </label>
          <input
            id="club-website"
            name="website"
            type="url"
            inputMode="url"
            maxLength={2048}
            placeholder="https://example.org"
            defaultValue={state.values?.website}
            aria-invalid={Boolean(state.fieldErrors?.website)}
            aria-describedby={state.fieldErrors?.website ? "club-website-error" : "club-website-hint"}
            disabled={pending}
            className={inputClassName}
          />
          {state.fieldErrors?.website ? (
            <FieldError id="club-website-error" message={state.fieldErrors.website} />
          ) : (
            <p id="club-website-hint" className="mt-2 text-xs leading-5 text-muted-foreground">
              Include http:// or https://.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <Link
          href="/clubs"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-neutral-strong transition hover:bg-surface-muted"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Registering…" : "Register club"}
        </button>
      </div>
    </form>
  );
}
