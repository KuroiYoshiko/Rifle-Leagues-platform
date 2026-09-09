"use client";

import { useActionState, useState } from "react";
import {
  createAverageContext,
  createAveragePolicy,
  createAveragePolicyVersion,
  setAverageContextArchived,
  setAveragePolicyArchived,
  setCompetitionSeriesAverageDefaults,
  type AverageActionState,
} from "@/app/(app)/organisations/[slug]/average-actions";
import {
  formatAverageMaximum,
  getAveragePolicyStrategyLabel,
  type AverageConfiguration,
  type AveragePolicyStrategy,
  type AverageSeriesManagementRow,
} from "@/lib/competition-average-types";
import { Badge, Card, SectionHeader } from "@/components/ui";

const initialState: AverageActionState = {};
const inputClassName = "mt-2 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:bg-surface-muted disabled:opacity-60";
const secondaryButton = "min-h-10 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle disabled:opacity-60";

function CommonFields({ organisation }: { organisation: { id: number; slug: string } }) {
  return <>
    <input type="hidden" name="organisation_id" value={organisation.id} />
    <input type="hidden" name="organisation_slug" value={organisation.slug} />
  </>;
}

function StatusMessage({ state }: { state: AverageActionState }) {
  return state.message ? <p role={state.status === "error" ? "alert" : "status"} className={`mt-2 text-xs leading-5 ${state.status === "error" ? "text-danger" : "text-success"}`}>{state.message}</p> : null;
}

function PolicyDefinitionFields({
  initialStrategy = "manual",
  initialCurrent = 2,
  initialPreceding = 2,
  disabled,
}: {
  initialStrategy?: AveragePolicyStrategy;
  initialCurrent?: number;
  initialPreceding?: number;
  disabled: boolean;
}) {
  const [strategy, setStrategy] = useState<AveragePolicyStrategy>(initialStrategy);
  return <div className="space-y-4">
    <div>
      <label className="text-sm font-semibold text-foreground">Calculation method</label>
      <select name="strategy" value={strategy} onChange={(event) => setStrategy(event.target.value as AveragePolicyStrategy)} disabled={disabled} className={inputClassName}>
        <option value="manual">Manual</option>
        <option value="current_then_preceding">Current then preceding</option>
      </select>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {strategy === "manual"
          ? "Starting Average is entered manually for each shooter."
          : "Use the latest eligible Competition when enough scores are available; otherwise use the immediately preceding Competition."}
      </p>
    </div>
    {strategy === "current_then_preceding" ? <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-foreground">Minimum scores in latest Competition
        <input name="minimum_current_scores" type="number" min={1} max={999} step={1} required defaultValue={initialCurrent} disabled={disabled} className={inputClassName} />
      </label>
      <label className="text-sm font-medium text-foreground">Minimum scores in preceding Competition
        <input name="minimum_preceding_scores" type="number" min={1} max={999} step={1} required defaultValue={initialPreceding} disabled={disabled} className={inputClassName} />
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Fallback: Manual</p>
    </div> : null}
  </div>;
}

function ContextArchiveForm({ organisation, contextId, archived }: {
  organisation: { id: number; slug: string };
  contextId: number;
  archived: boolean;
}) {
  const [state, action, pending] = useActionState(setAverageContextArchived, initialState);
  return <form action={action}>
    <CommonFields organisation={organisation} />
    <input type="hidden" name="average_context_id" value={contextId} />
    <input type="hidden" name="archived" value={String(!archived)} />
    <button type="submit" disabled={pending} className={secondaryButton}>{pending ? "Saving…" : archived ? "Restore" : "Archive"}</button>
    <StatusMessage state={state} />
  </form>;
}

function PolicyArchiveForm({ organisation, policyId, archived }: {
  organisation: { id: number; slug: string };
  policyId: number;
  archived: boolean;
}) {
  const [state, action, pending] = useActionState(setAveragePolicyArchived, initialState);
  return <form action={action}>
    <CommonFields organisation={organisation} />
    <input type="hidden" name="average_policy_id" value={policyId} />
    <input type="hidden" name="archived" value={String(!archived)} />
    <button type="submit" disabled={pending} className={secondaryButton}>{pending ? "Saving…" : archived ? "Restore" : "Archive"}</button>
    <StatusMessage state={state} />
  </form>;
}

function CreateContextForm({ organisation }: { organisation: { id: number; slug: string } }) {
  const [state, action, pending] = useActionState(createAverageContext, initialState);
  return <Card className="p-5 sm:p-6">
    <h3 className="font-semibold text-foreground">Create Average Context</h3>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">Only Competitions with this exact shooter maximum can share the Context.</p>
    <form action={action} className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.35fr)_auto] sm:items-end">
      <CommonFields organisation={organisation} />
      <label className="text-sm font-medium text-foreground">Average context name *<input name="name" required minLength={2} maxLength={160} disabled={pending} placeholder="Short Range Individual" className={inputClassName} /></label>
      <label className="text-sm font-medium text-foreground">Maximum score (Ex) *<input name="basis_maximum" required type="text" inputMode="decimal" disabled={pending} placeholder="100" className={inputClassName} /></label>
      <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? "Creating…" : "Create"}</button>
    </form>
    <StatusMessage state={state} />
  </Card>;
}

