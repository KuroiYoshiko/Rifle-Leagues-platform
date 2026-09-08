"use client";

import { useActionState } from "react";
import {
  calculateCompetitionStartingAverages,
  finaliseCompetitionStartingAverages,
  setCompetitionAverageSettings,
  setManualStartingAverage,
  type AverageActionState,
  type ManualStartingAverageState,
  type StartingAverageCalculationState,
  type StartingAveragePreviewRow,
} from "@/app/(app)/organisations/[slug]/average-actions";
import {
  formatAverageMaximum,
  getAveragePolicyStrategyLabel,
  type AverageConfiguration,
  type CompetitionAverageManagement,
  type StartingAverageParticipant,
} from "@/lib/competition-average-types";
import { Badge, Card, SectionHeader } from "@/components/ui";

const initialState: AverageActionState = {};
const initialCalculationState: StartingAverageCalculationState = {};
const initialManualState: ManualStartingAverageState = {};
const inputClassName = "mt-2 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:bg-surface-muted disabled:opacity-60";

type CompetitionIdentity = {
  id: number;
  name: string;
  slug: string;
  status: string;
  shooterMaximum: number;
};

function CompetitionFields({ organisation, season, competition }: {
  organisation: { id: number; slug: string };
  season: { id: number; slug: string };
  competition: CompetitionIdentity;
}) {
  return <>
    <input type="hidden" name="organisation_id" value={organisation.id} />
    <input type="hidden" name="organisation_slug" value={organisation.slug} />
    <input type="hidden" name="league_season_id" value={season.id} />
    <input type="hidden" name="season_slug" value={season.slug} />
    <input type="hidden" name="competition_id" value={competition.id} />
    <input type="hidden" name="competition_slug" value={competition.slug} />
  </>;
}

function StatusMessage({ state }: { state: AverageActionState }) {
  return state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`mt-3 text-sm leading-5 ${state.status === "error" ? "text-danger" : "text-success"}`}>{state.message}</p> : null;
}

