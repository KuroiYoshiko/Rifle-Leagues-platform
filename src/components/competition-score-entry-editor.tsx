"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  saveCompetitionRoundScores,
  type CompetitionScoreActionState,
} from "@/app/(app)/competition-score-actions";
import { Badge, Card } from "@/components/ui";
import type {
  CompetitionEntryFormat,
  CompetitionRound,
} from "@/lib/competitions";
import { isCompetitionRoundWithinLocalCutoff } from "@/lib/competition-score-dates";
import type { CompetitionScoreEntry } from "@/lib/competition-scores";

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

type EditableEntrant = {
  id: number;
  position: number;
  participants: EditableParticipant[];
};

type EditableClubGroup = {
  id: number;
  name: string;
  entrants: EditableEntrant[];
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

function editableParticipants(data: CompetitionScoreEntry) {
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

function entrantLabel(format: CompetitionEntryFormat, position: number) {
  if (format === "pairs") return `Pair ${position}`;
  if (format === "team") return `Team ${position}`;
  return `Individual ${position}`;
}

function dateContext(round: CompetitionRound) {
  const details = [`Round End ${formatRoundDate(round.deadline)}`];
  if (round.shoot_by_date) {
    details.push(`Shoot-by ${formatRoundDate(round.shoot_by_date)}`);
  }
  return details.join(" · ");
}

function ReadOnlyMessage({ data }: { data: CompetitionScoreEntry }) {
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

export function CompetitionScoreEntryEditor({
  data,
  rounds,
  organisationId,
  leagueSeasonId,
  clubId,
}: {
  data: CompetitionScoreEntry;
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
  const usesClubRoundGroups =
    data.access_scope === "club" &&
    data.competition.started &&
    data.competition.local_scoring_enabled;
  const locallyEditableRounds = usesClubRoundGroups
    ? rounds.filter((round) =>
        isCompetitionRoundWithinLocalCutoff(round, data.database_today),
      )
    : [];
  const locallyClosedRounds = usesClubRoundGroups
    ? rounds.filter(
        (round) =>
          !isCompetitionRoundWithinLocalCutoff(round, data.database_today),
      )
    : [];
  const selectedRoundIsLocallyEditable = locallyEditableRounds.some(
    (round) => round.id === data.round.id,
  );
  const selectedRoundIsLocallyClosed = locallyClosedRounds.some(
    (round) => round.id === data.round.id,
  );
  const clubsWithEntrants = useMemo(() => {
    const groups = new Map<
      number,
      Omit<EditableClubGroup, "entrants"> & {
        entrants: Map<number, EditableEntrant>;
      }
    >();

    for (const participant of participants) {
      let club = groups.get(participant.club_id);
      if (!club) {
        club = {
          id: participant.club_id,
          name: participant.club_name,
          entrants: new Map(),
        };
        groups.set(participant.club_id, club);
      }

      const entrant = club.entrants.get(participant.entrant_id);
      if (entrant) entrant.participants.push(participant);
      else {
        club.entrants.set(participant.entrant_id, {
          id: participant.entrant_id,
          position: participant.entrant_position,
          participants: [participant],
        });
      }
    }

    return [...groups.values()].map((club) => ({
      id: club.id,
      name: club.name,
      entrants: [...club.entrants.values()],
    }));
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
      const result = await saveCompetitionRoundScores({
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
          {usesClubRoundGroups ? (
            <div className="min-w-0">
              {locallyEditableRounds.length > 0 ? (
                <label className="text-sm font-medium text-foreground">
                  Available for scoring
                  <select
                    value={
                      selectedRoundIsLocallyEditable ? data.round.id : ""
                    }
                    onChange={(event) =>
                      selectRound(Number(event.target.value))
                    }
                    disabled={isPending}
                    className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-wait disabled:opacity-60"
                  >
                    {!selectedRoundIsLocallyEditable ? (
                      <option value="" disabled>
                        Choose an editable Round
                      </option>
                    ) : null}
                    {locallyEditableRounds.map((round) => (
                      <option key={round.id} value={round.id}>
                        R{round.round_number} — {dateContext(round)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="rounded-xl border border-border bg-surface-muted px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">
                    No Rounds remain open for club scoring
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Previously submitted source scores remain available below.
                  </p>
                </div>
              )}

              {locallyClosedRounds.length > 0 ? (
                <details
                  open={
                    selectedRoundIsLocallyClosed ||
                    locallyEditableRounds.length === 0
                  }
                  className="mt-3 rounded-xl border border-border bg-surface-muted"
                >
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-brand-deep">
                    View closed Rounds ({locallyClosedRounds.length})
                  </summary>
                  <div className="flex flex-wrap gap-2 border-t border-border px-3 py-3">
                    {locallyClosedRounds.map((round) => (
                      <button
                        key={round.id}
                        type="button"
                        onClick={() => selectRound(round.id)}
                        disabled={isPending}
                        aria-current={
                          round.id === data.round.id ? "page" : undefined
                        }
                        className={`rounded-lg border px-3 py-2 text-left text-xs leading-5 transition disabled:cursor-wait disabled:opacity-60 ${
                          round.id === data.round.id
                            ? "border-brand bg-brand-subtle font-semibold text-brand-deep"
                            : "border-border bg-surface text-muted-foreground hover:bg-brand-subtle hover:text-brand-deep"
                        }`}
                      >
                        <span className="block font-semibold text-foreground">
                          R{round.round_number}
                        </span>
                        <span>{dateContext(round)}</span>
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
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
          )}
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

      {clubsWithEntrants.length === 0 ? (
        <Card className="mt-6 p-6 sm:p-8">
          <h2 className="font-semibold text-foreground">No submitted entrants</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Submitted entrants will appear here. Divisions are not required for
            score entry.
          </p>
        </Card>
      ) : (
        <div className="mt-8 space-y-9">
          {clubsWithEntrants.map((group) => (
            <section key={group.id} aria-labelledby={`score-club-${group.id}`}>
              <div className="mb-4">
                <h2
                  id={`score-club-${group.id}`}
                  className="text-lg font-semibold tracking-[-0.025em] text-foreground"
                >
                  {group.name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {group.entrants.length} submitted entrant
                  {group.entrants.length === 1 ? "" : "s"} ·{" "}
                  {group.entrants.reduce(
                    (total, entrant) => total + entrant.participants.length,
                    0,
                  )}{" "}
                  shooters
                </p>
              </div>

              <div className="space-y-4">
                {group.entrants.map((entrant) => (
                  <Card key={entrant.id} className="overflow-hidden p-0">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 py-3 sm:px-5">
                      <h3 className="font-semibold text-foreground">
                        {entrantLabel(
                          data.competition.entry_format,
                          entrant.position,
                        )}
                      </h3>
                      <Badge tone="neutral">
                        {entrant.participants.length} shooter
                        {entrant.participants.length === 1 ? "" : "s"}
                      </Badge>
                    </div>

                    <div className="divide-y divide-border">
                      {entrant.participants.map((participant, shooterIndex) => (
                        <div
                          key={participant.participant_id}
                          className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)]"
                        >
                          <div className="min-w-0">
                            <h4 className="font-semibold text-foreground">
                              {participantName(participant)}
                            </h4>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Shooter {shooterIndex + 1}
                            </p>
                          </div>

                          <div
                            className={`grid min-w-0 gap-3 ${
                              data.competition.sets_per_round > 1
                                ? "xl:grid-cols-2"
                                : ""
                            }`}
                          >
                            {Array.from(
                              { length: data.competition.sets_per_round },
                              (_, index) => index + 1,
                            ).map((setNumber) => (
                              <fieldset
                                key={setNumber}
                                className="min-w-0 rounded-lg border border-border bg-surface-muted px-3 pb-3 pt-2"
                              >
                                <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-strong">
                                  Set {setNumber}
                                </legend>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {participant.values
                                    .filter(
                                      (value) =>
                                        value.set_number === setNumber,
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
                                          className={`grid min-w-0 gap-2 ${
                                            data.competition.uses_x_score
                                              ? "grid-cols-[minmax(0,1fr)_5.5rem]"
                                              : ""
                                          }`}
                                        >
                                          <label className="block text-xs font-semibold text-foreground">
                                            {label}
                                            <span className="mt-0.5 block text-[10px] font-normal leading-4 text-muted-foreground">
                                              {scoringMethodLabel(
                                                component.score_method,
                                              )}{" "}
                                              · Ex{" "}
                                              {Number(
                                                component.maximum_score,
                                              ).toLocaleString("en-GB", {
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
                                              disabled={
                                                !data.can_edit || isPending
                                              }
                                              aria-label={`${participantName(participant)}, Set ${setNumber}, ${label}, ${scoringMethodLabel(component.score_method)}`}
                                              className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm tabular-nums text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70"
                                            />
                                          </label>

                                          {data.competition.uses_x_score ? (
                                            <label className="block text-xs font-medium text-muted-foreground">
                                              X
                                              <span className="mt-0.5 block text-[10px] font-normal leading-4">
                                                Count
                                              </span>
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
                                                  value.entered_score.trim() ===
                                                    ""
                                                }
                                                aria-label={`${participantName(participant)}, Set ${setNumber}, ${label}, X count`}
                                                className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-surface px-2 text-sm tabular-nums text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70"
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
                        </div>
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
