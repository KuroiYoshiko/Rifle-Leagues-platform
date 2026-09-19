"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import {
  archiveClubTeam,
  createClubTeam,
  unarchiveClubTeam,
  updateClubTeam,
  type ClubTeamActionState,
} from "@/app/(app)/clubs/[slug]/teams/actions";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Badge, Card, SectionHeader } from "@/components/ui";
import type { Club, ManagedClubMember } from "@/lib/clubs";
import type {
  ClubTeam,
  ClubTeamRosterMember,
  ClubTeamUnitType,
} from "@/lib/club-teams";

type EditorState = { team: ClubTeam | null };
type ArchiveState = { team: ClubTeam; archived: boolean };
type RosterOption = Pick<
  ManagedClubMember,
  "membership_id" | "first_name" | "last_name"
> & {
  membership_status: "pending" | "active" | "rejected" | "left";
};

function memberName(member: Pick<RosterOption, "first_name" | "last_name">) {
  return (
    [member.first_name?.trim(), member.last_name?.trim()]
      .filter(Boolean)
      .join(" ") || "Club member"
  );
}

function actionMessage(state: ClubTeamActionState | null) {
  if (!state?.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm ${
        state.status === "error"
          ? "border-danger/20 bg-danger-subtle text-danger"
          : "border-success/20 bg-success-subtle text-success"
      }`}
    >
      {state.message}
    </p>
  );
}

function unitLabel(team: ClubTeam) {
  if (!team.unit_type || !team.fixed_size) return "Needs type and roster setup";
  return `${team.unit_type === "pair" ? "Pair" : "Team"} · ${team.fixed_size} shooters`;
}

function TeamCard({
  team,
  canManage,
  onEdit,
  onArchive,
}: {
  team: ClubTeam;
  canManage: boolean;
  onEdit: (team: ClubTeam) => void;
  onArchive: (team: ClubTeam, archived: boolean) => void;
}) {
  const archived = Boolean(team.archived_at);
  const needsSetup = !team.is_complete;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-semibold text-foreground">{team.name}</h3>
            <Badge tone={archived || needsSetup ? "neutral" : "positive"}>
              {archived ? "Archived" : needsSetup ? "Needs setup" : "Active"}
            </Badge>
          </div>
          <p className="mt-1.5 text-sm font-medium text-muted-foreground">
            {unitLabel(team)}
          </p>
          {team.roster.length ? (
            <ol className="mt-3 space-y-1.5 text-sm text-foreground">
              {team.roster.map((member) => (
                <li key={member.membership_id}>
                  {member.position}. {memberName(member)}
                  {member.membership_status !== "active" ? (
                    <span className="ml-2 text-xs font-semibold text-danger">Inactive</span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No current roster. Complete setup before using this unit in a Competition.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {team.submitted_usage_count > 0
              ? `${team.submitted_usage_count} submitted Competition ${team.submitted_usage_count === 1 ? "entry" : "entries"}`
              : "No submitted Competition history yet"}
          </p>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onEdit(team)}
              className="min-h-10 rounded-xl border border-border px-4 text-xs font-semibold text-brand-deep hover:bg-brand-subtle"
            >
              {needsSetup ? "Complete setup" : "Edit"}
            </button>
            <button
              type="button"
              onClick={() => onArchive(team, !archived)}
              className={`min-h-10 rounded-xl px-4 text-xs font-semibold ${
                archived
                  ? "bg-primary text-primary-foreground hover:bg-brand-deep"
                  : "text-danger hover:bg-danger-subtle"
              }`}
            >
              {archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function rosterOptionFromTeam(member: ClubTeamRosterMember): RosterOption {
  return {
    membership_id: member.membership_id,
    first_name: member.first_name,
    last_name: member.last_name,
    membership_status: member.membership_status,
  };
}

export function ClubTeamsManager({
  club,
  initialTeams,
  members,
  canManage,
}: {
  club: Pick<Club, "id" | "name" | "slug">;
  initialTeams: ClubTeam[];
  members: ManagedClubMember[];
  canManage: boolean;
}) {
  const editorDialogRef = useRef<HTMLDialogElement>(null);
  const [teams, setTeams] = useState(initialTeams);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [archiveState, setArchiveState] = useState<ArchiveState | null>(null);
  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState<ClubTeamUnitType | "">("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [actionState, setActionState] = useState<ClubTeamActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const activeTeams = teams.filter((team) => !team.archived_at);
  const archivedTeams = teams.filter((team) => team.archived_at);
  const fixedSize = editor?.team?.fixed_size ?? null;
  const requiredCount = unitType === "pair" ? 2 : fixedSize;
  const activeMemberIds = new Set(members.map((member) => member.membership_id));
  const everySelectedMemberIsActive = selectedMemberIds.every((id) => activeMemberIds.has(id));
  const validRoster = everySelectedMemberIsActive && (unitType === "pair"
    ? selectedMemberIds.length === 2
    : unitType === "team" && (
      fixedSize ? selectedMemberIds.length === fixedSize : selectedMemberIds.length >= 3
    ));

  const memberOptions = (() => {
    const byId = new Map<number, RosterOption>(
      members.map((member) => [member.membership_id, member]),
    );
    for (const member of editor?.team?.roster ?? []) {
      byId.set(member.membership_id, rosterOptionFromTeam(member));
    }
    return Array.from(byId.values()).sort((left, right) =>
      memberName(left).localeCompare(memberName(right), "en-GB"),
    );
  })();

  function openEditor(team: ClubTeam | null) {
    setEditor({ team });
    setName(team?.name ?? "");
    setUnitType(team?.unit_type ?? "");
    setSelectedMemberIds(team?.roster.map((member) => member.membership_id) ?? []);
    setActionState(null);
    editorDialogRef.current?.showModal();
  }

  function closeEditor() {
    if (pending) return;
    editorDialogRef.current?.close();
    setEditor(null);
  }

  function toggleMember(membershipId: number) {
    setSelectedMemberIds((current) => current.includes(membershipId)
      ? current.filter((id) => id !== membershipId)
      : [...current, membershipId]);
    setActionState(null);
  }

  function changeUnitType(next: ClubTeamUnitType | "") {
    setUnitType(next);
    setSelectedMemberIds([]);
    setActionState(null);
  }

  function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !unitType || !validRoster) return;
    startTransition(async () => {
      const result = editor.team
        ? await updateClubTeam({
            clubTeamId: editor.team.id,
            clubSlug: club.slug,
            name,
            unitType,
            rosterMembershipIds: selectedMemberIds,
          })
        : await createClubTeam({
            clubId: club.id,
            clubSlug: club.slug,
            name,
            unitType,
            rosterMembershipIds: selectedMemberIds,
          });
      setActionState(result);
      if (result.status !== "success" || !result.team) return;
      setTeams((current) => {
        const exists = current.some((team) => team.id === result.team!.id);
        return (exists
          ? current.map((team) => team.id === result.team!.id ? result.team! : team)
          : [...current, result.team!]
        ).sort((left, right) => left.display_order - right.display_order);
      });
      editorDialogRef.current?.close();
      setEditor(null);
    });
  }

  function confirmArchive() {
    if (!archiveState) return;
    startTransition(async () => {
      const result = archiveState.archived
        ? await archiveClubTeam({ clubTeamId: archiveState.team.id, clubSlug: club.slug })
        : await unarchiveClubTeam({ clubTeamId: archiveState.team.id, clubSlug: club.slug });
      setActionState(result);
      if (result.status === "success" && result.team) {
        setTeams((current) => current.map((team) =>
          team.id === result.team!.id ? result.team! : team,
        ));
        setArchiveState(null);
      }
    });
  }

  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader
          title="Club Pairs and Teams"
          description="Reusable named units with a current Club roster"
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-brand-deep"
          >
            Create Pair or Team
          </button>
        ) : null}
      </div>

      <div className="mt-5">{actionMessage(actionState)}</div>

      <section className="mt-6" aria-labelledby="active-club-teams-heading">
        <h2 id="active-club-teams-heading" className="text-lg font-semibold text-foreground">
          Active Pairs and Teams
        </h2>
        <div className="mt-3 space-y-3">
          {activeTeams.length ? activeTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              canManage={canManage}
              onEdit={openEditor}
              onArchive={(selected, archived) => setArchiveState({ team: selected, archived })}
            />
          )) : (
            <Card className="bg-surface-muted p-6 text-sm text-muted-foreground">
              No persistent Club Pairs or Teams have been created yet.
            </Card>
          )}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="archived-club-teams-heading">
        <h2 id="archived-club-teams-heading" className="text-lg font-semibold text-foreground">
          Archived Pairs and Teams
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Archived units keep their historical Competition links and current management metadata.
        </p>
        <div className="mt-3 space-y-3">
          {archivedTeams.length ? archivedTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              canManage={canManage}
              onEdit={openEditor}
              onArchive={(selected, archived) => setArchiveState({ team: selected, archived })}
            />
          )) : (
            <Card className="bg-surface-muted p-6 text-sm text-muted-foreground">
              No archived Pairs or Teams.
            </Card>
          )}
        </div>
      </section>

      <dialog
        ref={editorDialogRef}
        aria-labelledby="club-team-editor-title"
        onCancel={(event) => {
          event.preventDefault();
          closeEditor();
        }}
        className="m-auto w-[min(94vw,42rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form onSubmit={saveEditor} className="p-6 sm:p-7">
          <h2 id="club-team-editor-title" className="text-lg font-semibold">
            {editor?.team ? "Edit Club Pair or Team" : "Create Club Pair or Team"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The roster is the current reusable Club roster. Existing Competition participants are never rewritten.
          </p>

          <label className="mt-5 block text-sm font-semibold text-foreground">
            Name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder={unitType === "pair" ? "Pair 1" : "Team 1"}
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          </label>

          <label className="mt-5 block text-sm font-semibold text-foreground">
            Type
            <select
              value={unitType}
              disabled={Boolean(editor?.team?.unit_type)}
              onChange={(event) => changeUnitType(event.target.value as ClubTeamUnitType | "")}
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:opacity-70"
            >
              <option value="">Choose Pair or Team</option>
              <option value="pair">Pair · exactly 2 shooters</option>
              <option value="team">Team · 3–20 shooters</option>
            </select>
          </label>

          {unitType ? (
            <fieldset className="mt-5">
              <legend className="text-sm font-semibold text-foreground">Current shooters</legend>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {fixedSize
                  ? `This unit has a fixed size of ${fixedSize}. Select exactly ${fixedSize} active Club members.`
                  : unitType === "pair"
                    ? "Select exactly 2 active Club members."
                    : "Select 3–20 active Club members. The selected count becomes the fixed Team size."}
              </p>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-xl border border-border p-3">
                {memberOptions.map((member) => {
                  const checked = selectedMemberIds.includes(member.membership_id);
                  const limit = unitType === "pair" ? 2 : fixedSize ?? 20;
                  const unavailable = member.membership_status !== "active";
                  const disabled = pending || (!checked && (unavailable || selectedMemberIds.length >= limit));
                  return (
                    <label
                      key={member.membership_id}
                      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                        disabled ? "opacity-50" : "cursor-pointer hover:bg-brand-subtle"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleMember(member.membership_id)}
                        className="size-4 accent-brand"
                      />
                      <span className="font-medium text-foreground">{memberName(member)}</span>
                      {unavailable ? <span className="ml-auto text-xs font-semibold text-danger">Inactive</span> : null}
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs font-semibold text-brand-deep">
                {selectedMemberIds.length} selected{requiredCount ? ` · ${requiredCount} required` : ""}
              </p>
            </fieldset>
          ) : null}

          <div className="mt-4">{actionMessage(actionState)}</div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={closeEditor}
              className="min-h-11 rounded-xl border border-border px-5 text-sm font-semibold disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              disabled={pending || !unitType || !validRoster || (Boolean(editor?.team) && !name.trim())}
              className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Saving…" : editor?.team ? "Save changes" : "Create unit"}
            </button>
          </div>
        </form>
      </dialog>

      <ConfirmationDialog
        open={Boolean(archiveState)}
        title={archiveState?.archived ? "Archive Club Pair or Team?" : "Unarchive Club Pair or Team?"}
        description={archiveState?.archived
          ? "The unit will no longer be offered for new Competition entries. Submitted historical entries keep their name and participants. A unit linked to a Draft entry cannot be archived."
          : "The unit will return to management. It is selectable only when its current roster is complete and active."}
        onCancel={() => setArchiveState(null)}
        cancelDisabled={pending}
      >
        <button
          type="button"
          disabled={pending}
          onClick={() => setArchiveState(null)}
          className="min-h-11 rounded-xl border border-border px-5 text-sm font-semibold disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={confirmArchive}
          className={`min-h-11 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-60 ${
            archiveState?.archived ? "bg-danger" : "bg-primary"
          }`}
        >
          {pending ? "Working…" : archiveState?.archived ? "Archive unit" : "Unarchive unit"}
        </button>
      </ConfirmationDialog>
    </>
  );
}
