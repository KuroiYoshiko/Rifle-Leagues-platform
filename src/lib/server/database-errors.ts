import "server-only";

import {
  createServerErrorDiagnostic,
  reportUnexpectedServerError,
  type SafeEntityIds,
  type ServerErrorReporter,
} from "@/lib/server/unexpected-error";

export const DATABASE_SERVICE_UNAVAILABLE_MESSAGE =
  "This service is temporarily unavailable. Please try again later or contact support.";

export const UNEXPECTED_DATABASE_ERROR_MESSAGE =
  "The request could not be completed. Please try again later.";

export type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
};

export type DatabaseErrorKind =
  | "domain"
  | "authorization"
  | "missing"
  | "deployment"
  | "unexpected";

export type SafeDomainErrorRule = {
  code?: string | readonly string[];
  message: string | RegExp;
  userMessage: string | ((error: DatabaseErrorLike) => string);
};

export type DatabaseErrorOptions = {
  operation: string;
  entityIds?: SafeEntityIds;
  authorizationMessage: string;
  missingMessage: string;
  unexpectedMessage?: string;
  serviceUnavailableMessage?: string;
  safeDomainErrors?: readonly SafeDomainErrorRule[];
  reporter?: ServerErrorReporter;
};

export type ClassifiedDatabaseError = {
  kind: DatabaseErrorKind;
  message: string;
};

const deploymentErrorCodes = new Set([
  "PGRST202",
  "PGRST205",
  "42883",
  "42P01",
  "42704",
  "3F000",
]);

function ruleCodeMatches(rule: SafeDomainErrorRule, code: string | null) {
  if (!rule.code) return true;
  return Array.isArray(rule.code)
    ? rule.code.includes(code ?? "")
    : rule.code === code;
}

function ruleMessageMatches(rule: SafeDomainErrorRule, message: string) {
  if (typeof rule.message === "string") return rule.message === message;
  rule.message.lastIndex = 0;
  return rule.message.test(message);
}

export function classifyDatabaseError(
  error: DatabaseErrorLike,
  options: Omit<DatabaseErrorOptions, "operation" | "entityIds" | "reporter">,
): ClassifiedDatabaseError {
  const code = error.code ?? null;
  const message = error.message ?? "";
  const safeDomainRule = options.safeDomainErrors?.find(
    (rule) => ruleCodeMatches(rule, code) && ruleMessageMatches(rule, message),
  );

  if (safeDomainRule) {
    return {
      kind: "domain",
      message: typeof safeDomainRule.userMessage === "function"
        ? safeDomainRule.userMessage(error)
        : safeDomainRule.userMessage,
    };
  }

  if (code && deploymentErrorCodes.has(code)) {
    return {
      kind: "deployment",
      message: options.serviceUnavailableMessage ?? DATABASE_SERVICE_UNAVAILABLE_MESSAGE,
    };
  }

  if (code === "42501") {
    return { kind: "authorization", message: options.authorizationMessage };
  }

  if (code === "P0002") {
    return { kind: "missing", message: options.missingMessage };
  }

  return {
    kind: "unexpected",
    message: options.unexpectedMessage ?? UNEXPECTED_DATABASE_ERROR_MESSAGE,
  };
}

export function resolveDatabaseError(
  error: DatabaseErrorLike,
  options: DatabaseErrorOptions,
): ClassifiedDatabaseError {
  const classified = classifyDatabaseError(error, options);

  if (classified.kind === "deployment" || classified.kind === "unexpected") {
    const reporter = options.reporter ?? reportUnexpectedServerError;
    reporter(createServerErrorDiagnostic({
      operation: options.operation,
      category: classified.kind,
      code: error.code,
      entityIds: options.entityIds,
    }));
  }

  return classified;
}
