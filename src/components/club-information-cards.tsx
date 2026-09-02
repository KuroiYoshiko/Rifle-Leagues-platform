"use client";

import {
  createClubInformationCard,
  deleteClubInformationCard,
  reorderClubInformationCards,
  updateClubInformationCard,
} from "@/app/(app)/clubs/[slug]/information/actions";
import { InformationCards } from "@/components/organisation-information-cards";
import type { Club, ClubInformationCard } from "@/lib/clubs";

export function ClubInformationCards({
  club,
  initialCards,
  isOwner,
}: {
  club: Pick<Club, "id" | "name" | "slug">;
  initialCards: ClubInformationCard[];
  isOwner: boolean;
}) {
  return (
    <InformationCards
      entity={club}
      initialCards={initialCards}
      isOwner={isOwner}
      copy={{
        headingId: "club-information-heading",
        description: `Published guidance and long-form information from ${club.name}.`,
        editorEyebrow: "Club information",
        onboardingTitle: "Build your club information page",
        onboardingDescription:
          "Add up to 5 information cards for anything your members may need to know — for example club rules, range guidance or competition information.",
        emptyTitle: "No information has been published yet",
        emptyDescription: "This club has not added any public information cards yet.",
        deleteDescription: "This published information will be removed from the club page.",
      }}
      actions={{
        create: ({ entityId, entitySlug, title, content }) =>
          createClubInformationCard({ clubId: entityId, clubSlug: entitySlug, title, content }),
        update: ({ entityId, entitySlug, cardId, title, content }) =>
          updateClubInformationCard({ clubId: entityId, clubSlug: entitySlug, cardId, title, content }),
        delete: ({ entityId, entitySlug, cardId }) =>
          deleteClubInformationCard({ clubId: entityId, clubSlug: entitySlug, cardId }),
        reorder: ({ entityId, entitySlug, cardIds }) =>
          reorderClubInformationCards({ clubId: entityId, clubSlug: entitySlug, cardIds }),
      }}
    />
  );
}
