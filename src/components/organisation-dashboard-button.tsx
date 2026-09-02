"use client";

import { useActionState } from "react";
import {
  updateOrganisationDashboard,
  type OrganisationDashboardState,
} from "@/app/(app)/organisations/actions";
import type {
  OrganisationStaffRole,
  OrganisationStaffStatus,
} from "@/lib/organisations";

export function OrganisationDashboardButton({
  organisationId,
  initiallyAdded,
  managementRole,
  managementStatus,
  statusUnavailable = false,
}: {
  organisationId: number;
  initiallyAdded: boolean;
  managementRole?: OrganisationStaffRole;
  managementStatus?: OrganisationStaffStatus;
  statusUnavailable?: boolean;
}) {
  const [state, formAction, submitting] = useActionState(
    updateOrganisationDashboard,
    { isAdded: initiallyAdded } satisfies OrganisationDashboardState,
  );
  const isAdded = state.isAdded ?? initiallyAdded;
  const hasActiveManagement = managementStatus === "active" && managementRole;
  const managementLabel = hasActiveManagement
    ? `${managementRole === "owner" ? "Owner" : "Manager"} access active`
    : managementStatus === "pending"
      ? "Management request pending"
      : managementStatus === "rejected"
        ? "Previous management request rejected"
        : managementStatus === "revoked"
          ? "Previous management access revoked"
          : null;

  return (
    <div className="sm:text-right">
      {managementLabel ? (
        <p
          className={`mb-2 text-xs font-semibold ${
            hasActiveManagement
              ? "text-success"
              : managementStatus === "pending"
                ? "text-warning"
                : "text-muted-foreground"
          }`}
        >
          {managementLabel}
        </p>
      ) : null}
      {isAdded ? (
        <p className="mb-2 text-xs font-semibold text-success">
          Manually added to My Organisations
        </p>
      ) : null}
      {!hasActiveManagement || isAdded ? (
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
                  ? "Remove manual shortcut"
                  : "Add to my organisations"}
          </button>
        </form>
      ) : (
        <p className="max-w-sm text-xs leading-5 text-muted-foreground sm:ml-auto">
          Active management access already includes this organisation in your sidebar.
        </p>
      )}
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
