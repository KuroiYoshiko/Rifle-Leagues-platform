"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  processOrganisationManagementRequest,
  removeOrganisationManagerAccess,
  transferOrganisationOwnership,
  type OrganisationStaffActionState,
} from "@/app/(app)/organisations/management-actions";

const initialState: OrganisationStaffActionState = {};

function ActionMessage({ state }: { state: OrganisationStaffActionState }) {
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

export function OrganisationRequestDecisionControls({
  staffId,
  staffName,
  organisationSlug,
}: {
  staffId: number;
  staffName: string;
  organisationSlug: string;
}) {
  const rejectDialogRef = useRef<HTMLDialogElement>(null);
  const [approveState, approveAction, approving] = useActionState(
    processOrganisationManagementRequest,
    initialState,
  );
  const [rejectState, rejectAction, rejecting] = useActionState(
    processOrganisationManagementRequest,
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
          <input type="hidden" name="staff_id" value={staffId} />
          <input
            type="hidden"
            name="organisation_slug"
            value={organisationSlug}
          />
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
        aria-labelledby={`reject-organisation-request-${staffId}`}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={rejectAction} className="p-6 sm:p-7">
          <input type="hidden" name="staff_id" value={staffId} />
          <input
            type="hidden"
            name="organisation_slug"
            value={organisationSlug}
          />
          <input type="hidden" name="decision" value="rejected" />
          <h2
            id={`reject-organisation-request-${staffId}`}
            className="text-lg font-semibold"
          >
            Reject {staffName}&apos;s request?
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Their request will be rejected. They may submit a new request later.
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
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
            >
              {rejecting ? "Rejecting…" : "Reject request"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export function OrganisationManagerActions({
  staffId,
  staffName,
  organisation,
}: {
  staffId: number;
  staffName: string;
  organisation: { id: number; name: string; slug: string };
}) {
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const transferDialogRef = useRef<HTMLDialogElement>(null);
  const [removeState, removeAction, removing] = useActionState(
    removeOrganisationManagerAccess,
    initialState,
  );
  const [transferState, transferAction, transferring] = useActionState(
    transferOrganisationOwnership,
    initialState,
  );

  useEffect(() => {
    if (removeState.status === "success") removeDialogRef.current?.close();
  }, [removeState.status]);

  useEffect(() => {
    if (transferState.status === "success") transferDialogRef.current?.close();
  }, [transferState.status]);

  return (
    <div className="shrink-0 sm:text-right">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <button
          type="button"
          disabled={removing || transferring}
          onClick={() => removeDialogRef.current?.showModal()}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-warning/30 bg-surface px-4 text-xs font-semibold text-warning transition hover:bg-warning-subtle disabled:opacity-60"
        >
          Remove access
        </button>
        <button
          type="button"
          disabled={removing || transferring}
          onClick={() => transferDialogRef.current?.showModal()}
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-danger/25 bg-surface px-4 text-xs font-semibold text-danger transition hover:bg-danger-subtle disabled:opacity-60"
        >
          Transfer ownership
        </button>
      </div>

      <dialog
        ref={removeDialogRef}
        aria-labelledby={`remove-manager-${staffId}`}
        aria-describedby={`remove-manager-description-${staffId}`}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={removeAction} className="p-6 sm:p-7">
          <input type="hidden" name="staff_id" value={staffId} />
          <input
            type="hidden"
            name="organisation_slug"
            value={organisation.slug}
          />
          <h2 id={`remove-manager-${staffId}`} className="text-lg font-semibold">
            Remove management access from {staffName}?
          </h2>
          <p
            id={`remove-manager-description-${staffId}`}
            className="mt-3 text-sm leading-6 text-muted-foreground"
          >
            {staffName} will no longer be able to administer this organisation.
          </p>
          <ActionMessage state={removeState} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={removing}
              onClick={() => removeDialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={removing}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
            >
              {removing ? "Removing…" : "Remove access"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={transferDialogRef}
        aria-labelledby={`transfer-organisation-${staffId}`}
        aria-describedby={`transfer-organisation-description-${staffId}`}
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={transferAction} className="p-6 sm:p-7">
          <input
            type="hidden"
            name="organisation_id"
            value={organisation.id}
          />
          <input
            type="hidden"
            name="organisation_slug"
            value={organisation.slug}
          />
          <input type="hidden" name="target_staff_id" value={staffId} />
          <h2
            id={`transfer-organisation-${staffId}`}
            className="text-lg font-semibold"
          >
            Transfer organisation ownership?
          </h2>
          <div
            id={`transfer-organisation-description-${staffId}`}
            className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground"
          >
            <p>
              {staffName} will become the owner of {organisation.name}.
            </p>
            <p>
              You will remain an organisation manager but will lose owner-only
              controls.
            </p>
            <p>
              {staffName} will be able to manage staff and transfer ownership again.
            </p>
            <p className="font-semibold text-danger">
              This changes who controls the organisation.
            </p>
          </div>
          <ActionMessage state={transferState} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={transferring}
              onClick={() => transferDialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={transferring}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
            >
              {transferring ? "Transferring…" : "Transfer ownership"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
