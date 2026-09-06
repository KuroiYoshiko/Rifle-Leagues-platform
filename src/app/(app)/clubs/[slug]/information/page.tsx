import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClubInformationCards } from "@/components/club-information-cards";
import { ClubPageFrame } from "@/components/club-page-frame";
import {
  getClubInformationCards,
  getClubPageContextBySlug,
  isClubOwner,
} from "@/lib/clubs";
import { getPublicClubResultsCatalog } from "@/lib/public-results";
import { getViewerId } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "Club information",
};

export default async function ClubInformationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewerId = await getViewerId();
  const authenticatedContext = viewerId
    ? await getClubPageContextBySlug(slug)
    : null;
  const publicCatalog = viewerId
    ? null
    : await getPublicClubResultsCatalog({ clubSlug: slug });
  const context = authenticatedContext ??
    (publicCatalog?.club
      ? {
          club: publicCatalog.club,
          membership: null,
          informationCardCount: publicCatalog.information_cards?.length ?? 0,
        }
      : null);

  if (!context) notFound();

  const owner = isClubOwner(context.membership);
  if (!owner && context.informationCardCount === 0) notFound();

  const cards = viewerId
    ? await getClubInformationCards(context.club.id)
    : (publicCatalog?.information_cards ?? []);

  return (
    <ClubPageFrame
      club={context.club}
      membership={context.membership}
      informationCardCount={context.informationCardCount}
      isAuthenticated={Boolean(viewerId)}
      currentSection="information"
    >
      <ClubInformationCards
        key={cards.map((card) => `${card.id}:${card.updated_at}`).join("|")}
        club={context.club}
        initialCards={cards}
        isOwner={owner}
      />
    </ClubPageFrame>
  );
}
