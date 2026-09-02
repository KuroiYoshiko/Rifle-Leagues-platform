"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  createCompetition,
  updateCompetition,
  type CompetitionField,
  type CompetitionFormState,
} from "@/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/actions";
import type {
  Competition,
  CompetitionEntryFormat,
  CompetitionRound,
} from "@/lib/competitions";
import type { LeagueSeason } from "@/lib/league-seasons";

const initialState: CompetitionFormState = {};
const inputClassName =
  "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted";
const sectionClassName =
  "space-y-5 border-b border-border pb-7 last:border-b-0 last:pb-0";
const seasonDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatSeasonDate(value: string) {
  return seasonDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function FieldError({
  field,
  message,
}: {
  field: CompetitionField;
  message?: string;
}) {
  return message ? (
    <p
      id={`competition-${field}-error`}
      className="mt-2 text-sm leading-5 text-danger"
      role="alert"
    >
      {message}
    </p>
  ) : null;
}

function addCalendarDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getInitialDeadlines(
  competition: Competition | undefined,
  rounds: CompetitionRound[],
) {
  if (!competition || rounds.length === 0) return [];

  const deadlines = Array.from(
    { length: competition.number_of_rounds },
    () => "",
  );
  for (const round of rounds) {
    if (
      round.round_number >= 1 &&
      round.round_number <= competition.number_of_rounds
    ) {
      deadlines[round.round_number - 1] = round.deadline;
    }
  }
  return deadlines;
}

function SectionTitle({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h3
        id={id}
        className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground"
      >
        {title}
      </h3>
      {description ? (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function CompetitionForm({
  organisation,
  season,
  competition,
  rounds = [],
}: {
  organisation: { id: number; name: string; slug: string };
  season: LeagueSeason;
  competition?: Competition;
  rounds?: CompetitionRound[];
}) {
  const editing = Boolean(competition);
  const [state, formAction, pending] = useActionState(
    editing ? updateCompetition : createCompetition,
    initialState,
  );
  const initialValues = state.values;
  const [entryFormat, setEntryFormat] = useState<CompetitionEntryFormat>(
    (initialValues?.entryFormat as CompetitionEntryFormat | undefined) ??
      competition?.entry_format ??
      "individual",
  );
  const [numberOfRounds, setNumberOfRounds] = useState(
    initialValues?.numberOfRounds ??
      String(competition?.number_of_rounds ?? 10),
  );
  const [roundDeadlines, setRoundDeadlines] = useState<string[]>(() => {
    if (initialValues?.roundDeadlines.length) {
      return initialValues.roundDeadlines;
    }
    return getInitialDeadlines(competition, rounds);
  });
  const [firstDeadline, setFirstDeadline] = useState(
    roundDeadlines.find(Boolean) ?? season.starts_at ?? "",
  );
  const [repeatEvery, setRepeatEvery] = useState("2");
  const [repeatUnit, setRepeatUnit] = useState<"days" | "weeks">("weeks");
  const [generatorError, setGeneratorError] = useState<string | null>(null);

  const detailPath = competition
    ? `/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`
    : `/organisations/${organisation.slug}/leagues/${season.slug}`;
  const parsedRoundCount = Number(numberOfRounds);
  const validRoundCount =
    Number.isInteger(parsedRoundCount) &&
    parsedRoundCount >= 1 &&
    parsedRoundCount <= 52
      ? parsedRoundCount
      : null;
  const deadlinesSet = roundDeadlines.filter(Boolean).length;

  const clientScheduleErrors = useMemo(() => {
    const errors: string[] = [];
    let previousDeadline: string | null = null;

    for (const [index, deadline] of roundDeadlines.entries()) {
      if (!deadline) continue;

      if (deadline < "1900-01-01" || deadline > "2200-12-31") {
        errors.push(
          `Round ${index + 1} must use a deadline between 1900 and 2200.`,
        );
      }

      if (season.starts_at && deadline < season.starts_at) {
        errors.push(
          `Round ${index + 1} falls before the ${season.name} season starts on ${formatSeasonDate(season.starts_at)}.`,
        );
      }

      if (season.ends_at && deadline > season.ends_at) {
        errors.push(
          `Round ${index + 1} falls outside the ${season.name} season. Adjust it to ${formatSeasonDate(season.ends_at)} or earlier.`,
        );
      }

      if (previousDeadline && deadline < previousDeadline) {
        errors.push(
          `Round ${index + 1} cannot be before an earlier round deadline.`,
        );
      }

      previousDeadline = deadline;
    }

    return errors;
  }, [roundDeadlines, season.ends_at, season.name, season.starts_at]);

  function handleRoundCountChange(value: string) {
    setNumberOfRounds(value);
    const nextCount = Number(value);

    if (
      roundDeadlines.length > 0 &&
      Number.isInteger(nextCount) &&
      nextCount >= 1 &&
      nextCount <= 52
    ) {
      setRoundDeadlines((current) =>
        Array.from({ length: nextCount }, (_, index) => current[index] ?? ""),
      );
    }
  }

  function generateSchedule() {
    setGeneratorError(null);
    const interval = Number(repeatEvery);
    const intervalMaximum = repeatUnit === "days" ? 365 : 52;

    if (!validRoundCount) {
      setGeneratorError("Set the number of rounds between 1 and 52 first.");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDeadline)) {
      setGeneratorError("Choose the first round deadline.");
      return;
    }

    if (
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > intervalMaximum
    ) {
      setGeneratorError(
        `Repeat interval must be between 1 and ${intervalMaximum} ${repeatUnit}.`,
      );
      return;
    }

    const intervalDays = repeatUnit === "weeks" ? interval * 7 : interval;
    setRoundDeadlines(
      Array.from({ length: validRoundCount }, (_, index) =>
        addCalendarDays(firstDeadline, intervalDays * index),
      ),
    );
  }

  return (
    <form action={formAction} className="space-y-7" noValidate>
      <input type="hidden" name="organisation_id" value={organisation.id} />
      <input type="hidden" name="league_season_id" value={season.id} />
      {competition ? (
        <>
          <input type="hidden" name="competition_id" value={competition.id} />
          <input
            type="hidden"
            name="current_status"
            value={competition.status}
          />
        </>
      ) : null}

      {state.message ? (
        <div
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm leading-6 ${
            state.status === "success"
              ? "border-success/20 bg-success-subtle text-success"
              : "border-danger/20 bg-danger-subtle text-danger"
          }`}
        >
          <p className="font-semibold">{state.message}</p>
          {state.publishErrors?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {state.publishErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <section className={sectionClassName} aria-labelledby="basic-details-title">
        <SectionTitle
          id="basic-details-title"
          title="Basic details"
          description="Name the competition and optionally explain its discipline or purpose."
        />
        <div>
          <label
            htmlFor="competition-name"
            className="text-sm font-semibold text-foreground"
          >
            Competition name <span aria-hidden="true">*</span>
          </label>
          <input
            id="competition-name"
            name="name"
            required
            minLength={2}
            maxLength={160}
            autoComplete="off"
            defaultValue={initialValues?.name ?? competition?.name ?? ""}
            aria-invalid={Boolean(state.fieldErrors?.name)}
            aria-describedby={
              state.fieldErrors?.name ? "competition-name-error" : undefined
            }
            disabled={pending}
            placeholder="Short Range Ind Open League"
            className={inputClassName}
          />
          <FieldError field="name" message={state.fieldErrors?.name} />
          {editing ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Renaming the competition does not change its web address.
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="competition-description"
            className="text-sm font-semibold text-foreground"
          >
            Description
          </label>
          <textarea
            id="competition-description"
            name="description"
            rows={4}
            maxLength={2000}
            defaultValue={
              initialValues?.description ?? competition?.description ?? ""
            }
            aria-invalid={Boolean(state.fieldErrors?.description)}
            aria-describedby="competition-description-help"
            disabled={pending}
            placeholder="Individual competition for .22 Benchrest Rifle."
            className={`${inputClassName} resize-y py-3`}
          />
          <p
            id="competition-description-help"
            className="mt-2 text-xs leading-5 text-muted-foreground"
          >
            Optional plain text, up to 2,000 characters.
          </p>
          <FieldError
            field="description"
            message={state.fieldErrors?.description}
          />
        </div>
      </section>

      <section className={sectionClassName} aria-labelledby="entry-format-title">
        <SectionTitle
          id="entry-format-title"
          title="Entry format"
          description="This stores the future entry composition; it does not add shooters yet."
        />
        <fieldset>
          <legend className="sr-only">Entry format</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["individual", "Individual", "1 shooter"],
                ["pairs", "Pairs", "2 shooters"],
                ["team", "Team", "3–20 shooters"],
              ] as const
            ).map(([value, label, detail]) => (
              <label
                key={value}
                className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                  entryFormat === value
                    ? "border-brand bg-brand-subtle"
                    : "border-border bg-surface hover:bg-surface-muted"
                }`}
              >
                <input
                  type="radio"
                  name="entry_format"
                  value={value}
                  checked={entryFormat === value}
                  onChange={() => setEntryFormat(value)}
                  disabled={pending}
                  className="mt-1 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <FieldError
            field="entryFormat"
            message={state.fieldErrors?.entryFormat}
          />
        </fieldset>

        {entryFormat === "team" ? (
          <div className="max-w-xs">
            <label
              htmlFor="competition-team-size"
              className="text-sm font-semibold text-foreground"
            >
              Team size <span aria-hidden="true">*</span>
            </label>
            <input
              id="competition-team-size"
              name="team_size"
              type="number"
              inputMode="numeric"
              min={3}
              max={20}
              step={1}
              required
              defaultValue={
                initialValues?.teamSize ?? competition?.team_size ?? 3
              }
              aria-invalid={Boolean(state.fieldErrors?.teamSize)}
              disabled={pending}
              className={inputClassName}
            />
            <FieldError
              field="teamSize"
              message={state.fieldErrors?.teamSize}
            />
          </div>
        ) : (
          <input
            type="hidden"
            name="team_size"
            value={entryFormat === "individual" ? 1 : 2}
          />
        )}
      </section>

      <section className={sectionClassName} aria-labelledby="scoring-title">
        <SectionTitle
          id="scoring-title"
          title="Scoring"
          description="Configure how future scores will be described. Ranking calculations are not part of this step."
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="competition-scoring-method"
              className="text-sm font-semibold text-foreground"
            >
              Scoring method <span aria-hidden="true">*</span>
            </label>
            <select
              id="competition-scoring-method"
              name="scoring_method"
              defaultValue={
                initialValues?.scoringMethod ??
                competition?.scoring_method ??
                "points_dropped"
              }
              aria-invalid={Boolean(state.fieldErrors?.scoringMethod)}
              disabled={pending}
              className={inputClassName}
            >
              <option value="points_dropped">Points dropped</option>
              <option value="points_scored">Points scored</option>
            </select>
            <FieldError
              field="scoringMethod"
              message={state.fieldErrors?.scoringMethod}
            />
          </div>

          <div>
            <label
              htmlFor="competition-maximum-score"
              className="text-sm font-semibold text-foreground"
            >
              Maximum possible score per round
            </label>
            <input
              id="competition-maximum-score"
              name="maximum_score_per_round"
              type="number"
              inputMode="numeric"
              min={1}
              max={1_000_000}
              step={1}
              defaultValue={
                initialValues?.maximumScorePerRound ??
                competition?.maximum_score_per_round ??
                ""
              }
              aria-invalid={Boolean(
                state.fieldErrors?.maximumScorePerRound,
              )}
              disabled={pending}
              placeholder="100"
              className={inputClassName}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Required before publishing.
            </p>
            <FieldError
              field="maximumScorePerRound"
              message={state.fieldErrors?.maximumScorePerRound}
            />
          </div>

          <div>
            <label
              htmlFor="competition-shots-per-round"
              className="text-sm font-semibold text-foreground"
            >
              Shots per round
            </label>
            <input
              id="competition-shots-per-round"
              name="shots_per_round"
              type="number"
              inputMode="numeric"
              min={1}
              max={10_000}
              step={1}
              defaultValue={
                initialValues?.shotsPerRound ??
                competition?.shots_per_round ??
                ""
              }
              aria-invalid={Boolean(state.fieldErrors?.shotsPerRound)}
              disabled={pending}
              placeholder="10"
              className={inputClassName}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Required before publishing.
            </p>
            <FieldError
              field="shotsPerRound"
              message={state.fieldErrors?.shotsPerRound}
            />
          </div>

          <div>
            <label
              htmlFor="competition-entry-fee"
              className="text-sm font-semibold text-foreground"
            >
              Entry fee
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 mt-1 -translate-y-1/2 text-sm text-muted-foreground">
                £
              </span>
              <input
                id="competition-entry-fee"
                name="entry_fee"
                type="number"
                inputMode="decimal"
                min={0}
                max={10_000}
                step="0.01"
                defaultValue={
                  initialValues?.entryFee ?? competition?.entry_fee ?? ""
                }
                aria-invalid={Boolean(state.fieldErrors?.entryFee)}
                disabled={pending}
                placeholder="4.00"
                className={`${inputClassName} pl-8`}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Optional GBP display value. No payment is collected.
            </p>
            <FieldError
              field="entryFee"
              message={state.fieldErrors?.entryFee}
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-muted p-4">
          <input
            name="uses_x_score"
            type="checkbox"
            defaultChecked={
              initialValues?.usesXScore ?? competition?.uses_x_score ?? false
            }
            disabled={pending}
            className="mt-1 size-4 accent-primary"
          />
          <span>
            <span className="block text-sm font-semibold text-foreground">
              Use X score
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Store X score as an additional scoring or tiebreak property.
            </span>
          </span>
        </label>
      </section>

      <section className={sectionClassName} aria-labelledby="rounds-title">
        <SectionTitle
          id="rounds-title"
          title="Rounds"
          description="Choose the explicit number of rounds for this competition."
        />
        <div className="max-w-xs">
          <label
            htmlFor="competition-number-of-rounds"
            className="text-sm font-semibold text-foreground"
          >
            Number of rounds <span aria-hidden="true">*</span>
          </label>
          <input
            id="competition-number-of-rounds"
            name="number_of_rounds"
            type="number"
            inputMode="numeric"
            min={1}
            max={52}
            step={1}
            required
            value={numberOfRounds}
            onChange={(event) => handleRoundCountChange(event.target.value)}
            aria-invalid={Boolean(state.fieldErrors?.numberOfRounds)}
            disabled={pending}
            className={inputClassName}
          />
          <FieldError
            field="numberOfRounds"
            message={state.fieldErrors?.numberOfRounds}
          />
        </div>
      </section>

      <section className="space-y-5" aria-labelledby="round-schedule-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <SectionTitle
            id="round-schedule-title"
            title="Round schedule"
            description={`${validRoundCount ?? 0} rounds · ${deadlinesSet} deadlines set`}
          />
          {roundDeadlines.length > 0 ? (
            <button
              type="button"
              onClick={generateSchedule}
              disabled={pending}
              className="self-start text-xs font-semibold text-brand-strong hover:text-brand-deep hover:underline disabled:opacity-60"
            >
              Regenerate schedule
            </button>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border bg-surface-muted p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_auto] sm:items-end">
            <div>
              <label
                htmlFor="first-round-deadline"
                className="text-sm font-medium text-foreground"
              >
                First round deadline
              </label>
              <input
                id="first-round-deadline"
                type="date"
                min="1900-01-01"
                max="2200-12-31"
                value={firstDeadline}
                onChange={(event) => setFirstDeadline(event.target.value)}
                disabled={pending}
                className={inputClassName}
              />
            </div>
            <div>
              <label
                htmlFor="repeat-every"
                className="text-sm font-medium text-foreground"
              >
                Repeat every
              </label>
              <input
                id="repeat-every"
                type="number"
                inputMode="numeric"
                min={1}
                max={repeatUnit === "days" ? 365 : 52}
                step={1}
                value={repeatEvery}
                onChange={(event) => setRepeatEvery(event.target.value)}
                disabled={pending}
                className={inputClassName}
              />
            </div>
            <div>
              <label htmlFor="repeat-unit" className="sr-only">
                Repeat unit
              </label>
              <select
                id="repeat-unit"
                value={repeatUnit}
                onChange={(event) =>
                  setRepeatUnit(event.target.value as "days" | "weeks")
                }
                disabled={pending}
                className={inputClassName}
              >
                <option value="days">days</option>
                <option value="weeks">weeks</option>
              </select>
            </div>
            <button
              type="button"
              onClick={generateSchedule}
              disabled={pending}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:opacity-60"
            >
              Generate
            </button>
          </div>
          {generatorError ? (
            <p className="mt-3 text-sm text-danger" role="alert">
              {generatorError}
            </p>
          ) : null}
        </div>

        {roundDeadlines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
            No schedule generated yet. You can still save this competition as a
            private draft.
          </div>
        ) : (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {roundDeadlines.map((deadline, index) => (
              <label
                key={index}
                className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <span className="text-sm font-semibold text-brand-deep">
                  R{index + 1}
                </span>
                <input
                  name="round_deadline"
                  type="date"
                  min="1900-01-01"
                  max="2200-12-31"
                  value={deadline}
                  onChange={(event) => {
                    const nextDeadline = event.target.value;
                    setRoundDeadlines((current) =>
                      current.map((value, roundIndex) =>
                        roundIndex === index ? nextDeadline : value,
                      ),
                    );
                  }}
                  aria-label={`Round ${index + 1} deadline`}
                  disabled={pending}
                  className="min-h-10 min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
                />
              </label>
            ))}
          </div>
        )}

        {clientScheduleErrors.length > 0 ? (
          <div
            className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger"
            role="alert"
          >
            <p className="font-semibold">Adjust the round schedule.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {clientScheduleErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <FieldError
          field="roundSchedule"
          message={state.fieldErrors?.roundSchedule}
        />
      </section>

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
        <Link
          href={detailPath}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-neutral-strong transition hover:bg-surface-muted"
        >
          Cancel
        </Link>
        {competition?.status === "draft" ? (
          <button
            type="submit"
            name="intent"
            value="publish"
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-brand px-6 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Saving…" : "Publish competition"}
          </button>
        ) : null}
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
        >
          {pending
            ? "Saving…"
            : competition
              ? competition.status === "draft"
                ? "Save draft"
                : "Save changes"
              : "Save draft"}
        </button>
      </div>
    </form>
  );
}
