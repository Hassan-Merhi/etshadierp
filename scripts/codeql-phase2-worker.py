from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}")
    file_path.write_text(text.replace(old, new, 1))


movement = "server/routes/inventory-movement/movement.ts"
replace_once(
    movement,
    '''      const { stockItemId: siStr, locationId: locStr, startDate, endDate } = req.query;
      if (!siStr) return res.status(400).json({ message: "stockItemId required" });

      const stockItemId = parseInt(siStr as string);
      const locationId = locStr ? parseInt(locStr as string) : null;
      // When no dates supplied (All Time preset), span from a safe epoch to today.
      const today = new Date().toISOString().slice(0, 10);
      const sd = (startDate as string) || "2000-01-01";
      const ed = (endDate as string) || today;
''',
    '''      const {
        stockItemId: stockItemIdRaw,
        locationId: locationIdRaw,
        startDate: startDateRaw,
        endDate: endDateRaw,
      } = req.query;
      if (typeof stockItemIdRaw !== "string") {
        return res.status(400).json({ message: "stockItemId must be a single positive integer" });
      }
      if (locationIdRaw !== undefined && typeof locationIdRaw !== "string") {
        return res.status(400).json({ message: "locationId must be a single positive integer" });
      }
      if (startDateRaw !== undefined && typeof startDateRaw !== "string") {
        return res.status(400).json({ message: "startDate must be a single YYYY-MM-DD value" });
      }
      if (endDateRaw !== undefined && typeof endDateRaw !== "string") {
        return res.status(400).json({ message: "endDate must be a single YYYY-MM-DD value" });
      }

      const stockItemId = Number.parseInt(stockItemIdRaw, 10);
      if (!Number.isSafeInteger(stockItemId) || stockItemId <= 0) {
        return res.status(400).json({ message: "stockItemId must be a single positive integer" });
      }

      let locationId: number | null = null;
      if (locationIdRaw) {
        const parsedLocationId = Number.parseInt(locationIdRaw, 10);
        if (!Number.isSafeInteger(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "locationId must be a single positive integer" });
        }
        locationId = parsedLocationId;
      }

      // When no dates supplied (All Time preset), span from a safe epoch to today.
      const today = new Date().toISOString().slice(0, 10);
      const sd = startDateRaw || "2000-01-01";
      const ed = endDateRaw || today;
      const datePattern = /^\\d{4}-\\d{2}-\\d{2}$/;
      if (!datePattern.test(sd) || !datePattern.test(ed) || sd > ed) {
        return res.status(400).json({ message: "Invalid inventory movement date range" });
      }
''',
)
replace_once(
    movement,
    '''      const { stockItemId: siStr, locationId: locStr, year: yearStr, month: monthStr } = req.query;
      if (!siStr || !yearStr || !monthStr)
        return res.status(400).json({ message: "stockItemId, year, month required" });

      const stockItemId = parseInt(siStr as string);
      const locationId = locStr ? parseInt(locStr as string) : null;
      const year = parseInt(yearStr as string);
      const month = parseInt(monthStr as string);
''',
    '''      const {
        stockItemId: stockItemIdRaw,
        locationId: locationIdRaw,
        year: yearRaw,
        month: monthRaw,
      } = req.query;
      if (typeof stockItemIdRaw !== "string" || typeof yearRaw !== "string" || typeof monthRaw !== "string") {
        return res.status(400).json({ message: "stockItemId, year, month must be single integer values" });
      }
      if (locationIdRaw !== undefined && typeof locationIdRaw !== "string") {
        return res.status(400).json({ message: "locationId must be a single positive integer" });
      }

      const stockItemId = Number.parseInt(stockItemIdRaw, 10);
      const year = Number.parseInt(yearRaw, 10);
      const month = Number.parseInt(monthRaw, 10);
      if (!Number.isSafeInteger(stockItemId) || stockItemId <= 0) {
        return res.status(400).json({ message: "stockItemId must be a single positive integer" });
      }
      if (!Number.isSafeInteger(year) || year < 2000 || year > 9999) {
        return res.status(400).json({ message: "year must be a valid four-digit year" });
      }
      if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
        return res.status(400).json({ message: "month must be between 1 and 12" });
      }

      let locationId: number | null = null;
      if (locationIdRaw) {
        const parsedLocationId = Number.parseInt(locationIdRaw, 10);
        if (!Number.isSafeInteger(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "locationId must be a single positive integer" });
        }
        locationId = parsedLocationId;
      }
''',
)