function CompetitionSettings({ organisation, season, competition, configuration, management }: {
  organisation: { id: number; slug: string };
  season: { id: number; slug: string };
  competition: CompetitionIdentity;
  configuration: AverageConfiguration;
  management: CompetitionAverageManagement;
}) {
  const [state, action, pending] = useActionState(setCompetitionAverageSettings, initialState);
  const compatibleContexts = configuration.contexts.filter((context) =>
    !context.archived_at && context.basis_maximum === competition.shooterMaximum);
  const activePolicies = configuration.policies.filter((policy) => !policy.archived_at);
  const current = management.setting;
  const currentUnavailable = Boolean(current && (current.context?.archived_at || current.policy?.archived_at));
  const readOnly = Boolean(management.finalisedAt) || management.hasFrozenStartingAverages;

  return <section aria-labelledby="competition-average-settings-heading">
    <SectionHeader title="Competition Average setup" description="The authoritative Context, Policy, and history contribution for this edition" />
    <Card className="p-5 sm:p-6">
      {current ? <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Average Context</dt><dd className="mt-1 font-semibold text-foreground">{current.context?.name ?? "Unavailable"}{current.context ? ` · ${formatAverageMaximum(current.context.basis_maximum)}` : ""}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Policy</dt><dd className="mt-1 font-semibold text-foreground">{current.policy && current.policyVersion ? `${current.policy.name} · ${getAveragePolicyStrategyLabel(current.policyVersion.strategy)} · v${current.policyVersion.version_number}` : "Unavailable"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Contributes to history</dt><dd className="mt-1 font-semibold text-foreground">{current.contributes_to_history ? "Yes" : "No"}</dd></div>
      </dl> : <p className="text-sm text-muted-foreground">This Competition has no Starting Average setup.</p>}

      {readOnly ? <p className="mt-4 rounded-xl border border-warning/20 bg-warning-subtle p-4 text-sm text-warning">These settings are read-only because Starting Averages were finalised for this Competition.</p> : <form action={action} className="mt-5 space-y-4 border-t border-border pt-5">
        <CompetitionFields organisation={organisation} season={season} competition={competition} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-foreground">Average Context<select name="average_context_id" required defaultValue={current?.average_context_id ?? ""} disabled={pending} className={inputClassName}><option value="">Choose Context</option>{current?.context?.archived_at ? <option value={current.context.id} disabled>{current.context.name} · {formatAverageMaximum(current.context.basis_maximum)} · Archived</option> : null}{compatibleContexts.map((context) => <option key={context.id} value={context.id}>{context.name} · {formatAverageMaximum(context.basis_maximum)}</option>)}</select></label>
          <label className="text-sm font-medium text-foreground">Average Policy<select name="average_policy_version_id" required defaultValue={current?.average_policy_version_id ?? ""} disabled={pending} className={inputClassName}><option value="">Choose Policy</option>{current?.policy?.archived_at && current.policyVersion ? <option value={current.policyVersion.id} disabled>{current.policy.name} · v{current.policyVersion.version_number} · Archived</option> : null}{activePolicies.map((policy) => <option key={policy.latestVersion.id} value={policy.latestVersion.id}>{policy.name} · {getAveragePolicyStrategyLabel(policy.latestVersion.strategy)} · v{policy.latestVersion.version_number}</option>)}</select></label>
        </div>
        <label className="inline-flex min-h-11 items-center gap-3 text-sm font-medium text-foreground"><input type="checkbox" name="contributes_to_history" value="true" defaultChecked={current?.contributes_to_history ?? true} disabled={pending} className="size-4 accent-primary" />Contributes to future Starting Average history</label>
        <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={pending || !compatibleContexts.length || !activePolicies.length} className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? "Saving…" : current ? "Save settings" : "Add Starting Average setup"}</button><p className="text-xs text-muted-foreground">Competition scale: {formatAverageMaximum(competition.shooterMaximum)}. Exact-match Contexts only.</p></div>
        {currentUnavailable ? <p className="text-sm text-warning">The historical binding uses an archived item. Select active replacements before saving.</p> : null}
        {!compatibleContexts.length || !activePolicies.length ? <p className="text-sm text-warning">No active matching Context and Policy are available in Organisation Averages.</p> : null}
        <StatusMessage state={state} />
      </form>}
    </Card>
  </section>;
}

function shooterName(firstName: string | null, lastName: string | null) {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ") || "Shooter";
}

