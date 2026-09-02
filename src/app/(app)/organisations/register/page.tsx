import type { Metadata } from "next";
import { OrganisationAdministrationOptions } from "@/components/organisation-administration-options";
import { OrganisationRegistrationForm } from "@/components/organisation-registration-form";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Register an organisation",
};

export default function OrganisationRegistrationPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-medium text-brand-strong">
          Organisation administration
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Register a league organisation
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Choose the path that matches your organisation. Registration creates a
          new public organisation record; it is not the same as adding an existing
          organisation to My Organisations.
        </p>
      </div>

      <OrganisationAdministrationOptions current="register" />

      <Card className="mt-8 p-5 sm:p-8">
        <div className="mb-7 border-b border-border pb-6">
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
            Organisation details
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Use this form only if the organisation is not already registered on
            RifleLeagues. If it exists, use Request management access instead.
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            You will become the organisation owner when registration succeeds.
            Fields marked * are required.
          </p>
        </div>
        <OrganisationRegistrationForm />
      </Card>
    </div>
  );
}
