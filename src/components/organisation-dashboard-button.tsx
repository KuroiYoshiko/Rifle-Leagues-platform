"use client";

import { useActionState } from "react";
import {
  updateOrganisationDashboard,
  type OrganisationDashboardState,
} from "@/app/(app)/organisations/actions";

export function OrganisationDashboardButton({
  organisationId,
  initiallyAdded,
  statusUnavailable = false,
}: {
  organisationId: number;
  initiallyAdded: boolean;
  statusUnavailable?: boolean;
}) {
  const [state, formAction, submitting] = useActionState(
    updateOrganisationDashboard,
    { isAdded: initiallyAdded } satisfies OrganisationDashboardState,
  );
  const isAdded = state.isAdded ?? initiallyAdded;

  return (
    <div className="sm:text-right">
      {isAdded ? (
        <p className="mb-2 text-xs font-semibold text-success">
          Added to your organisations
        </p>
      ) : null}
      <form action={formAction}>
        <input type="hidden" name="organisation_id" value={organisationId} />
        <input type="hidden" name="intent" value={isAdded ? "remove" : "add"} />
        <button
          type="submit"
          disabled={submitting || statusUnavailable}
          className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition sm:w-auto ${
            statusUnavailable
              ? "cursor-not-allowed bg-surface-muted text-muted-foreground"
              : isAdded
                ? "border border-border bg-surface text-neutral-strong hover:border-danger/25 hover:bg-danger-subtle hover:text-danger disabled:cursor-wait disabled:opacity-70"
                : "bg-primary text-primary-foreground hover:bg-brand-deep disabled:cursor-wait disabled:opacity-70"
          }`}
        >
          {statusUnavailable
            ? "Status unavailable"
            : submitting
              ? isAdded
                ? "Removing…"
                : "Adding…"
              : isAdded
                ? "Remove"
                : "Add to my organisations"}
        </button>
      </form>
      {state.message ? (
        <p
          className={`mt-2 max-w-sm text-xs leading-5 sm:ml-auto ${
            state.status === "error" ? "text-danger" : "text-muted-foreground"
          }`}
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
