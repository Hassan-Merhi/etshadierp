const MAX_ERROR_STRING_LENGTH = 2_000;
const MAX_CAUSE_DEPTH = 4;

const DATABASE_ERROR_FIELDS = [
  "code",
  "severity",
  "detail",
  "hint",
  "constraint",
  "schema",
  "table",
  "column",
  "dataType",
  "routine",
] as const;

export type SafeLoggedError = {
  message: string;
  stack?: string;
  code?: string;
  severity?: string;
  detail?: string;
  hint?: string;
  constraint?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  routine?: string;
  cause?: SafeLoggedError;
};

function truncate(value: string): string {
  return value.length > MAX_ERROR_STRING_LENGTH
    ? `${value.slice(0, MAX_ERROR_STRING_LENGTH)}…`
    : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Convert an Error (including Drizzle's nested PostgreSQL `cause`) into a safe,
 * structured shape for logs. Query text, parameters, request bodies, and other
 * arbitrary properties are intentionally excluded.
 */
export function serialiseErrorForLog(
  error: unknown,
  includeStack = process.env.NODE_ENV !== "production",
  depth = 0,
  seen = new WeakSet<object>(),
): SafeLoggedError | undefined {
  if (error === undefined || error === null) return undefined;

  if (typeof error !== "object") {
    return { message: truncate(String(error)) };
  }

  if (seen.has(error)) return { message: "[Circular error cause]" };
  seen.add(error);

  const record = asRecord(error)!;
  const rawMessage =
    typeof record.message === "string"
      ? record.message
      : error instanceof Error
        ? error.message
        : String(error);

  const output: SafeLoggedError = { message: truncate(rawMessage) };

  if (includeStack && error instanceof Error && typeof error.stack === "string") {
    output.stack = truncate(error.stack);
  }

  for (const field of DATABASE_ERROR_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) {
      output[field] = truncate(value);
    }
  }

  if (depth < MAX_CAUSE_DEPTH && record.cause !== undefined && record.cause !== null) {
    output.cause = serialiseErrorForLog(record.cause, includeStack, depth + 1, seen);
  }

  return output;
}
