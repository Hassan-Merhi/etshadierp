export interface NormalizedProformaImportLine {
  barcode: string;
  itemName: string;
  qty: number;
  weightPerBale: string;
  pricePerBale: string;
}

export interface ProformaImportValidationResult {
  lines: NormalizedProformaImportLine[];
  errors: string[];
}

function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function normalizeNumberText(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return value == null ? "0" : null;

  let raw = value.trim();
  if (!raw) return "0";

  // Permit common currency/unit wrappers while rejecting embedded words.
  raw = raw.replace(/^[^0-9+\-.,]+/, "").replace(/[^0-9.,]+$/, "").replace(/\s+/g, "");
  if (!raw || !/^[+\-]?[0-9][0-9.,]*$/.test(raw)) return null;

  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");

  if (comma !== -1 && dot !== -1) {
    // Whichever separator appears last is the decimal separator; the other is thousands grouping.
    if (comma > dot) raw = raw.replace(/\./g, "").replace(",", ".");
    else raw = raw.replace(/,/g, "");
  } else if (comma !== -1) {
    const commaCount = (raw.match(/,/g) || []).length;
    const digitsAfter = raw.length - comma - 1;
    if (commaCount === 1 && digitsAfter > 0 && digitsAfter !== 3) raw = raw.replace(",", ".");
    else raw = raw.replace(/,/g, "");
  }

  return raw;
}

function parseDecimal(
  value: unknown,
  scale: number,
  maxIntegerDigits: number,
  label: string,
  rowNumber: number
): { value?: string; error?: string } {
  const normalized = normalizeNumberText(value);
  if (normalized === null || !/^[+\-]?\d+(?:\.\d+)?$/.test(normalized)) {
    return { error: `Row ${rowNumber}: ${label} is not a valid number` };
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { error: `Row ${rowNumber}: ${label} must be zero or greater` };
  }

  const [integerPart] = normalized.replace(/^[+\-]/, "").split(".");
  const significantIntegerDigits = integerPart.replace(/^0+(?=\d)/, "").length;
  if (significantIntegerDigits > maxIntegerDigits) {
    return { error: `Row ${rowNumber}: ${label} is too large` };
  }

  return { value: numeric.toFixed(scale) };
}

export function normalizeProformaImportLines(input: unknown[]): ProformaImportValidationResult {
  const lines: NormalizedProformaImportLine[] = [];
  const errors: string[] = [];

  input.forEach((rawLine, index) => {
    const rowNumber = index + 2; // spreadsheet row 1 is normally the header
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      errors.push(`Row ${rowNumber}: invalid row format`);
      return;
    }

    const record = rawLine as Record<string, unknown>;
    const barcode = String(getField(record, ["barcode", "Barcode", "code", "Code"]) ?? "").trim();
    const itemName = String(getField(record, ["itemName", "Item Name", "name", "Name"]) ?? "").trim();

    if (!barcode) errors.push(`Row ${rowNumber}: Barcode is required`);
    else if (barcode.length > 200) errors.push(`Row ${rowNumber}: Barcode is longer than 200 characters`);

    if (!itemName) errors.push(`Row ${rowNumber}: Item Name is required`);

    const qtyRaw = getField(record, ["qty", "Qty", "quantity", "Quantity"]);
    const qtyNumber = Number(normalizeNumberText(qtyRaw));
    if (!Number.isSafeInteger(qtyNumber) || qtyNumber < 0 || qtyNumber > 2_147_483_647) {
      errors.push(`Row ${rowNumber}: Qty must be a whole number from 0 to 2,147,483,647`);
    }

    const weight = parseDecimal(
      getField(record, ["weightPerBale", "Weight per Bale", "Weight/Bale", "Weight"]),
      3,
      12,
      "Weight per Bale",
      rowNumber
    );
    if (weight.error) errors.push(weight.error);

    const price = parseDecimal(
      getField(record, ["pricePerBale", "Price per Bale", "Price/Bale", "Price"]),
      2,
      13,
      "Price per Bale",
      rowNumber
    );
    if (price.error) errors.push(price.error);

    if (
      barcode &&
      barcode.length <= 200 &&
      itemName &&
      Number.isSafeInteger(qtyNumber) &&
      qtyNumber >= 0 &&
      qtyNumber <= 2_147_483_647 &&
      weight.value !== undefined &&
      price.value !== undefined
    ) {
      lines.push({
        barcode,
        itemName,
        qty: qtyNumber,
        weightPerBale: weight.value,
        pricePerBale: price.value,
      });
    }
  });

  return { lines, errors };
}
