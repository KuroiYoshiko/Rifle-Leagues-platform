"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState, useTransition } from "react";
import {
  updateOrganisationContactDetails,
  type OrganisationContactActionResult,
} from "@/app/(app)/organisations/[slug]/actions";
import { Card } from "@/components/ui";
import {
  normaliseOrganisationContactValues,
  validateOrganisationContact,
  type OrganisationContactField,
  type OrganisationContactFieldErrors,
  type OrganisationContactValues,
} from "@/lib/organisation-contact";

function FieldError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}) {
  return message ? (
    <p id={id} className="mt-1.5 text-xs leading-5 text-danger" role="alert">
      {message}
    </p>
  ) : null;
}

export function OrganisationContactDetails({
  organisationId,
  organisationName,
  initialValues,
  isOwner,
}: {
  organisationId: number;
  organisationName: string;
  initialValues: OrganisationContactValues;
  isOwner: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initialValues);
  const [fieldErrors, setFieldErrors] =
    useState<OrganisationContactFieldErrors>({});
  const [dialogMessage, setDialogMessage] =
    useState<OrganisationContactActionResult | null>(null);
  const [pageMessage, setPageMessage] =
    useState<OrganisationContactActionResult | null>(null);
  const [saving, startSaving] = useTransition();
  const hasAddress = Boolean(initialValues.address || initialValues.postcode);
  const hasContactDetails = Boolean(
    hasAddress ||
      initialValues.telephone ||
      initialValues.contactEmail ||
      initialValues.website,
  );

  function openEditor() {
    setDraft(initialValues);
    setFieldErrors({});
    setDialogMessage(null);
    dialogRef.current?.showModal();
  }

  function updateField(field: OrganisationContactField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setDialogMessage(null);
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = normaliseOrganisationContactValues(draft);
    const nextFieldErrors = validateOrganisationContact(values);

    setDraft(values);
    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      setDialogMessage({
        status: "error",
        message: "Review the highlighted contact details and try again.",
      });
      return;
    }

    setDialogMessage(null);
    startSaving(async () => {
      const result = await updateOrganisationContactDetails({
        organisationId,
        ...values,
      });

      if (result.status === "error") {
        setFieldErrors(result.fieldErrors ?? {});
        setDialogMessage(result);
        return;
      }

      dialogRef.current?.close();
      setPageMessage(result);
      router.refresh();
    });
  }

  return (
    <>
      <Card className="min-w-0 p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
              Contact details
            </p>
            <h2 className="mt-3 break-words text-xl font-semibold tracking-[-0.025em] text-foreground">
              {organisationName}
            </h2>
          </div>
          {isOwner ? (
            <button
              type="button"
              onClick={openEditor}
              className="inline-flex min-h-11 shrink-0 items-center justify-center self-start rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
            >
              Edit contact details
            </button>
          ) : null}
        </div>

        {pageMessage ? (
          <p className="mt-5 text-sm text-success" role="status">
            {pageMessage.message}
          </p>
        ) : null}

        {hasContactDetails ? (
          <dl className="mt-7 space-y-6">
            {hasAddress ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Address</dt>
                <dd className="mt-1.5 whitespace-pre-line break-words text-sm font-semibold leading-6 text-foreground">
                  {initialValues.address}
                  {initialValues.address && initialValues.postcode ? "\n" : ""}
                  {initialValues.postcode}
                </dd>
              </div>
            ) : null}
            {initialValues.telephone ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Telephone</dt>
                <dd className="mt-1.5 min-w-0 break-words text-sm font-semibold text-foreground">
                  <a
                    href={`tel:${initialValues.telephone}`}
                    className="text-brand-strong hover:text-brand-deep hover:underline"
                  >
                    {initialValues.telephone}
                  </a>
                </dd>
              </div>
            ) : null}
            {initialValues.contactEmail ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Email</dt>
                <dd className="mt-1.5 min-w-0 break-all text-sm font-semibold text-foreground">
                  <a
                    href={`mailto:${initialValues.contactEmail}`}
                    className="text-brand-strong hover:text-brand-deep hover:underline"
                  >
                    {initialValues.contactEmail}
                  </a>
                </dd>
              </div>
            ) : null}
            {initialValues.website ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Website</dt>
                <dd className="mt-1.5 min-w-0 text-sm font-semibold text-foreground">
                  <a
                    href={initialValues.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full flex-wrap text-brand-strong hover:text-brand-deep hover:underline"
                  >
                    Visit organisation website
                    <span className="ml-1" aria-hidden="true">↗</span>
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-7 max-w-2xl text-sm leading-6 text-muted-foreground">
            No contact details have been published yet.
          </p>
        )}

      </Card>

      <dialog
        ref={dialogRef}
        aria-labelledby="contact-editor-title"
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
        className="m-auto max-h-[92vh] w-[min(94vw,42rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form onSubmit={submitEditor} className="p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
            Organisation contact
          </p>
          <h2
            id="contact-editor-title"
            className="mt-2 text-xl font-semibold tracking-[-0.025em]"
          >
            Edit contact details
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Only fields with a value are shown on the public Contact page.
          </p>

          <div className="mt-6">
            <label htmlFor="contact-address" className="text-sm font-semibold text-foreground">
              Address
            </label>
            <textarea
              id="contact-address"
              value={draft.address}
              onChange={(event) => updateField("address", event.target.value)}
              maxLength={1000}
              rows={4}
              autoComplete="street-address"
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.address)}
              aria-describedby={fieldErrors.address ? "contact-address-error" : undefined}
              className="mt-2 w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand disabled:opacity-60"
            />
            <FieldError id="contact-address-error" message={fieldErrors.address} />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="contact-postcode" className="text-sm font-semibold text-foreground">
                Postcode
              </label>
              <input
                id="contact-postcode"
                value={draft.postcode}
                onChange={(event) => updateField("postcode", event.target.value)}
                maxLength={20}
                autoComplete="postal-code"
                disabled={saving}
                aria-invalid={Boolean(fieldErrors.postcode)}
                aria-describedby={fieldErrors.postcode ? "contact-postcode-error" : undefined}
                className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand disabled:opacity-60"
              />
              <FieldError id="contact-postcode-error" message={fieldErrors.postcode} />
            </div>
            <div>
              <label htmlFor="contact-telephone" className="text-sm font-semibold text-foreground">
                Telephone
              </label>
              <input
                id="contact-telephone"
                type="tel"
                value={draft.telephone}
                onChange={(event) => updateField("telephone", event.target.value)}
                maxLength={50}
                autoComplete="tel"
                disabled={saving}
                aria-invalid={Boolean(fieldErrors.telephone)}
                aria-describedby={fieldErrors.telephone ? "contact-telephone-error" : undefined}
                className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand disabled:opacity-60"
              />
              <FieldError id="contact-telephone-error" message={fieldErrors.telephone} />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="contact-email" className="text-sm font-semibold text-foreground">
              Email address
            </label>
            <input
              id="contact-email"
              type="email"
              value={draft.contactEmail}
              onChange={(event) => updateField("contactEmail", event.target.value)}
              maxLength={320}
              autoComplete="email"
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.contactEmail)}
              aria-describedby={fieldErrors.contactEmail ? "contact-email-error" : undefined}
              className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand disabled:opacity-60"
            />
            <FieldError id="contact-email-error" message={fieldErrors.contactEmail} />
          </div>

          <div className="mt-4">
            <label htmlFor="contact-website" className="text-sm font-semibold text-foreground">
              Website
            </label>
            <input
              id="contact-website"
              type="url"
              value={draft.website}
              onChange={(event) => updateField("website", event.target.value)}
              maxLength={2048}
              placeholder="https://example.org"
              autoComplete="url"
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.website)}
              aria-describedby={fieldErrors.website ? "contact-website-error" : "contact-website-help"}
              className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-brand disabled:opacity-60"
            />
            {fieldErrors.website ? (
              <FieldError id="contact-website-error" message={fieldErrors.website} />
            ) : (
              <p id="contact-website-help" className="mt-1.5 text-xs leading-5 text-muted-foreground">
                Use a complete address beginning with http:// or https://.
              </p>
            )}
          </div>

          <div className="mt-4 min-h-6">
            {dialogMessage ? (
              <p
                className={dialogMessage.status === "error" ? "text-sm text-danger" : "text-sm text-success"}
                role={dialogMessage.status === "error" ? "alert" : "status"}
              >
                {dialogMessage.message}
              </p>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => dialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
