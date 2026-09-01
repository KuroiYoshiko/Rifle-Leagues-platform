import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClubPageFrame } from "@/components/club-page-frame";
import { ClubSettingsForm } from "@/components/club-settings-form";
import { Card, SectionHeader } from "@/components/ui";
import { getClubPageContextBySlug, isClubManager } from "@/lib/clubs";

export const metadata: Metadata = {
  title: "Club settings",
};

export default async function ClubSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getClubPageContextBySlug(slug);

  if (!context || !isClubManager(context.membership)) {
    notFound();
  }

  const { club, membership } = context;

  return (
    <ClubPageFrame club={club} membership={membership} currentSection="settings">
      <section aria-labelledby="club-settings-heading">
        <SectionHeader
          title="Club settings"
          description="Edit the basic details shown in club discovery"
        />
        <Card className="p-6 sm:p-8">
          <h2 id="club-settings-heading" className="sr-only">
            Club details
          </h2>
          <ClubSettingsForm club={club} />
        </Card>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          The club slug and status are managed separately and cannot be changed
          here. RifleLeagues does not provide club deletion in this area.
        </p>
      </section>
    </ClubPageFrame>
  );
}
