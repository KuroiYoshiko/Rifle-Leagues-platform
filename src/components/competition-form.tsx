"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  createCompetition,
  updateCompetition,
  type CompetitionField,
  type CompetitionFormState,
  type CompetitionScoreComponentValue,
} from "@/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/actions";
import type {
  Competition,
  CompetitionEntryFormat,
  CompetitionEntryWindowMode,
  CompetitionRankingMethod,
  CompetitionRound,
  CompetitionScoreComponent,
  CompetitionStartDateMode,
} from "@/lib/competitions";
import type { LeagueSeason } from "@/lib/league-seasons";

const initialState: CompetitionFormState = {};
const inputClassName =
  "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted";
const compactDateClassName =
  "min-h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted";
const sectionClassName = "space-y-5 border-b border-border pb-7 last:border-b-0 last:pb-0";
const defaultScoreComponent: CompetitionScoreComponentValue = {
  shortLabel: "", maximumScore: "100", scoreMethod: "points_dropped",
};
const rankingDescriptions: Record<CompetitionRankingMethod, string> = {
  aggregate: "Entrants are ranked within their division after each round and awarded ranking points based on finishing position. Overall standings use the total ranking points earned.",
  best_n_average: "Standings are based on shooting averages. Once enough rounds have been completed, only each entrant's best N rounds count towards the final average.",
  round_robin: "Entrants compete head-to-head against another entrant in their division each round. A win earns 2 points, a draw 1 and a loss 0.",
  gun_score: "Entrants are ranked directly by their recorded gun scores. No separate ranking points are awarded for finishing position.",
};
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(`${value}T00:00:00Z`)) : "Not set";
}

function addCalendarDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function FieldError({ field, message }: { field: CompetitionField; message?: string }) {
  return message ? <p id={`competition-${field}-error`} className="mt-2 text-sm leading-5 text-danger" role="alert">{message}</p> : null;
}

function SectionTitle({ id, title, description }: { id: string; title: string; description: string }) {
  return <div>
    <h3 id={id} className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">{title}</h3>
    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</p>
  </div>;
}

function InfoHelp({ label, children }: { label: string; children: string }) {
  return <details className="group relative inline-block align-middle">
    <summary
      aria-label={`Help for ${label}`}
      title={children}
      className="ml-1 inline-flex size-6 cursor-help list-none items-center justify-center rounded-full border border-border bg-surface text-xs font-bold text-brand-deep outline-none marker:content-none hover:bg-brand-subtle focus-visible:ring-4 focus-visible:ring-brand/15"
    >i</summary>
    <p className="absolute right-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-3 text-left text-xs font-normal leading-5 text-muted-foreground shadow-lg sm:left-0 sm:right-auto">{children}</p>
  </details>;
}

function initialRoundValues(
  competition: Competition | undefined,
  rounds: CompetitionRound[],
  field: "deadline" | "shoot_by_date",
) {
  if (!competition || rounds.length === 0) return [];
  const values = Array.from({ length: competition.number_of_rounds }, () => "");
  for (const round of rounds) {
    if (round.round_number >= 1 && round.round_number <= competition.number_of_rounds) {
      values[round.round_number - 1] = round[field] ?? "";
    }
  }
  return values;
}

