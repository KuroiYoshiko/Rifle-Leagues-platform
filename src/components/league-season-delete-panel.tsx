"use client";

import { useActionState, useState } from "react";
import {
  deleteLeagueSeason,
  type LeagueSeasonDeleteState,
} from "@/app/(app)/organisations/[slug]/leagues/actions";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Card } from "@/components/ui";

const initialState: LeagueSeasonDeleteState = {};

export function LeagueSeasonDeletePanel({
  organisationId,
  seasonId,
  seasonName,
  eligible,
  unavailableReason,
}: {
  organisationId: number;
  seasonId: number;
  seasonName: string;
  eligible: boolean;
  unavailableReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    deleteLeagueSeason,
    initialState,
  );

  return (
    <Card className="mt-10 border-danger/25 p-5 sm:p-6">
      <h2 className="font-semibold text-foreground">Delete season</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Only an unused draft Season can be deleted.
      </p>
      {unavailableReason ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {unavailableReason}
        </p>
      ) : null}
      {state.status === "error" && state.message ? (
        <p className="mt-3 text-sm leading-6 text-danger" role="alert">
          {state.message}
        </p>
      ) : null}
      {eligible ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-danger/35 bg-surface px-5 text-sm font-semibold text-danger transition hover:bg-danger-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          Delete season
        </button>
      ) : null}

      <ConfirmationDialog
        open={open}
        title="Delete season?"
        description={
          <>
            <strong className="font-semibold text-foreground">{seasonName}</strong>{" "}
            will be permanently removed. This is only allowed while it remains
            an unused draft with no Competitions.
          </>
        }
        onCancel={() => setOpen(false)}
        cancelDisabled={pending}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-foreground transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <form action={formAction}>
          <input type="hidden" name="organisation_id" value={organisationId} />
          <input type="hidden" name="league_season_id" value={seasonId} />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white transition hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Delete season"}
          </button>
        </form>
      </ConfirmationDialog>
    </Card>
  );
}
