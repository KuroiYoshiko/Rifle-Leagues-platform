import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card } from "@/components/ui";
import { getActiveOrganisationBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation contact",
};

export default async function OrganisationContactPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const organisation = await getActiveOrganisationBySlug(slug);

  if (!organisation) {
    notFound();
  }

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="contact">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <Card className="p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
            Contact details
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.025em] text-foreground">
            {organisation.name}
          </h2>

          <dl className="mt-7 space-y-6">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Email</dt>
              <dd className="mt-1.5 text-sm font-semibold text-foreground">
                {organisation.contact_email ? (
                  <a
                    href={`mailto:${organisation.contact_email}`}
                    className="text-brand-strong hover:text-brand-deep hover:underline"
                  >
                    {organisation.contact_email}
                  </a>
                ) : (
                  "Not published"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Website</dt>
              <dd className="mt-1.5 text-sm font-semibold text-foreground">
                {organisation.website ? (
                  <a
                    href={organisation.website}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-brand-strong hover:text-brand-deep hover:underline"
                  >
                    {organisation.website}
                    <span className="ml-1" aria-hidden="true">↗</span>
                  </a>
                ) : (
                  "Not published"
                )}
              </dd>
            </div>
          </dl>

          {organisation.contact_email ? (
            <a
              href={`mailto:${organisation.contact_email}`}
              className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep"
            >
              Email the organisation
            </a>
          ) : null}
        </Card>

        <Card className="bg-surface-muted p-6 sm:p-8">
          <span
            className="grid size-12 place-items-center rounded-2xl bg-brand-subtle text-sm font-bold text-brand-deep"
            aria-hidden="true"
          >
            C
          </span>
          <h2 className="mt-5 font-semibold text-foreground">
            Contact form planned for later
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Direct contact details are shown now. A message form can be added when
            a real email delivery service and handling workflow exist.
          </p>
        </Card>
      </div>
    </OrganisationPageFrame>
  );
}
