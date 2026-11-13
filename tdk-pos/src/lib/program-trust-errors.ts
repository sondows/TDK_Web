export type ProgramTrustFailureCategory = "connection_limit" | "connection_failure" | "schema_error" | "internal_error";

const connectionLimitCodes = new Set(["ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS", "ER_USER_LIMIT_REACHED"]);
const connectionFailureCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND",
  "EAI_AGAIN", "PROTOCOL_CONNECTION_LOST", "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR", "ER_SERVER_SHUTDOWN",
]);
const schemaErrorCodes = new Set(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_BAD_TABLE_ERROR"]);

/** Extract only a known driver code; never return an error message or SQL text. */
export function classifyProgramTrustFailure(error: unknown): { category: ProgramTrustFailureCategory; code: string | null } {
  const root = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const rawCode = typeof root?.code === "string" ? root.code :
    typeof root?.cause?.code === "string" ? root.cause.code : "";
  const code = /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : null;
  if (code && connectionLimitCodes.has(code)) return { category: "connection_limit", code };
  if (code && connectionFailureCodes.has(code)) return { category: "connection_failure", code };
  if (code && schemaErrorCodes.has(code)) return { category: "schema_error", code };
  return { category: "internal_error", code };
}
