import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import {
  OrganisationManagerActions,
  OrganisationRequestDecisionControls,
} from "@/components/organisation-staff-actions";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  getOrganisationManagementContextBySlug,
  getOrganisationStaffName,
  type ManagedOrganisationStaff,
} from "@/lib/organisations";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Organisation management",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Warsaw",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export default async function OrganisationManagementPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);

  if (!context) {
    notFound();
  }

  const { organisation, access } = context;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_organisation_staff", {
    p_organisation_id: organisation.id,
  });
  const staff = (data ?? []) as ManagedOrganisationStaff[];
  const pendingRequests = staff.filter(
    (person) => person.staff_status === "pending",
  );
  const activeStaff = staff.filter(
    (person) => person.staff_status === "active",
  );
  const currentUserIsOwner = access.role === "owner";

  return (
    <OrganisationPageFrame
      organisation={organisation}
      currentSection="management"
    >
      {error ? (
        <Card className="border-danger/20 p-6 sm:p-8">
          <div role="alert">
            <h2 className="font-semibold text-foreground">
              Organisation staff could not be loaded
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Run the latest organisation staff SQL in Supabase, then refresh
              this page.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {currentUserIsOwner ? (
            <section aria-labelledby="management-requests-heading">
              <SectionHeader
                title="Management access requests"
                description={`${pendingRequests.length} request${
                  pendingRequests.length === 1 ? "" : "s"
                } waiting`}
              />
              {pendingRequests.length > 0 ? (
                <div className="space-y-3">
                  {pendingRequests.map((person) => {
                    const staffName = getOrganisationStaffName(person);

                    return (
                      <Card key={person.staff_id} className="p-5 sm:p-6">
                        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <div>
                            <h3 className="font-semibold text-foreground">
                              {staffName}
                            </h3>
                            <p className="mt-1.5 text-sm text-muted-foreground">
                              Requested {formatDate(person.updated_at)}
                            </p>
                          </div>
                          <OrganisationRequestDecisionControls
                            staffId={person.staff_id}
                            staffName={staffName}
                            organisationSlug={organisation.slug}
                          />
                        </div>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card className="bg-surface-muted p-6">
                  <p className="text-sm text-muted-foreground">
                    There are no pending management access requests.
                  </p>
                </Card>
              )}
            </section>
          ) : null}

          <section className={currentUserIsOwner ? "mt-10" : undefined}>
            <SectionHeader
              title="Organisation staff"
              description={`${activeStaff.length} active staff member${
                activeStaff.length === 1 ? "" : "s"
              }`}
            />
            {activeStaff.length > 0 ? (
              <Card className="divide-y divide-border">
                {activeStaff.map((person) => {
                  const staffName = getOrganisationStaffName(person);
                  const isCurrentUser = person.staff_id === access.id;

                  return (
                    <div
                      key={person.staff_id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 p-5 sm:items-center sm:px-6"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground">
                            {staffName}
                            {isCurrentUser ? (
                              <span className="ml-1 font-normal text-muted-foreground">
                                (you)
                              </span>
                            ) : null}
                          </h3>
                          <Badge tone="brand">
                            {person.staff_role === "owner" ? "Owner" : "Manager"}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Access recorded {formatDate(person.created_at)}
                        </p>
                      </div>

                      {currentUserIsOwner &&
                      !isCurrentUser &&
                      person.staff_role === "manager" ? (
                        <OrganisationManagerActions
                          staffId={person.staff_id}
                          staffName={staffName}
                          organisation={{
                            id: organisation.id,
                            name: organisation.name,
                            slug: organisation.slug,
                          }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </Card>
            ) : (
              <Card className="bg-surface-muted p-6">
                <p className="text-sm text-muted-foreground">
                  No active organisation staff could be loaded.
                </p>
              </Card>
            )}
          </section>
        </>
      )}
    </OrganisationPageFrame>
  );
}
