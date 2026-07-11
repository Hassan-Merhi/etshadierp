import fs from "node:fs";
import { execFileSync } from "node:child_process";

const branch = "agent/combo-4b-payroll-nonstock-typescript-v3";

function git(...args) {
  execFileSync("git", args, { stdio: "inherit" });
}

function replaceExact(path, oldText, newText, expected = 1) {
  const source = fs.readFileSync(path, "utf8");
  const count = source.split(oldText).length - 1;
  if (count !== expected) {
    throw new Error(`${path}: expected ${expected} match(es), found ${count}`);
  }
  fs.writeFileSync(path, source.replaceAll(oldText, newText));
}

function replaceLineExact(path, lineNumber, oldText, newText) {
  const source = fs.readFileSync(path, "utf8");
  const lines = source.split("\n");
  const index = lineNumber - 1;
  if (lines[index] !== oldText) {
    throw new Error(`${path}:${lineNumber}: expected ${JSON.stringify(oldText)}, found ${JSON.stringify(lines[index])}`);
  }
  lines[index] = newText;
  fs.writeFileSync(path, lines.join("\n"));
}

git("fetch", "origin", branch, "main");
git("checkout", "-B", branch, `origin/${branch}`);

replaceExact(
  "server/routes/payroll/payrollCoreRoutes.ts",
  "        const workerIds = [...new Set(payrollsToMark.map((p: any) => p.workerId))];",
  "        const workerIds = Array.from(new Set<number>(payrollsToMark.map((p: any) => p.workerId)));"
);

replaceExact(
  "server/routes/payroll/workerStatsAdvancesRoutes.ts",
  `      const conditions: any[] = [eq(factoryAdvanceRepayments.companyId, companyId)];
      if (req.query.workerId)
        conditions.push(eq(factoryAdvanceRepayments.workerId, parseOptionalId(req.query.workerId)));`,
  `      const conditions: any[] = [eq(factoryAdvanceRepayments.companyId, companyId)];
      const workerId = req.query.workerId ? parseOptionalId(req.query.workerId) : null;
      if (req.query.workerId && workerId === null) {
        return res.status(400).json({ message: "Invalid workerId" });
      }
      if (workerId !== null) conditions.push(eq(factoryAdvanceRepayments.workerId, workerId));`
);

replaceExact(
  "server/routes/payroll/workerStatsAdvancesRoutes.ts",
  `      const conditions: any[] = [eq(factoryWorkerAdvances.companyId, companyId)];
      if (req.query.workerId) conditions.push(eq(factoryWorkerAdvances.workerId, parseOptionalId(req.query.workerId)));`,
  `      const conditions: any[] = [eq(factoryWorkerAdvances.companyId, companyId)];
      const workerId = req.query.workerId ? parseOptionalId(req.query.workerId) : null;
      if (req.query.workerId && workerId === null) {
        return res.status(400).json({ message: "Invalid workerId" });
      }
      if (workerId !== null) conditions.push(eq(factoryWorkerAdvances.workerId, workerId));`
);

replaceExact(
  "server/routes/payroll/workerStatsAdvancesRoutes.ts",
  `      const workerId = parseId(req.params.id);
      const deductions = await db`,
  `      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });
      const deductions = await db`
);

replaceExact(
  "server/routes/payroll/workerStatsAdvancesRoutes.ts",
  `      const workerId = parseId(req.params.id);
      const { amount, reason, deductionDate } = req.body;`,
  `      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });
      const { amount, reason, deductionDate } = req.body;`
);

replaceExact(
  "server/routes/payroll/workerStatsAdvancesRoutes.ts",
  `      const deductionId = parseId(req.params.id);
      const [existing] = await db`,
  `      const deductionId = parseId(req.params.id);
      if (deductionId === null) return res.status(400).json({ message: "Invalid id" });
      const [existing] = await db`
);

const daybookPath = "server/routes/factory/customer-orders/orderChargesRoutes.ts";
const daybookOld = "            .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })";
const daybookNew = "            .set({ amountCurrency: String(newGrandTotal), amountUsd: String(newGrandTotal) })";
replaceLineExact(daybookPath, 271, daybookOld, daybookNew);
replaceLineExact(daybookPath, 292, daybookOld, daybookNew);
replaceLineExact(daybookPath, 857, daybookOld, daybookNew);

replaceExact(
  "server/routes/factory/suppliers/supplierCrudRoutes.ts",
  `      let query = db
        .select()
        .from(factorySupplierPayments)
        .where(eq(factorySupplierPayments.companyId, companyId))
        .orderBy(desc(factorySupplierPayments.date));

      if (supplierIds.length > 0) {
        query = query.where(
          and(
            eq(factorySupplierPayments.companyId, companyId),
            inArray(factorySupplierPayments.supplierId, supplierIds)
          )
        );
      }

      const payments = await query;`,
  `      const paymentConditions = [eq(factorySupplierPayments.companyId, companyId)];
      if (supplierIds.length > 0) {
        paymentConditions.push(inArray(factorySupplierPayments.supplierId, supplierIds));
      }

      const payments = await db
        .select()
        .from(factorySupplierPayments)
        .where(and(...paymentConditions))
        .orderBy(desc(factorySupplierPayments.date));`
);

git("checkout", "origin/main", "--", "package.json");
fs.rmSync("scripts/combo-4b-apply.mjs");

git("config", "user.name", "github-actions[bot]");
git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
git("add", "-A");
git("commit", "-m", "Fix Combo 4B payroll and non-stock TypeScript errors");
git("push", "origin", `HEAD:${branch}`);

console.log("Combo 4B source patch committed and bootstrap removed.");
