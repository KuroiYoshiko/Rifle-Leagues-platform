import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganisationContactDetails } from "@/components/organisation-contact-details";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
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
      <div className="max-w-4xl">
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
      </div>
    </OrganisationPageFrame>
  );
}
