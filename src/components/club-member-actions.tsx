"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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

export function OwnerMemberActions({
  membershipId,
  memberName,
  currentRole,
  club,
}: {
  membershipId: number;
  memberName: string;
  currentRole: "member" | "official";
  club: { id: number; name: string; slug: string };
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const roleMenuItemRef = useRef<HTMLButtonElement>(null);
  const roleDialogRef = useRef<HTMLDialogElement>(null);
  const transferDialogRef = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [roleState, roleAction, changingRole] = useActionState(
    changeClubMemberRole,
    initialState,
  );
  const [transferState, transferAction, transferring] = useActionState(
    transferClubOwnership,
    initialState,
  );
  const isDemotion = currentRole === "official";
  const targetRole = isDemotion ? "member" : "official";
  const roleActionLabel = isDemotion
    ? "Remove official access"
    : "Make official";
  const menuId = `member-actions-${membershipId}`;

  useEffect(() => {
    if (roleState.status === "success") roleDialogRef.current?.close();
  }, [roleState.status]);

  useEffect(() => {
    if (transferState.status === "success") transferDialogRef.current?.close();
  }, [transferState.status]);

  useEffect(() => {
    if (!menuOpen) return;

    roleMenuItemRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  }

  const roleFields = (
    <>
      <input type="hidden" name="membership_id" value={membershipId} />
      <input type="hidden" name="club_slug" value={club.slug} />
      <input type="hidden" name="role" value={targetRole} />
    </>
  );

  return (
    <div
      ref={menuRef}
      className="relative shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setMenuOpen(false);
        }
      }}
    >
      <button
        ref={menuTriggerRef}
        type="button"
        aria-label={`Manage ${memberName}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        disabled={changingRole || transferring}
        onClick={() => setMenuOpen((open) => !open)}
        className="grid size-10 place-items-center rounded-lg text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:bg-surface-muted focus-visible:text-foreground disabled:cursor-wait disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          aria-hidden="true"
          fill="currentColor"
        >
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>

      {menuOpen ? (
        <div
          id={menuId}
          role="menu"
          aria-label={`Manage ${memberName}`}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-border bg-surface p-1.5 text-foreground shadow-lg"
        >
          <button
            ref={roleMenuItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              roleDialogRef.current?.showModal();
            }}
            className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold transition focus-visible:outline-none ${
              isDemotion
                ? "text-warning hover:bg-warning-subtle focus-visible:bg-warning-subtle"
                : "text-brand-deep hover:bg-brand-subtle focus-visible:bg-brand-subtle"
            }`}
          >
            {roleActionLabel}
          </button>
          <div role="none" className="my-1.5 border-t border-border pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                transferDialogRef.current?.showModal();
              }}
              className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-danger transition hover:bg-danger-subtle focus-visible:bg-danger-subtle focus-visible:outline-none"
            >
              Transfer ownership
            </button>
          </div>
        </div>
      ) : null}

      <dialog
        ref={roleDialogRef}
        aria-labelledby={`role-title-${membershipId}`}
        aria-describedby={`role-description-${membershipId}`}
        onClose={() => menuTriggerRef.current?.focus()}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={roleAction} className="p-6 sm:p-7">
          {roleFields}
          <h2 id={`role-title-${membershipId}`} className="text-lg font-semibold">
            {isDemotion
              ? `Remove official access from ${memberName}?`
              : `Make ${memberName} an official?`}
          </h2>
          <p
            id={`role-description-${membershipId}`}
            className="mt-3 text-sm leading-6 text-muted-foreground"
          >
            {isDemotion
              ? `${memberName} will remain an active club member but will lose club-management access.`
              : `${memberName} will be able to manage membership requests and edit club details.`}
          </p>
          <ActionMessage state={roleState} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={changingRole}
              onClick={() => roleDialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={changingRole}
              className={`inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                isDemotion
                  ? "border border-warning/30 bg-warning-subtle text-warning hover:border-warning/50"
                  : "bg-primary text-primary-foreground hover:bg-brand-deep"
              }`}
            >
              {changingRole
                ? isDemotion
                  ? "Removing access…"
                  : "Making official…"
                : isDemotion
                  ? "Remove access"
                  : "Make official"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={transferDialogRef}
        aria-labelledby={`transfer-title-${membershipId}`}
        aria-describedby={`transfer-description-${membershipId}`}
        onClose={() => menuTriggerRef.current?.focus()}
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={transferAction} className="p-6 sm:p-7">
          <input type="hidden" name="club_id" value={club.id} />
          <input type="hidden" name="club_slug" value={club.slug} />
          <input
            type="hidden"
            name="target_membership_id"
            value={membershipId}
          />
          <h2 id={`transfer-title-${membershipId}`} className="text-lg font-semibold">
            Transfer club ownership?
          </h2>
          <div
            id={`transfer-description-${membershipId}`}
            className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground"
          >
            <p>
              {memberName} will become the owner of {club.name}.
            </p>
            <p>
              You will lose owner access and become a club official. {memberName}{" "}
              will be able to manage club officials and transfer ownership again.
            </p>
            <p className="font-semibold text-danger">
              This changes who controls the club.
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
