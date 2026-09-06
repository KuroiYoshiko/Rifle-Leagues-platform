import { NextResponse } from "next/server";
import {
  getPublicClubResultsCatalog,
  getPublicResultsCatalog,
} from "@/lib/public-results";
import { normaliseSavedPublicResults } from "@/lib/saved-public-results.mjs";

type SavedItem = {
  type: "club" | "organisation";
  slug: string;
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ items: [] }, { status: 400 });
  }

  const rawItems = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { items?: unknown }).items
    : [];
  const items = normaliseSavedPublicResults(rawItems) as SavedItem[];
  let lookupFailed = false;
  const resolved = await Promise.all(items.map(async (item) => {
    try {
      if (item.type === "club") {
        const catalog = await getPublicClubResultsCatalog({ clubSlug: item.slug });
        return catalog?.club
          ? { type: item.type, slug: item.slug, name: catalog.club.name }
          : null;
      }

      const catalog = await getPublicResultsCatalog({
        organisationSlug: item.slug,
      });
      return catalog?.organisation
        ? { type: item.type, slug: item.slug, name: catalog.organisation.name }
        : null;
    } catch {
      lookupFailed = true;
      return null;
    }
  }));

  if (lookupFailed) {
    return NextResponse.json({ items: [] }, { status: 503 });
  }

  return NextResponse.json(
    { items: resolved.filter((item) => item !== null) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
