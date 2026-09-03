"use client";

import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";
import {
  editCompetitionDivisions,
  publishCompetitionDivisions,
  saveCompetitionDivisionDraft,
  type DivisionActionState,
} from "@/app/(app)/division-management-actions";
import { Badge, Card } from "@/components/ui";
import {
  getDivisionEntrantName,
  type CompetitionDivisionManagement,
  type DivisionEntrant,
} from "@/lib/competition-division-types";

type EditableDivision = {
  key: string;
  name: string;
};

type AssignmentState = Record<number, string>;

const UNASSIGNED = "unassigned";

function entrantLabel(entrant: DivisionEntrant) {
  return getDivisionEntrantName(entrant) || `Entrant ${entrant.entry_position}`;
}

function DraggableEntrantCard({
  entrant,
  divisions,
  currentKey,
  editable,
  onMove,
}: {
  entrant: DivisionEntrant;
  divisions: EditableDivision[];
  currentKey: string;
  editable: boolean;
  onMove: (entrantId: number, destination: string) => void;
}) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `entrant-${entrant.id}`,
    data: { entrantId: entrant.id },
    disabled: !editable,
  });

  return (
    <article
      ref={ref}
      className={`rounded-xl border border-border bg-surface p-3 shadow-xs transition ${
        isDragging ? "opacity-45" : ""
      }`}
    >
      <div className="flex min-w-0 items-start gap-2">
        {editable ? (
          <button
            ref={handleRef}
            type="button"
            className="mt-0.5 grid size-8 shrink-0 cursor-grab place-items-center rounded-lg border border-border bg-surface-muted text-sm text-muted-foreground active:cursor-grabbing"
            aria-label={`Drag ${entrantLabel(entrant)}`}
            title="Drag entrant"
          >
            ⠿
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-sm font-semibold leading-5 text-foreground">
            {entrantLabel(entrant)}
          </h4>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {entrant.club_name}
          </p>
        </div>
      </div>

      {editable ? (
        <label className="mt-2.5 block text-[11px] font-medium text-muted-foreground">
          Move to
          <select
            value={currentKey}
            onChange={(event) => onMove(entrant.id, event.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          >
            <option value={UNASSIGNED}>Unassigned</option>
            {divisions.map((division) => (
              <option key={division.key} value={division.key}>
                {division.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </article>
  );
}

function DivisionBucket({
  bucketKey,
  title,
  entrants,
  divisions,
  assignments,
  editable,
  targetSize,
  onMove,
  controls,
}: {
  bucketKey: string;
  title: string;
  entrants: DivisionEntrant[];
  divisions: EditableDivision[];
  assignments: AssignmentState;
  editable: boolean;
  targetSize: number;
  onMove: (entrantId: number, destination: string) => void;
  controls?: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `bucket:${bucketKey}`,
    data: { bucketKey },
    disabled: !editable,
  });
  const isUnassigned = bucketKey === UNASSIGNED;

  return (
    <section
      ref={ref}
      className={`min-w-0 self-start rounded-2xl border bg-surface-muted p-3 transition sm:p-4 ${
        isDropTarget ? "border-brand bg-brand-subtle" : "border-border"
      }`}
    >
      <div className="flex min-h-10 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {entrants.length} entrant{entrants.length === 1 ? "" : "s"}
            {isUnassigned ? "" : ` · target ${targetSize}`}
          </p>
        </div>
        {controls}
      </div>

      <div
        className={`mt-3 space-y-2 overflow-y-auto overscroll-contain pr-1 ${
          isUnassigned
            ? "max-h-[min(62vh,44rem)]"
            : "max-h-[32rem]"
        }`}
      >
        {entrants.map((entrant) => (
          <DraggableEntrantCard
            key={entrant.id}
            entrant={entrant}
            divisions={divisions}
            currentKey={assignments[entrant.id] ?? UNASSIGNED}
            editable={editable}
            onMove={onMove}
          />
        ))}
        {entrants.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-3 py-7 text-center text-xs text-muted-foreground">
            {editable ? "Drop entrant units here" : "No entrants"}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function CompetitionDivisionManager({
  data,
  organisationId,
  leagueSeasonId,
  competitionId,
  backHref,
}: {
  data: CompetitionDivisionManagement;
  organisationId: number;
  leagueSeasonId: number;
  competitionId: number;
  backHref: string;
}) {
  const initialDivisions = data.divisions.map((division) => ({
    key: `saved-${division.id}`,
    name: division.name,
  }));
  const initialAssignments = data.divisions.reduce<AssignmentState>(
    (result, division) => {
      for (const entrantId of division.entrant_ids) {
        result[entrantId] = `saved-${division.id}`;
      }
      return result;
    },
    {},
  );

  const [targetSize, setTargetSize] = useState(data.config?.target_size ?? 10);
  const [divisions, setDivisions] = useState<EditableDivision[]>(initialDivisions);
  const [assignments, setAssignments] =
    useState<AssignmentState>(initialAssignments);
  const [workflowStatus, setWorkflowStatus] = useState(
    data.config?.status ?? "draft",
  );
  const [configured, setConfigured] = useState(Boolean(data.config));
  const [actionState, setActionState] = useState<DivisionActionState>({});
  const [dirty, setDirty] = useState(false);
  const [isPending, startTransition] = useTransition();
  const editable = workflowStatus === "draft";
  const plannedDivisionCount =
    data.entrant_count > 0 ? Math.ceil(data.entrant_count / targetSize) : 0;

  const entrantsByBucket = useMemo(() => {
    const buckets: Record<string, DivisionEntrant[]> = { [UNASSIGNED]: [] };
    for (const division of divisions) buckets[division.key] = [];
    for (const entrant of data.entrants) {
      const bucket = assignments[entrant.id];
      (buckets[bucket] ?? buckets[UNASSIGNED]).push(entrant);
    }
    return buckets;
  }, [assignments, data.entrants, divisions]);

  const unassignedCount = entrantsByBucket[UNASSIGNED]?.length ?? 0;
  const showUnassigned = editable || unassignedCount > 0;
  const publishedIntegrityProblem = !editable && unassignedCount > 0;

  function markChanged() {
    setDirty(true);
    setActionState({});
  }

  function moveEntrant(entrantId: number, destination: string) {
    if (!editable) return;
    if (
      destination !== UNASSIGNED &&
      !divisions.some((division) => division.key === destination)
    ) {
      return;
    }
    setAssignments((current) => ({ ...current, [entrantId]: destination }));
    markChanged();
  }

  function createDivisions() {
    if (
      !editable ||
      data.entrant_count === 0 ||
      plannedDivisionCount > 200
    ) {
      return;
    }
    const count = plannedDivisionCount;
    setDivisions(
      Array.from({ length: count }, (_, index) => ({
        key: `new-${Date.now()}-${index + 1}`,
        name: `Division ${index + 1}`,
      })),
    );
    setAssignments({});
    markChanged();
  }

  function addDivision() {
    if (!editable || divisions.length >= 200) return;
    const nextNumber = divisions.length + 1;
    setDivisions((current) => [
      ...current,
      { key: `new-${Date.now()}-${nextNumber}`, name: `Division ${nextNumber}` },
    ]);
    markChanged();
  }

  function renameDivision(key: string, name: string) {
    setDivisions((current) =>
      current.map((division) =>
        division.key === key ? { ...division, name } : division,
      ),
    );
    markChanged();
  }

  function removeDivision(key: string) {
    if ((entrantsByBucket[key]?.length ?? 0) > 0) {
      setActionState({
        status: "error",
        message: "Move every entrant out of that division before removing it.",
      });
      return;
    }
    setDivisions((current) => current.filter((division) => division.key !== key));
    markChanged();
  }

  function reorderDivision(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= divisions.length) return;
    setDivisions((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    markChanged();
  }

  function draftInput() {
    return {
      organisationId,
      leagueSeasonId,
      competitionId,
      targetSize,
      divisions: divisions.map((division) => ({
        name: division.name.trim(),
        entrant_ids: (entrantsByBucket[division.key] ?? []).map(
          (entrant) => entrant.id,
        ),
      })),
    };
  }

  function runAction(action: "save" | "publish" | "edit") {
    setActionState({});
    startTransition(async () => {
      const result =
        action === "save"
          ? await saveCompetitionDivisionDraft(draftInput())
          : action === "publish"
            ? await publishCompetitionDivisions(draftInput())
            : await editCompetitionDivisions({
                organisationId,
                leagueSeasonId,
                competitionId,
              });
      setActionState(result);
      if (result.status === "success") {
        setDirty(false);
        setConfigured(true);
        if (action === "publish") setWorkflowStatus("published");
        if (action === "edit") setWorkflowStatus("draft");
      }
    });
  }

  return (
    <>
      <Link
        href={backHref}
        className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        ← Back to competition
      </Link>

      <Card className="mt-5 p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={workflowStatus === "published" ? "positive" : "warning"}>
                {configured ? (workflowStatus === "published" ? "Published" : "Draft") : "Not configured"}
              </Badge>
              {dirty ? <Badge tone="neutral">Unsaved changes</Badge> : null}
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-foreground">
              Division management
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Arrange submitted entrant units. Pairs and teams remain together as one card.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:min-w-64">
            <div className="rounded-xl bg-surface-muted p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Entrants</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{data.entrant_count}</dd>
            </div>
            <div className="rounded-xl bg-surface-muted p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Clubs</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{data.club_count}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {workflowStatus === "published" ? (
        <div className="mt-5 rounded-2xl border border-success/20 bg-success-subtle p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
          <div>
            <p className="font-semibold text-success">Published allocation</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This layout is read-only for members. Return it to draft before making changes.
            </p>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("edit")}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:cursor-wait disabled:opacity-60 sm:mt-0"
          >
            {isPending ? "Opening…" : "Edit divisions"}
          </button>
        </div>
      ) : (
        <Card className="mt-5 p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-end">
            <label className="text-sm font-medium text-foreground">
              Target division size
              <input
                type="number"
                min={1}
                max={1000}
                value={targetSize}
                onChange={(event) => {
                  setTargetSize(Math.min(1000, Math.max(1, Number(event.target.value) || 1)));
                  markChanged();
                }}
                className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm tabular-nums text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {divisions.length === 0 ? (
                <button
                  type="button"
                  disabled={data.entrant_count === 0 || plannedDivisionCount > 200}
                  onClick={createDivisions}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create {plannedDivisionCount} divisions
                </button>
              ) : (
                <button
                  type="button"
                  onClick={addDivision}
                  disabled={divisions.length >= 200}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:opacity-50"
                >
                  + Add division
                </button>
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                {plannedDivisionCount > 200
                  ? "Increase the target size; a competition is limited to 200 divisions."
                  : "Planning aid only; uneven divisions are allowed."}
              </p>
            </div>
          </div>
        </Card>
      )}

      {publishedIntegrityProblem ? (
        <div
          className="mt-6 rounded-2xl border border-danger/20 bg-danger-subtle px-5 py-4 text-sm leading-6 text-danger"
          role="alert"
        >
          <strong className="font-semibold">Published allocation problem.</strong>{" "}
          {unassignedCount} eligible entrant{unassignedCount === 1 ? " is" : "s are"}{" "}
          unexpectedly unassigned. Return the allocation to draft and review it.
        </div>
      ) : null}

      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled) return;
          const entrantId = Number(event.operation.source?.data?.entrantId);
          const destination = String(event.operation.target?.data?.bucketKey ?? "");
          if (Number.isSafeInteger(entrantId) && entrantId > 0 && destination) {
            moveEntrant(entrantId, destination);
          }
        }}
      >
        <div
          className={`mt-6 grid min-w-0 gap-5 ${
            showUnassigned
              ? "lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:items-start"
              : "grid-cols-1"
          }`}
        >
          {showUnassigned ? (
            <div className="min-w-0 lg:sticky lg:top-6">
              <DivisionBucket
                bucketKey={UNASSIGNED}
                title="Unassigned"
                entrants={entrantsByBucket[UNASSIGNED] ?? []}
                divisions={divisions}
                assignments={assignments}
                editable={editable}
                targetSize={targetSize}
                onMove={moveEntrant}
              />
            </div>
          ) : null}

          <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {divisions.map((division, index) => (
              <DivisionBucket
                key={division.key}
                bucketKey={division.key}
                title={division.name || "Unnamed division"}
                entrants={entrantsByBucket[division.key] ?? []}
                divisions={divisions}
                assignments={assignments}
                editable={editable}
                targetSize={targetSize}
                onMove={moveEntrant}
                controls={
                  editable ? (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => reorderDivision(index, -1)} disabled={index === 0} aria-label={`Move ${division.name} earlier`} className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-xs disabled:opacity-35">↑</button>
                      <button type="button" onClick={() => reorderDivision(index, 1)} disabled={index === divisions.length - 1} aria-label={`Move ${division.name} later`} className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-xs disabled:opacity-35">↓</button>
                      <button type="button" onClick={() => removeDivision(division.key)} aria-label={`Remove ${division.name}`} className="grid size-8 place-items-center rounded-lg border border-danger/20 bg-danger-subtle text-xs text-danger">×</button>
                    </div>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      </DragDropProvider>

      {editable && divisions.length > 0 ? (
        <Card className="mt-5 p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-foreground">Division names</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {divisions.map((division, index) => (
              <label key={division.key} className="text-xs font-medium text-muted-foreground">
                Division {index + 1}
                <input
                  value={division.name}
                  maxLength={80}
                  onChange={(event) => renameDivision(division.key, event.target.value)}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
                />
              </label>
            ))}
          </div>
        </Card>
      ) : null}

      {actionState.message ? (
        <p
          className={`mt-5 rounded-xl px-4 py-3 text-sm ${actionState.status === "error" ? "bg-danger-subtle text-danger" : "bg-success-subtle text-success"}`}
          role={actionState.status === "error" ? "alert" : "status"}
        >
          {actionState.message}
        </p>
      ) : null}

      {editable ? (
        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("save")}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:cursor-wait disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            disabled={isPending || divisions.length === 0 || unassignedCount > 0 || !data.entry_window_closed}
            onClick={() => runAction("publish")}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            Publish divisions
          </button>
        </div>
      ) : null}

      {editable && !data.entry_window_closed ? (
        <p className="mt-3 text-right text-xs text-muted-foreground">
          Publication unlocks after the entry window closes. Drafts can be saved now.
        </p>
      ) : editable && unassignedCount > 0 ? (
        <p className="mt-3 text-right text-xs text-muted-foreground">
          Assign all {unassignedCount} remaining entrant{unassignedCount === 1 ? "" : "s"} before publishing.
        </p>
      ) : null}
    </>
  );
}
