"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  createConcurrentShootingGroup,
  mutateConcurrentShootingGroup,
  type ConcurrentShootingActionState,
} from "@/app/(app)/organisations/[slug]/concurrent-shooting-actions";
import { Badge, Card, SectionHeader } from "@/components/ui";
import type {
  ConcurrentShootingCandidate,
  ConcurrentShootingGroupListItem,
  ConcurrentShootingLifecycle,
  ConcurrentShootingStatus,
  ConcurrentShootingWorkspace,
} from "@/lib/concurrent-shooting";
import type { LeagueSeason } from "@/lib/league-seasons";

const initialState: ConcurrentShootingActionState = {};
const fieldClass = "min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const dangerButton = "inline-flex min-h-10 items-center justify-center rounded-xl border border-danger/30 bg-danger-subtle px-4 text-sm font-semibold text-danger transition hover:border-danger/50 disabled:cursor-not-allowed disabled:opacity-50";
const activatedDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function getCompetitionEntryFormatLabel(value: string) {
  return value === "individual" ? "Individual" : value === "pairs" ? "Pairs" : "Team";
}

function getCompetitionRankingMethodLabel(value: string) {
  if (value === "aggregate") return "Aggregate points";
  if (value === "best_n_average") return "Best N rounds average";
  if (value === "round_robin") return "Round robin";
  return "Gun score";
}

function CommonFields({ organisation, groupId }: {
  organisation: { id: number; slug: string };
  groupId: number;
}) {
  return <>
    <input type="hidden" name="organisation_id" value={organisation.id} />
    <input type="hidden" name="organisation_slug" value={organisation.slug} />
    <input type="hidden" name="concurrent_group_id" value={groupId} />
  </>;
}

