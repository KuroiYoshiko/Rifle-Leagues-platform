import type { Metadata } from "next";
import Link from "next/link";
import { ClubRegistrationForm } from "@/components/club-registration-form";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Register a club",
};

export default function ClubRegistrationPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-medium text-brand-strong">Club administration</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Register a club
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Create a new public club record and become its owner on RifleLeagues.
          Registration is not the same as joining an existing club.
        </p>
      </div>

      <Card className="border-warning/25 bg-warning-subtle p-5 sm:p-6">
        <h2 className="font-semibold text-foreground">Check before registering</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          If your club already exists on RifleLeagues, do not register it again. Find
          the existing club and request membership instead.
        </p>
        <Link
          href="/clubs"
          className="mt-4 inline-flex text-sm font-semibold text-brand-deep hover:underline"
        >
          Search existing clubs
        </Link>
      </Card>

      <Card className="mt-8 p-5 sm:p-8">
        <div className="mb-7 border-b border-border pb-6">
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
            Club details
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Your club becomes active immediately. You will become its owner when
            registration succeeds. Fields marked * are required.
          </p>
        </div>
        <ClubRegistrationForm />
      </Card>
    </div>
  );
}
