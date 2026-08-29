"use client";

import { useActionState } from "react";
import {
  requestClubMembership,
  type MembershipRequestState,
} from "@/app/(app)/clubs/actions";
import type { MembershipStatus } from "@/lib/clubs";

const initialState: MembershipRequestState = {};

export function MembershipRequestButton({
  clubId,
  currentStatus,
  statusUnavailable = false,
  showDeclinedLabel = true,
}: {
  clubId: number;
  currentStatus?: MembershipStatus;
  statusUnavailable?: boolean;
  showDeclinedLabel?: boolean;
}) {
  const [state, formAction, submitting] = useActionState(
    requestClubMembership,
    initialState,
  );
  const membershipStatus = state.membershipStatus ?? currentStatus;
  const requestCannotChange =
    membershipStatus === "pending" || membershipStatus === "active";
  const disabled = submitting || statusUnavailable || requestCannotChange;

  const label = statusUnavailable
    ? "Status unavailable"
    : submitting
      ? membershipStatus === "rejected"
        ? "Sending again…"
        : "Sending request…"
      : membershipStatus === "active"
        ? "Membership active"
        : membershipStatus === "pending"
          ? "Request pending"
          : membershipStatus === "rejected"
            ? "Request again"
            : "Request to join";

  return (
    <div className="sm:text-right">
      {membershipStatus === "rejected" && showDeclinedLabel ? (
        <p className="mb-2 text-xs font-semibold text-danger">
          Membership request declined
        </p>
      ) : null}
      <form action={formAction}>
        <input type="hidden" name="club_id" value={clubId} />
        <button
          type="submit"
          disabled={disabled}
          className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition sm:w-auto ${
            statusUnavailable
              ? "cursor-not-allowed bg-surface-muted text-muted-foreground"
              : membershipStatus === "active"
                ? "cursor-default bg-success-subtle text-success"
                : membershipStatus === "pending"
                  ? "cursor-default bg-warning-subtle text-warning"
                  : membershipStatus === "rejected"
                    ? "border border-danger/25 bg-surface text-danger hover:bg-danger-subtle disabled:cursor-wait disabled:opacity-70"
                    : "bg-primary text-primary-foreground hover:bg-brand-deep disabled:cursor-wait disabled:opacity-70"
          }`}
        >
          {label}
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
