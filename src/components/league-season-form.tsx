"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createLeagueSeason,
  updateLeagueSeason,
  type LeagueSeasonFormState,
} from "@/app/(app)/organisations/[slug]/leagues/actions";
import {
  type LeagueSeason,
  type LeagueSeasonStatus,
} from "@/lib/league-seasons";

const initialState: LeagueSeasonFormState = {};
const inputClassName =
  "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted";

const statusLabels: Record<LeagueSeasonStatus, string> = {
  draft: "Draft",
  open: "Open",
  active: "Active",
  completed: "Completed",
};

const nextStatuses: Partial<Record<LeagueSeasonStatus, LeagueSeasonStatus>> = {
  draft: "open",
  open: "active",
  active: "completed",
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-2 text-sm leading-5 text-danger" role="alert">
      {message}
    </p>
  ) : null;
}

export function LeagueSeasonForm({
  organisation,
  season,
}: {
  organisation: { id: number; name: string; slug: string };
  season?: LeagueSeason;
}) {
  const editing = Boolean(season);
  const [state, formAction, pending] = useActionState(
    editing ? updateLeagueSeason : createLeagueSeason,
    initialState,
  );
  const detailPath = season
    ? `/organisations/${organisation.slug}/leagues/${season.slug}`
    : `/organisations/${organisation.slug}/leagues`;
  const nextStatus = season
    ? nextStatuses[season.status] ?? null
    : null;
  const statusOptions = season
    ? [season.status, ...(nextStatus ? [nextStatus] : [])]
    : (["draft"] as LeagueSeasonStatus[]);
  const values = state.values;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input
        type="hidden"
        name="organisation_id"
        value={organisation.id}
      />
      {season ? (
        <input type="hidden" name="league_season_id" value={season.id} />
      ) : null}

      {state.message ? (
        <div
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm leading-6 ${
            state.status === "success"
              ? "border-success/20 bg-success-subtle text-success"
              : "border-danger/20 bg-danger-subtle text-danger"
          }`}
        >
          {state.message}
        </div>
      ) : null}

      <div>
        <label
          htmlFor="league-season-name"
          className="text-sm font-semibold text-foreground"
        >
          Season name <span aria-hidden="true">*</span>
        </label>
        <input
          id="league-season-name"
          name="name"
          required
          minLength={2}
          maxLength={160}
          autoComplete="off"
          defaultValue={values?.name ?? season?.name ?? ""}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={
            state.fieldErrors?.name ? "league-season-name-error" : undefined
          }
          disabled={pending}
          placeholder="Summer 2026"
          className={inputClassName}
        />
        <FieldError
          id="league-season-name-error"
          message={state.fieldErrors?.name}
        />
        {editing ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Renaming the season does not change its web address.
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="league-season-description"
          className="text-sm font-semibold text-foreground"
        >
          Season description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="league-season-description"
          name="description"
          rows={5}
          maxLength={2000}
          defaultValue={values?.description ?? season?.description ?? ""}
          aria-invalid={Boolean(state.fieldErrors?.description)}
          aria-describedby={
            state.fieldErrors?.description
              ? "league-season-description-help league-season-description-error"
              : "league-season-description-help"
          }
          disabled={pending}
          placeholder="A short plain-text overview of this season."
          className={`${inputClassName} py-3`}
        />
        <p
          id="league-season-description-help"
          className="mt-2 text-xs leading-5 text-muted-foreground"
        >
          Plain text, up to 2,000 characters.
        </p>
        <FieldError
          id="league-season-description-error"
          message={state.fieldErrors?.description}
        />
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-foreground">
          Default entry window
        </legend>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Optional default dates for competitions in this season.
        </p>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="league-entry-opens"
              className="text-sm font-medium text-foreground"
            >
              Entries open
            </label>
            <input
              id="league-entry-opens"
              name="entry_opens_at"
              type="date"
              defaultValue={
                values?.entryOpensAt ?? season?.entry_opens_at ?? ""
              }
              aria-invalid={Boolean(state.fieldErrors?.entryOpensAt)}
              aria-describedby={
                state.fieldErrors?.entryOpensAt
                  ? "league-entry-opens-error"
                  : undefined
              }
              disabled={pending}
              className={inputClassName}
            />
            <FieldError
              id="league-entry-opens-error"
              message={state.fieldErrors?.entryOpensAt}
            />
          </div>
          <div>
            <label
              htmlFor="league-entry-closes"
              className="text-sm font-medium text-foreground"
            >
              Entries close
            </label>
            <input
              id="league-entry-closes"
              name="entry_closes_at"
              type="date"
              defaultValue={
                values?.entryClosesAt ?? season?.entry_closes_at ?? ""
              }
              aria-invalid={Boolean(state.fieldErrors?.entryClosesAt)}
              aria-describedby={
                state.fieldErrors?.entryClosesAt
                  ? "league-entry-closes-error"
                  : undefined
              }
              disabled={pending}
              className={inputClassName}
            />
            <FieldError
              id="league-entry-closes-error"
              message={state.fieldErrors?.entryClosesAt}
            />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-foreground">
          Season dates
        </legend>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Optional dates for the planned start and end of the season.
        </p>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="league-starts"
              className="text-sm font-medium text-foreground"
            >
              Season starts
            </label>
            <input
              id="league-starts"
              name="starts_at"
              type="date"
              defaultValue={values?.startsAt ?? season?.starts_at ?? ""}
              aria-invalid={Boolean(state.fieldErrors?.startsAt)}
              aria-describedby={
                state.fieldErrors?.startsAt
                  ? "league-starts-error"
                  : undefined
              }
              disabled={pending}
              className={inputClassName}
            />
            <FieldError
              id="league-starts-error"
              message={state.fieldErrors?.startsAt}
            />
          </div>
          <div>
            <label
              htmlFor="league-ends"
              className="text-sm font-medium text-foreground"
            >
              Season ends
            </label>
            <input
              id="league-ends"
              name="ends_at"
              type="date"
              defaultValue={values?.endsAt ?? season?.ends_at ?? ""}
              aria-invalid={Boolean(state.fieldErrors?.endsAt)}
              aria-describedby={
                state.fieldErrors?.endsAt ? "league-ends-error" : undefined
              }
              disabled={pending}
              className={inputClassName}
            />
            <FieldError
              id="league-ends-error"
              message={state.fieldErrors?.endsAt}
            />
          </div>
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="league-status"
          className="text-sm font-semibold text-foreground"
        >
          Status
        </label>
        {editing ? (
          <select
            id="league-status"
            name="status"
            defaultValue={values?.status ?? season?.status}
            aria-invalid={Boolean(state.fieldErrors?.status)}
            aria-describedby={
              state.fieldErrors?.status
                ? "league-status-help league-status-error"
                : "league-status-help"
            }
            disabled={pending}
            className={inputClassName}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="hidden" name="status" value="draft" />
            <input
              id="league-status"
              value="Draft"
              readOnly
              aria-describedby="league-status-help"
              className={`${inputClassName} bg-surface-muted`}
            />
          </>
        )}
        <p id="league-status-help" className="mt-2 text-xs leading-5 text-muted-foreground">
          {editing
            ? nextStatus
              ? `You can keep this season ${statusLabels[season!.status].toLowerCase()} or move it forward to ${statusLabels[nextStatus].toLowerCase()}.`
              : "Completed is the final status and cannot be moved backward."
            : "New seasons are private drafts. Publish the season from its edit page when it is ready."}
        </p>
        <FieldError
          id="league-status-error"
          message={state.fieldErrors?.status}
        />
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <Link
          href={detailPath}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-neutral-strong transition hover:bg-surface-muted"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
        >
          {pending
            ? editing
              ? "Saving…"
              : "Creating…"
            : editing
              ? "Save changes"
              : "Create season"}
        </button>
      </div>
    </form>
  );
}
