"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  startClubCompetitionEntry,
  type CompetitionEntryActionState,
} from "@/app/(app)/competition-entry-actions";
import { Badge, Card } from "@/components/ui";
import type { CompetitionClubEntryContext } from "@/lib/competition-entries";

const initialState: CompetitionEntryActionState = {};

function entryHref(basePath: string, entryId: number) {
  return `${basePath}/entry?entry=${entryId}`;
}

function statusLabel(status: "draft" | "submitted" | "withdrawn") {
  return status[0].toUpperCase() + status.slice(1);
}

function WindowMessage({ state }: { state: "upcoming" | "open" | "closed" }) {
  if (state === "upcoming") {
    return <p className="text-sm text-muted-foreground">Entries are not open yet.</p>;
  }
  if (state === "closed") {
    return <p className="text-sm text-muted-foreground">Entry is closed and saved entries are read-only.</p>;
  }
  return <p className="text-sm text-muted-foreground">Entries are open for active club owners and officials.</p>;
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
    <section className="mt-10" aria-labelledby="competition-entry-heading">
      <div className="mb-5">
        <h2 id="competition-entry-heading" className="text-lg font-semibold tracking-[-0.025em] text-foreground">
          Competition entry
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Club participation is managed by active club owners and officials.
        </p>
      </div>

      {manageable.length > 0 && selected ? (
        <Card className="p-6 sm:p-8">
          <form action={formAction}>
            <input type="hidden" name="competition_id" value={competitionId} />
            <input type="hidden" name="club_id" value={selected.club_id} />
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="min-w-0">
                {manageable.length > 1 ? (
                  <div className="max-w-xl">
                    <label htmlFor="competition-entry-club" className="text-sm font-medium text-foreground">
                      Club
                    </label>
                    <select
                      id="competition-entry-club"
                      value={selected.club_id}
                      onChange={(event) => setSelectedClubId(Number(event.target.value))}
                      disabled={pending}
                      className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                    >
                      {manageable.map((context) => (
                        <option key={context.club_id} value={context.club_id}>
                          {context.club_name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Club</p>
                    <p className="mt-2 font-semibold text-foreground">{selected.club_name}</p>
                  </>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {selected.entry_status ? (
                    <Badge
                      tone={selected.entry_status === "submitted" ? "positive" : selected.entry_status === "draft" ? "warning" : "neutral"}
                    >
                      {statusLabel(selected.entry_status)}
                    </Badge>
                  ) : null}
                  {selected.is_user_entered && selected.entry_status === "submitted" ? (
                    <Badge tone="brand">You are entered</Badge>
                  ) : null}
                  <WindowMessage state={selected.entry_window_state} />
                </div>
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
                className={`mt-4 text-sm ${state.status === "error" ? "text-danger" : "text-success"}`}
                role={state.status === "error" ? "alert" : "status"}
              >
                {state.message}
              </p>
            ) : null}
          </form>
        </Card>
      ) : null}

      {memberOnly.map((context) => (
        <Card key={context.club_id} className={`${manageable.length > 0 ? "mt-4" : ""} p-6 sm:p-8`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="positive">Submitted</Badge>
                {context.is_user_entered ? <Badge tone="brand">You are entered</Badge> : null}
              </div>
              <p className="mt-3 font-semibold text-foreground">{context.club_name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {context.participant_count} shooter{context.participant_count === 1 ? "" : "s"} entered by your club.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">Club officials manage the roster.</p>
          </div>
        </Card>
      ))}
    </section>
  );
}