function formatStartingAverage(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function previewRows(participants: StartingAverageParticipant[], manualPolicy: boolean): StartingAveragePreviewRow[] {
  return participants.map((participant) => ({
    competitionEntrantParticipantId: participant.competitionEntrantParticipantId,
    shooterProfileId: participant.shooterProfileId,
    firstName: participant.firstName,
    lastName: participant.lastName,
    startingAverage: participant.startingAverage,
    manualRequired: manualPolicy && participant.startingAverage === null,
    origin: participant.origin ?? "manual",
    status: participant.status,
    policyBranch: participant.origin === "manual" ? "manual" : "current",
    qualifyingScoreCount: participant.qualifyingScoreCount,
    sourceCompetitionId: participant.sourceCompetitionId,
    sourceCompetitionName: participant.sourceCompetitionName,
    manualReason: participant.manualReason,
  }));
}

function StartingAverageRow({
  organisation,
  season,
  competition,
  participant,
  basisMaximum,
  manualPolicy,
  calculatedNow,
}: {
  organisation: { id: number; slug: string };
  season: { id: number; slug: string };
  competition: CompetitionIdentity;
  participant: StartingAveragePreviewRow;
  basisMaximum: number;
  manualPolicy: boolean;
  calculatedNow: boolean;
}) {
  const [state, action, pending] = useActionState(setManualStartingAverage, initialManualState);
  const manualSaved = state.status === "success" && state.startingAverage !== undefined;
  const displayedAverage = manualSaved ? state.startingAverage! : participant.startingAverage;
  const displayedOrigin = manualSaved ? "manual" : participant.origin;
  const displayedStatus = manualSaved ? "provisional" : participant.status;
  const needsManual = participant.manualRequired || (manualPolicy && displayedAverage === null);
  return <div className="p-5">
    <div className="grid gap-3 text-sm md:grid-cols-[minmax(0,1.1fr)_0.5fr_minmax(0,1.5fr)_0.45fr_0.55fr] md:gap-4">
      <div><span className="text-xs text-muted-foreground md:hidden">Shooter · </span><span className="font-semibold text-foreground">{shooterName(participant.firstName, participant.lastName)}</span></div>
      <div><span className="text-xs text-muted-foreground md:hidden">S/Av · </span><span className="font-semibold tabular-nums text-foreground">{formatStartingAverage(displayedAverage)}</span></div>
      <div><span className="text-xs text-muted-foreground md:hidden">Source · </span><span className={needsManual && !manualSaved ? "text-warning" : "text-foreground"}>{needsManual && !manualSaved ? "Manual required" : displayedOrigin === "manual" ? "Manual" : sourceLabel(participant, calculatedNow)}</span></div>
      <div><span className="text-xs text-muted-foreground md:hidden">Scores used · </span><span className="text-foreground">{participant.qualifyingScoreCount} score{participant.qualifyingScoreCount === 1 ? "" : "s"}</span></div>
      <div><Badge tone={displayedStatus === "frozen" ? "positive" : needsManual && !manualSaved ? "warning" : displayedAverage === null ? "neutral" : "brand"}>{displayedStatus === "frozen" ? "Frozen" : needsManual && !manualSaved ? "Needs input" : displayedAverage === null ? "Not calculated" : displayedOrigin === "manual" ? "Manual · Provisional" : "Calculated · Provisional"}</Badge></div>
    </div>
    {displayedStatus !== "frozen" && (needsManual || (displayedOrigin === "manual" && displayedStatus === "provisional")) ? <form action={action} className="mt-3 grid gap-3 rounded-xl bg-surface-muted p-3 sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)_auto] sm:items-end">
      <CompetitionFields organisation={organisation} season={season} competition={competition} />
      <input type="hidden" name="competition_entrant_participant_id" value={participant.competitionEntrantParticipantId} />
      <label className="text-xs font-medium text-foreground">Starting Average<input name="starting_average" required type="text" inputMode="decimal" defaultValue={displayedAverage ?? ""} disabled={pending} placeholder="97.50" className={inputClassName} /><span className="mt-1 block text-[11px] text-muted-foreground">Scale: {formatAverageMaximum(basisMaximum)}</span></label>
      <label className="text-xs font-medium text-foreground">Reason (optional)<input name="manual_reason" maxLength={500} defaultValue={state.manualReason ?? participant.manualReason ?? ""} disabled={pending} className={inputClassName} /></label>
      <button type="submit" disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:opacity-60">{pending ? "Saving…" : "Save manual S/Av"}</button>
      {state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`text-xs sm:col-span-3 ${state.status === "error" ? "text-danger" : "text-success"}`}>{state.message}</p> : null}
    </form> : null}
  </div>;
}

function sourceLabel(row: StartingAveragePreviewRow, calculatedNow: boolean) {
  if (row.policyBranch === "manual" || row.origin === "manual") return "Manual";
  const prefix = calculatedNow
    ? row.policyBranch === "preceding" ? "Preceding Competition" : "Latest Competition"
    : "Source Competition";
  return row.sourceCompetitionName ? `${prefix} · ${row.sourceCompetitionName}` : prefix;
}