function CreatePolicyForm({ organisation }: { organisation: { id: number; slug: string } }) {
  const [state, action, pending] = useActionState(createAveragePolicy, initialState);
  return <Card className="p-5 sm:p-6">
    <h3 className="font-semibold text-foreground">Create Average Policy</h3>
    <form action={action} className="mt-4 space-y-4">
      <CommonFields organisation={organisation} />
      <label className="block max-w-2xl text-sm font-medium text-foreground">Policy name *<input name="name" required minLength={2} maxLength={160} disabled={pending} placeholder="Standard league Starting Average" className={inputClassName} /></label>
      <PolicyDefinitionFields disabled={pending} />
      <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? "Creating…" : "Create policy"}</button>
    </form>
    <StatusMessage state={state} />
  </Card>;
}

function NewPolicyVersionForm({ organisation, policyId, strategy, current, preceding }: {
  organisation: { id: number; slug: string };
  policyId: number;
  strategy: AveragePolicyStrategy;
  current: number;
  preceding: number;
}) {
  const [state, action, pending] = useActionState(createAveragePolicyVersion, initialState);
  return <details className="mt-4 border-t border-border pt-4">
    <summary className="cursor-pointer text-sm font-semibold text-brand-deep">Create new version</summary>
    <form action={action} className="mt-4 space-y-4 rounded-xl bg-surface-muted p-4">
      <CommonFields organisation={organisation} />
      <input type="hidden" name="average_policy_id" value={policyId} />
      <PolicyDefinitionFields initialStrategy={strategy} initialCurrent={current} initialPreceding={preceding} disabled={pending} />
      <p className="text-xs leading-5 text-muted-foreground">Saving creates a new immutable version. Existing Competitions keep their selected version.</p>
      <button type="submit" disabled={pending} className={secondaryButton}>{pending ? "Creating…" : "Create version"}</button>
      <StatusMessage state={state} />
    </form>
  </details>;
}

function SeriesDefaultForm({ organisation, row, configuration }: {
  organisation: { id: number; slug: string };
  row: AverageSeriesManagementRow;
  configuration: AverageConfiguration;
}) {
  const [state, action, pending] = useActionState(setCompetitionSeriesAverageDefaults, initialState);
  const [enabled, setEnabled] = useState(Boolean(row.averageDefault));
  const compatibleContexts = configuration.contexts.filter((context) =>
    !context.archived_at && context.basis_maximum === row.shooterMaximum);
  const activePolicies = configuration.policies.filter((policy) => !policy.archived_at);
  const currentContext = row.averageDefault?.context;
  const currentPolicy = row.averageDefault?.policy;
  const currentVersion = row.averageDefault?.policyVersion;
  return <Card className="p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold text-foreground">{row.name}</h3><p className="mt-1 text-xs text-muted-foreground">Shooter maximum: {row.shooterMaximum === null ? "Not configured" : formatAverageMaximum(row.shooterMaximum)}</p></div>
      {row.averageDefault ? <Badge tone={currentContext?.archived_at || currentPolicy?.archived_at ? "warning" : "brand"}>Defaults set</Badge> : <Badge>None</Badge>}
    </div>
    {row.averageDefault ? <dl className="mt-4 grid gap-3 rounded-xl bg-surface-muted p-4 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted-foreground">Average Context</dt><dd className="mt-1 font-semibold text-foreground">{currentContext?.name ?? "Unavailable"}{currentContext ? ` · ${formatAverageMaximum(currentContext.basis_maximum)}` : ""}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Calculation</dt><dd className="mt-1 font-semibold text-foreground">{currentPolicy && currentVersion ? `${currentPolicy.name} · ${getAveragePolicyStrategyLabel(currentVersion.strategy)} · v${currentVersion.version_number}` : "Unavailable"}</dd></div>
    </dl> : null}
    <form action={action} className="mt-4 space-y-4">
      <CommonFields organisation={organisation} />
      <input type="hidden" name="competition_series_id" value={row.id} />
      <fieldset><legend className="sr-only">Starting Average defaults</legend><div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2"><input type="radio" name="average_setup" value="none" checked={!enabled} onChange={() => setEnabled(false)} disabled={pending} className="accent-primary" />None</label>
        <label className="inline-flex items-center gap-2"><input type="radio" name="average_setup" value="configured" checked={enabled} onChange={() => setEnabled(true)} disabled={pending} className="accent-primary" />Use Average Context + Policy</label>
      </div></fieldset>
      {enabled ? <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-foreground">Average Context<select name="average_context_id" required defaultValue={row.averageDefault?.average_context_id ?? ""} disabled={pending} className={inputClassName}><option value="">Choose Context</option>{currentContext?.archived_at ? <option value={currentContext.id} disabled>{currentContext.name} · {formatAverageMaximum(currentContext.basis_maximum)} · Archived</option> : null}{compatibleContexts.map((context) => <option key={context.id} value={context.id}>{context.name} · {formatAverageMaximum(context.basis_maximum)}</option>)}</select></label>
        <label className="text-sm font-medium text-foreground">Average Policy<select name="average_policy_version_id" required defaultValue={row.averageDefault?.average_policy_version_id ?? ""} disabled={pending} className={inputClassName}><option value="">Choose Policy</option>{currentPolicy?.archived_at && currentVersion ? <option value={currentVersion.id} disabled>{currentPolicy.name} · v{currentVersion.version_number} · Archived</option> : null}{activePolicies.map((policy) => <option key={policy.latestVersion.id} value={policy.latestVersion.id}>{policy.name} · {getAveragePolicyStrategyLabel(policy.latestVersion.strategy)} · v{policy.latestVersion.version_number}</option>)}</select></label>
      </div> : null}
      {enabled && (!compatibleContexts.length || !activePolicies.length) ? <p className="text-xs leading-5 text-warning">Create an active matching Context and Policy above before setting new defaults.</p> : null}
      <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={pending || (enabled && (!compatibleContexts.length || !activePolicies.length))} className={secondaryButton}>{pending ? "Saving…" : "Save defaults"}</button><p className="text-xs text-muted-foreground">Applies only to future editions; existing Competition settings do not change.</p></div>
      <StatusMessage state={state} />
    </form>
  </Card>;
}

