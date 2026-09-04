"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  deleteCompetitionFromDetail,
  publishCompetitionFromDetail,
  returnCompetitionToDraft,
  type CompetitionLifecycleActionState,
} from "@/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/actions";
import type { CompetitionStatus } from "@/lib/competitions";

const initialState: CompetitionLifecycleActionState = {};

function LifecycleFields({
  organisationId,
  leagueSeasonId,
  competitionId,
}: {
  organisationId: number;
  leagueSeasonId: number;
  competitionId: number;
}) {
  return (
    <>
      <input type="hidden" name="organisation_id" value={organisationId} />
      <input type="hidden" name="league_season_id" value={leagueSeasonId} />
      <input type="hidden" name="competition_id" value={competitionId} />
    </>
  );
}

function DialogError({ state }: { state: CompetitionLifecycleActionState }) {
  if (state.status !== "error" || !state.message) return null;
  return (
    <p
      className="mt-4 rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm leading-6 text-danger"
      role="alert"
    >
      {state.message}
    </p>
  );
}

export function CompetitionLifecycleActions({
  organisationId,
  leagueSeasonId,
  competitionId,
  competitionName,
  status,
  canReturnToDraft,
  canDelete,
  editHref,
}: {
  organisationId: number;
  leagueSeasonId: number;
  competitionId: number;
  competitionName: string;
  status: CompetitionStatus;
  canReturnToDraft: boolean;
  canDelete: boolean;
  editHref: string;
}) {
  const id = useId();
  const menuId = `${id}-menu`;
  const returnTitleId = `${id}-return-title`;
  const returnDescriptionId = `${id}-return-description`;
  const deleteTitleId = `${id}-delete-title`;
  const deleteDescriptionId = `${id}-delete-description`;
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);
  const publishErrorRef = useRef<HTMLDivElement>(null);
  const returnDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [publishState, publishAction, publishing] = useActionState(
    publishCompetitionFromDetail,
    initialState,
  );
  const [returnState, returnAction, returning] = useActionState(
    returnCompetitionToDraft,
    initialState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteCompetitionFromDetail,
    initialState,
  );
  const canPublish = status === "draft";
  const hasLifecycleActions = canPublish || canReturnToDraft || canDelete;
  const submitting = publishing || returning || deleting;

  useEffect(() => {
    if (!menuOpen) return;
    firstMenuItemRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
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

  useEffect(() => {
    if (publishState.status === "error") {
      publishErrorRef.current?.focus();
    }
  }, [publishState]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    );
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
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

  const fields = (
    <LifecycleFields
      organisationId={organisationId}
      leagueSeasonId={leagueSeasonId}
      competitionId={competitionId}
    />
  );

  return (
    <div className="min-w-0 self-start sm:max-w-md">
      <div className="flex items-center gap-2">
        <Link
          href={editHref}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
        >
          Edit competition
        </Link>

        {hasLifecycleActions ? (
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
              aria-label={`Manage ${competitionName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              disabled={submitting}
              onClick={() => setMenuOpen((open) => !open)}
              className="grid size-11 place-items-center rounded-xl border border-border bg-surface text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:bg-surface-muted focus-visible:text-foreground disabled:cursor-wait disabled:opacity-50"
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
                aria-label={`Lifecycle actions for ${competitionName}`}
                onKeyDown={handleMenuKeyDown}
                className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 text-foreground shadow-lg"
              >
                {canPublish ? (
                  <form
                    action={publishAction}
                    role="none"
                    onSubmit={() => setMenuOpen(false)}
                  >
                    {fields}
                    <button
                      ref={firstMenuItemRef}
                      type="submit"
                      role="menuitem"
                      disabled={publishing}
                      className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle focus-visible:bg-brand-subtle focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
                    >
                      {publishing ? "Publishing…" : "Publish competition"}
                    </button>
                  </form>
                ) : null}

                {canReturnToDraft ? (
                  <button
                    ref={canPublish ? undefined : firstMenuItemRef}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      returnDialogRef.current?.showModal();
                    }}
                    className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-warning transition hover:bg-warning-subtle focus-visible:bg-warning-subtle focus-visible:outline-none"
                  >
                    Return to draft
                  </button>
                ) : null}

                {canDelete ? (
                  <div role="none" className="mt-1.5 border-t border-border pt-1.5">
                    <button
                      ref={
                        !canPublish && !canReturnToDraft
                          ? firstMenuItemRef
                          : undefined
                      }
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        deleteDialogRef.current?.showModal();
                      }}
                      className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-danger transition hover:bg-danger-subtle focus-visible:bg-danger-subtle focus-visible:outline-none"
                    >
                      Delete competition
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {publishState.status === "error" && publishState.message ? (
        <div
          ref={publishErrorRef}
          tabIndex={-1}
          className="mt-3 rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-left text-sm leading-6 text-danger outline-none"
          role="alert"
        >
          <p>{publishState.message}</p>
          <Link
            href={editHref}
            className="mt-2 inline-flex font-semibold underline underline-offset-2"
          >
            Edit competition to fix this
          </Link>
        </div>
      ) : null}

      <dialog
        ref={returnDialogRef}
        aria-labelledby={returnTitleId}
        aria-describedby={returnDescriptionId}
        onClose={() => menuTriggerRef.current?.focus()}
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-left text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={returnAction} className="p-6 sm:p-7">
          {fields}
          <h2 id={returnTitleId} className="text-lg font-semibold">
            Return competition to draft?
          </h2>
          <p
            id={returnDescriptionId}
            className="mt-3 text-sm leading-6 text-muted-foreground"
          >
            The competition will become private and will no longer accept entries
            until it is published again.
          </p>
          <DialogError state={returnState} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={returning}
              onClick={() => returnDialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={returning}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-warning/30 bg-warning-subtle px-5 text-sm font-semibold text-warning transition hover:border-warning/50 disabled:cursor-wait disabled:opacity-60"
            >
              {returning ? "Returning…" : "Return to draft"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteDialogRef}
        aria-labelledby={deleteTitleId}
        aria-describedby={deleteDescriptionId}
        onClose={() => menuTriggerRef.current?.focus()}
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-left text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form action={deleteAction} className="p-6 sm:p-7">
          {fields}
          <h2 id={deleteTitleId} className="text-lg font-semibold">
            Delete competition?
          </h2>
          <div
            id={deleteDescriptionId}
            className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground"
          >
            <p>
              <strong className="font-semibold text-foreground">
                {competitionName}
              </strong>{" "}
              will be permanently deleted.
            </p>
            <p className="font-semibold text-danger">This cannot be undone.</p>
          </div>
          <DialogError state={deleteState} />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deleting}
              onClick={() => deleteDialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleting}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete competition"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
