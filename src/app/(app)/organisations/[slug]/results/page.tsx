import { redirect } from "next/navigation";

export default async function OrganisationResultsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/organisations/${slug}/leagues`);
}
