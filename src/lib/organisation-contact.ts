export type OrganisationContactField =
  | "address"
  | "postcode"
  | "telephone"
  | "contactEmail"
  | "website";

export type OrganisationContactValues = Record<OrganisationContactField, string>;

export type OrganisationContactFieldErrors = Partial<
  Record<OrganisationContactField, string>
>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseOrganisationContactValues(values: {
  address: unknown;
  postcode: unknown;
  telephone: unknown;
  contactEmail: unknown;
  website: unknown;
}): OrganisationContactValues {
  return {
    address: String(values.address ?? "").trim(),
    postcode: String(values.postcode ?? "").trim(),
    telephone: String(values.telephone ?? "").trim(),
    contactEmail: String(values.contactEmail ?? "").trim().toLowerCase(),
    website: String(values.website ?? "").trim(),
  };
}

export function validateOrganisationContact(
  values: OrganisationContactValues,
): OrganisationContactFieldErrors {
  const fieldErrors: OrganisationContactFieldErrors = {};

  if (values.address.length > 1000) {
    fieldErrors.address = "Use 1000 characters or fewer.";
  }

  if (values.postcode.length > 20) {
    fieldErrors.postcode = "Use 20 characters or fewer.";
  }

  if (
    values.telephone &&
    (values.telephone.length < 3 || values.telephone.length > 50)
  ) {
    fieldErrors.telephone = "Use between 3 and 50 characters.";
  }

  if (values.contactEmail.length > 320) {
    fieldErrors.contactEmail = "Use 320 characters or fewer.";
  } else if (values.contactEmail && !emailPattern.test(values.contactEmail)) {
    fieldErrors.contactEmail = "Enter a valid email address.";
  }

  if (values.website) {
    try {
      const url = new URL(values.website);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        fieldErrors.website = "Use a website beginning with http:// or https://.";
      }
    } catch {
      fieldErrors.website = "Enter a complete website address.";
    }

    if (values.website.length > 2048) {
      fieldErrors.website = "Use 2048 characters or fewer.";
    }
  }

  return fieldErrors;
}
