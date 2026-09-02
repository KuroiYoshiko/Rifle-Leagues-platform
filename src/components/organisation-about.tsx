"use client";

import { updateOrganisationAbout } from "@/app/(app)/organisations/[slug]/actions";
import { RichTextDocument } from "@/components/rich-text-document";

export function OrganisationAbout({
  organisationId,
  initialContent,
  isOwner,
}: {
  organisationId: number;
  initialContent: string | null;
  isOwner: boolean;
}) {
  return (
    <RichTextDocument
      entityId={organisationId}
      entityLabel="Organisation"
      initialContent={initialContent}
      isOwner={isOwner}
      description="Public introduction supplied by this organisation."
      editorEyebrow="Organisation overview"
      placeholder="Write an introduction to this organisation…"
      emptyMessage="No organisation introduction has been published yet."
      fieldId="organisation-about-content"
      save={({ entityId, content }) =>
        updateOrganisationAbout({ organisationId: entityId, content })
      }
    />
  );
}
