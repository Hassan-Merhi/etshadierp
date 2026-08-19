export type StatementDateRangeValidation =
  | { ok: true }
  | { ok: false; message: string };

function buildLocalDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Normalizes database/driver date values into a real JavaScript Date suitable
 * for ExcelJS. In particular, this avoids concatenating `T00:00:00` onto a
 * value that is already a Date, which creates an Invalid Date and corrupts the
 * generated XLSX XML with `NaN`.
 */
export function normalizeStatementDate(value: unknown): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return buildLocalDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(trimmed);
  if (dateOnly) {
    return buildLocalDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return buildLocalDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

export function statementDateKey(value: unknown): string | null {
  const date = normalizeStatementDate(value);
  if (!date) return null;
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function validateStatementDateRange(startDate?: string, endDate?: string): StatementDateRangeValidation {
  const validate = (value: string | undefined, label: string) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !normalizeStatementDate(value)) {
      return `${label} must be a valid date in YYYY-MM-DD format`;
    }
    return null;
  };

  const startError = validate(startDate, "startDate");
  if (startError) return { ok: false, message: startError };
  const endError = validate(endDate, "endDate");
  if (endError) return { ok: false, message: endError };
  if (startDate && endDate && startDate > endDate) {
    return { ok: false, message: "startDate cannot be after endDate" };
  }
  return { ok: true };
}

export function assertValidPdfBuffer(value: unknown): asserts value is Buffer {
  if (!Buffer.isBuffer(value) || value.length < 5 || value.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("Statement PDF generation returned an invalid or empty PDF buffer");
  }
}
