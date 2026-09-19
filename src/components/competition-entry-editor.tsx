"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import {
  saveClubCompetitionEntry,
  searchCompetitionEntryMembers,
  startClubCompetitionEntry,
  submitClubCompetitionEntry,
  withdrawClubCompetitionEntry,
  type CompetitionEntryActionState,
  type EntryCompositionUnit,
} from "@/app/(app)/competition-entry-actions";
import { Badge, Card } from "@/components/ui";
import type { ClubTeam } from "@/lib/club-teams";
import type {
  ClubCompetitionEntryManagement,
  EntryMemberSearchResult,
} from "@/lib/competition-entries";

type MemberOption = EntryMemberSearchResult & {
  membership_status?: "pending" | "active" | "rejected" | "left";
};
type EditableEntrant = {
  clubTeamId: number | null;
  clubTeamNameSnapshot: string | null;
  participants: Array<number | null>;
};

function memberName(member: Pick<MemberOption, "first_name" | "last_name">) {
  return (
    [member.first_name?.trim(), member.last_name?.trim()]
      .filter(Boolean)
      .join(" ") || "Club member"
  );
}

function statusLabel(status: "draft" | "submitted" | "withdrawn") {
  return status[0].toUpperCase() + status.slice(1);
}

function formatLabel(format: "individual" | "pairs" | "team", plural = false) {
  if (format === "individual") return plural ? "individual entries" : "Individual entry";
  if (format === "pairs") return plural ? "pairs" : "Pair";
  return plural ? "teams" : "Team";
}

