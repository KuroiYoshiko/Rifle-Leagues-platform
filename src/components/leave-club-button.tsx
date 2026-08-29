"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  leaveClubMembership,
  type LeaveClubState,
} from "@/app/(app)/clubs/actions";

const initialState: LeaveClubState = {};

export function LeaveClubButton({
  membershipId,
  clubName,
}: {
  membershipId: number;
  clubName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, formAction, submitting] = useActionState(
    leaveClubMembership,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") {
      dialogRef.current?.close();
    }
  }, [state.status]);

  useEffect(() => {
    if (!menuOpen) return;

    menuItemRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
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

  return (
    <>
      <div ref={menuRef} className="relative shrink-0 self-start">
        <button
          ref={menuTriggerRef}
          type="button"
          aria-label="Club membership options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="grid size-11 place-items-center rounded-lg text-white/55 transition hover:bg-white/[.07] hover:text-white focus-visible:bg-white/[.1] focus-visible:text-white"
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
            role="menu"
            aria-label="Club membership options"
            className="absolute right-0 z-20 mt-2 min-w-44 rounded-xl border border-border bg-surface p-1.5 text-foreground shadow-lg"
          >
            <button
              ref={menuItemRef}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                dialogRef.current?.showModal();
              }}
              className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-danger transition hover:bg-danger-subtle focus-visible:bg-danger-subtle"
            >
              Leave club
            </button>
          </div>
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="leave-club-title"
        aria-describedby="leave-club-description"
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={formAction} className="p-6 sm:p-7">
          <input type="hidden" name="membership_id" value={membershipId} />
          <h2 id="leave-club-title" className="text-lg font-semibold">
            Leave {clubName}?
          </h2>
          <p
            id="leave-club-description"
            className="mt-3 text-sm leading-6 text-muted-foreground"
          >
            Club-specific access will be removed. You can request to join this club
            again later.
          </p>

          {state.status === "error" && state.message ? (
            <p
              className="mt-4 rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm leading-6 text-danger"
              role="alert"
            >
              {state.message}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={() => dialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-foreground transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-danger/25 bg-danger-subtle px-5 text-sm font-semibold text-danger transition hover:border-danger/40 disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? "Leaving…" : "Leave club"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