function SubmitButton({ label, pendingLabel, tone = "secondary" }: {
  label: string;
  pendingLabel: string;
  tone?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  return <button
    type="submit"
    disabled={pending}
    className={tone === "primary" ? primaryButton : tone === "danger" ? dangerButton : secondaryButton}
  >{pending ? pendingLabel : label}</button>;
}

function ActionMessage({ state }: { state: ConcurrentShootingActionState }) {
  return state.message ? <p
    role={state.status === "error" ? "alert" : "status"}
    className={`mt-2 text-sm ${state.status === "error" ? "text-danger" : "text-success"}`}
  >{state.message}</p> : null;
}

function MutationForm({
  organisation,
  groupId,
  operation,
  children,
  submitLabel,
  pendingLabel,
  tone,
  className = "",
  confirmMessage,
}: {
  organisation: { id: number; slug: string };
  groupId: number;
  operation: string;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  tone?: "primary" | "secondary" | "danger";
  className?: string;
  confirmMessage?: string;
}) {
  const [state, action] = useActionState(mutateConcurrentShootingGroup, initialState);
  return <form
    action={action}
    className={className}
    onSubmit={confirmMessage ? (event) => {
      if (!window.confirm(confirmMessage)) event.preventDefault();
    } : undefined}
  >
    <CommonFields organisation={organisation} groupId={groupId} />
    <input type="hidden" name="operation" value={operation} />
    {children}
    <SubmitButton label={submitLabel} pendingLabel={pendingLabel} tone={tone} />
    <ActionMessage state={state} />
  </form>;
}

function statusTone(status: ConcurrentShootingStatus) {
  return status === "active" ? "positive" as const
    : status === "draft" ? "warning" as const
      : "neutral" as const;
}

function statusLabel(status: ConcurrentShootingStatus) {
  return status[0].toUpperCase() + status.slice(1);
}

export function ConcurrentShootingCreateForm({ organisation, seasons }: {
  organisation: { id: number; slug: string };
  seasons: LeagueSeason[];
}) {
  const [state, action, pending] = useActionState(createConcurrentShootingGroup, initialState);
  if (!seasons.length) return <Card className="bg-surface-muted p-6">
    <h2 className="font-semibold text-foreground">No eligible Seasons</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Create an upcoming Season before preparing Concurrent Shooting.</p>
  </Card>;
  return <form action={action} className="space-y-6">
    <input type="hidden" name="organisation_id" value={organisation.id} />
    <input type="hidden" name="organisation_slug" value={organisation.slug} />
    <Card className="p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">Step 1 · Basic details</p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground">Create a Draft group</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Concurrent Shooting lets one physical shooter score count in several physically eligible Competitions. The organiser still selects the Competitions and explicitly maps the Rounds that represent the same shoot.</p>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-foreground">Season</span>
          <select name="league_season_id" required disabled={pending} defaultValue="" className={`mt-2 ${fieldClass}`}>
            <option value="" disabled>Choose a Season</option>
            {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-foreground">Group name</span>
          <input name="group_name" required minLength={2} maxLength={160} disabled={pending} placeholder="Winter Short Range Shared Shooting" className={`mt-2 ${fieldClass}`} />
        </label>
      </div>
      <div className="mt-6"><button type="submit" disabled={pending} className={primaryButton}>{pending ? "Creating Draft…" : "Create Draft and continue"}</button></div>
      <ActionMessage state={state} />
    </Card>
  </form>;
}

export type ConcurrentShootingListRow = ConcurrentShootingGroupListItem & {
  season_name: string;
  lifecycle: ConcurrentShootingLifecycle;
};

function GroupCard({ organisation, group, isOwner }: {
  organisation: { id: number; slug: string };
  group: ConcurrentShootingListRow;
  isOwner: boolean;
}) {
  const href = `/organisations/${organisation.slug}/management/concurrent-shooting/${group.id}`;
  return <Card className="p-5 sm:p-6">
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(group.status)}>{statusLabel(group.status)}</Badge>
          <span className="text-xs text-muted-foreground">{group.season_name}</span>
        </div>
        <h3 className="mt-3 break-words text-lg font-semibold text-foreground">{group.name}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{group.member_count} linked Competition{group.member_count === 1 ? "" : "s"} · {group.physical_round_count} shared physical Round{group.physical_round_count === 1 ? "" : "s"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={href} className={secondaryButton}>{group.status === "draft" ? "Open Draft" : "View"}</Link>
        {group.status === "draft" ? <MutationForm
          organisation={organisation}
          groupId={group.id}
          operation="delete_group"
          submitLabel="Delete"
          pendingLabel="Deleting…"
          tone="danger"
          confirmMessage={`Delete Draft Concurrent Shooting group “${group.name}”?`}
        /> : null}
        {group.status === "active" && isOwner && group.lifecycle.can_cancel_activation ? <MutationForm
          organisation={organisation}
          groupId={group.id}
          operation="cancel"
          submitLabel="Cancel activation"
          pendingLabel="Cancelling…"
          confirmMessage="Return this unused Active group to Draft?"
        /> : null}
        {group.status === "active" && isOwner ? <MutationForm
          organisation={organisation}
          groupId={group.id}
          operation="archive"
          submitLabel="Archive"
          pendingLabel="Archiving…"
          confirmMessage="Archive this Concurrent Shooting group and preserve its configuration?"
        /> : null}
      </div>
    </div>
  </Card>;
}

export function ConcurrentShootingGroupList({ organisation, groups, isOwner }: {
  organisation: { id: number; slug: string };
  groups: ConcurrentShootingListRow[];
  isOwner: boolean;
}) {
  if (!groups.length) return <Card className="border-dashed bg-surface-muted p-7 text-center sm:p-10">
    <h2 className="text-lg font-semibold text-foreground">No Concurrent Shooting groups yet</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Create a Draft to select Competitions with the same structured physical Course of Fire, then explicitly map the Rounds they share.</p>
    <Link href={`/organisations/${organisation.slug}/management/concurrent-shooting/new`} className={`mt-5 ${primaryButton}`}>Create Concurrent Shooting Group</Link>
  </Card>;
  const sections: Array<{ status: ConcurrentShootingStatus; title: string }> = [
    { status: "draft", title: "Draft" },
    { status: "active", title: "Active" },
    { status: "archived", title: "Archived" },
  ];
  return <div className="space-y-10">{sections.map((section) => {
    const rows = groups.filter((group) => group.status === section.status);
    if (!rows.length) return null;
    return <section key={section.status} aria-labelledby={`concurrent-${section.status}-heading`}>
      <SectionHeader title={section.title} description={`${rows.length} group${rows.length === 1 ? "" : "s"}`} />
      <div className="space-y-3">{rows.map((group) => <GroupCard key={group.id} organisation={organisation} group={group} isOwner={isOwner} />)}</div>
    </section>;
  })}</div>;
}

function mismatchMessage(candidate: ConcurrentShootingCandidate) {
  if (candidate.status !== "published") return "Publish this Competition before adding it.";
  if (!candidate.has_course_of_fire) return "Complete its Course of Fire before adding it.";
  if (!candidate.physical_details_configured) return "Physical shooting details required.";
  if (candidate.existing_group_id && !candidate.selected) return `Already belongs to ${candidate.existing_group_name ?? "another Concurrent Shooting group"}.`;
  const labels: Record<string, string> = {
    physical_details: "physical shooting details are incomplete",
    equipment: "equipment differs",
    sets_per_round: "sets per Round differ",
    component_count: "component count differs",
    components: "component structure, labels, maximums, or scoring methods differ",
    component_positions: "component position / style differs",
    component_distances: "component distance differs",
    component_shots: "component shot count differs",
    uses_x_score: "X scoring differs",
    shots_per_round: "shots per Round differ",
    shooter_maximum: "shooter maximum differs",
  };
  const reasons = candidate.compatibility_mismatches.map((item) => labels[item] ?? "Course of Fire differs");
  return reasons.length ? `Physical eligibility mismatch: ${reasons.join("; ")}.` : null;
}

function CandidateCard({ organisation, groupId, candidate, editable }: {
  organisation: { id: number; slug: string };
  groupId: number;
  candidate: ConcurrentShootingCandidate;
  editable: boolean;
}) {
  const reason = mismatchMessage(candidate);
  return <Card className={`p-4 sm:p-5 ${candidate.selected ? "border-brand/40 bg-brand-subtle/30" : ""}`}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-foreground">{candidate.name}</h3>
          <Badge tone={candidate.selected ? "brand" : candidate.selectable ? "positive" : "neutral"}>{candidate.selected ? "Selected" : candidate.selectable ? "Eligible for Concurrent Shooting" : "Unavailable"}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{getCompetitionEntryFormatLabel(candidate.entry_format)} · {candidate.number_of_rounds} Round{candidate.number_of_rounds === 1 ? "" : "s"} · {getCompetitionRankingMethodLabel(candidate.ranking_method)}</p>
        {reason ? <p className="mt-2 text-sm leading-5 text-warning">{reason}</p> : null}
      </div>
      {editable && (candidate.selected || candidate.selectable) ? <MutationForm
        organisation={organisation}
        groupId={groupId}
        operation={candidate.selected ? "remove_competition" : "add_competition"}
        submitLabel={candidate.selected ? "Remove" : "Add Competition"}
        pendingLabel={candidate.selected ? "Removing…" : "Adding…"}
        tone={candidate.selected ? "danger" : "secondary"}
        className="shrink-0"
        confirmMessage={candidate.selected ? `Remove ${candidate.name} and all of its Draft Round mappings?` : undefined}
      ><input type="hidden" name="competition_id" value={candidate.competition_id} /></MutationForm> : null}
    </div>
  </Card>;
}

function independentRounds(workspace: ConcurrentShootingWorkspace, competitionId: number) {
  const mapped = new Set(workspace.physical_rounds.flatMap((physical) => physical.mappings
    .filter((mapping) => mapping.competition_id === competitionId)
    .map((mapping) => mapping.competition_round_id)));
  return (workspace.roundsByCompetition[String(competitionId)] ?? [])
    .filter((round) => !mapped.has(round.id));
}

function MappingCards({ organisation, workspace, editable }: {
  organisation: { id: number; slug: string };
  workspace: ConcurrentShootingWorkspace;
  editable: boolean;
}) {
  if (!workspace.physical_rounds.length) return <Card className="border-dashed bg-surface-muted p-6">
    <p className="text-sm text-muted-foreground">No shared physical Rounds have been added. Round numbers are never linked automatically.</p>
  </Card>;
  return <div className="space-y-4">{workspace.physical_rounds.map((physical) => <Card key={physical.id} className="overflow-hidden">
    <div className="border-b border-border bg-surface-muted p-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">Shared {physical.position}</p><h3 className="mt-1 font-semibold text-foreground">{physical.label || `Shared physical Round ${physical.position}`}</h3></div>
        {editable ? <div className="flex flex-col gap-2 sm:flex-row">
          <MutationForm organisation={organisation} groupId={workspace.group.id} operation="update_round" submitLabel="Save label" pendingLabel="Saving…" className="flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="physical_round_id" value={physical.id} /><input type="hidden" name="position" value={physical.position} />
            <label><span className="sr-only">Shared Round label</span><input name="round_label" maxLength={160} defaultValue={physical.label ?? ""} placeholder="Optional label" className={fieldClass} /></label>
          </MutationForm>
          <MutationForm organisation={organisation} groupId={workspace.group.id} operation="delete_round" submitLabel="Remove" pendingLabel="Removing…" tone="danger" confirmMessage={`Remove Shared ${physical.position} and all its Draft mappings?`}>
            <input type="hidden" name="physical_round_id" value={physical.id} />
          </MutationForm>
        </div> : null}
      </div>
    </div>
    <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">{workspace.members.map((member) => {
      const selected = physical.mappings.find((mapping) => mapping.competition_id === member.competition_id);
      const rounds = workspace.roundsByCompetition[String(member.competition_id)] ?? [];
      const usedElsewhere = new Set(workspace.physical_rounds.filter((item) => item.id !== physical.id)
        .flatMap((item) => item.mappings.filter((mapping) => mapping.competition_id === member.competition_id).map((mapping) => mapping.competition_round_id)));
      return <div key={member.competition_id} className="rounded-xl border border-border bg-surface p-4">
        <h4 className="text-sm font-semibold text-foreground">{member.name}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{getCompetitionEntryFormatLabel(member.entry_format)}</p>
        {editable ? <MutationForm organisation={organisation} groupId={workspace.group.id} operation="set_mapping" submitLabel="Save mapping" pendingLabel="Saving…" className="mt-3">
          <input type="hidden" name="physical_round_id" value={physical.id} /><input type="hidden" name="competition_id" value={member.competition_id} />
          <label><span className="sr-only">Competition Round for {member.name}</span><select name="competition_round_id" defaultValue={selected?.competition_round_id ?? ""} className={fieldClass}>
            <option value="">Independent / not mapped</option>
            {rounds.map((round) => <option key={round.id} value={round.id} disabled={usedElsewhere.has(round.id)}>Round {round.round_number}{usedElsewhere.has(round.id) ? " · already mapped" : ""}</option>)}
          </select></label>
        </MutationForm> : <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm font-medium text-foreground">{selected ? `Competition Round ${selected.round_number}` : "Independent"}</p>}
      </div>;
    })}</div>
  </Card>)}</div>;
}

