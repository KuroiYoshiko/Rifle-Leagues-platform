import "server-only";

export class SiteUrlConfigurationError extends Error {
  readonly code: "SITE_URL_MISSING" | "SITE_URL_INVALID";

  constructor(code: SiteUrlConfigurationError["code"]) {
    super(code === "SITE_URL_MISSING"
      ? "The canonical site URL is not configured."
      : "The canonical site URL is invalid.");
    this.name = "SiteUrlConfigurationError";
    this.code = code;
  }
}

export function getRegistrationConfirmationUrl(input: {
  nodeEnv: string | undefined;
  configuredSiteUrl: string | undefined;
  requestOrigin: string | null;
}) {
  const configuredSiteUrl = input.configuredSiteUrl?.trim();
  const candidate = configuredSiteUrl || (
    input.nodeEnv === "production"
      ? null
      : input.requestOrigin ?? "http://localhost:3000"
  );

  if (!candidate) throw new SiteUrlConfigurationError("SITE_URL_MISSING");

  let siteUrl: URL;
  try {
    siteUrl = new URL(candidate);
  } catch {
    throw new SiteUrlConfigurationError("SITE_URL_INVALID");
  }

  if (
    !["http:", "https:"].includes(siteUrl.protocol) ||
    siteUrl.username ||
    siteUrl.password ||
    siteUrl.pathname !== "/" ||
    siteUrl.search ||
    siteUrl.hash
  ) {
    throw new SiteUrlConfigurationError("SITE_URL_INVALID");
  }

  return new URL("/auth/confirm", siteUrl.origin).toString();
}
