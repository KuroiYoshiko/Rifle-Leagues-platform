export function isRecoverySession(claims: { amr?: unknown } | null | undefined) {
  return Array.isArray(claims?.amr) && claims.amr.some((entry: unknown) =>
    entry === "recovery" || (
      entry !== null && typeof entry === "object" &&
      "method" in entry && entry.method === "recovery"
    ),
  );
}
