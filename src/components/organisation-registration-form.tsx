"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  registerOrganisation,
  type OrganisationRegistrationState,
} from "@/app/(app)/organisations/register/actions";

const initialState: OrganisationRegistrationState = {};
const inputClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-2 text-sm text-danger">
      {message}
    </p>
  ) : null;
}

export function OrganisationRegistrationForm() {
  const [state, formAction, pending] = useActionState(
    registerOrganisation,
    initialState,
  );

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
        <label htmlFor="organisation-name" className="text-sm font-semibold text-foreground">
          Organisation name <span aria-hidden="true">*</span>
        </label>
        <input
          id="organisation-name"
          name="name"
          autoComplete="organization"
          required
          minLength={2}
          maxLength={160}
          defaultValue={state.values?.name}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={state.fieldErrors?.name ? "organisation-name-error" : undefined}
          disabled={pending}
          className={inputClassName}
        />
        <FieldError id="organisation-name-error" message={state.fieldErrors?.name} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="organisation-short-name" className="text-sm font-semibold text-foreground">
            Abbreviated name
          </label>
          <input
            id="organisation-short-name"
            name="short_name"
            maxLength={100}
            defaultValue={state.values?.shortName}
            aria-invalid={Boolean(state.fieldErrors?.shortName)}
            aria-describedby={state.fieldErrors?.shortName ? "organisation-short-name-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="organisation-short-name-error" message={state.fieldErrors?.shortName} />
        </div>
        <div>
          <label htmlFor="organisation-type" className="text-sm font-semibold text-foreground">
            Type <span aria-hidden="true">*</span>
          </label>
          <select
            id="organisation-type"
            name="organisation_type"
            required
            defaultValue={state.values?.organisationType ?? "county_association"}
            aria-invalid={Boolean(state.fieldErrors?.organisationType)}
            aria-describedby={state.fieldErrors?.organisationType ? "organisation-type-error" : undefined}
            disabled={pending}
            className={inputClassName}
          >
            <option value="county_association">County Association</option>
            <option value="regional_association">Regional Association</option>
            <option value="business">Business</option>
            <option value="other">Other</option>
          </select>
          <FieldError id="organisation-type-error" message={state.fieldErrors?.organisationType} />
        </div>
      </div>

      <div>
        <label htmlFor="organisation-address" className="text-sm font-semibold text-foreground">
          Address
        </label>
        <textarea
          id="organisation-address"
          name="address"
          autoComplete="street-address"
          rows={4}
          maxLength={1000}
          defaultValue={state.values?.address}
          aria-invalid={Boolean(state.fieldErrors?.address)}
          aria-describedby={state.fieldErrors?.address ? "organisation-address-error" : undefined}
          disabled={pending}
          className={`${inputClassName} py-3`}
        />
        <FieldError id="organisation-address-error" message={state.fieldErrors?.address} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="organisation-postcode" className="text-sm font-semibold text-foreground">
            Postcode
          </label>
          <input
            id="organisation-postcode"
            name="postcode"
            autoComplete="postal-code"
            maxLength={20}
            defaultValue={state.values?.postcode}
            aria-invalid={Boolean(state.fieldErrors?.postcode)}
            aria-describedby={state.fieldErrors?.postcode ? "organisation-postcode-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="organisation-postcode-error" message={state.fieldErrors?.postcode} />
        </div>
        <div>
          <label htmlFor="organisation-telephone" className="text-sm font-semibold text-foreground">
            Telephone
          </label>
          <input
            id="organisation-telephone"
            name="telephone"
            type="tel"
            autoComplete="tel"
            maxLength={50}
            defaultValue={state.values?.telephone}
            aria-invalid={Boolean(state.fieldErrors?.telephone)}
            aria-describedby={state.fieldErrors?.telephone ? "organisation-telephone-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="organisation-telephone-error" message={state.fieldErrors?.telephone} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="organisation-email" className="text-sm font-semibold text-foreground">
            Email address
          </label>
          <input
            id="organisation-email"
            name="contact_email"
            type="email"
            autoComplete="email"
            maxLength={320}
            defaultValue={state.values?.contactEmail}
            aria-invalid={Boolean(state.fieldErrors?.contactEmail)}
            aria-describedby={state.fieldErrors?.contactEmail ? "organisation-email-error" : undefined}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError id="organisation-email-error" message={state.fieldErrors?.contactEmail} />
        </div>
        <div>
          <label htmlFor="organisation-website" className="text-sm font-semibold text-foreground">
            Website
          </label>
          <input
            id="organisation-website"
            name="website"
            type="url"
            inputMode="url"
            maxLength={2048}
            placeholder="https://example.org"
            defaultValue={state.values?.website}
            aria-invalid={Boolean(state.fieldErrors?.website)}
            aria-describedby={state.fieldErrors?.website ? "organisation-website-error" : "organisation-website-hint"}
            disabled={pending}
            className={inputClassName}
          />
          {state.fieldErrors?.website ? (
            <FieldError id="organisation-website-error" message={state.fieldErrors.website} />
          ) : (
            <p id="organisation-website-hint" className="mt-2 text-xs leading-5 text-muted-foreground">
              Include http:// or https://.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <Link
          href="/organisations/access"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-neutral-strong transition hover:bg-surface-muted"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Registering…" : "Register organisation"}
        </button>
      </div>
    </form>
  );
}
