"use client";

import { useMemo, useState } from "react";
import { OwnerMemberActions } from "@/components/club-member-actions";
import { Badge, Card } from "@/components/ui";
import type { ClubRole, ManagedClubMember } from "@/lib/clubs";

const membersPerPage = 20;
const rolePriority: Record<ClubRole, number> = {
  owner: 0,
  official: 1,
  member: 2,
};
const nameCollator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

function normaliseSearchValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function memberName(member: ManagedClubMember) {
  return (
    [member.first_name?.trim(), member.last_name?.trim()]
      .filter(Boolean)
      .join(" ") || "Club member"
  );
}

function roleLabel(role: ClubRole) {
  return role[0].toUpperCase() + role.slice(1);
}

function compareNamePart(left: string | null, right: string | null) {
  const leftValue = left?.trim();
  const rightValue = right?.trim();

  if (!leftValue && !rightValue) return 0;
  if (!leftValue) return 1;
  if (!rightValue) return -1;
  return nameCollator.compare(leftValue, rightValue);
}

function compareMembers(left: ManagedClubMember, right: ManagedClubMember) {
  const roleDifference =
    rolePriority[left.club_role] - rolePriority[right.club_role];
  if (roleDifference !== 0) return roleDifference;

  const lastNameDifference = compareNamePart(left.last_name, right.last_name);
  if (lastNameDifference !== 0) return lastNameDifference;

  const firstNameDifference = compareNamePart(left.first_name, right.first_name);
  if (firstNameDifference !== 0) return firstNameDifference;

  return left.membership_id - right.membership_id;
}

function memberMatchesSearch(member: ManagedClubMember, query: string) {
  if (!query) return true;

  const firstName = normaliseSearchValue(member.first_name ?? "");
  const lastName = normaliseSearchValue(member.last_name ?? "");
  const fullName = normaliseSearchValue(
    [member.first_name, member.last_name].filter(Boolean).join(" "),
  );

  return (
    firstName.includes(query) ||
    lastName.includes(query) ||
    fullName.includes(query)
  );
}

function paginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "end-ellipsis", totalPages] as const;
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "start-ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "start-ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "end-ellipsis",
    totalPages,
  ] as const;
}

export function ActiveClubMembersList({
  members,
  currentMembershipId,
  currentUserIsOwner,
  club,
}: {
  members: ManagedClubMember[];
  currentMembershipId: number;
  currentUserIsOwner: boolean;
  club: { id: number; name: string; slug: string };
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const normalisedQuery = normaliseSearchValue(searchQuery);
  const filteredMembers = useMemo(
    () =>
      members
        .filter((member) => memberMatchesSearch(member, normalisedQuery))
        .sort(compareMembers),
    [members, normalisedQuery],
  );
  const totalPages = Math.ceil(filteredMembers.length / membersPerPage);
  const currentPage = Math.min(page, Math.max(totalPages, 1));
  const visibleMembers = filteredMembers.slice(
    (currentPage - 1) * membersPerPage,
    currentPage * membersPerPage,
  );
  const resultDescription = normalisedQuery
    ? `${filteredMembers.length} of ${members.length} active members`
    : `${members.length} active member${members.length === 1 ? "" : "s"}`;

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-[-0.025em] text-foreground">
          Active members
        </h2>
        <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
          {resultDescription}
        </p>
      </div>

      <div className="mb-4">
        <label htmlFor="active-member-search" className="sr-only">
          Search active members by name
        </label>
        <input
          id="active-member-search"
          type="search"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search members by name..."
          autoComplete="off"
          className="min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-brand focus:ring-4 focus:ring-brand/10"
        />
      </div>

      {visibleMembers.length > 0 ? (
        <Card className="divide-y divide-border">
          {visibleMembers.map((member) => {
            const name = memberName(member);
            const isCurrentUser = member.membership_id === currentMembershipId;

            return (
              <div
                key={member.membership_id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-5 sm:items-center sm:px-6"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 font-semibold text-foreground">
                      {name}
                      {isCurrentUser ? (
                        <span className="ml-1 font-normal text-muted-foreground">
                          (you)
                        </span>
                      ) : null}
                    </h3>
                    <Badge tone={member.club_role === "member" ? "neutral" : "brand"}>
                      {roleLabel(member.club_role)}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Membership recorded {dateFormatter.format(new Date(member.created_at))}
                  </p>
                </div>

                {currentUserIsOwner &&
                !isCurrentUser &&
                member.club_role !== "owner" ? (
                  <OwnerMemberActions
                    membershipId={member.membership_id}
                    memberName={name}
                    currentRole={member.club_role}
                    club={club}
                  />
                ) : null}
              </div>
            );
          })}
        </Card>
      ) : (
        <Card className="bg-surface-muted p-6 sm:p-8">
          <p className="text-sm text-muted-foreground">
            No members match your search.
          </p>
        </Card>
      )}

      {totalPages > 1 ? (
        <nav
          className="mt-5 flex flex-wrap items-center justify-center gap-2"
          aria-label="Active members pagination"
        >
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-neutral-strong transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45"
          >
            Previous
          </button>
          {paginationItems(currentPage, totalPages).map((item) =>
            typeof item === "number" ? (
              <button
                key={item}
                type="button"
                aria-label={`Go to page ${item}`}
                aria-current={item === currentPage ? "page" : undefined}
                onClick={() => setPage(item)}
                className={`grid min-h-10 min-w-10 place-items-center rounded-xl border px-2 text-xs font-semibold transition ${
                  item === currentPage
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-neutral-strong hover:bg-surface-muted"
                }`}
              >
                {item}
              </button>
            ) : (
              <span
                key={item}
                className="grid min-h-10 min-w-6 place-items-center text-xs text-muted-foreground"
                aria-hidden="true"
              >
                …
              </span>
            ),
          )}
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-neutral-strong transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45"
          >
            Next
          </button>
        </nav>
      ) : null}
    </>
  );
}
