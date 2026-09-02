"use client";

import { useActionState } from "react";
import {
  updateClubDetails,
  type ClubManagementActionState,
} from "@/app/(app)/clubs/management-actions";
import type { Club } from "@/lib/clubs";

const initialState: ClubManagementActionState = {};

const inputClassName =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:bg-surface-muted";

export function ClubSettingsForm({
  club,
  isOwner,
}: {
  club: Club;
  isOwner: boolean;
}) {
  const [state, formAction, submitting] = useActionState(
    updateClubDetails,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="club_id" value={club.id} />
      <input type="hidden" name="club_slug" value={club.slug} />
      {!isOwner ? <input type="hidden" name="name" value={club.name} /> : null}
      <div>
        <label htmlFor="club-name" className="text-sm font-semibold text-foreground">
          Club name
        </label>
        <input
          id="club-name"
          name={isOwner ? "name" : undefined}
          required
          minLength={2}
          maxLength={160}
          defaultValue={club.name}
          disabled={submitting || !isOwner}
          className={inputClassName}
        />
        {!isOwner ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Only the club owner can change the official club name.
          </p>
        ) : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="club-town" className="text-sm font-semibold text-foreground">
            Town
          </label>
          <input
            id="club-town"
            name="town"
            maxLength={100}
            defaultValue={club.town ?? ""}
            disabled={submitting}
            className={inputClassName}
          />
        </div>
        <div>
          <label htmlFor="club-county" className="text-sm font-semibold text-foreground">
            County
          </label>
          <input
            id="club-county"
            name="county"
            maxLength={100}
            defaultValue={club.county ?? ""}
            disabled={submitting}
            className={inputClassName}
          />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="club-postcode" className="text-sm font-semibold text-foreground">
            Postcode
          </label>
          <input
            id="club-postcode"
            name="postcode"
            maxLength={20}
            defaultValue={club.postcode ?? ""}
            disabled={submitting}
            className={inputClassName}
          />
        </div>
        <div>
          <label htmlFor="club-website" className="text-sm font-semibold text-foreground">
            Website
          </label>
          <input
            id="club-website"
            name="website"
            type="url"
            maxLength={2048}
            placeholder="https://example.org"
            defaultValue={club.website ?? ""}
            disabled={submitting}
            className={inputClassName}
          />
        </div>
      </div>
      {state.message ? (
        <p
          className={`rounded-xl px-4 py-3 text-sm ${
            state.status === "error"
              ? "border border-danger/20 bg-danger-subtle text-danger"
              : "border border-success/20 bg-success-subtle text-success"
          }`}
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Save club details"}
        </button>
      </div>
    </form>
  );
}
