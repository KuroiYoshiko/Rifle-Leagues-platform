"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import {
  archiveClubTeam,
  createClubTeam,
  renameClubTeam,
  unarchiveClubTeam,
  type ClubTeamActionState,
  type ClubTeamMutation,
} from "@/app/(app)/clubs/[slug]/teams/actions";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Badge, Card, SectionHeader } from "@/components/ui";
import type { Club } from "@/lib/clubs";
import type { ClubTeam } from "@/lib/club-teams";

type EditorState = { mode: "create" | "rename"; team: ClubTeam | null };
type ArchiveState = { team: ClubTeam; archived: boolean };

function mergeTeam(current: ClubTeam, mutation: ClubTeamMutation): ClubTeam {
  return {
    ...current,
    ...mutation,
    competition_usage_count:
      mutation.competition_usage_count ?? current.competition_usage_count,
    submitted_usage_count:
      mutation.submitted_usage_count ?? current.submitted_usage_count,
    created_at: mutation.created_at ?? current.created_at,
  };
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

function TeamCard({
  team,
  canManage,
  onRename,
  onArchive,
}: {
  team: ClubTeam;
  canManage: boolean;
  onRename: (team: ClubTeam) => void;
  onArchive: (team: ClubTeam, archived: boolean) => void;
}) {
  const archived = Boolean(team.archived_at);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-semibold text-foreground">{team.name}</h3>
            <Badge tone={archived ? "neutral" : "positive"}>
              {archived ? "Archived" : "Active"}
            </Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {team.submitted_usage_count > 0
              ? `${team.submitted_usage_count} submitted Competition ${team.submitted_usage_count === 1 ? "entry" : "entries"}`
              : "No submitted Competition history yet"}
          </p>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onRename(team)}
              className="min-h-10 rounded-xl border border-border px-4 text-xs font-semibold text-brand-deep hover:bg-brand-subtle"
            >
              Rename
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

export function ClubTeamsManager({
  club,
  initialTeams,
  canManage,
}: {
  club: Pick<Club, "id" | "name" | "slug">;
  initialTeams: ClubTeam[];
  canManage: boolean;
}) {
  const editorDialogRef = useRef<HTMLDialogElement>(null);
  const [teams, setTeams] = useState(initialTeams);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [archiveState, setArchiveState] = useState<ArchiveState | null>(null);
  const [name, setName] = useState("");
  const [actionState, setActionState] = useState<ClubTeamActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const activeTeams = teams.filter((team) => !team.archived_at);
  const archivedTeams = teams.filter((team) => team.archived_at);

  function openEditor(next: EditorState) {
    setEditor(next);
    setName(next.team?.name ?? "");
    setActionState(null);
    editorDialogRef.current?.showModal();
  }

  function closeEditor() {
    if (pending) return;
    editorDialogRef.current?.close();
    setEditor(null);
  }

  function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    startTransition(async () => {
      const result = editor.mode === "create"
        ? await createClubTeam({ clubId: club.id, clubSlug: club.slug, name })
        : await renameClubTeam({
            clubTeamId: editor.team!.id,
            clubSlug: club.slug,
            name,
          });
      setActionState(result);
      if (result.status !== "success" || !result.team) return;

      setTeams((current) => {
        const existing = current.find((team) => team.id === result.team!.id);
        if (existing) {
          return current.map((team) =>
            team.id === result.team!.id ? mergeTeam(team, result.team!) : team,
          );
        }
        return [...current, {
          ...result.team!,
          competition_usage_count: result.team!.competition_usage_count ?? 0,
          submitted_usage_count: result.team!.submitted_usage_count ?? 0,
          created_at: result.team!.created_at ?? new Date().toISOString(),
        }].sort((left, right) => left.display_order - right.display_order);
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
          team.id === result.team!.id ? mergeTeam(team, result.team!) : team,
        ));
        setArchiveState(null);
      }
    });
  }

  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader
          title="Club Teams"
          description="Persistent Team identities that can be reused across Competition editions"
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => openEditor({ mode: "create", team: null })}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-brand-deep"
          >
            Create Team
          </button>
        ) : null}
      </div>

      <div className="mt-5">{actionMessage(actionState)}</div>

      <section className="mt-6" aria-labelledby="active-club-teams-heading">
        <h2 id="active-club-teams-heading" className="text-lg font-semibold text-foreground">
          Active Teams
        </h2>
        <div className="mt-3 space-y-3">
          {activeTeams.length ? activeTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              canManage={canManage}
              onRename={(selected) => openEditor({ mode: "rename", team: selected })}
              onArchive={(selected, archived) => setArchiveState({ team: selected, archived })}
            />
          )) : (
            <Card className="bg-surface-muted p-6 text-sm text-muted-foreground">
              No persistent Club Teams have been created yet.
            </Card>
          )}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="archived-club-teams-heading">
        <h2 id="archived-club-teams-heading" className="text-lg font-semibold text-foreground">
          Archived Teams
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Archived Teams keep their historical Competition links and names.
        </p>
        <div className="mt-3 space-y-3">
          {archivedTeams.length ? archivedTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              canManage={canManage}
              onRename={(selected) => openEditor({ mode: "rename", team: selected })}
              onArchive={(selected, archived) => setArchiveState({ team: selected, archived })}
            />
          )) : (
            <Card className="bg-surface-muted p-6 text-sm text-muted-foreground">
              No archived Teams.
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
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form onSubmit={saveEditor} className="p-6 sm:p-7">
          <h2 id="club-team-editor-title" className="text-lg font-semibold">
            {editor?.mode === "rename" ? "Rename Club Team" : "Create Club Team"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {editor?.mode === "rename"
              ? "Submitted Competition entries keep their original Team-name snapshot."
              : "Leave the name blank to use the next available Team number."}
          </p>
          <label className="mt-5 block text-sm font-semibold text-foreground">
            Team name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="Team 1"
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          </label>
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
              disabled={pending}
              className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Saving…" : editor?.mode === "rename" ? "Save name" : "Create Team"}
            </button>
          </div>
        </form>
      </dialog>

      <ConfirmationDialog
        open={Boolean(archiveState)}
        title={archiveState?.archived ? "Archive Club Team?" : "Unarchive Club Team?"}
        description={archiveState?.archived
          ? "The Team will no longer be offered for new Competition entries. Submitted historical entries keep their snapshot. A Team linked to a Draft entry cannot be archived."
          : "The Team will become available for new Team-format Competition entries again."}
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
          {pending ? "Working…" : archiveState?.archived ? "Archive Team" : "Unarchive Team"}
        </button>
      </ConfirmationDialog>
    </>
  );
}
