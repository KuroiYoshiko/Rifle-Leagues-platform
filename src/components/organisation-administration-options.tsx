import Link from "next/link";

const options = [
  {
    id: "access" as const,
    href: "/organisations/access",
    mark: "A",
    title: "Request management access",
    description:
      "I am authorised to help administer an organisation already registered on RifleLeagues.",
  },
  {
    id: "register" as const,
    href: "/organisations/register",
    mark: "B",
    title: "Register a new organisation",
    description:
      "My league organisation is not yet registered on RifleLeagues.",
  },
];

export function OrganisationAdministrationOptions({
  current,
}: {
  current: (typeof options)[number]["id"];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-label="Organisation administration options">
      {options.map((option) => {
        const isCurrent = option.id === current;

        return (
          <Link
            key={option.id}
            href={option.href}
            aria-current={isCurrent ? "page" : undefined}
            className={`group rounded-2xl border p-5 shadow-xs transition sm:p-6 ${
              isCurrent
                ? "border-brand/40 bg-brand-subtle"
                : "border-border bg-surface hover:border-brand/30 hover:bg-brand-subtle/45"
            }`}
          >
            <span
              className={`grid size-10 place-items-center rounded-xl text-xs font-bold ${
                isCurrent
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted text-brand-deep group-hover:bg-surface"
              }`}
              aria-hidden="true"
            >
              {option.mark}
            </span>
            <span className="mt-4 block font-semibold text-foreground">
              {option.title}
            </span>
            <span className="mt-2 block text-sm leading-6 text-muted-foreground">
              {option.description}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
