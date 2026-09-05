import { permanentRedirect } from "next/navigation";

export default async function CompetitionResultsPage({
  params,
}: {
  params: Promise<{
    slug: string;
    seasonSlug: string;
    competitionSlug: string;
  }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  permanentRedirect(
    `/organisations/${encodeURIComponent(slug)}/leagues/${encodeURIComponent(seasonSlug)}/competitions/${encodeURIComponent(competitionSlug)}#results`,
  );
}