function stateMessage(state: CompetitionEntryActionState | null) {
  if (!state?.message) return null;
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm leading-6 ${
        state.status === "error"
          ? "border-danger/20 bg-danger-subtle text-danger"
          : "border-success/20 bg-success-subtle text-success"
      }`}
      role={state.status === "error" ? "alert" : "status"}
    >
      <p className="font-semibold">{state.message}</p>
      {state.errors?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {state.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function sameRoster(left: Array<number | null>, right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function CompetitionEntryEditor({
  data,
  initialMembers,
  initialClubTeams = [],
}: {
  data: ClubCompetitionEntryManagement;
  initialMembers: EntryMemberSearchResult[];
  initialClubTeams?: ClubTeam[];
}) {
  const router = useRouter();
  const withdrawDialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<MemberOption[]>(() => {
    const byId = new Map<number, MemberOption>(
      initialMembers.map((member) => [member.membership_id, member]),
    );
    for (const entrant of data.entrants) {
      for (const participant of entrant.participants) {
        byId.set(participant.membership_id, {
          membership_id: participant.membership_id,
          first_name: participant.first_name,
          last_name: participant.last_name,
          club_role: "member",
          membership_status: participant.membership_status,
        });
      }
    }
    for (const team of initialClubTeams) {
      for (const member of team.roster) {
        byId.set(member.membership_id, {
          membership_id: member.membership_id,
          first_name: member.first_name,
          last_name: member.last_name,
          club_role: "member",
          membership_status: member.membership_status,
        });
      }
    }
    return Array.from(byId.values());
  });
  const [searchError, setSearchError] = useState<string>();
  const [actionState, setActionState] = useState<CompetitionEntryActionState | null>(null);
  const [status, setStatus] = useState(data.entry.status);
  const size = data.competition.team_size;
  const format = data.competition.entry_format;
  const readOnly = data.entry_window_state !== "open" || status === "withdrawn";
  const [entrants, setEntrants] = useState<EditableEntrant[]>(() =>
    data.entrants.map((entrant) => {
      const participants = Array<number | null>(size).fill(null);
      for (const participant of entrant.participants) {
        participants[participant.slot_number - 1] = participant.membership_id;
      }
      return {
        clubTeamId: entrant.club_team_id,
        clubTeamNameSnapshot: entrant.club_team_name_snapshot,
        participants,
      };
    }),
  );

  const compatibleUnits = useMemo(() => initialClubTeams.filter((team) =>
    !team.archived_at &&
    team.is_complete &&
    team.fixed_size === size &&
    ((format === "pairs" && team.unit_type === "pair") ||
      (format === "team" && team.unit_type === "team")),
  ), [format, initialClubTeams, size]);
  const unitsById = useMemo(
    () => new Map(compatibleUnits.map((team) => [team.id, team])),
    [compatibleUnits],
  );
  const membersById = useMemo(
    () => new Map(members.map((member) => [member.membership_id, member])),
    [members],
  );
  const selectedIds = new Set(
    entrants.flatMap((entrant) => entrant.participants)
      .filter((value): value is number => value !== null),
  );
  const selectedTeamIds = new Set(
    entrants.map((entrant) => entrant.clubTeamId)
      .filter((value): value is number => value !== null),
  );

  function entrantDisplayLabel(entrant: EditableEntrant, index: number) {
    if (format === "individual") return `Individual entry ${index + 1}`;
    return entrant.clubTeamNameSnapshot || `${formatLabel(format)} ${index + 1}`;
  }

  function unitRoster(team: ClubTeam) {
    return team.roster.map((member) => member.membership_id);
  }

  function unitConflicts(team: ClubTeam, ignoredEntrantIndex?: number) {
    const used = new Set(
      entrants.flatMap((entrant, index) =>
        index === ignoredEntrantIndex ? [] : entrant.participants,
      ).filter((value): value is number => value !== null),
    );
    return unitRoster(team).some((membershipId) => used.has(membershipId));
  }

  function addPersistentUnit(teamId: number) {
    const team = unitsById.get(teamId);
    if (!team || selectedTeamIds.has(team.id) || unitConflicts(team)) {
      setActionState({
        status: "error",
        message: "That Club Pair or Team is already used or shares a shooter with another entrant.",
      });
      return;
    }
    setEntrants((current) => [...current, {
      clubTeamId: team.id,
      clubTeamNameSnapshot: team.name,
      participants: unitRoster(team),
    }]);
    setActionState(null);
  }

  function selectPersistentUnit(entrantIndex: number, teamId: number) {
    const team = unitsById.get(teamId);
    if (!team || (selectedTeamIds.has(team.id) && entrants[entrantIndex]?.clubTeamId !== team.id) ||
      unitConflicts(team, entrantIndex)) {
      setActionState({
        status: "error",
        message: "That Club Pair or Team is already used or shares a shooter with another entrant.",
      });
      return;
    }
    setEntrants((current) => current.map((entrant, index) => index === entrantIndex
      ? {
          clubTeamId: team.id,
          clubTeamNameSnapshot: team.name,
          participants: unitRoster(team),
        }
      : entrant));
    setActionState(null);
  }

  function assignIndividual(membershipId: number) {
    if (selectedIds.has(membershipId)) {
      setActionState({ status: "error", message: "That shooter is already selected in this club entry." });
      return;
    }
    setEntrants((current) => [...current, {
      clubTeamId: null,
      clubTeamNameSnapshot: null,
      participants: [membershipId],
    }]);
    setActionState(null);
  }

  function removeEntrant(index: number) {
    setEntrants((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setActionState(null);
  }

  function entrantPayload(): EntryCompositionUnit[] {
    if (format === "individual") return entrants.map((entrant) => entrant.participants);
    return entrants.map((entrant) => entrant.clubTeamId
      ? { clubTeamId: entrant.clubTeamId }
      : entrant.participants);
  }

  function runMutation(
    mutation: () => Promise<CompetitionEntryActionState>,
    successfulStatus?: "draft" | "submitted" | "withdrawn",
  ) {
    startTransition(async () => {
      const result = await mutation();
      setActionState(result);
      if (result.status === "success" && successfulStatus) {
        if (format !== "individual") {
          setEntrants((current) => current.map((entrant) => {
            const team = entrant.clubTeamId ? unitsById.get(entrant.clubTeamId) : null;
            return team
              ? {
                  ...entrant,
                  clubTeamNameSnapshot: team.name,
                  participants: unitRoster(team),
                }
              : entrant;
          }));
        }
        setStatus(successfulStatus);
        router.refresh();
      }
    });
  }

  function searchMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchError(undefined);
    startTransition(async () => {
      const result = await searchCompetitionEntryMembers({ entryId: data.entry.id, query });
      if (result.status === "error") {
        setSearchError(result.message);
        return;
      }
      setMembers((current) => {
        const selected = current.filter((member) => selectedIds.has(member.membership_id));
        const byId = new Map(selected.map((member) => [member.membership_id, member]));
        for (const member of result.members) byId.set(member.membership_id, member);
        return Array.from(byId.values());
      });
    });
  }

  if (status === "withdrawn") {
    return (
      <Card className="p-6 sm:p-8">
        <Badge tone="neutral">Withdrawn</Badge>
        <h2 className="mt-4 text-xl font-semibold text-foreground">This club entry is withdrawn</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Its saved composition is preserved. It can be started again while entries remain open.
        </p>
        {data.entry_window_state === "open" ? (
          <form action={(formData) => {
            startTransition(async () => {
              const result = await startClubCompetitionEntry({}, formData);
              setActionState(result);
            });
          }} className="mt-5">
            <input type="hidden" name="competition_id" value={data.competition.id} />
            <input type="hidden" name="club_id" value={data.club.id} />
            <button disabled={pending} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {pending ? "Starting…" : "Start entry again"}
            </button>
          </form>
        ) : null}
        <div className="mt-4">{stateMessage(actionState)}</div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-start">
      <div className="min-w-0 space-y-4">
        {!readOnly && format !== "individual" ? (
          <Card className="p-5 sm:p-6">
            <h2 className="font-semibold text-foreground">Select Club {formatLabel(format)}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Only active {size}-shooter {formatLabel(format, true)} are shown. Their current roster is copied when this entry is saved.
            </p>
            <select
              value=""
              onChange={(event) => {
                if (event.target.value) addPersistentUnit(Number(event.target.value));
              }}
              className="mt-4 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-medium text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            >
              <option value="">Choose a Club {formatLabel(format).toLowerCase()}…</option>
              {compatibleUnits.map((team) => (
                <option
                  key={team.id}
                  value={team.id}
                  disabled={selectedTeamIds.has(team.id) || unitConflicts(team)}
                >
                  {team.name} · {team.roster.map((member) => memberName(member)).join(", ")}
                </option>
              ))}
            </select>
            {compatibleUnits.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No compatible Club {formatLabel(format, true)} are ready yet.
              </p>
            ) : null}
            <Link
              href={`/clubs/${data.club.slug}/teams`}
              className="mt-3 inline-flex text-sm font-semibold text-brand-deep hover:underline"
            >
              Manage Club Pairs and Teams
            </Link>
          </Card>
        ) : null}

        {entrants.length === 0 ? (
          <Card className="bg-surface-muted p-6 sm:p-8">
            <p className="text-sm text-muted-foreground">No {formatLabel(format, true)} have been added yet.</p>
          </Card>
        ) : entrants.map((entrant, entrantIndex) => {
          const currentUnit = entrant.clubTeamId ? unitsById.get(entrant.clubTeamId) : null;
          const currentRoster = currentUnit ? unitRoster(currentUnit) : null;
          const rosterChanged = Boolean(currentRoster && !sameRoster(entrant.participants, currentRoster));
          return (
            <Card key={entrantIndex} className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-foreground">
                    {entrantDisplayLabel(entrant, entrantIndex)}
                  </h2>
                  {format !== "individual" && !entrant.clubTeamId ? (
                    <Badge tone="warning">Legacy unlinked</Badge>
                  ) : null}
                </div>
                {!readOnly ? (
                  <button type="button" onClick={() => removeEntrant(entrantIndex)} className="text-xs font-semibold text-danger hover:underline">
                    Remove
                  </button>
                ) : null}
              </div>

              {!readOnly && format !== "individual" ? (
                <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Select Club {formatLabel(format)}
                  <select
                    value={entrant.clubTeamId ?? ""}
                    onChange={(event) => {
                      if (event.target.value) selectPersistentUnit(entrantIndex, Number(event.target.value));
                    }}
                    className="mt-2 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
                  >
                    <option value="" disabled>Choose a compatible Club {formatLabel(format).toLowerCase()}</option>
                    {entrant.clubTeamId && !currentUnit ? (
                      <option value={entrant.clubTeamId} disabled>
                        {entrant.clubTeamNameSnapshot ?? "Unavailable unit"} (archived, incomplete, or incompatible)
                      </option>
                    ) : null}
                    {compatibleUnits.map((team) => (
                      <option
                        key={team.id}
                        value={team.id}
                        disabled={(selectedTeamIds.has(team.id) && entrant.clubTeamId !== team.id) || unitConflicts(team, entrantIndex)}
                      >
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {rosterChanged ? (
                <p className="mt-3 rounded-lg bg-warning-subtle px-3 py-2 text-xs font-semibold text-warning">
                  The current Club roster has changed. Explicitly saving this draft will refresh its Competition participants.
                </p>
              ) : null}
              {!entrant.clubTeamId && format !== "individual" ? (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  This legacy entrant remains valid. Select a persistent Club {formatLabel(format).toLowerCase()} to replace it with a reusable current roster.
                </p>
              ) : null}

              <div className="mt-4 grid gap-3">
                {entrant.participants.map((membershipId, slotIndex) => {
                  const member = membershipId ? membersById.get(membershipId) : null;
                  return (
                    <div key={slotIndex} className="rounded-xl border border-border bg-surface-muted p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Shooter {slotIndex + 1}</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{member ? memberName(member) : "Not selected"}</p>
                          {member?.membership_status && member.membership_status !== "active" ? (
                            <p className="mt-1 text-xs text-danger">No longer an active club member</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <aside className="min-w-0 space-y-5 lg:sticky lg:top-28">
        {!readOnly && format === "individual" ? (
          <Card className="p-5 sm:p-6">
            <h2 className="font-semibold text-foreground">Add shooters</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Search active {data.club.name} members. Results are limited to 30.
            </p>
            <form onSubmit={searchMembers} className="mt-4 flex gap-2">
              <label htmlFor="entry-member-search" className="sr-only">Search active club members</label>
              <input id="entry-member-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name..." className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" />
              <button disabled={pending} className="rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60">Search</button>
            </form>
            {searchError ? <p className="mt-3 text-xs text-danger" role="alert">{searchError}</p> : null}
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
              {members.filter((member) => !member.membership_status || member.membership_status === "active").map((member) => {
                const selected = selectedIds.has(member.membership_id);
                return (
                  <button key={member.membership_id} type="button" disabled={selected || pending} onClick={() => assignIndividual(member.membership_id)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border px-3 text-left text-sm transition hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-45">
                    <span className="truncate font-medium text-foreground">{memberName(member)}</span>
                    <span className="shrink-0 text-xs font-semibold text-brand-deep">{selected ? "Selected" : "Add"}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        ) : null}

        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status === "submitted" ? "positive" : "warning"}>{statusLabel(status)}</Badge>
            {data.entry_window_state !== "open" ? <Badge tone="neutral">Entry closed</Badge> : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {entrants.length} {formatLabel(format, true)} · {selectedIds.size} shooter{selectedIds.size === 1 ? "" : "s"}
          </p>
          {status === "submitted" && !readOnly ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Saving composition changes returns this entry to Draft until it is submitted again.</p>
          ) : null}
          <div className="mt-4">{stateMessage(actionState)}</div>

          {!readOnly ? (
            <div className="mt-5 grid gap-3">
              <button type="button" disabled={pending} onClick={() => runMutation(() => saveClubCompetitionEntry({ entryId: data.entry.id, entrants: entrantPayload() }), "draft")} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep hover:bg-brand-subtle disabled:opacity-60">
                {pending ? "Working…" : "Save draft"}
              </button>
              <button type="button" disabled={pending} onClick={() => runMutation(() => submitClubCompetitionEntry({ entryId: data.entry.id, entrants: entrantPayload() }), "submitted")} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-brand-deep disabled:opacity-60">
                {pending ? "Working…" : status === "submitted" ? "Submit changes" : "Submit entry"}
              </button>
              <button type="button" disabled={pending} onClick={() => withdrawDialogRef.current?.showModal()} className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold text-danger hover:bg-danger-subtle disabled:opacity-60">
                Withdraw entry
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted-foreground">The saved entry is read-only because the entry window is closed.</p>
          )}
        </Card>
      </aside>

      <dialog ref={withdrawDialogRef} aria-labelledby="withdraw-entry-title" className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm">
        <div className="p-6 sm:p-7">
          <h2 id="withdraw-entry-title" className="text-lg font-semibold">Withdraw competition entry?</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {data.club.name} will no longer be entered in {data.competition.name}. This can be started again while entries remain open.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" disabled={pending} onClick={() => withdrawDialogRef.current?.close()} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-5 text-sm font-semibold">Cancel</button>
            <button type="button" disabled={pending} onClick={() => {
              withdrawDialogRef.current?.close();
              runMutation(() => withdrawClubCompetitionEntry(data.entry.id), "withdrawn");
            }} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "Withdrawing…" : "Withdraw entry"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
