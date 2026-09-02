"use client";

import { useActionState } from "react";
import {
  requestOrganisationManagementAccess,
  type ManagementAccessActionState,
} from "@/app/(app)/organisations/management-actions";
import type {
  OrganisationStaffRole,
  OrganisationStaffStatus,
} from "@/lib/organisations";

export function OrganisationAccessRequestButton({
  organisationId,
  initialRole,
  initialStatus,
  statusUnavailable = false,
}: {
  organisationId: number;
  initialRole?: OrganisationStaffRole;
  initialStatus?: OrganisationStaffStatus;
  statusUnavailable?: boolean;
}) {
  const initialState: ManagementAccessActionState = {
    accessStatus: initialStatus,
  };
  const [state, formAction, pending] = useActionState(
    requestOrganisationManagementAccess,
    initialState,
  );
  const accessStatus = state.accessStatus ?? initialStatus;
  const accessIsPending = accessStatus === "pending";
  const accessIsActive = accessStatus === "active";
  const disabled = pending || accessIsPending || accessIsActive || statusUnavailable;
  const buttonLabel = pending
    ? "Requesting…"
    : accessIsPending
      ? "Request pending"
      : accessIsActive
        ? initialRole === "owner"
          ? "Owner access active"
          : "Manager access active"
        : accessStatus === "rejected" || accessStatus === "revoked"
          ? "Request access again"
          : "Request management access";

  return (
    <div className="sm:text-right">
      <form action={formAction}>
        <input type="hidden" name="organisation_id" value={organisationId} />
        <button
          type="submit"
          disabled={disabled}
          className={`inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold transition disabled:cursor-not-allowed ${
            accessIsPending
              ? "border border-warning/25 bg-warning-subtle text-warning"
              : accessIsActive
                ? "border border-success/25 bg-success-subtle text-success"
                : "bg-primary text-primary-foreground hover:bg-brand-deep disabled:opacity-55"
          }`}
        >
          {buttonLabel}
        </button>
      </form>
      {state.message ? (
        <p
          className={`mt-2 max-w-sm text-xs leading-5 sm:ml-auto ${
            state.status === "error" ? "text-danger" : "text-success"
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