function StartingAverageTable({ organisation, season, competition, management }: {
  organisation: { id: number; slug: string };
  season: { id: number; slug: string };
  competition: CompetitionIdentity;
  management: CompetitionAverageManagement;
}) {
  const [state, action, pending] = useActionState(calculateCompetitionStartingAverages, initialCalculationState);
  const setting = management.setting;
  const manualPolicy = setting?.policyVersion?.strategy === "manual";
  const rows = state.rows ?? previewRows(management.participants, manualPolicy);
  const calculatedNow = Boolean(state.rows);
  const [finaliseState, finaliseAction, finalisePending] = useActionState(
    finaliseCompetitionStartingAverages,
    initialState,
  );
  const finalised = Boolean(management.finalisedAt) || management.hasFrozenStartingAverages;
  const allValuesPresent = rows.every(
    (participant) => participant.startingAverage !== null,
  );

  if (!setting) return <section className="mt-10"><SectionHeader title="Starting Averages" /><Card className="bg-surface-muted p-6"><p className="text-sm text-muted-foreground">Add Competition Average setup before calculating Starting Averages.</p></Card></section>;
  if (competition.status !== "published") return <section className="mt-10"><SectionHeader title="Starting Averages" /><Card className="bg-surface-muted p-6"><p className="text-sm text-muted-foreground">Publish the Competition before calculating Starting Averages. Values remain provisional in Stage 2A.</p></Card></section>;
  if (!management.participants.length) return <section className="mt-10"><SectionHeader title="Starting Averages" /><Card className="bg-surface-muted p-6"><p className="text-sm text-muted-foreground">There are no submitted participants yet. Starting Averages can be calculated after entries are submitted.</p></Card></section>;

  return <section className="mt-10" aria-labelledby="starting-average-preview-heading">
    <SectionHeader title="Starting Averages" description="Preview and manage each submitted shooter participant" action={finalised ? undefined : <form action={action}><CompetitionFields organisation={organisation} season={season} competition={competition} /><button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? "Calculating…" : rows.some((row) => row.startingAverage !== null) ? "Recalculate Starting Averages" : "Calculate Starting Averages"}</button></form>} />
    <p className={`mb-4 rounded-xl border px-4 py-3 text-sm ${finalised ? "border-success/20 bg-success-subtle text-success" : "border-warning/20 bg-warning-subtle text-warning"}`}>{finalised ? "Starting Averages were finalised for this Competition." : "Starting Averages remain provisional until divisions are first published or they are explicitly finalised for a Competition without divisions."}</p>
    <StatusMessage state={state} />
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,1.1fr)_0.5fr_minmax(0,1.5fr)_0.45fr_0.55fr] gap-4 border-b border-border bg-surface-muted px-5 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground md:grid"><span>Shooter</span><span>S/Av</span><span>Source</span><span>Scores used</span><span>Status</span></div>
      <div className="divide-y divide-border">{rows.map((row) => <StartingAverageRow key={row.competitionEntrantParticipantId} organisation={organisation} season={season} competition={competition} participant={row} basisMaximum={setting.context?.basis_maximum ?? competition.shooterMaximum} manualPolicy={manualPolicy} calculatedNow={calculatedNow} />)}</div>
    </Card>
    {!finalised && management.divisionStatus === null ? <Card className="mt-5 p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
      <div><h3 className="text-sm font-semibold text-foreground">Competition without divisions</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Use this only if this Competition will not publish divisions. Finalisation permanently freezes every participant S/Av.</p></div>
      <form action={finaliseAction} className="mt-4 shrink-0 sm:mt-0"><CompetitionFields organisation={organisation} season={season} competition={competition} /><button type="submit" disabled={finalisePending || !allValuesPresent} className="min-h-11 rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-50">{finalisePending ? "Finalising…" : "Finalise Starting Averages"}</button></form>
      {finaliseState.message ? <p role={finaliseState.status === "error" ? "alert" : "status"} className={`mt-3 text-xs sm:basis-full ${finaliseState.status === "error" ? "text-danger" : "text-success"}`}>{finaliseState.message}</p> : null}
    </Card> : null}
  </section>;
}

export function CompetitionAverageWorkspace({ organisation, season, competition, configuration, management }: {
  organisation: { id: number; slug: string };
  season: { id: number; slug: string };
  competition: CompetitionIdentity;
  configuration: AverageConfiguration;
  management: CompetitionAverageManagement;
}) {
  return <>
    <CompetitionSettings organisation={organisation} season={season} competition={competition} configuration={configuration} management={management} />
    <StartingAverageTable organisation={organisation} season={season} competition={competition} management={management} />
  </>;
}