function Review({ workspace, seasonName }: {
  workspace: ConcurrentShootingWorkspace;
  seasonName: string;
}) {
  const candidateById = new Map(workspace.candidates.map((candidate) => [candidate.competition_id, candidate]));
  const entryFormats = new Set(workspace.members.map((member) => member.entry_format));
  const rankingMethods = new Set(workspace.members.map((member) => candidateById.get(member.competition_id)?.ranking_method).filter(Boolean));
  const schedules = new Set(workspace.members.map((member) => JSON.stringify((workspace.roundsByCompetition[String(member.competition_id)] ?? []).map((round) => [round.deadline, round.shoot_by_date]))));
  const compatible = workspace.members.every((member) => member.compatibility_mismatches.length === 0);
  const validPhysicalRounds = workspace.physical_rounds.filter((physical) => new Set(physical.mappings.map((mapping) => mapping.competition_id)).size >= 2).length;
  return <Card className="p-5 sm:p-7">
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="font-semibold text-foreground">{workspace.group.name}</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <div><dt className="text-muted-foreground">Season</dt><dd className="mt-1 font-semibold text-foreground">{seasonName}</dd></div>
          <div>
            <dt className="text-muted-foreground">Competitions</dt>
            <dd className="mt-1">
              <span className="font-semibold text-foreground">{workspace.members.length} selected</span>
              <ul className="mt-2 space-y-1 text-muted-foreground">{workspace.members.map((member) => <li key={member.competition_id}>✓ {member.name}</li>)}</ul>
            </dd>
          </div>
          <div><dt className="text-muted-foreground">Physical eligibility</dt><dd className={`mt-1 font-semibold ${compatible ? "text-success" : "text-warning"}`}>{compatible ? "✓ Eligible for Concurrent Shooting" : "Review physical or scoring differences"}</dd></div>
          <div><dt className="text-muted-foreground">Shared physical Rounds</dt><dd className="mt-1 font-semibold text-foreground">{workspace.physical_rounds.length} configured · {validPhysicalRounds} ready</dd></div>
        </dl>
      </div>
      <div>
        <h3 className="font-semibold text-foreground">Independent Competition Rounds</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">{workspace.members.map((member) => {
          const rounds = independentRounds(workspace, member.competition_id);
          return <li key={member.competition_id}><span className="font-medium text-foreground">{member.name}:</span> {rounds.length ? rounds.map((round) => round.round_number).join(", ") : "None"}</li>;
        })}</ul>
      </div>
    </div>
    <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
      {entryFormats.size > 1 ? <Badge tone="brand">Entry formats differ</Badge> : null}
      {rankingMethods.size > 1 ? <Badge tone="brand">Ranking methods differ</Badge> : null}
      {schedules.size > 1 ? <Badge tone="brand">Round release dates differ</Badge> : null}
    </div>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Entry format, ranking, unmapped Rounds, and Round release dates remain Competition-specific.</p>
  </Card>;
}

