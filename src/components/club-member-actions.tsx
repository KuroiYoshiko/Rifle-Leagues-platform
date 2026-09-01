"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  changeClubMemberRole,
  processMembershipRequest,
  transferClubOwnership,
  type ClubManagementActionState,
} from "@/app/(app)/clubs/management-actions";

const initialState: ClubManagementActionState = {};

function ActionMessage({ state }: { state: ClubManagementActionState }) {
  if (!state.message) return null;

  return (
    <p
      className={`mt-2 text-xs leading-5 ${
        state.status === "error" ? "text-danger" : "text-success"
      }`}
      role={state.status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {state.message}
    </p>
  );
}

export function MembershipDecisionControls({
  membershipId,
  memberName,
  clubSlug,
}: {
  membershipId: number;
  memberName: string;
  clubSlug: string;
}) {
  const rejectDialogRef = useRef<HTMLDialogElement>(null);
  const [approveState, approveAction, approving] = useActionState(
    processMembershipRequest,
    initialState,
  );
  const [rejectState, rejectAction, rejecting] = useActionState(
    processMembershipRequest,
    initialState,
  );
  const submitting = approving || rejecting;

  useEffect(() => {
    if (rejectState.status === "success") rejectDialogRef.current?.close();
  }, [rejectState.status]);

  return (
    <div className="sm:text-right">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <form action={approveAction}>
          <input type="hidden" name="membership_id" value={membershipId} />
          <input type="hidden" name="club_slug" value={clubSlug} />
          <input type="hidden" name="decision" value="active" />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
          >
            {approving ? "Approving…" : "Approve"}
          </button>
        </form>
        <button
          type="button"
          disabled={submitting}
          onClick={() => rejectDialogRef.current?.showModal()}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-danger/25 bg-surface px-4 text-xs font-semibold text-danger transition hover:bg-danger-subtle disabled:cursor-wait disabled:opacity-60"
        >
          Reject
        </button>
      </div>
      <ActionMessage state={approveState} />

      <dialog
        ref={rejectDialogRef}
        aria-labelledby={`reject-title-${membershipId}`}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={rejectAction} className="p-6 sm:p-7">
          <input type="hidden" name="membership_id" value={membershipId} />
          <input type="hidden" name="club_slug" value={clubSlug} />
          <input type="hidden" name="decision" value="rejected" />
          <h2 id={`reject-title-${membershipId}`} className="text-lg font-semibold">
            Reject {memberName}&apos;s request?
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            They will lose this pending request, but may request membership again.
          </p>
          <ActionMessage state={rejectState} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={rejecting}
              onClick={() => rejectDialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={rejecting}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white transition disabled:cursor-wait disabled:opacity-60"
            >
              {rejecting ? "Rejecting…" : "Reject request"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export function OfficialAccessControl({
  membershipId,
  memberName,
  clubSlug,
  currentRole,
}: {
  membershipId: number;
  memberName: string;
  clubSlug: string;
  currentRole: "member" | "official";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, submitting] = useActionState(
    changeClubMemberRole,
    initialState,
  );
  const isDemotion = currentRole === "official";
  const targetRole = isDemotion ? "member" : "official";

  useEffect(() => {
    if (state.status === "success") dialogRef.current?.close();
  }, [state.status]);

  const fields = (
    <>
      <input type="hidden" name="membership_id" value={membershipId} />
      <input type="hidden" name="club_slug" value={clubSlug} />
      <input type="hidden" name="role" value={targetRole} />
    </>
  );

  if (!isDemotion) {
    return (
      <div className="sm:text-right">
        <form action={formAction}>
          {fields}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-brand/30 bg-brand-subtle px-4 text-xs font-semibold text-brand-deep transition hover:border-brand/50 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? "Granting access…" : "Make official"}
          </button>
        </form>
        <ActionMessage state={state} />
      </div>
    );
  }

  return (
    <div className="sm:text-right">
      <button
        type="button"
        disabled={submitting}
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-neutral-strong transition hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60"
      >
        Remove official access
      </button>
      <ActionMessage state={state} />
      <dialog
        ref={dialogRef}
        aria-labelledby={`demote-title-${membershipId}`}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={formAction} className="p-6 sm:p-7">
          {fields}
          <h2 id={`demote-title-${membershipId}`} className="text-lg font-semibold">
            Remove official access from {memberName}?
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            They will remain an active club member without club-management access.
          </p>
          <ActionMessage state={state} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={() => dialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? "Removing access…" : "Remove official access"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export function TransferOwnershipControl({
  clubId,
  clubSlug,
  memberName,
  targetMembershipId,
}: {
  clubId: number;
  clubSlug: string;
  memberName: string;
  targetMembershipId: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, submitting] = useActionState(
    transferClubOwnership,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") dialogRef.current?.close();
  }, [state.status]);

  return (
    <div className="sm:text-right">
      <button
        type="button"
        disabled={submitting}
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex min-h-9 items-center justify-center text-xs font-semibold text-brand-strong hover:text-brand-deep hover:underline disabled:opacity-60"
      >
        Transfer ownership
      </button>
      <ActionMessage state={state} />
      <dialog
        ref={dialogRef}
        aria-labelledby={`transfer-title-${targetMembershipId}`}
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={formAction} className="p-6 sm:p-7">
          <input type="hidden" name="club_id" value={clubId} />
          <input type="hidden" name="club_slug" value={clubSlug} />
          <input
            type="hidden"
            name="target_membership_id"
            value={targetMembershipId}
          />
          <h2 id={`transfer-title-${targetMembershipId}`} className="text-lg font-semibold">
            Transfer ownership to {memberName}?
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            You will become a club official and {memberName} will become the club
            owner.
          </p>
          <ActionMessage state={state} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={() => dialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? "Transferring…" : "Transfer ownership"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
