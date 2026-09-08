"use client";

import { useActionState } from "react";
import {
  deleteEmptyCompetitionSeries,
  renameCompetitionSeries,
  setCompetitionSeriesArchived,
  type CompetitionSeriesActionState,
} from "@/app/(app)/organisations/[slug]/competition-series-actions";
import type { CompetitionSeriesManagementRow } from "@/lib/competition-series-types";
import { Badge, Card } from "@/components/ui";

const initialState: CompetitionSeriesActionState = {};

function SeriesFields({ organisationId, organisationSlug, seriesId }: {
  organisationId: number;
  organisationSlug: string;
  seriesId: number;
}) {
  return <>
    <input type="hidden" name="organisation_id" value={organisationId} />
    <input type="hidden" name="organisation_slug" value={organisationSlug} />
    <input type="hidden" name="competition_series_id" value={seriesId} />
  </>;
}

function StatusMessage({ state }: { state: CompetitionSeriesActionState }) {
  return state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`mt-2 text-xs ${state.status === "error" ? "text-danger" : "text-success"}`}>{state.message}</p> : null;
}

function CompetitionSeriesRow({ organisation, series }: {
  organisation: { id: number; slug: string };
  series: CompetitionSeriesManagementRow;
}) {
  const [renameState, renameAction, renaming] = useActionState(renameCompetitionSeries, initialState);
  const [archiveState, archiveAction, archiving] = useActionState(setCompetitionSeriesArchived, initialState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteEmptyCompetitionSeries, initialState);
  const common = <SeriesFields organisationId={organisation.id} organisationSlug={organisation.slug} seriesId={series.id} />;

  return <Card className="p-5 sm:p-6">
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={series.archived_at ? "neutral" : "positive"}>{series.archived_at ? "Archived" : "Active"}</Badge><span className="text-xs text-muted-foreground">{series.edition_count} edition{series.edition_count === 1 ? "" : "s"}</span></div>
        <form action={renameAction} className="mt-3 flex max-w-2xl flex-col gap-2 sm:flex-row">
          {common}
          <label className="min-w-0 flex-1"><span className="sr-only">Series name</span><input name="series_name" required minLength={2} maxLength={160} defaultValue={series.name} disabled={renaming} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:opacity-60" /></label>
          <button type="submit" disabled={renaming} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:opacity-60">{renaming ? "Saving…" : "Rename"}</button>
        </form>
        <StatusMessage state={renameState} />
      </div>

      <div className="flex flex-wrap gap-2 lg:justify-end">
        <form action={archiveAction}>
          {common}<input type="hidden" name="archived" value={String(!series.archived_at)} />
          <button type="submit" disabled={archiving} className="min-h-10 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground transition hover:bg-surface-muted disabled:opacity-60">{archiving ? "Saving…" : series.archived_at ? "Restore" : "Archive"}</button>
        </form>
        {series.edition_count === 0 ? <form action={deleteAction} onSubmit={(event) => { if (!window.confirm(`Delete empty Series “${series.name}”?`)) event.preventDefault(); }}>
          {common}<button type="submit" disabled={deleting} className="min-h-10 rounded-xl border border-danger/30 bg-danger-subtle px-4 text-sm font-semibold text-danger transition hover:border-danger/50 disabled:opacity-60">{deleting ? "Deleting…" : "Delete empty"}</button>
        </form> : null}
      </div>
    </div>
    <StatusMessage state={archiveState.status ? archiveState : deleteState} />
  </Card>;
}

export function CompetitionSeriesManager({ organisation, series }: {
  organisation: { id: number; slug: string };
  series: CompetitionSeriesManagementRow[];
}) {
  if (!series.length) {
    return <Card className="bg-surface-muted p-6"><p className="text-sm text-muted-foreground">No Competition Series have been created yet.</p></Card>;
  }
  return <div className="space-y-3">{series.map((item) => <CompetitionSeriesRow key={item.id} organisation={organisation} series={item} />)}</div>;
}
