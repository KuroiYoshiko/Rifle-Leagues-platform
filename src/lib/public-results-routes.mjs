const routeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedOrganisationSegments = new Set(["access", "register"]);
const reservedClubSegments = new Set(["register"]);

/** @param {string} pathname */
export function isPublicResultsPathname(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "clubs") {
    if (segments.length === 1) return true;

    const clubSlug = segments[1];
    if (
      !routeSlugPattern.test(clubSlug) ||
      reservedClubSegments.has(clubSlug)
    ) return false;
    if (segments.length === 2) return true;

    return (
      segments.length === 3 &&
      (segments[2] === "competitions" || segments[2] === "information")
    );
  }

  if (segments[0] !== "organisations") return false;
  if (segments.length === 1) return true;

  const organisationSlug = segments[1];
  if (
    !routeSlugPattern.test(organisationSlug) ||
    reservedOrganisationSegments.has(organisationSlug)
  ) return false;
  if (segments.length === 2) return true;
  if (segments[2] === "results") return segments.length === 3;
  if (segments[2] !== "leagues") return false;
  if (segments.length === 3) return true;

  const seasonSlug = segments[3];
  if (!routeSlugPattern.test(seasonSlug) || seasonSlug === "new") return false;
  if (segments.length === 4) return true;
  if (segments[4] !== "competitions") return false;

  const competitionSlug = segments[5];
  if (!competitionSlug) return false;
  if (!routeSlugPattern.test(competitionSlug) || competitionSlug === "new") {
    return false;
  }
  if (segments.length === 6) return true;
  return segments.length === 7 && segments[6] === "results";
}

/**
 * @param {{
 *   isAuthenticated: boolean;
 *   isOwner: boolean;
 *   hasManagementContext: boolean;
 *   competitionPublished: boolean;
 *   hasDivisionManagement: boolean;
 * }} input
 */
export function getCompetitionViewerCapabilities({
  isAuthenticated,
  isOwner,
  hasManagementContext,
  competitionPublished,
  hasDivisionManagement,
}) {
  return {
    loadEntryContext: isAuthenticated && competitionPublished,
    showEntryControls: isAuthenticated,
    showLifecycleActions: isAuthenticated && isOwner,
    showScoringAccess: isAuthenticated,
    showCompetitionManagement:
      isAuthenticated &&
      ((hasManagementContext && competitionPublished) || hasDivisionManagement),
  };
}
