"use client";

import { updateClubAbout } from "@/app/(app)/clubs/[slug]/actions";
import { RichTextDocument } from "@/components/rich-text-document";

export function ClubAbout({
  clubId,
  initialContent,
  isOwner,
}: {
  clubId: number;
  initialContent: string | null;
  isOwner: boolean;
}) {
  return (
    <RichTextDocument
      entityId={clubId}
      entityLabel="Club"
      initialContent={initialContent}
      isOwner={isOwner}
      description="Public introduction supplied by this club."
      editorEyebrow="Club overview"
      placeholder="Write an introduction to this club…"
      emptyMessage="Add About information to introduce your club."
      fieldId="club-about-content"
      save={({ entityId, content }) => updateClubAbout({ clubId: entityId, content })}
    />
  );
}
