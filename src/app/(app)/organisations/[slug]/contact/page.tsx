import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganisationContactDetails } from "@/components/organisation-contact-details";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card } from "@/components/ui";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation contact",
};

export default async function OrganisationContactPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [organisation, managementContext] = await Promise.all([
    getActiveOrganisationBySlug(slug),
    getOrganisationManagementContextBySlug(slug),
  ]);

  if (!organisation) {
    notFound();
  }

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="contact">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <OrganisationContactDetails
          key={organisation.updated_at}
          organisationId={organisation.id}
          organisationName={organisation.name}
          initialValues={{
            address: organisation.address ?? "",
            postcode: organisation.postcode ?? "",
            telephone: organisation.telephone ?? "",
            contactEmail: organisation.contact_email ?? "",
            website: organisation.website ?? "",
          }}
          isOwner={managementContext?.access.role === "owner"}
        />

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
