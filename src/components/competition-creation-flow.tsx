"use client";

import { useMemo, useState } from "react";
import {
  CompetitionForm,
  type CompetitionCreationMode,
} from "@/components/competition-form";
import {
  type CompetitionSeriesCreationOption,
} from "@/lib/competition-series-types";
import type { LeagueSeason } from "@/lib/league-seasons";

const modes: Array<{
  value: CompetitionCreationMode;
  title: string;
  detail: string;
}> = [
  {
    value: "continue_series",
    title: "Continue existing Series",
    detail: "Create this Season’s edition of a Competition that has run before.",
  },
  {
    value: "new_series",
    title: "Create new Series",
    detail: "Start a recurring Competition for this and future Seasons.",
  },
  {
    value: "one_off",
    title: "Create one-off Competition",
    detail: "Create a standalone Competition with no historical Series relationship.",
  },
];

function seasonStatusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function getCompetitionStatusLabel(value: string) {
  return value === "published" ? "Published" : "Draft";
}

function getCompetitionRankingMethodLabel(value: string) {
  if (value === "best_n_average") return "Best N rounds average";
  if (value === "round_robin") return "Round robin";
  if (value === "gun_score") return "Gun score";
  return "Aggregate points";
}

export function CompetitionCreationFlow({
  organisation,
  season,
  seriesOptions,
}: {
  organisation: { id: number; name: string; slug: string };
  season: LeagueSeason;
  seriesOptions: CompetitionSeriesCreationOption[];
}) {
  const [mode, setMode] = useState<CompetitionCreationMode | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [showSourceChooser, setShowSourceChooser] = useState(false);

  const selectedSeries = useMemo(
    () => seriesOptions.find((option) => option.series.id === Number(selectedSeriesId)) ?? null,
    [selectedSeriesId, seriesOptions],
  );
  const selectedSource = selectedSeries?.sources.find(
    (source) => source.metadata.id === Number(selectedSourceId),
  ) ?? null;
  const recommendedSource = selectedSeries?.sources.find(
    (source) => source.metadata.id === selectedSeries.sourceInfo.recommended_source_id,
  ) ?? null;

  function chooseMode(nextMode: CompetitionCreationMode) {
    setMode(nextMode);
    setSelectedSeriesId("");
    setSelectedSourceId("");
    setShowSourceChooser(false);
  }

  function chooseSeries(value: string) {
    const option = seriesOptions.find((item) => item.series.id === Number(value));
    const recommended = option?.sourceInfo.recommended_source_id;
    setSelectedSeriesId(value);
    setSelectedSourceId(recommended ? String(recommended) : "");
    setShowSourceChooser(!recommended);
  }

  if (!mode) {
    return <div className="grid gap-3 lg:grid-cols-3">
      {modes.map((item) => <button key={item.value} type="button" onClick={() => chooseMode(item.value)} className="rounded-xl border border-border bg-surface p-4 text-left transition hover:border-brand hover:bg-brand-subtle focus-visible:border-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/10">
        <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">{item.title}</span>
        <span className="mt-2 block text-sm leading-6 text-muted-foreground">{item.detail}</span>
      </button>)}
    </div>;
  }

  return <div className="space-y-7">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">Creation path</p><p className="mt-1 text-sm font-semibold text-foreground">{modes.find((item) => item.value === mode)?.title}</p></div>
      <button type="button" onClick={() => setMode(null)} className="min-h-10 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle">Change</button>
    </div>

    {mode === "new_series" ? <CompetitionForm organisation={organisation} season={season} creationMode="new_series" /> : null}
    {mode === "one_off" ? <CompetitionForm organisation={organisation} season={season} creationMode="one_off" /> : null}

    {mode === "continue_series" ? <div className="space-y-6">
      {seriesOptions.length ? <div className="max-w-xl"><label htmlFor="series-choice" className="text-sm font-semibold text-foreground">Active Series</label><select id="series-choice" value={selectedSeriesId} onChange={(event) => chooseSeries(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"><option value="">Choose a Series</option>{seriesOptions.map((option) => <option key={option.series.id} value={option.series.id}>{option.series.name}</option>)}</select></div> : <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">There are no active Competition Series to continue. Create a new Series instead.</p>}

      {selectedSeries ? <div className="space-y-4 rounded-xl border border-border bg-surface-muted p-4 sm:p-5">
        <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">Selected Series</p><h3 className="mt-1 text-base font-semibold text-foreground">{selectedSeries.series.name}</h3></div>

        {recommendedSource ? <div className="border-t border-border pt-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recommended previous edition</p><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5"><div><dt className="text-muted-foreground">Competition</dt><dd className="font-semibold text-foreground">{recommendedSource.metadata.name}</dd></div><div><dt className="text-muted-foreground">Season</dt><dd className="font-semibold text-foreground">{recommendedSource.metadata.season_name} · {seasonStatusLabel(recommendedSource.metadata.season_status)}</dd></div><div><dt className="text-muted-foreground">Status</dt><dd className="font-semibold text-foreground">{getCompetitionStatusLabel(recommendedSource.metadata.status)}</dd></div><div><dt className="text-muted-foreground">Ranking</dt><dd className="font-semibold text-foreground">{getCompetitionRankingMethodLabel(recommendedSource.metadata.ranking_method)}</dd></div><div><dt className="text-muted-foreground">Rounds</dt><dd className="font-semibold text-foreground">{recommendedSource.metadata.number_of_rounds}</dd></div></dl></div> : <p className="border-t border-border pt-4 text-sm leading-6 text-muted-foreground">{selectedSeries.sourceInfo.ambiguous_latest_date ? "More than one edition is equally recent. Choose the source explicitly." : "There is no unambiguous recommended previous edition. Choose the source explicitly."}</p>}

        {selectedSeries.sources.length > 1 || !recommendedSource ? <div className="border-t border-border pt-4">{recommendedSource && !showSourceChooser ? <button type="button" onClick={() => setShowSourceChooser(true)} className="text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline">Use another edition</button> : <div className="max-w-xl"><label htmlFor="source-choice" className="text-sm font-semibold text-foreground">Configuration source</label><select id="source-choice" value={selectedSourceId} onChange={(event) => setSelectedSourceId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"><option value="">Choose an edition</option>{selectedSeries.sources.map((source) => <option key={source.metadata.id} value={source.metadata.id}>{source.metadata.season_name} · {source.metadata.name} · {getCompetitionStatusLabel(source.metadata.status)} · {getCompetitionRankingMethodLabel(source.metadata.ranking_method)} · {source.metadata.number_of_rounds} rounds</option>)}</select>{recommendedSource ? <button type="button" onClick={() => { setSelectedSourceId(String(recommendedSource.metadata.id)); setShowSourceChooser(false); }} className="mt-2 text-xs font-semibold text-brand-strong hover:underline">Use recommendation</button> : null}</div>}</div> : null}
        {selectedSource && selectedSource.metadata.id !== recommendedSource?.metadata.id ? <div className="border-t border-border pt-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Selected source</p><p className="mt-2 text-sm font-semibold text-foreground">{selectedSource.metadata.season_name} · {selectedSource.metadata.name}</p><p className="mt-1 text-xs text-muted-foreground">{getCompetitionStatusLabel(selectedSource.metadata.status)} · {getCompetitionRankingMethodLabel(selectedSource.metadata.ranking_method)} · {selectedSource.metadata.number_of_rounds} rounds</p></div> : null}
      </div> : null}

      {selectedSource && selectedSeries ? <CompetitionForm
        key={`${selectedSeries.series.id}:${selectedSource.metadata.id}`}
        organisation={organisation}
        season={season}
        creationMode="continue_series"
        series={selectedSeries.series}
        sourceContext={{ metadata: selectedSource.metadata, expectedVersion: selectedSource.metadata.configuration_version }}
        initialCompetition={{
          ...selectedSource.competition,
          custom_entry_opens_at: null,
          custom_entry_closes_at: null,
          custom_starts_at: null,
        }}
        scoreComponents={selectedSeries.components}
      /> : null}

      {selectedSeries && !selectedSource && selectedSeries.sources.length === 0 ? <p className="rounded-xl border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">This Series has no eligible configuration source edition.</p> : null}
    </div> : null}
  </div>;
}
