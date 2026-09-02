import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganisationInformationCards } from "@/components/organisation-information-cards";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import {
  getActiveOrganisationBySlug,
  getOrganisationInformationCards,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation information",
};

export default async function OrganisationInformationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const organisation = await getActiveOrganisationBySlug(slug);

  if (!organisation) {
    notFound();
  }

  const [cards, managementContext] = await Promise.all([
    getOrganisationInformationCards(organisation.id),
    getOrganisationManagementContextBySlug(slug),
  ]);
  const isOwner = managementContext?.access.role === "owner";

  return (
    <OrganisationPageFrame
      organisation={organisation}
      currentSection="information"
    >
      <OrganisationInformationCards
        key={cards.map((card) => `${card.id}:${card.updated_at}`).join("|")}
        organisation={organisation}
        initialCards={cards}
        isOwner={isOwner}
      />
    </OrganisationPageFrame>
  );
}
