import "server-only";

export type SafeEntityIds = Readonly<Record<string, string | number | null | undefined>>;

export type ServerErrorDiagnostic = {
  correlationId: string;
  operation: string;
  category: "deployment" | "unexpected";
  code: string | null;
  entityIds: Record<string, string | number | null>;
};

export type ServerErrorReporter = (diagnostic: ServerErrorDiagnostic) => void;

function correlationId() {
  return globalThis.crypto?.randomUUID?.() ??
    `error-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normaliseEntityIds(entityIds: SafeEntityIds | undefined) {
  return Object.fromEntries(
    Object.entries(entityIds ?? {}).flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || value === null
        ? [[key, value]]
        : [],
    ),
  );
}

export const reportUnexpectedServerError: ServerErrorReporter = (diagnostic) => {
  console.error("[server-error] handled operation failed", diagnostic);
};

export function createServerErrorDiagnostic(input: {
  operation: string;
  category: ServerErrorDiagnostic["category"];
  code?: string | null;
  entityIds?: SafeEntityIds;
}): ServerErrorDiagnostic {
  return {
    correlationId: correlationId(),
    operation: input.operation,
    category: input.category,
    code: input.code ?? null,
    entityIds: normaliseEntityIds(input.entityIds),
  };
}
