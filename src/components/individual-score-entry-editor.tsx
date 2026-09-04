"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  saveIndividualCompetitionRoundScores,
  type CompetitionScoreActionState,
} from "@/app/(app)/competition-score-actions";
import { Badge, Card } from "@/components/ui";
import type { CompetitionRound } from "@/lib/competitions";
import type { IndividualCompetitionScoreEntry } from "@/lib/competition-scores";

type EditableScoreValue = {
  set_number: number;
  component_position: number;
  entered_score: string;
  x_count: string;
};

type EditableParticipant = {
  participant_id: number;
  entrant_id: number;
  entrant_position: number;
  club_id: number;
  club_name: string;
  first_name: string | null;
  last_name: string | null;
  values: EditableScoreValue[];
};

const roundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatRoundDate(value: string) {
  return roundDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function scoringMethodLabel(value: "points_scored" | "points_dropped") {
  return value === "points_dropped" ? "Points dropped" : "Points scored";
}

function participantName(
  participant: Pick<EditableParticipant, "first_name" | "last_name">,
) {
  return (
    [participant.first_name?.trim(), participant.last_name?.trim()]
      .filter(Boolean)
      .join(" ") || "Shooter"
  );
}

function editableParticipants(data: IndividualCompetitionScoreEntry) {
  return data.participants.map((participant) => ({
    ...participant,
    values: participant.values.map((value) => ({
      ...value,
      entered_score:
        value.entered_score === null ? "" : String(value.entered_score),
      x_count: value.x_count === null ? "" : String(value.x_count),
    })),
  }));
}

function dateContext(round: CompetitionRound) {
  const details = [`Round End ${formatRoundDate(round.deadline)}`];
  if (round.shoot_by_date) {
    details.push(`Shoot-by ${formatRoundDate(round.shoot_by_date)}`);
  }
  return details.join(" · ");
}

function ReadOnlyMessage({ data }: { data: IndividualCompetitionScoreEntry }) {
  if (!data.competition.started) {
    return (
      <div className="rounded-2xl border border-warning/20 bg-warning-subtle px-5 py-4 text-sm leading-6 text-warning">
        Score entry opens on the effective Competition Start
        {data.competition.effective_starts_at
          ? `, ${formatRoundDate(data.competition.effective_starts_at)}`
          : ""}
        . Future Rounds remain selectable for review.
      </div>
    );
  }

  if (
    data.access_scope === "club" &&
    !data.competition.local_scoring_enabled
  ) {
    return (
      <div className="rounded-2xl border border-border bg-surface-muted px-5 py-4 text-sm leading-6 text-muted-foreground">
        Scores for this Competition are entered by the organisation. Club score
        entry is read-only.
      </div>
    );
  }

  if (data.access_scope === "club" && data.round.local_cutoff_passed) {
    return (
      <div className="rounded-2xl border border-warning/20 bg-warning-subtle px-5 py-4 text-sm leading-6 text-warning">
        The local cutoff for this Round was {formatRoundDate(data.round.local_cutoff)}.
        Scores are now read-only for club scorers; organisation scorers may
        still make changes.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-muted px-5 py-4 text-sm leading-6 text-muted-foreground">
      This Round is currently read-only.
    </div>
  );
}

export function IndividualScoreEntryEditor({
  data,
  rounds,
  organisationId,
  leagueSeasonId,
  clubId,
}: {
  data: IndividualCompetitionScoreEntry;
  rounds: CompetitionRound[];
  organisationId: number;
  leagueSeasonId: number;
  clubId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [participants, setParticipants] = useState<EditableParticipant[]>(() =>
    editableParticipants(data),
  );
  const [actionState, setActionState] =
    useState<CompetitionScoreActionState>({});
  const [isPending, startTransition] = useTransition();
  const componentByPosition = useMemo(
    () =>
      new Map(
        data.components.map((component) => [component.position, component]),
      ),
    [data.components],
  );
  const participantsByClub = useMemo(() => {
    const groups = new Map<
      number,
      { id: number; name: string; participants: EditableParticipant[] }
    >();

    for (const participant of participants) {
      const existing = groups.get(participant.club_id);
      if (existing) {
        existing.participants.push(participant);
      } else {
        groups.set(participant.club_id, {
          id: participant.club_id,
          name: participant.club_name,
          participants: [participant],
        });
      }
    }

    return [...groups.values()];
  }, [participants]);

  function selectRound(roundId: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("round", String(roundId));
    router.push(`${pathname}?${next.toString()}`);
  }

  function updateValue(
    participantId: number,
    setNumber: number,
    componentPosition: number,
    field: "entered_score" | "x_count",
    value: string,
  ) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.participant_id !== participantId
          ? participant
          : {
              ...participant,
              values: participant.values.map((score) =>
                score.set_number === setNumber &&
                score.component_position === componentPosition
                  ? {
                      ...score,
                      [field]: value,
                      ...(field === "entered_score" && value.trim() === ""
                        ? { x_count: "" }
                        : {}),
                    }
                  : score,
              ),
            },
      ),
    );
    setActionState({});
  }

  function saveScores() {
    setActionState({});
    startTransition(async () => {
      const result = await saveIndividualCompetitionRoundScores({
        organisationId,
        leagueSeasonId,
        competitionId: data.competition.id,
        competitionRoundId: data.round.id,
        clubId,
        scores: participants.map((participant) => ({
          participant_id: participant.participant_id,
          values: participant.values.map((value) => ({
            set_number: value.set_number,
            component_position: value.component_position,
            entered_score: value.entered_score.trim() || null,
            x_count:
              value.x_count.trim() === "" ? null : Number(value.x_count),
          })),
        })),
      });
      setActionState(result);
    });
  }

  return (
    <>
      <Card className="p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-end">
          <label className="text-sm font-medium text-foreground">
            Round
            <select
              value={data.round.id}
              onChange={(event) => selectRound(Number(event.target.value))}
              disabled={isPending}
              className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-wait disabled:opacity-60"
            >
              {rounds.map((round) => (
                <option key={round.id} value={round.id}>
                  R{round.round_number} — {dateContext(round)}
                </option>
              ))}
            </select>
          </label>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-muted p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Round End
              </dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">
                {formatRoundDate(data.round.deadline)}
              </dd>
            </div>
            <div className="rounded-xl bg-surface-muted p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {data.round.shoot_by_date ? "Shoot-by" : "Local cutoff"}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">
                {formatRoundDate(data.round.local_cutoff)}
              </dd>
            </div>
          </dl>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Badge tone={data.access_scope === "organisation" ? "brand" : "neutral"}>
            {data.access_scope === "organisation"
              ? "Organisation scoring"
              : "Club scoring"}
          </Badge>
          <p className="text-xs leading-5 text-muted-foreground">
            Any configured Round may be selected after the Competition starts;
            earlier Rounds do not block later ones.
          </p>
        </div>
      </Card>

      {!data.can_edit ? (
        <div className="mt-5">
          <ReadOnlyMessage data={data} />
        </div>
      ) : null}

      {participantsByClub.length === 0 ? (
        <Card className="mt-6 p-6 sm:p-8">
          <h2 className="font-semibold text-foreground">
            No submitted Individual entrants
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Submitted entrants will appear here. Divisions are not required for
            score entry.
          </p>
        </Card>
      ) : (
        <div className="mt-8 space-y-10">
          {participantsByClub.map((group) => (
            <section key={group.id} aria-labelledby={`score-club-${group.id}`}>
              <div className="mb-4">
                <h2
                  id={`score-club-${group.id}`}
                  className="text-lg font-semibold tracking-[-0.025em] text-foreground"
                >
                  {group.name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {group.participants.length} submitted shooter
                  {group.participants.length === 1 ? "" : "s"}
                </p>
              </div>

              <div className="space-y-4">
                {group.participants.map((participant) => (
                  <Card
                    key={participant.participant_id}
                    className="p-5 sm:p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">
                          {participantName(participant)}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Individual entry {participant.entrant_position}
                        </p>
                      </div>
                      <Badge tone="neutral">
                        {data.competition.sets_per_round} set
                        {data.competition.sets_per_round === 1 ? "" : "s"}
                      </Badge>
                    </div>

                    <div className="mt-5 grid gap-5 xl:grid-cols-2">
                      {Array.from(
                        { length: data.competition.sets_per_round },
                        (_, index) => index + 1,
                      ).map((setNumber) => (
                        <fieldset
                          key={setNumber}
                          className="min-w-0 rounded-xl border border-border bg-surface-muted p-4"
                        >
                          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">
                            Set {setNumber}
                          </legend>
                          <div className="grid gap-4 sm:grid-cols-2">
                            {participant.values
                              .filter(
                                (value) => value.set_number === setNumber,
                              )
                              .map((value) => {
                                const component = componentByPosition.get(
                                  value.component_position,
                                );
                                if (!component) return null;
                                const label =
                                  component.short_label ||
                                  `Score ${component.position}`;

                                return (
                                  <div
                                    key={`${setNumber}-${component.position}`}
                                    className="min-w-0"
                                  >
                                    <label className="block text-sm font-semibold text-foreground">
                                      {label}
                                      <span className="mt-0.5 block text-[11px] font-normal leading-4 text-muted-foreground">
                                        {scoringMethodLabel(component.score_method)}{" "}
                                        · Ex {Number(component.maximum_score).toLocaleString("en-GB", {
                                          maximumFractionDigits: 2,
                                        })}
                                      </span>
                                      <input
                                        type="number"
                                        min="0"
                                        max={component.maximum_score}
                                        step="0.01"
                                        inputMode="decimal"
                                        value={value.entered_score}
                                        onChange={(event) =>
                                          updateValue(
                                            participant.participant_id,
                                            setNumber,
                                            component.position,
                                            "entered_score",
                                            event.target.value,
                                          )
                                        }
                                        disabled={!data.can_edit || isPending}
                                        aria-label={`${participantName(participant)}, Set ${setNumber}, ${label}, ${scoringMethodLabel(component.score_method)}`}
                                        className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-base tabular-nums text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70"
                                      />
                                    </label>

                                    {data.competition.uses_x_score ? (
                                      <label className="mt-3 block text-xs font-medium text-muted-foreground">
                                        X count
                                        <input
                                          type="number"
                                          min="0"
                                          max="10000"
                                          step="1"
                                          inputMode="numeric"
                                          value={value.x_count}
                                          onChange={(event) =>
                                            updateValue(
                                              participant.participant_id,
                                              setNumber,
                                              component.position,
                                              "x_count",
                                              event.target.value,
                                            )
                                          }
                                          disabled={
                                            !data.can_edit ||
                                            isPending ||
                                            value.entered_score.trim() === ""
                                          }
                                          aria-label={`${participantName(participant)}, Set ${setNumber}, ${label}, X count`}
                                          className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm tabular-nums text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70"
                                        />
                                      </label>
                                    ) : null}
                                  </div>
                                );
                              })}
                          </div>
                        </fieldset>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {actionState.message ? (
        <p
          className={`mt-6 rounded-xl px-4 py-3 text-sm ${
            actionState.status === "error"
              ? "bg-danger-subtle text-danger"
              : "bg-success-subtle text-success"
          }`}
          role={actionState.status === "error" ? "alert" : "status"}
        >
          {actionState.message}
        </p>
      ) : null}

      {data.can_edit && participants.length > 0 ? (
        <div className="mt-6 flex justify-end border-t border-border pt-6">
          <button
            type="button"
            onClick={saveScores}
            disabled={isPending}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60 sm:w-auto"
          >
            {isPending ? "Saving scores…" : "Save scores"}
          </button>
        </div>
      ) : null}
    </>
  );
}