sp = "server/routes/sp/spExportRoutes.ts"
replace_once(
    sp,
    'import { requireSpCompany } from "./spHelpers";\n',
    'import { requireSpCompany } from "./spHelpers";\nimport { validateStatementDateRange } from "../../lib/accountStatementExportSafety";\n',
)
replace_once(
    sp,
    '''      const { fromDate, toDate, locationId } = req.query;

      if (!fromDate || !toDate) {
        return res.status(400).json({ message: "fromDate and toDate are required (YYYY-MM-DD)" });
      }

      const locId = locationId ? parseInt(locationId as string) : undefined;
''',
    '''      const { fromDate: fromDateRaw, toDate: toDateRaw, locationId: locationIdRaw } = req.query;

      if (typeof fromDateRaw !== "string" || typeof toDateRaw !== "string") {
        return res.status(400).json({ message: "fromDate and toDate must each be a single YYYY-MM-DD value" });
      }
      if (locationIdRaw !== undefined && typeof locationIdRaw !== "string") {
        return res.status(400).json({ message: "locationId must be a single positive integer" });
      }
      const dateRange = validateStatementDateRange(fromDateRaw, toDateRaw);
      if (!dateRange.ok) return res.status(400).json({ message: dateRange.message });

      let locId: number | undefined;
      if (locationIdRaw) {
        const parsedLocationId = Number.parseInt(locationIdRaw, 10);
        if (!Number.isSafeInteger(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "locationId must be a single positive integer" });
        }
        locId = parsedLocationId;
      }
      const fromDate = fromDateRaw;
      const toDate = toDateRaw;
''',
)
replace_once(sp, '        fromDate: fromDate as string,\n        toDate: toDate as string,\n', '        fromDate,\n        toDate,\n')
replace_once(
    sp,
    '      const from = (fromDate as string).slice(5).replace("-", "");\n      const to = (toDate as string).slice(5).replace("-", "");\n',
    '      const from = fromDate.slice(5).replace("-", "");\n      const to = toDate.slice(5).replace("-", "");\n',
)
replace_once(
    sp,
    '''      const { fromDate, toDate, locationId, cashAccountId } = req.query;

      if (!fromDate || !toDate) {
        return res.status(400).json({ message: "fromDate and toDate are required (YYYY-MM-DD)" });
      }

      const locId = locationId ? parseInt(locationId as string) : undefined;
      let cashId = cashAccountId ? parseInt(cashAccountId as string) : undefined;
''',
    '''      const {
        fromDate: fromDateRaw,
        toDate: toDateRaw,
        locationId: locationIdRaw,
        cashAccountId: cashAccountIdRaw,
      } = req.query;

      if (typeof fromDateRaw !== "string" || typeof toDateRaw !== "string") {
        return res.status(400).json({ message: "fromDate and toDate must each be a single YYYY-MM-DD value" });
      }
      if (locationIdRaw !== undefined && typeof locationIdRaw !== "string") {
        return res.status(400).json({ message: "locationId must be a single positive integer" });
      }
      if (cashAccountIdRaw !== undefined && typeof cashAccountIdRaw !== "string") {
        return res.status(400).json({ message: "cashAccountId must be a single positive integer" });
      }
      const dateRange = validateStatementDateRange(fromDateRaw, toDateRaw);
      if (!dateRange.ok) return res.status(400).json({ message: dateRange.message });

      let locId: number | undefined;
      if (locationIdRaw) {
        const parsedLocationId = Number.parseInt(locationIdRaw, 10);
        if (!Number.isSafeInteger(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "locationId must be a single positive integer" });
        }
        locId = parsedLocationId;
      }

      let cashId: number | undefined;
      if (cashAccountIdRaw) {
        const parsedCashId = Number.parseInt(cashAccountIdRaw, 10);
        if (!Number.isSafeInteger(parsedCashId) || parsedCashId <= 0) {
          return res.status(400).json({ message: "cashAccountId must be a single positive integer" });
        }
        cashId = parsedCashId;
      }
      const fromDate = fromDateRaw;
      const toDate = toDateRaw;
''',
)
replace_once(sp, '        fromDate: fromDate as string,\n        toDate: toDate as string,\n', '        fromDate,\n        toDate,\n')
replace_once(
    sp,
    '      const from = (fromDate as string).slice(5).replace("-", "");\n      const to = (toDate as string).slice(5).replace("-", "");\n',
    '      const from = fromDate.slice(5).replace("-", "");\n      const to = toDate.slice(5).replace("-", "");\n',
)

