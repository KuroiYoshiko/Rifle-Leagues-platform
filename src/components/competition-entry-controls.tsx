"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  startClubCompetitionEntry,
  type CompetitionEntryActionState,
} from "@/app/(app)/competition-entry-actions";
import { Card } from "@/components/ui";
import type { CompetitionClubEntryContext } from "@/lib/competition-entries";

const initialState: CompetitionEntryActionState = {};

function entryHref(basePath: string, entryId: number) {
  return `${basePath}/entry?entry=${entryId}`;
}

function statusLabel(status: "draft" | "submitted" | "withdrawn") {
  return status[0].toUpperCase() + status.slice(1);
}

function windowMessage(state: "upcoming" | "open" | "closed") {
  if (state === "upcoming") return "Entries are not open yet";
  if (state === "closed") return "Entry closed · Saved entries are read-only";
  return "Entry open";
}

export function CompetitionEntryControls({
  contexts,
  competitionId,
  basePath,
}: {
  contexts: CompetitionClubEntryContext[];
  competitionId: number;
  basePath: string;
}) {
  const manageable = useMemo(
    () => contexts.filter((context) => context.can_manage),
    [contexts],
  );
  const memberOnly = contexts.filter((context) => !context.can_manage);
  const [selectedClubId, setSelectedClubId] = useState(
    manageable[0]?.club_id ?? 0,
  );
  const selected =
    manageable.find((context) => context.club_id === selectedClubId) ??
    manageable[0];
  const [state, formAction, pending] = useActionState(
    startClubCompetitionEntry,
    initialState,
  );

  if (manageable.length === 0 && memberOnly.length === 0) return null;

  return (
    <section className="mt-8" aria-labelledby="competition-entry-heading">
      <div className="mb-3">
        <h2 id="competition-entry-heading" className="text-lg font-semibold tracking-[-0.025em] text-foreground">
          Competition entry
        </h2>
      </div>

      {manageable.length > 0 && selected ? (
        <Card className="p-4 sm:p-5">
          <form action={formAction}>
            <input type="hidden" name="competition_id" value={competitionId} />
            <input type="hidden" name="club_id" value={selected.club_id} />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                {manageable.length > 1 ? (
                  <div className="max-w-xl">
                    <label htmlFor="competition-entry-club" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Club
                    </label>
                    <select
                      id="competition-entry-club"
                      value={selected.club_id}
                      onChange={(event) => setSelectedClubId(Number(event.target.value))}
                      disabled={pending}
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                    >
                      {manageable.map((context) => (
                        <option key={context.club_id} value={context.club_id}>
                          {context.club_name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="font-semibold text-foreground">{selected.club_name}</p>
                )}

                <p className="mt-1.5 text-sm text-muted-foreground">
                  {selected.entry_status ? (
                    <span className="font-semibold text-foreground">
                      {statusLabel(selected.entry_status)}
                    </span>
                  ) : (
                    <span className="font-semibold text-foreground">Not entered</span>
                  )}
                  {selected.is_user_entered && selected.entry_status === "submitted"
                    ? " · You are entered"
                    : ""}
                  {` · ${windowMessage(selected.entry_window_state)}`}
                  {selected.entry_status ? (
                    <>
                      {` · ${selected.participant_count} shooter${selected.participant_count === 1 ? "" : "s"}`}
                    </>
                  ) : null}
                </p>
              </div>

              <div className="flex flex-wrap gap-3 sm:justify-end">
                {selected.entry_id ? (
                  <Link
                    href={entryHref(basePath, selected.entry_id)}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
                  >
                    {selected.entry_window_state === "open" && selected.entry_status !== "withdrawn"
                      ? "Manage club entry"
                      : "View club entry"}
                  </Link>
                ) : null}
                {selected.entry_window_state === "open" &&
                (!selected.entry_id || selected.entry_status === "withdrawn") ? (
                  <button
                    type="submit"
                    disabled={pending}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
                  >
                    {pending
                      ? "Starting…"
                      : selected.entry_status === "withdrawn"
                        ? "Start again"
                        : "Start entry"}
                  </button>
                ) : null}
              </div>
            </div>

            {state.message ? (
              <p
                className={`mt-3 text-sm ${state.status === "error" ? "text-danger" : "text-success"}`}
                role={state.status === "error" ? "alert" : "status"}
              >
                {state.message}
              </p>
            ) : null}
          </form>
        </Card>
      ) : null}

      {memberOnly.map((context) => (
        <Card key={context.club_id} className={`${manageable.length > 0 ? "mt-3" : ""} p-4 sm:p-5`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{context.club_name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Submitted</span>
                {context.is_user_entered ? " · You are entered" : ""}
                {` · ${context.participant_count} shooter${context.participant_count === 1 ? "" : "s"}`}
              </p>
            </div>
            <p className="shrink-0 text-sm text-muted-foreground">
              Club officials manage the roster
            </p>
          </div>
        </Card>
      ))}
    </section>
  );
}
