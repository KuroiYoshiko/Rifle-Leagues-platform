"use client";

import { useActionState } from "react";
import {
  PROFILE_TITLES,
  type ProfileFormValues,
} from "@/lib/profiles";
import { updateProfile, type ProfileFormState } from "./actions";

const inputClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/65 focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-65";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-2 text-sm text-danger">
      {message}
    </p>
  ) : null;
}

function TextField({
  field,
  label,
  autoComplete,
  values,
  state,
  required = false,
  maxLength,
  type = "text",
}: {
  field: Exclude<keyof ProfileFormValues, "title" | "address">;
  label: string;
  autoComplete: string;
  values: ProfileFormValues;
  state: ProfileFormState;
  required?: boolean;
  maxLength: number;
  type?: "text" | "tel";
}) {
  const error = state.fieldErrors?.[field];
  const errorId = `${field}-error`;

  return (
    <div>
      <label htmlFor={field} className="text-sm font-semibold text-foreground">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      <input
        id={field}
        name={field}
        type={type}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        defaultValue={values[field]}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={inputClassName}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function ProfileForm({
  initialValues,
  email,
}: {
  initialValues: ProfileFormValues;
  email: string;
}) {
  const initialState: ProfileFormState = { values: initialValues };
  const [state, formAction, pending] = useActionState(
    updateProfile,
    initialState,
  );
  const values = state.values ?? initialValues;

  return (
    <form action={formAction} noValidate>
      <fieldset disabled={pending} className="space-y-8">
        <section aria-labelledby="personal-details-heading">
          <div className="border-b border-border pb-4">
            <h2
              id="personal-details-heading"
              className="text-lg font-semibold tracking-[-0.025em] text-foreground"
            >
              Personal details
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Tell us how you would like to be addressed.
            </p>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2 sm:max-w-xs">
              <label htmlFor="title" className="text-sm font-semibold text-foreground">
                Title
              </label>
              <select
                id="title"
                name="title"
                autoComplete="honorific-prefix"
                defaultValue={values.title}
                aria-invalid={Boolean(state.fieldErrors?.title)}
                aria-describedby={state.fieldErrors?.title ? "title-error" : undefined}
                className={inputClassName}
              >
                <option value="">Select a title</option>
                {PROFILE_TITLES.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </select>
              <FieldError id="title-error" message={state.fieldErrors?.title} />
            </div>

            <TextField
              field="first_name"
              label="First name"
              autoComplete="given-name"
              values={values}
              state={state}
              maxLength={100}
              required
            />
            <TextField
              field="last_name"
              label="Last name"
              autoComplete="family-name"
              values={values}
              state={state}
              maxLength={100}
              required
            />
          </div>
        </section>

        <section aria-labelledby="postal-address-heading">
          <div className="border-b border-border pb-4">
            <h2
              id="postal-address-heading"
              className="text-lg font-semibold tracking-[-0.025em] text-foreground"
            >
              Postal address
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This information is private and is not shown publicly.
            </p>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="address" className="text-sm font-semibold text-foreground">
                Address
              </label>
              <textarea
                id="address"
                name="address"
                autoComplete="street-address"
                rows={3}
                maxLength={500}
                defaultValue={values.address}
                aria-invalid={Boolean(state.fieldErrors?.address)}
                aria-describedby={state.fieldErrors?.address ? "address-error" : undefined}
                className={`${inputClassName} resize-y py-3`}
              />
              <FieldError id="address-error" message={state.fieldErrors?.address} />
            </div>
            <TextField
              field="town"
              label="Town"
              autoComplete="address-level2"
              values={values}
              state={state}
              maxLength={100}
            />
            <TextField
              field="county"
              label="County"
              autoComplete="address-level1"
              values={values}
              state={state}
              maxLength={100}
            />
            <TextField
              field="postcode"
              label="Postcode"
              autoComplete="postal-code"
              values={values}
              state={state}
              maxLength={20}
            />
          </div>
        </section>

        <section aria-labelledby="contact-heading">
          <div className="border-b border-border pb-4">
            <h2
              id="contact-heading"
              className="text-lg font-semibold tracking-[-0.025em] text-foreground"
            >
              Contact
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Your contact details remain private.
            </p>
          </div>

          <div className="mt-5 max-w-xl">
            <TextField
              field="phone_number"
              label="Phone number"
              autoComplete="tel"
              values={values}
              state={state}
              maxLength={40}
              type="tel"
            />
          </div>
        </section>

        <section aria-labelledby="account-information-heading">
          <div className="border-b border-border pb-4">
            <h2
              id="account-information-heading"
              className="text-lg font-semibold tracking-[-0.025em] text-foreground"
            >
              Account information
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Your email address is managed by your RifleLeagues account.
            </p>
          </div>
          <div className="mt-5 rounded-xl bg-surface-muted px-4 py-3.5">
            <span className="block text-xs font-medium text-muted-foreground">Email address</span>
            <span className="mt-1 block break-all text-sm font-semibold text-foreground">
              {email}
            </span>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Email and password changes are not available in this version.
          </p>
        </section>
      </fieldset>

      <div className="mt-8 border-t border-border pt-6">
        {state.message ? (
          <div
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className={`mb-4 rounded-xl border px-4 py-3 text-sm leading-6 ${
              state.status === "error"
                ? "border-danger/20 bg-danger-subtle text-danger"
                : "border-success/20 bg-success-subtle text-success"
            }`}
          >
            {state.message}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-65 sm:w-auto"
        >
          {pending ? "Saving profile…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