export function AverageManagement({
  organisation,
  configuration,
  series,
}: {
  organisation: { id: number; slug: string };
  configuration: AverageConfiguration;
  series: AverageSeriesManagementRow[];
}) {
  return <div className="space-y-10">
    <section aria-labelledby="average-contexts-heading">
      <SectionHeader title="Average Contexts" description="Which Competitions share average history" />
      <div className="space-y-3"><CreateContextForm organisation={organisation} />
        {configuration.contexts.length ? configuration.contexts.map((context) => <Card key={context.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-foreground">{context.name}</h3><Badge tone={context.archived_at ? "neutral" : "positive"}>{context.archived_at ? "Archived" : "Active"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{formatAverageMaximum(context.basis_maximum)} · exact maximum only</p></div><ContextArchiveForm organisation={organisation} contextId={context.id} archived={Boolean(context.archived_at)} /></Card>) : <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">No Average Contexts have been created yet.</p>}
      </div>
    </section>

    <section aria-labelledby="average-policies-heading">
      <SectionHeader title="Average Policies" description="How Starting Average is calculated" />
      <div className="space-y-3"><CreatePolicyForm organisation={organisation} />
        {configuration.policies.length ? configuration.policies.map((policy) => {
          const version = policy.latestVersion;
          const current = version.configuration.minimum_current_scores ?? 2;
          const preceding = version.configuration.minimum_preceding_scores ?? 2;
          return <Card key={policy.id} className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-foreground">{policy.name}</h3><Badge tone={policy.archived_at ? "neutral" : "positive"}>{policy.archived_at ? "Archived" : "Active"}</Badge><Badge>Version {version.version_number}</Badge></div><p className="mt-2 text-sm font-medium text-foreground">{getAveragePolicyStrategyLabel(version.strategy)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{version.strategy === "manual" ? "Starting Average is entered manually for each shooter." : `Latest Competition: minimum ${current} scores · preceding Competition: minimum ${preceding} scores · fallback: Manual.`}</p></div><PolicyArchiveForm organisation={organisation} policyId={policy.id} archived={Boolean(policy.archived_at)} /></div>{!policy.archived_at ? <NewPolicyVersionForm organisation={organisation} policyId={policy.id} strategy={version.strategy} current={current} preceding={preceding} /> : null}</Card>;
        }) : <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">No Average Policies have been created yet.</p>}
      </div>
    </section>

    <section aria-labelledby="series-average-defaults-heading">
      <SectionHeader title="Competition Series defaults" description="Optional Starting Average setup copied into future Competition editions" />
      {series.length ? <div className="space-y-3">{series.map((row) => <SeriesDefaultForm key={row.id} organisation={organisation} row={row} configuration={configuration} />)}</div> : <Card className="bg-surface-muted p-6"><p className="text-sm text-muted-foreground">No Competition Series have been created yet.</p></Card>}
    </section>
  </div>;
}
