"use client";

import { Card } from "@/components/ui";

export default function OrganisationError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card className="border-danger/20 p-7 sm:p-9">
        <div role="alert">
          <h1 className="text-xl font-semibold text-foreground">
            Organisation unavailable
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            This organisation could not be loaded. If the database foundation has
            just been installed, refresh the page and try again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep"
          >
            Try again
          </button>
        </div>
      </Card>
    </div>
  );
}
