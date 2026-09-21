"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  publishCompetitionFromDetail,
  type CompetitionLifecycleActionState,
} from "@/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/actions";
import { Card } from "@/components/ui";
import type { CompetitionPublishReadiness } from "@/lib/competitions";

const initialState: CompetitionLifecycleActionState = {};

export function CompetitionReadinessCard({
  readiness,
  isOwner,
  organisationId,
  leagueSeasonId,
  competitionId,
  editHref,
}: {
  readiness: CompetitionPublishReadiness;
  isOwner: boolean;
  organisationId: number;
  leagueSeasonId: number;
  competitionId: number;
  editHref: string;
}) {
  const [state, action, pending] = useActionState(
    publishCompetitionFromDetail,
    initialState,
  );

  if (!readiness.ready) {
    return (
      <Card className="mt-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Competition not ready to publish</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Complete the remaining setup before this Competition can be published.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
              {readiness.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          </div>
          <Link
            href={editHref}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
          >
            Edit competition
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mt-4 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">
            {isOwner ? "Ready to publish" : "Ready for owner review"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {isOwner
              ? "Publishing makes this Competition visible when its Season is public."
              : "An Organisation Owner must publish this Competition."}
          </p>
          {state.status === "error" && state.message ? (
            <p className="mt-2 text-sm text-danger" role="alert">{state.message}</p>
          ) : null}
        </div>
        {isOwner ? (
          <form action={action}>
            <input type="hidden" name="organisation_id" value={organisationId} />
            <input type="hidden" name="league_season_id" value={leagueSeasonId} />
            <input type="hidden" name="competition_id" value={competitionId} />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Publishing…" : "Publish competition"}
            </button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
