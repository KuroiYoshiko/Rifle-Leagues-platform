import Link from "next/link";
import type { ReactNode } from "react";
import {
  getOrganisationManagementContextBySlug,
  type Organisation,
} from "@/lib/organisations";

export type OrganisationSection =
  | "overview"
  | "leagues"
  | "results"
  | "information"
  | "contact"
  | "management";

const sectionItems: Array<{
  id: OrganisationSection;
  label: string;
  suffix: string;
}> = [
  { id: "overview", label: "Overview", suffix: "" },
  { id: "leagues", label: "Seasons", suffix: "/leagues" },
  { id: "results", label: "Results", suffix: "/results" },
  { id: "information", label: "Information", suffix: "/information" },
  { id: "contact", label: "Contact", suffix: "/contact" },
];

export async function OrganisationPageFrame({
  organisation,
  currentSection,
  children,
}: {
  organisation: Organisation;
  currentSection: OrganisationSection;
  children: ReactNode;
}) {
  const basePath = `/organisations/${organisation.slug}`;
  const managementContext = await getOrganisationManagementContextBySlug(
    organisation.slug,
  );
  const showManagement = Boolean(managementContext);
  const visibleSectionItems = showManagement
    ? [
        ...sectionItems,
        { id: "management" as const, label: "Management", suffix: "/management" },
      ]
    : sectionItems;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-brand-strong">
            {organisation.short_name ?? "League organisation"}
          </p>
          <h1 className="mt-3 max-w-4xl break-words text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
            {organisation.name}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Public league context and information from this organisation.
          </p>
        </div>
        <Link
          href="/organisations"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
        >
          Browse organisations
        </Link>
      </div>

      <nav
        className="organisation-section-navigation mt-8 overflow-x-auto rounded-2xl border border-border bg-surface p-2 shadow-xs"
        aria-label={`${organisation.name} sections`}
      >
        <div className="flex min-w-max gap-1">
          {visibleSectionItems.map((item) => {
            const isActive = item.id === currentSection;

            return (
              <Link
                key={item.id}
                href={`${basePath}${item.suffix}`}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold transition ${
                  isActive
                    ? "bg-brand-subtle text-brand-deep"
                    : "text-neutral-strong hover:bg-brand-subtle hover:text-brand-deep"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-8">{children}</div>
    </div>
  );
}

export function OrganisationEmptyState({
  mark,
  title,
  description,
}: {
  mark: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-start gap-5 sm:flex-row">
      <span
        className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-subtle text-sm font-bold text-brand-deep"
        aria-hidden="true"
      >
        {mark}
      </span>
      <div>
        <h2 className="font-semibold text-foreground">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