function cancelExplanation(lifecycle: ConcurrentShootingLifecycle) {
  if (lifecycle.cancel_block_reason === "competition_started") return "Activation cannot be cancelled because at least one linked Competition has started.";
  if (lifecycle.cancel_block_reason === "score_provenance") return "Activation cannot be cancelled because shared score provenance already exists.";
  return null;
}

export function ConcurrentShootingWorkspaceView({ organisation, seasonName, workspace, isOwner }: {
  organisation: { id: number; slug: string };
  seasonName: string;
  workspace: ConcurrentShootingWorkspace;
  isOwner: boolean;
}) {
  const editable = workspace.group.status === "draft";
  const nextPosition = Math.max(0, ...workspace.physical_rounds.map((round) => round.position)) + 1;
  const cancellationNote = cancelExplanation(workspace.lifecycle);
  const hasEligibleCompetition = workspace.candidates.some((candidate) => candidate.selected || candidate.selectable);
  const displayedCandidates = editable
    ? workspace.candidates
    : workspace.candidates.filter((candidate) => candidate.selected);
  return <div className="space-y-10">
    <section aria-labelledby="concurrent-basic-heading">
      <SectionHeader title="1. Basic details" description={`Season: ${seasonName}`} />
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(workspace.group.status)}>{statusLabel(workspace.group.status)}</Badge>{workspace.group.activated_at ? <span className="text-xs text-muted-foreground">Activated {activatedDateFormatter.format(new Date(workspace.group.activated_at))}</span> : null}</div>
        {editable ? <MutationForm organisation={organisation} groupId={workspace.group.id} operation="rename" submitLabel="Save name" pendingLabel="Saving…" className="mt-4 flex max-w-3xl flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1"><span className="sr-only">Concurrent Shooting group name</span><input name="group_name" required minLength={2} maxLength={160} defaultValue={workspace.group.name} className={fieldClass} /></label>
        </MutationForm> : <h2 id="concurrent-basic-heading" className="mt-3 text-xl font-semibold text-foreground">{workspace.group.name}</h2>}
        {!editable ? <p className="mt-3 text-sm text-muted-foreground">This configuration is read-only and remains the historical source of its explicit shared Round mappings.</p> : null}
      </Card>
    </section>

    <section aria-labelledby="concurrent-competitions-heading">
      <SectionHeader title="2. Select Competitions" description="At least two published Competitions with the same Course of Fire are required" />
      <p className="mb-4 rounded-xl border border-brand/20 bg-brand-subtle px-4 py-3 text-sm leading-6 text-brand-deep">Eligibility is based on the structured physical Course of Fire—not Competition names. Individual, Pair, and Team Competitions can be linked when their physical and scoring definitions match.</p>
      {!hasEligibleCompetition ? <Card className="mb-4 border-dashed bg-surface-muted p-5"><p className="text-sm text-muted-foreground">No published Competition in this Season is currently eligible. Publish at least two Competitions with matching scoring and complete physical shooting details, then return here.</p></Card> : null}
      {displayedCandidates.length ? <div className="space-y-3">{displayedCandidates.map((candidate) => <CandidateCard key={candidate.competition_id} organisation={organisation} groupId={workspace.group.id} candidate={candidate} editable={editable} />)}</div> : <Card className="bg-surface-muted p-6"><p className="text-sm text-muted-foreground">There are no Competitions in this Season yet.</p></Card>}
    </section>

    <section aria-labelledby="concurrent-rounds-heading">
      <SectionHeader title="3. Map shared physical Rounds" description="Choose every mapping explicitly; equal Round numbers are not linked automatically" action={editable ? <MutationForm organisation={organisation} groupId={workspace.group.id} operation="create_round" submitLabel="Add shared Round" pendingLabel="Adding…">
        <input type="hidden" name="position" value={nextPosition} /><input type="hidden" name="round_label" value="" />
      </MutationForm> : undefined} />
      <MappingCards organisation={organisation} workspace={workspace} editable={editable} />
    </section>

    <section aria-labelledby="concurrent-review-heading">
      <SectionHeader title="4. Review" description="Confirm shared and independent Competition behaviour" />
      <Review workspace={workspace} seasonName={seasonName} />
    </section>

    <section aria-labelledby="concurrent-lifecycle-heading">
      <SectionHeader title={editable ? "5. Activation" : "Lifecycle"} />
      <Card className="p-5 sm:p-6">
        {editable ? <>
          <p className="text-sm leading-6 text-muted-foreground">Activation locks membership and Round mappings. Scores entered for mapped Rounds become one physical score across linked Competition usages, while Competition Results and release dates remain independent.</p>
          <div className="mt-5">{isOwner ? <MutationForm organisation={organisation} groupId={workspace.group.id} operation="activate" submitLabel="Activate Concurrent Shooting" pendingLabel="Activating…" tone="primary" confirmMessage="Activate and lock this Concurrent Shooting configuration?" /> : <div className="rounded-xl border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">This Draft is ready for preparation, but an Organisation owner must activate it.</div>}</div>
        </> : workspace.group.status === "active" ? <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="font-semibold text-foreground">Active configuration</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Membership and shared Round mappings are locked.</p>{cancellationNote ? <p className="mt-2 text-sm text-warning">{cancellationNote}</p> : null}</div>
          {isOwner ? <div className="flex flex-wrap gap-2">{workspace.lifecycle.can_cancel_activation ? <MutationForm organisation={organisation} groupId={workspace.group.id} operation="cancel" submitLabel="Cancel activation" pendingLabel="Cancelling…" confirmMessage="Return this unused Active group to Draft?" /> : null}<MutationForm organisation={organisation} groupId={workspace.group.id} operation="archive" submitLabel="Archive" pendingLabel="Archiving…" confirmMessage="Archive this group while preserving all historical configuration?" /></div> : null}
        </div> : <div><h3 className="font-semibold text-foreground">Archived configuration</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">This historical configuration is preserved and cannot be edited or reactivated.</p></div>}
      </Card>
    </section>

    {editable ? <section aria-label="Delete Draft group"><Card className="border-danger/20 p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-foreground">Delete Draft group</h3><p className="mt-1 text-sm text-muted-foreground">This removes only the unused Draft configuration.</p></div><MutationForm organisation={organisation} groupId={workspace.group.id} operation="delete_group" submitLabel="Delete Draft" pendingLabel="Deleting…" tone="danger" confirmMessage={`Delete Draft Concurrent Shooting group “${workspace.group.name}”?`} /></div></Card></section> : null}
  </div>;
}
