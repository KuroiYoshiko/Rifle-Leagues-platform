"use client";

import { useActionState } from "react";
import type { MembershipStatus } from "@/lib/clubs";
import {
  requestClubMembership,
  type MembershipRequestState,
} from "./actions";

const initialState: MembershipRequestState = {};

export function MembershipRequestButton({
  clubId,
  currentStatus,
  statusUnavailable = false,
}: {
  clubId: number;
  currentStatus?: MembershipStatus;
  statusUnavailable?: boolean;
}) {
  const [state, formAction, submitting] = useActionState(
    requestClubMembership,
    initialState,
  );
  const membershipStatus = state.membershipStatus ?? currentStatus;
  const disabled = submitting || statusUnavailable || Boolean(membershipStatus);

  const label = statusUnavailable
    ? "Status unavailable"
    : submitting
    ? "Sending request…"
    : membershipStatus === "active"
      ? "Membership active"
      : membershipStatus === "pending"
        ? "Request pending"
        : membershipStatus === "rejected"
          ? "Request not approved"
          : "Request to join";

  return (
    <div className="sm:text-right">
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
                  ? "cursor-not-allowed bg-surface-muted text-muted-foreground"
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
