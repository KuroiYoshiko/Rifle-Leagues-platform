import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClubInformationCards } from "@/components/club-information-cards";
import { ClubPageFrame } from "@/components/club-page-frame";
import {
  getClubInformationCards,
  getClubPageContextBySlug,
  isClubOwner,
} from "@/lib/clubs";

export const metadata: Metadata = {
  title: "Club information",
};

export default async function ClubInformationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getClubPageContextBySlug(slug);

  if (!context) notFound();

  const owner = isClubOwner(context.membership);
  if (!owner && context.informationCardCount === 0) notFound();

  const cards = await getClubInformationCards(context.club.id);

  return (
    <ClubPageFrame
      club={context.club}
      membership={context.membership}
      informationCardCount={context.informationCardCount}
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
