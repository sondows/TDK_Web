/** Safe, non-secret classification for database failures in KDS authentication. */
export function getKdsAuthSchemaError(error: unknown): { code: string; name: string } | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const item = current as { code?: unknown; errno?: unknown; name?: unknown; cause?: unknown };
    const code = typeof item.code === "string" ? item.code : "";
    const errno = Number(item.errno);
    if (["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(code)
      || [1054, 1146, 1051].includes(errno)) {
      return { code: code || String(errno), name: typeof item.name === "string" ? item.name : "DatabaseSchemaError" };
    }
    current = item.cause;
  }

  return null;
}

export function getKdsForeignKeyViolation(error: unknown): {
  constraint: string; childTable: string; childColumn: string; parentTable: string; parentColumn: string;
} | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const item = current as { code?: unknown; sqlMessage?: unknown; cause?: unknown };
    const code = typeof item.code === "string" ? item.code : "";
    if (code === "ER_NO_REFERENCED_ROW_2" && typeof item.sqlMessage === "string") {
      const match = item.sqlMessage.match(/CONSTRAINT `([^`]+)` FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)` \(`([^`]+)`\)/i);
      if (match) return {
        constraint: match[1], childTable: "staff_sessions", childColumn: match[2],
        parentTable: match[3], parentColumn: match[4],
      };
    }
    current = item.cause;
  }
  return null;
}
