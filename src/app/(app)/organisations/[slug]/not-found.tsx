import Link from "next/link";
import { Card } from "@/components/ui";

export default function OrganisationNotFound() {
  return (
    <div className="mx-auto max-w-3xl">
      <Card className="p-7 sm:p-9">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-subtle text-sm font-bold text-brand-deep">
          O
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-foreground">
          Organisation not found
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          This organisation does not exist or is not currently active for public
          discovery.
        </p>
        <Link
          href="/organisations"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep"
        >
          Browse active organisations
        </Link>
      </Card>
    </div>
  );
}