function RadioCard({
  name, value, checked, onChange, title, detail, disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  detail: string;
  disabled: boolean;
}) {
  return <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${checked ? "border-brand bg-brand-subtle" : "border-border bg-surface hover:bg-surface-muted"}`}>
    <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="mt-1 accent-primary" />
    <span><span className="block text-sm font-semibold text-foreground">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span></span>
  </label>;
}

export function CompetitionForm({
  organisation,
  season,
  competition,
  rounds = [],
  scoreComponents = [],
}: {
  organisation: { id: number; name: string; slug: string };
  season: LeagueSeason;
  competition?: Competition;
  rounds?: CompetitionRound[];
  scoreComponents?: CompetitionScoreComponent[];
}) {
  const editing = Boolean(competition);
  const [state, formAction, pending] = useActionState(
    editing ? updateCompetition : createCompetition,
    initialState,
  );
  const submitted = state.values;
  const [entryFormat, setEntryFormat] = useState<CompetitionEntryFormat>(
    (submitted?.entryFormat as CompetitionEntryFormat | undefined) ?? competition?.entry_format ?? "individual",
  );
  const [entryWindowMode, setEntryWindowMode] = useState<CompetitionEntryWindowMode>(
    (submitted?.entryWindowMode as CompetitionEntryWindowMode | undefined) ?? competition?.entry_window_mode ?? "season_default",
  );
  const [customEntryOpensAt, setCustomEntryOpensAt] = useState(
    submitted?.customEntryOpensAt ?? competition?.custom_entry_opens_at ?? "",
  );
  const [customEntryClosesAt, setCustomEntryClosesAt] = useState(
    submitted?.customEntryClosesAt ?? competition?.custom_entry_closes_at ?? "",
  );
  const [startDateMode, setStartDateMode] = useState<CompetitionStartDateMode>(
    (submitted?.startDateMode as CompetitionStartDateMode | undefined) ?? competition?.start_date_mode ?? "season_default",
  );
  const [customStartsAt, setCustomStartsAt] = useState(
    submitted?.customStartsAt ?? competition?.custom_starts_at ?? "",
  );
  const [rankingMethod, setRankingMethod] = useState<CompetitionRankingMethod>(
    (submitted?.rankingMethod as CompetitionRankingMethod | undefined) ?? competition?.ranking_method ?? "aggregate",
  );
  const [usesXScore, setUsesXScore] = useState(
    submitted?.usesXScore ?? competition?.uses_x_score ?? false,
  );
  const [localScoringEnabled, setLocalScoringEnabled] = useState(
    submitted?.localScoringEnabled ?? competition?.local_scoring_enabled ?? true,
  );
  const [setsPerRound, setSetsPerRound] = useState(
    submitted?.setsPerRound ?? String(competition?.sets_per_round ?? 1),
  );
  const [components, setComponents] = useState<CompetitionScoreComponentValue[]>(() => {
    if (submitted?.scoreComponents) return submitted.scoreComponents;
    if (scoreComponents.length) return scoreComponents.map((component) => ({
      shortLabel: component.short_label ?? "",
      maximumScore: String(component.maximum_score),
      scoreMethod: component.score_method,
    }));
    return [{ ...defaultScoreComponent }];
  });
  const [scoresPerSet, setScoresPerSet] = useState(String(Math.max(components.length, 1)));
  const [numberOfRounds, setNumberOfRounds] = useState(
    submitted?.numberOfRounds ?? String(competition?.number_of_rounds ?? 10),
  );
  const [bestRoundsCount, setBestRoundsCount] = useState(
    submitted?.bestRoundsCount ?? String(competition?.best_rounds_count ?? ""),
  );
  const [roundDeadlines, setRoundDeadlines] = useState<string[]>(() =>
    submitted?.roundDeadlines.length
      ? submitted.roundDeadlines
      : initialRoundValues(competition, rounds, "deadline"),
  );
  const [shootByDates, setShootByDates] = useState<string[]>(() =>
    submitted?.roundShootByDates.length
      ? submitted.roundShootByDates
      : initialRoundValues(competition, rounds, "shoot_by_date"),
  );
  const [useShootByDates, setUseShootByDates] = useState(() => {
    const initial = submitted?.roundShootByDates.length
      ? submitted.roundShootByDates
      : initialRoundValues(competition, rounds, "shoot_by_date");
    return initial.some(Boolean);
  });
  const [firstDeadline, setFirstDeadline] = useState(
    roundDeadlines.find(Boolean) ?? (customStartsAt || season.starts_at
      ? addCalendarDays(customStartsAt || season.starts_at || "", 14)
      : ""),
  );
  const [repeatEvery, setRepeatEvery] = useState("2");
  const [repeatUnit, setRepeatUnit] = useState<"days" | "weeks">("weeks");
  const [generatorError, setGeneratorError] = useState<string | null>(null);

  const detailPath = competition
    ? `/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`
    : `/organisations/${organisation.slug}/leagues/${season.slug}`;
  const roundCount = Number(numberOfRounds);
  const validRoundCount = Number.isInteger(roundCount) && roundCount >= 1 && roundCount <= 100 ? roundCount : null;
  const bestCount = Number(bestRoundsCount);
  const bestRoundsError = rankingMethod === "best_n_average" && (
    !validRoundCount || !/^\d+$/.test(bestRoundsCount) || !Number.isInteger(bestCount) || bestCount < 1 || bestCount > validRoundCount
  ) ? `Must be between 1 and ${validRoundCount ?? 100}.` : null;
  const scoreCount = Number(scoresPerSet);
  const scoresPerSetError = !/^\d+$/.test(scoresPerSet) || !Number.isInteger(scoreCount) || scoreCount < 1 || scoreCount > 20
    ? "Must be between 1 and 20."
    : null;
  const derivedMaximum = useMemo(() => {
    const sets = Number(setsPerRound);
    const componentTotal = components.reduce((total, component) => {
      const maximum = Number(component.maximumScore);
      return total + (Number.isFinite(maximum) ? maximum : 0);
    }, 0);
    return Number.isFinite(sets) && sets > 0 ? sets * componentTotal : 0;
  }, [components, setsPerRound]);

  const effectiveEntryClose = entryWindowMode === "custom" ? customEntryClosesAt : season.entry_closes_at;
  const effectiveStart = startDateMode === "custom" ? customStartsAt : season.starts_at;
  const roundRobinDateError = rankingMethod === "round_robin" && effectiveEntryClose && effectiveStart && effectiveEntryClose >= effectiveStart
    ? "Round Robin requires time to finalise divisions after entries close. Competition Start must be after the Entry Close date."
    : null;
  const scheduleErrors = useMemo(() => {
    const errors: string[] = [];
    let previous: string | null = null;
    roundDeadlines.forEach((end, index) => {
      const shootBy = shootByDates[index];
      if (!end) return;
      if (previous && end < previous) errors.push(`Round ${index + 1} ends before an earlier round.`);
      if (effectiveStart && index === 0 && end <= effectiveStart) errors.push(`Round 1 End must be after Competition Start (${formatDate(effectiveStart)}).`);
      if (effectiveStart && index > 0 && end < effectiveStart) errors.push(`Round ${index + 1} ends before Competition Start (${formatDate(effectiveStart)}).`);
      if (season.ends_at && end > season.ends_at) errors.push(`Round ${index + 1} ends after the Season ends (${formatDate(season.ends_at)}).`);
      if (useShootByDates && shootBy && shootBy > end) errors.push(`Round ${index + 1} Shoot-by is after Round End.`);
      previous = end;
    });
    return errors;
  }, [effectiveStart, roundDeadlines, season.ends_at, shootByDates, useShootByDates]);

  function resizeSchedule(value: string) {
    setNumberOfRounds(value);
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 100) return;
    setRoundDeadlines((current) => Array.from({ length: count }, (_, index) => current[index] ?? ""));
    setShootByDates((current) => Array.from({ length: count }, (_, index) => current[index] ?? ""));
  }

  function generateSchedule() {
    setGeneratorError(null);
    const interval = Number(repeatEvery);
    const maximum = repeatUnit === "days" ? 365 : 52;
    if (!validRoundCount) return setGeneratorError("Set the number of rounds between 1 and 100 first.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDeadline)) return setGeneratorError("Choose the first Round End date.");
    if (!Number.isInteger(interval) || interval < 1 || interval > maximum) return setGeneratorError(`Repeat interval must be between 1 and ${maximum} ${repeatUnit}.`);
    const days = repeatUnit === "weeks" ? interval * 7 : interval;
    setRoundDeadlines(Array.from({ length: validRoundCount }, (_, index) => addCalendarDays(firstDeadline, days * index)));
    setShootByDates((current) => Array.from({ length: validRoundCount }, (_, index) => current[index] ?? ""));
  }

  function updateComponent(index: number, field: keyof CompetitionScoreComponentValue, value: string) {
    setComponents((current) => current.map((component, componentIndex) => componentIndex === index ? { ...component, [field]: value } : component));
  }

  function resizeComponents(value: string) {
    setScoresPerSet(value);
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 20) return;
    setComponents((current) => Array.from({ length: count }, (_, index) => current[index] ?? { ...defaultScoreComponent }));
  }

  function changeRankingMethod(value: CompetitionRankingMethod) {
    setRankingMethod(value);
    if (value === "best_n_average") setUsesXScore(false);
  }

  return <form action={formAction} className="space-y-7" noValidate>
    <input type="hidden" name="organisation_id" value={organisation.id} />
    <input type="hidden" name="league_season_id" value={season.id} />
    {competition ? <><input type="hidden" name="competition_id" value={competition.id} /><input type="hidden" name="current_status" value={competition.status} /></> : null}

    {state.message ? <div className={`rounded-xl px-4 py-3 text-sm ${state.status === "error" ? "bg-danger-subtle text-danger" : "bg-success-subtle text-success"}`} role={state.status === "error" ? "alert" : "status"}>
      <p className="font-semibold">{state.message}</p>
      {state.publishErrors?.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{state.publishErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
    </div> : null}

    <section className={sectionClassName} aria-labelledby="competition-details-title">
      <SectionTitle id="competition-details-title" title="Competition details" description="The name, description, format, and fee shown to clubs." />
      <div><label htmlFor="competition-name" className="text-sm font-semibold text-foreground">Competition name *</label><input id="competition-name" name="name" required minLength={2} maxLength={160} defaultValue={submitted?.name ?? competition?.name ?? ""} disabled={pending} className={inputClassName} /><FieldError field="name" message={state.fieldErrors?.name} /></div>
      <div><label htmlFor="competition-description" className="text-sm font-semibold text-foreground">Description</label><textarea id="competition-description" name="description" rows={4} maxLength={2000} defaultValue={submitted?.description ?? competition?.description ?? ""} disabled={pending} className={`${inputClassName} resize-y py-3`} /><p className="mt-2 text-xs text-muted-foreground">Optional plain text, up to 2,000 characters.</p><FieldError field="description" message={state.fieldErrors?.description} /></div>
      <fieldset><legend className="text-sm font-semibold text-foreground">Entry format</legend><div className="mt-2 grid gap-3 sm:grid-cols-3">{([
        ["individual", "Individual", "1 shooter"], ["pairs", "Pairs", "2 shooters"], ["team", "Team", "3–20 shooters"],
      ] as const).map(([value, title, detail]) => <RadioCard key={value} name="entry_format" value={value} checked={entryFormat === value} onChange={() => setEntryFormat(value)} title={title} detail={detail} disabled={pending} />)}</div><FieldError field="entryFormat" message={state.fieldErrors?.entryFormat} /></fieldset>
      {entryFormat === "team" ? <div className="max-w-xs"><label htmlFor="competition-team-size" className="text-sm font-semibold text-foreground">Team size *</label><input id="competition-team-size" name="team_size" type="number" min={3} max={20} step={1} defaultValue={submitted?.teamSize ?? competition?.team_size ?? 3} disabled={pending} className={inputClassName} /><FieldError field="teamSize" message={state.fieldErrors?.teamSize} /></div> : <input type="hidden" name="team_size" value={entryFormat === "individual" ? 1 : 2} />}
      <div className="max-w-xs"><label htmlFor="competition-entry-fee" className="text-sm font-semibold text-foreground">Entry fee (GBP)</label><input id="competition-entry-fee" name="entry_fee" type="number" min={0} max={10000} step="0.01" defaultValue={submitted?.entryFee ?? competition?.entry_fee ?? ""} disabled={pending} className={inputClassName} /><p className="mt-2 text-xs text-muted-foreground">Optional display value; no payment is collected here.</p><FieldError field="entryFee" message={state.fieldErrors?.entryFee} /></div>
    </section>

    <section className={sectionClassName} aria-labelledby="entry-window-title">
      <SectionTitle id="entry-window-title" title="Entry window" description="Choose the Season default or dates specific to this Competition." />
      <fieldset><legend className="sr-only">Entry window source</legend><div className="grid gap-3 sm:grid-cols-2">
        <RadioCard name="entry_window_mode" value="season_default" checked={entryWindowMode === "season_default"} onChange={() => setEntryWindowMode("season_default")} title="Use Season default" detail={`${formatDate(season.entry_opens_at)} – ${formatDate(season.entry_closes_at)}`} disabled={pending} />
        <RadioCard name="entry_window_mode" value="custom" checked={entryWindowMode === "custom"} onChange={() => setEntryWindowMode("custom")} title="Set custom dates" detail="Override the default for this Competition only." disabled={pending} />
      </div></fieldset>
      {entryWindowMode === "custom" ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-foreground">Entries open<input name="custom_entry_opens_at" type="date" value={customEntryOpensAt} onChange={(event) => setCustomEntryOpensAt(event.target.value)} disabled={pending} className={inputClassName} /></label><label className="text-sm font-medium text-foreground">Entries close<input name="custom_entry_closes_at" type="date" value={customEntryClosesAt} onChange={(event) => setCustomEntryClosesAt(event.target.value)} disabled={pending} className={inputClassName} /></label></div> : null}
      <FieldError field="entryWindow" message={state.fieldErrors?.entryWindow} />
    </section>

    <section className={sectionClassName} aria-labelledby="competition-start-title">
      <SectionTitle id="competition-start-title" title="Competition start" description="Round 1 End must be after the effective Competition Start; later rounds may share an end date." />
      <fieldset><legend className="sr-only">Competition Start source</legend><div className="grid gap-3 sm:grid-cols-2">
        <RadioCard name="start_date_mode" value="season_default" checked={startDateMode === "season_default"} onChange={() => setStartDateMode("season_default")} title="Use Season start" detail={formatDate(season.starts_at)} disabled={pending} />
        <RadioCard name="start_date_mode" value="custom" checked={startDateMode === "custom"} onChange={() => setStartDateMode("custom")} title="Set custom date" detail="Override the Season start for this Competition." disabled={pending} />
      </div></fieldset>
      {startDateMode === "custom" ? <label className="block max-w-xs text-sm font-medium text-foreground">Competition Start<input name="custom_starts_at" type="date" value={customStartsAt} onChange={(event) => setCustomStartsAt(event.target.value)} disabled={pending} className={inputClassName} /></label> : null}
      <FieldError field="competitionStart" message={state.fieldErrors?.competitionStart} />
    </section>

    <section className={sectionClassName} aria-labelledby="course-of-fire-title">
      <SectionTitle id="course-of-fire-title" title="Course of Fire" description="Define how many sets and separate gun scores each shooter records in one round." />
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <div><div className="flex items-center"><label htmlFor="sets-per-round" className="text-sm font-semibold text-foreground">Sets per round *</label><InfoHelp label="Sets per round">How many times each shooter completes the full set of scores during one round. Most competitions use 1. A Double Dewar may use 2.</InfoHelp></div><input id="sets-per-round" name="sets_per_round" type="number" min={1} max={100} step={1} value={setsPerRound} onChange={(event) => setSetsPerRound(event.target.value)} disabled={pending} className={inputClassName} /><FieldError field="setsPerRound" message={state.fieldErrors?.setsPerRound} /></div>
        <div><div className="flex items-center"><label htmlFor="scores-per-set" className="text-sm font-semibold text-foreground">Scores per set *</label><InfoHelp label="Scores per set">How many separate gun scores are recorded in each set. For example, 3P uses P, S and K: three scores per set.</InfoHelp></div><input id="scores-per-set" type="number" min={1} max={20} step={1} value={scoresPerSet} onChange={(event) => resizeComponents(event.target.value)} aria-invalid={Boolean(scoresPerSetError)} disabled={pending} className={inputClassName} />{scoresPerSetError ? <p className="mt-2 text-sm text-danger" role="alert">{scoresPerSetError}</p> : null}</div>
      </div>
      <div className="space-y-4">{components.map((component, index) => <fieldset key={index} className="rounded-xl border border-border bg-surface-muted p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">Score {index + 1}</legend>
        <div className="grid gap-4 lg:grid-cols-3">
          <div><div className="flex items-center"><label htmlFor={`component-label-${index}`} className="text-sm font-medium text-foreground">Label (optional)</label><InfoHelp label={`Score ${index + 1} label`}>Optional short heading shown for this score, e.g. P, S, K, 50m or 100yd.</InfoHelp></div><input id={`component-label-${index}`} name="component_label" maxLength={30} value={component.shortLabel} onChange={(event) => updateComponent(index, "shortLabel", event.target.value)} placeholder="50m" disabled={pending} className={inputClassName} /><p className="mt-2 text-xs leading-5 text-muted-foreground">Optional short heading shown for this score, e.g. P, S, K, 50m or 100yd.</p></div>
          <div><label htmlFor={`component-maximum-${index}`} className="text-sm font-medium text-foreground">Maximum score (Ex) *</label><input id={`component-maximum-${index}`} name="component_maximum" type="text" inputMode="decimal" autoComplete="off" value={component.maximumScore} onChange={(event) => updateComponent(index, "maximumScore", event.target.value)} placeholder="200" disabled={pending} className={inputClassName} /><p className="mt-2 text-xs leading-5 text-muted-foreground">Maximum possible gun score for this score, e.g. 100 or 200. Up to two decimal places are supported.</p></div>
          <div><label htmlFor={`component-method-${index}`} className="text-sm font-medium text-foreground">Score entry *</label><select id={`component-method-${index}`} name="component_method" value={component.scoreMethod} onChange={(event) => updateComponent(index, "scoreMethod", event.target.value)} disabled={pending} className={inputClassName}><option value="points_scored">Points scored</option><option value="points_dropped">Points dropped</option></select><p className="mt-2 text-xs leading-5 text-muted-foreground">Choose whether scorers enter the achieved points or the points dropped from the maximum.</p></div>
        </div>
      </fieldset>)}</div>
      <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted-foreground">Total possible gun score per shooter / round: <span className="font-semibold text-foreground">Ex {derivedMaximum.toLocaleString("en-GB", { maximumFractionDigits: 2 })}</span></p>
      <FieldError field="scoreComponents" message={state.fieldErrors?.scoreComponents} />
      <div className="max-w-xs"><label htmlFor="shots-per-round" className="text-sm font-semibold text-foreground">Shots per shooter / round (optional)</label><input id="shots-per-round" name="shots_per_round" type="number" min={1} max={10000} step={1} defaultValue={submitted?.shotsPerRound ?? competition?.shots_per_round ?? ""} disabled={pending} className={inputClassName} /><p className="mt-2 text-xs text-muted-foreground">Informational only. The number of recorded scores is defined by the Course of Fire above.</p><FieldError field="shotsPerRound" message={state.fieldErrors?.shotsPerRound} /></div>
    </section>

    <section className={sectionClassName} aria-labelledby="ranking-title">
      <SectionTitle id="ranking-title" title="Ranking" description="Choose the base ranking method. The standings engine is intentionally not implemented yet." />
      <div><div className="flex items-center"><label htmlFor="ranking-method" className="text-sm font-semibold text-foreground">Ranking method *</label><InfoHelp label="Ranking method">Choose how this Competition will convert recorded gun scores into standings. Ranking calculations are not implemented yet.</InfoHelp></div><select id="ranking-method" name="ranking_method" value={rankingMethod} onChange={(event) => changeRankingMethod(event.target.value as CompetitionRankingMethod)} disabled={pending} className={inputClassName}><option value="aggregate">Aggregate points</option><option value="best_n_average">Best N rounds average</option><option value="round_robin">Round robin</option><option value="gun_score">Gun score</option></select><p className="mt-2 text-sm leading-6 text-muted-foreground">{rankingDescriptions[rankingMethod]}</p><FieldError field="rankingMethod" message={state.fieldErrors?.rankingMethod} /></div>
      {rankingMethod === "best_n_average" ? <div className="max-w-xs"><label htmlFor="best-rounds-count" className="text-sm font-semibold text-foreground">Best rounds count *</label><input id="best-rounds-count" name="best_rounds_count" type="number" min={1} max={validRoundCount ?? 100} step={1} value={bestRoundsCount} onChange={(event) => setBestRoundsCount(event.target.value)} aria-invalid={Boolean(bestRoundsError || state.fieldErrors?.bestRoundsCount)} aria-describedby="best-rounds-range" disabled={pending} className={inputClassName} /><p id="best-rounds-range" className={`mt-2 text-xs ${bestRoundsError ? "text-danger" : "text-muted-foreground"}`} role={bestRoundsError ? "alert" : undefined}>{bestRoundsError ?? `Choose a value from 1 to ${validRoundCount ?? 100}.`}</p><FieldError field="bestRoundsCount" message={state.fieldErrors?.bestRoundsCount} /></div> : null}
      {rankingMethod === "round_robin" ? <div className="space-y-3"><p className="rounded-xl border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">Round Robin requires divisions to be finalised before the competition starts.</p>{roundRobinDateError ? <p className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger" role="alert">{roundRobinDateError}</p> : null}</div> : null}
      {rankingMethod === "best_n_average" ? <><input type="hidden" name="uses_x_score" value="false" /><p className="rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-muted-foreground">X-based ranking is not currently defined for Best N Average competitions.</p></> : <><fieldset><legend className="text-sm font-semibold text-foreground">X scoring</legend><div className="mt-2 grid gap-3 sm:grid-cols-2"><RadioCard name="uses_x_score" value="false" checked={!usesXScore} onChange={() => setUsesXScore(false)} title="Not used" detail="Do not record X scores." disabled={pending} /><RadioCard name="uses_x_score" value="true" checked={usesXScore} onChange={() => setUsesXScore(true)} title="Record X scores" detail="Store X counts separately for future ranking logic." disabled={pending} /></div></fieldset>{!usesXScore ? <p className="rounded-xl border border-warning/20 bg-warning-subtle px-4 py-3 text-sm leading-6 text-warning">X scores will not be recorded for this competition. They cannot be used for X-based tie resolution after scoring has started.</p> : null}</>}
      <FieldError field="xScoring" message={state.fieldErrors?.xScoring} />
      <fieldset><legend className="text-sm font-semibold text-foreground">Score entry access</legend><div className="mt-2 grid gap-3 sm:grid-cols-2"><RadioCard name="local_scoring_enabled" value="true" checked={localScoringEnabled} onChange={() => setLocalScoringEnabled(true)} title="Club + organisation scoring" detail="Club officials may later score their own club." disabled={pending} /><RadioCard name="local_scoring_enabled" value="false" checked={!localScoringEnabled} onChange={() => setLocalScoringEnabled(false)} title="Organisation scoring only" detail="Only organisation scoring roles will score." disabled={pending} /></div><FieldError field="scoringAccess" message={state.fieldErrors?.scoringAccess} /></fieldset>
    </section>

    <section className={sectionClassName} aria-labelledby="rounds-title">
      <SectionTitle id="rounds-title" title="Rounds / stages" description="Round 1 End must be after Competition Start. Later Round End dates may be equal but cannot move backwards." />
      <div className="max-w-xs"><label htmlFor="number-of-rounds" className="text-sm font-semibold text-foreground">Number of rounds *</label><input id="number-of-rounds" name="number_of_rounds" type="number" min={1} max={100} step={1} value={numberOfRounds} onChange={(event) => resizeSchedule(event.target.value)} disabled={pending} className={inputClassName} /><FieldError field="numberOfRounds" message={state.fieldErrors?.numberOfRounds} /></div>
      <div className="rounded-2xl border border-border bg-surface-muted p-4"><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.6fr)_auto] sm:items-end"><label className="text-sm font-medium text-foreground">First Round End<input type="date" value={firstDeadline} onChange={(event) => setFirstDeadline(event.target.value)} disabled={pending} className={inputClassName} /></label><label className="text-sm font-medium text-foreground">Repeat every<input type="number" min={1} max={repeatUnit === "days" ? 365 : 52} value={repeatEvery} onChange={(event) => setRepeatEvery(event.target.value)} disabled={pending} className={inputClassName} /></label><label className="text-sm font-medium text-foreground">Unit<select value={repeatUnit} onChange={(event) => setRepeatUnit(event.target.value as "days" | "weeks")} disabled={pending} className={inputClassName}><option value="days">days</option><option value="weeks">weeks</option></select></label><button type="button" onClick={generateSchedule} disabled={pending} className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">Generate</button></div>{generatorError ? <p className="mt-3 text-sm text-danger" role="alert">{generatorError}</p> : null}</div>
      {roundDeadlines.length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">No schedule generated yet. A draft can be saved without one.</p> : <div className="space-y-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground"><input type="checkbox" checked={useShootByDates} onChange={(event) => setUseShootByDates(event.target.checked)} disabled={pending} className="size-4 accent-primary" />Use Shoot-by dates</label>
        <div className="max-w-3xl overflow-hidden rounded-xl border border-border bg-surface">
          <div className={`grid items-center gap-2 border-b border-border bg-surface-muted px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${useShootByDates ? "grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-[2rem_minmax(0,1fr)]"}`}><span className="sr-only">Round</span><span>Round End</span>{useShootByDates ? <span>Shoot-by</span> : null}</div>
          <div className="divide-y divide-border">{roundDeadlines.map((deadline, index) => <div key={index} className={`grid items-center gap-2 px-3 py-2 ${useShootByDates ? "grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-[2rem_minmax(0,1fr)]"}`}>
            <span className="text-xs font-semibold text-brand-strong">R{index + 1}</span>
            <label className="min-w-0"><span className="sr-only">Round {index + 1} End</span><input name="round_deadline" type="date" value={deadline} onChange={(event) => setRoundDeadlines((current) => current.map((value, roundIndex) => roundIndex === index ? event.target.value : value))} disabled={pending} className={compactDateClassName} /></label>
            {useShootByDates ? <label className="min-w-0"><span className="sr-only">Round {index + 1} Shoot-by (optional)</span><input name="round_shoot_by_date" type="date" value={shootByDates[index] ?? ""} onChange={(event) => setShootByDates((current) => Array.from({ length: roundDeadlines.length }, (_, roundIndex) => roundIndex === index ? event.target.value : current[roundIndex] ?? ""))} disabled={pending} className={compactDateClassName} /></label> : null}
          </div>)}</div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Shoot-by is optional for every round. When it is not used, the local scorer cutoff will later fall back to Round End.</p>
      </div>}
      {scheduleErrors.length ? <div className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger" role="alert"><p className="font-semibold">Adjust the round schedule.</p><ul className="mt-2 list-disc space-y-1 pl-5">{scheduleErrors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
      <FieldError field="roundSchedule" message={state.fieldErrors?.roundSchedule} />
    </section>

    <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end"><Link href={detailPath} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-neutral-strong">Cancel</Link>{competition?.status === "draft" ? <button type="submit" name="intent" value="publish" disabled={pending || Boolean(bestRoundsError) || Boolean(scoresPerSetError)} className="min-h-11 rounded-xl border border-brand px-6 text-sm font-semibold text-brand-deep disabled:opacity-50">{pending ? "Saving…" : "Publish competition"}</button> : null}<button type="submit" name="intent" value="save" disabled={pending || Boolean(bestRoundsError) || Boolean(scoresPerSetError)} className="min-h-11 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : competition?.status === "published" ? "Save changes" : "Save draft"}</button></div>
  </form>;
}