account = "server/routes/accountStatementRoutes.ts"
replace_once(
    account,
    '''      const accountType = req.params.type;
      const accountId = parseInt(req.params.id);
      const { endDate } = req.query as { endDate?: string };
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });
''',
    '''      const accountType = req.params.type;
      const accountId = parseInt(req.params.id);
      const endDateRaw = req.query.endDate;
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });
      if (endDateRaw !== undefined && typeof endDateRaw !== "string") {
        return res.status(400).json({ message: "endDate must be a single YYYY-MM-DD value" });
      }
      const endDate = endDateRaw;
      const endDateValidation = validateStatementDateRange(undefined, endDate);
      if (!endDateValidation.ok) return res.status(400).json({ message: endDateValidation.message });
''',
)
replace_once(
    account,
    '''      const {
        startDate,
        endDate,
        lang = "en",
      } = req.query as {
        startDate?: string;
        endDate?: string;
        lang?: string;
      };

      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });
      const dateRange = validateStatementDateRange(startDate, endDate);
''',
    '''      const { startDate: startDateRaw, endDate: endDateRaw, lang: langRaw } = req.query;

      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });
      if (startDateRaw !== undefined && typeof startDateRaw !== "string") {
        return res.status(400).json({ message: "startDate must be a single YYYY-MM-DD value" });
      }
      if (endDateRaw !== undefined && typeof endDateRaw !== "string") {
        return res.status(400).json({ message: "endDate must be a single YYYY-MM-DD value" });
      }
      if (langRaw !== undefined && typeof langRaw !== "string") {
        return res.status(400).json({ message: "lang must be a single string value" });
      }
      const startDate = startDateRaw;
      const endDate = endDateRaw;
      const lang = langRaw ?? "en";
      const dateRange = validateStatementDateRange(startDate, endDate);
''',
)
replace_once(
    account,
    '''      const accountType = (req.query.accountType as string) || "ledger";
      const accountId = parseInt(req.query.accountId as string);
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid accountId" });
      const startDate = (req.query.startDate as string) || undefined;
      const endDate = (req.query.endDate as string) || undefined;
      const dateRange = validateStatementDateRange(startDate, endDate);
''',
    '''      const accountTypeRaw = req.query.accountType;
      const accountIdRaw = req.query.accountId;
      const startDateRaw = req.query.startDate;
      const endDateRaw = req.query.endDate;
      if (accountTypeRaw !== undefined && typeof accountTypeRaw !== "string") {
        return res.status(400).json({ message: "accountType must be a single string value" });
      }
      if (typeof accountIdRaw !== "string") {
        return res.status(400).json({ message: "Invalid accountId" });
      }
      if (startDateRaw !== undefined && typeof startDateRaw !== "string") {
        return res.status(400).json({ message: "startDate must be a single YYYY-MM-DD value" });
      }
      if (endDateRaw !== undefined && typeof endDateRaw !== "string") {
        return res.status(400).json({ message: "endDate must be a single YYYY-MM-DD value" });
      }

      const accountType = accountTypeRaw || "ledger";
      const accountId = Number.parseInt(accountIdRaw, 10);
      if (!Number.isSafeInteger(accountId) || accountId <= 0) {
        return res.status(400).json({ message: "Invalid accountId" });
      }
      const startDate = startDateRaw;
      const endDate = endDateRaw;
      const dateRange = validateStatementDateRange(startDate, endDate);
''',
)

account_test = "tests/account-statement-routes-behavior.test.ts"
replace_once(
    account_test,
    '  it("generates a statement PDF with a sanitized human-readable filename", async () => {\n',
    '''  it("rejects repeated query values at account statement boundaries", async () => {
    const prePeriod = responseHarness();
    await routes.get("GET /api/accounts/:type/:id/pre-period-balance")!(
      request({ params: { type: "bank", id: "3" }, query: { endDate: ["2026-08-01", "2026-08-02"] } }),
      prePeriod
    );
    expect(prePeriod.statusCode).toBe(400);
    expect(harness.db.select).not.toHaveBeenCalled();

    const pdf = responseHarness();
    await routes.get("GET /api/accounts/:type/:id/statement-pdf")!(
      request({ params: { type: "supplier", id: "8" }, query: { startDate: ["2026-08-01"] } }),
      pdf
    );
    expect(pdf.statusCode).toBe(400);
    expect(harness.generateAccountStatementPdf).not.toHaveBeenCalled();

    const excel = responseHarness();
    await routes.get("GET /api/accounts/statement/export-excel")!(
      request({ query: { accountId: ["8", "9"] } }),
      excel
    );
    expect(excel.statusCode).toBe(400);
  });

  it("generates a statement PDF with a sanitized human-readable filename", async () => {
''',
)
