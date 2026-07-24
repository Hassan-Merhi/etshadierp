/**
 * server/chat/reports.ts
 *
 * Read-only "data query" report dispatcher, extracted verbatim from
 * chatService.ts. Given a classified queryType plus request context, it runs the
 * matching SQL report and returns a structured result (title/subtitle/stats/table).
 *
 * Pure reporting: every branch only READS via db.execute(sql`…`) and formats an
 * object. No voucher/transfer/stock mutation occurs here. Behaviour is unchanged
 * from the original inline switch in chatService.chat().
 */
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, isNull, asc, ilike, or, inArray } from "drizzle-orm";

export interface DataQueryContext {
  companyId: number;
  params: any;
  dateFrom: string;
  dateTo: string;
  todayStr: string;
  todayDate: Date;
  thisMonthStart: string;
  lastMonthStart: string;
  lastMonthEnd: string;
  rowLimit: number;
  userMessage: string;
  fmt: (n: number) => string;
  fmtDec: (n: number) => string;
}

/** Dispatch a classified read-only report query to its handler. */
export async function runDataQuery(ctx: DataQueryContext): Promise<any | undefined> {
  const {
    companyId,
    params,
    dateFrom,
    dateTo,
    todayStr,
    todayDate,
    thisMonthStart,
    lastMonthStart,
    lastMonthEnd,
    rowLimit,
    userMessage,
    fmt,
    fmtDec,
  } = ctx;
  let dataQueryResult: any = undefined;

            switch (params.queryType) {
              case "pl_summary": {
                const rows = await db.execute(sql`
                  SELECT la.account_type,
                    COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) AS total_debit,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_credit
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id AND v.optional = false AND v.deleted_at IS NULL
                  JOIN ledger_accounts la ON la.id = ve.ledger_account_id AND la.company_id = ${companyId}
                  WHERE v.voucher_date BETWEEN ${dateFrom} AND ${dateTo}
                    AND la.account_type IN ('Income','Expense','Direct Expense','Indirect Expense','Profit')
                  GROUP BY la.account_type
                `);
                let revenue = 0,
                  cogs = 0,
                  opex = 0;
                for (const row of rows.rows as any[]) {
                  const dr = parseFloat(row.total_debit || "0");
                  const cr = parseFloat(row.total_credit || "0");
                  if (row.account_type === "Income") revenue += cr - dr;
                  else if (row.account_type === "Direct Expense") cogs += dr - cr;
                  else opex += dr - cr;
                }
                const gross = revenue - cogs;
                const net = gross - opex;
                dataQueryResult = {
                  queryType: "pl_summary",
                  title: "Profit & Loss Summary",
                  subtitle: `${dateFrom} to ${dateTo}`,
                  stats: [
                    { label: "Revenue", value: fmt(revenue), highlight: revenue >= 0 ? "positive" : "negative" },
                    { label: "Cost of Goods Sold", value: fmt(cogs), highlight: "muted" },
                    { label: "Gross Profit", value: fmt(gross), highlight: gross >= 0 ? "positive" : "negative" },
                    { label: "Operating Expenses", value: fmt(opex), highlight: "muted" },
                    { label: "Net Profit / (Loss)", value: fmt(net), highlight: net >= 0 ? "positive" : "negative" },
                  ],
                };
                break;
              }

              case "cash_position": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.account_type, la.opening_balance, la.opening_balance_side,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.account_type IN ('Cash','Bank') AND la.active = true AND la.deleted_at IS NULL
                  GROUP BY la.id, la.name, la.account_type, la.opening_balance, la.opening_balance_side
                  ORDER BY la.account_type, la.name
                `);
                let grandTotal = 0;
                const stats: any[] = (rows.rows as any[]).map((row) => {
                  const ob = parseFloat(row.opening_balance || "0");
                  const obAdj = row.opening_balance_side === "Cr" ? -ob : ob;
                  const bal = obAdj + parseFloat(row.total_debit || "0") - parseFloat(row.total_credit || "0");
                  grandTotal += bal;
                  return {
                    label: `${row.name} (${row.account_type})`,
                    value: fmt(bal),
                    highlight: bal >= 0 ? "positive" : "negative",
                  };
                });
                stats.push({
                  label: "TOTAL CASH & BANK",
                  value: fmt(grandTotal),
                  highlight: grandTotal >= 0 ? "positive" : "negative",
                });
                dataQueryResult = {
                  queryType: "cash_position",
                  title: "Cash & Bank Positions",
                  subtitle: `As of ${todayStr}`,
                  stats,
                };
                break;
              }

              case "overdue_payments": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.opening_balance, la.opening_balance_side,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit,
                    MAX(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN v.voucher_date END) AS last_tx
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.active = true AND la.deleted_at IS NULL
                    AND la.account_type NOT IN ('Cash','Bank','Income','Expense','Direct Expense','Indirect Expense','Equity','Profit','Government Taxes')
                  GROUP BY la.id, la.name, la.opening_balance, la.opening_balance_side
                  HAVING (
                    CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) > 100
                  ORDER BY (
                    CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows = (rows.rows as any[]).map((row) => {
                  const ob = parseFloat(row.opening_balance || "0");
                  const obAdj = row.opening_balance_side === "Cr" ? -ob : ob;
                  const bal = obAdj + parseFloat(row.total_debit || "0") - parseFloat(row.total_credit || "0");
                  const lastTx = row.last_tx ? String(row.last_tx).slice(0, 10) : "—";
                  return [row.name, fmt(bal), lastTx];
                });
                dataQueryResult = {
                  queryType: "overdue_payments",
                  title: "Outstanding Receivables",
                  subtitle: "Accounts with debit balance (they owe you)",
                  table: { headers: ["Account", "Balance Owed", "Last Transaction"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "customer_statement": {
                const name = params.entityName;
                if (!name) {
                  dataQueryResult = {
                    queryType: "customer_statement",
                    title: "Customer Statement",
                    summary: "Please specify a customer name.",
                  };
                  break;
                }
                const accts = await db
                  .select({ id: schema.ledgerAccounts.id, name: schema.ledgerAccounts.name })
                  .from(schema.ledgerAccounts)
                  .where(
                    and(
                      eq(schema.ledgerAccounts.companyId, companyId),
                      ilike(schema.ledgerAccounts.name, `%${name}%`),
                      isNull(schema.ledgerAccounts.deletedAt)
                    )
                  )
                  .limit(3);
                if (!accts.length) {
                  dataQueryResult = {
                    queryType: "customer_statement",
                    title: `Customer: ${name}`,
                    summary: "No account found matching that name.",
                  };
                  break;
                }
                const acct = accts[0];
                const txRows = await db
                  .select({
                    voucherDate: schema.vouchers.voucherDate,
                    voucherType: schema.vouchers.voucherType,
                    description: schema.vouchers.description,
                    debitAmount: schema.voucherEntries.debitAmount,
                    creditAmount: schema.voucherEntries.creditAmount,
                  })
                  .from(schema.voucherEntries)
                  .innerJoin(
                    schema.vouchers,
                    and(
                      eq(schema.voucherEntries.voucherId, schema.vouchers.id),
                      eq(schema.vouchers.optional, false),
                      isNull(schema.vouchers.deletedAt)
                    )
                  )
                  .where(eq(schema.voucherEntries.ledgerAccountId, acct.id))
                  .orderBy(desc(schema.vouchers.voucherDate))
                  .limit(rowLimit);
                const tableRows = txRows.map((r) => [
                  r.voucherDate || "—",
                  r.voucherType || "—",
                  (r.description || "").slice(0, 40),
                  parseFloat(r.debitAmount || "0") > 0 ? fmtDec(parseFloat(r.debitAmount!)) : "—",
                  parseFloat(r.creditAmount || "0") > 0 ? fmtDec(parseFloat(r.creditAmount!)) : "—",
                ]);
                dataQueryResult = {
                  queryType: "customer_statement",
                  title: `Statement: ${acct.name}`,
                  subtitle: `Last ${txRows.length} transaction(s)`,
                  table: { headers: ["Date", "Type", "Description", "Debit", "Credit"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "supplier_statement": {
                const name = params.entityName;
                if (!name) {
                  dataQueryResult = {
                    queryType: "supplier_statement",
                    title: "Supplier Statement",
                    summary: "Please specify a supplier name.",
                  };
                  break;
                }
                const accts = await db
                  .select({ id: schema.ledgerAccounts.id, name: schema.ledgerAccounts.name })
                  .from(schema.ledgerAccounts)
                  .where(
                    and(
                      eq(schema.ledgerAccounts.companyId, companyId),
                      ilike(schema.ledgerAccounts.name, `%${name}%`),
                      isNull(schema.ledgerAccounts.deletedAt)
                    )
                  )
                  .limit(3);
                if (!accts.length) {
                  dataQueryResult = {
                    queryType: "supplier_statement",
                    title: `Supplier: ${name}`,
                    summary: "No account found matching that name.",
                  };
                  break;
                }
                const acct = accts[0];
                const txRows = await db
                  .select({
                    voucherDate: schema.vouchers.voucherDate,
                    voucherType: schema.vouchers.voucherType,
                    description: schema.vouchers.description,
                    debitAmount: schema.voucherEntries.debitAmount,
                    creditAmount: schema.voucherEntries.creditAmount,
                  })
                  .from(schema.voucherEntries)
                  .innerJoin(
                    schema.vouchers,
                    and(
                      eq(schema.voucherEntries.voucherId, schema.vouchers.id),
                      eq(schema.vouchers.optional, false),
                      isNull(schema.vouchers.deletedAt)
                    )
                  )
                  .where(eq(schema.voucherEntries.ledgerAccountId, acct.id))
                  .orderBy(desc(schema.vouchers.voucherDate))
                  .limit(rowLimit);
                const tableRows = txRows.map((r) => [
                  r.voucherDate || "—",
                  r.voucherType || "—",
                  (r.description || "").slice(0, 40),
                  parseFloat(r.debitAmount || "0") > 0 ? fmtDec(parseFloat(r.debitAmount!)) : "—",
                  parseFloat(r.creditAmount || "0") > 0 ? fmtDec(parseFloat(r.creditAmount!)) : "—",
                ]);
                dataQueryResult = {
                  queryType: "supplier_statement",
                  title: `Supplier: ${acct.name}`,
                  subtitle: `Last ${txRows.length} transaction(s)`,
                  table: { headers: ["Date", "Type", "Description", "Debit", "Credit"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "top_customers": {
                const rows = await db.execute(sql`
                  SELECT la.name,
                    COUNT(DISTINCT v.id) AS tx_count,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_received
                  FROM ledger_accounts la
                  JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  JOIN vouchers v ON v.id = ve.voucher_id AND v.optional = false AND v.deleted_at IS NULL AND v.voucher_type = 'Receipt'
                  WHERE la.company_id = ${companyId} AND la.active = true
                    AND v.voucher_date BETWEEN ${dateFrom} AND ${dateTo}
                    AND la.account_type NOT IN ('Cash','Bank','Income','Expense','Direct Expense','Indirect Expense','Equity','Government Taxes')
                    AND CAST(ve.credit_amount AS numeric) > 0
                  GROUP BY la.id, la.name
                  ORDER BY total_received DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows = (rows.rows as any[]).map((r, i) => [
                  String(i + 1),
                  r.name,
                  String(r.tx_count),
                  fmt(parseFloat(r.total_received || "0")),
                ]);
                dataQueryResult = {
                  queryType: "top_customers",
                  title: `Top ${tableRows.length} Customers by Revenue`,
                  subtitle: `${dateFrom} to ${dateTo}`,
                  table: { headers: ["#", "Customer", "Transactions", "Amount Received"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "outstanding_suppliers": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.opening_balance, la.opening_balance_side,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.active = true AND la.deleted_at IS NULL
                    AND la.account_type NOT IN ('Cash','Bank','Income','Expense','Direct Expense','Indirect Expense','Equity','Profit','Government Taxes')
                  GROUP BY la.id, la.name, la.opening_balance, la.opening_balance_side
                  HAVING (
                    CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) < -100
                  ORDER BY (
                    CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) ASC
                  LIMIT ${rowLimit}
                `);
                const tableRows = (rows.rows as any[]).map((row) => {
                  const ob = parseFloat(row.opening_balance || "0");
                  const obAdj = row.opening_balance_side === "Cr" ? -ob : ob;
                  const bal = obAdj + parseFloat(row.total_debit || "0") - parseFloat(row.total_credit || "0");
                  return [row.name, fmt(Math.abs(bal))];
                });
                dataQueryResult = {
                  queryType: "outstanding_suppliers",
                  title: "Outstanding Supplier Balances",
                  subtitle: "Largest amounts owed to suppliers",
                  table: { headers: ["Supplier / Account", "Amount Owed"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "worker_attendance": {
                const rows = await db.execute(sql`
                  SELECT fa.status, COUNT(*) AS count, COUNT(DISTINCT fa.worker_id) AS workers
                  FROM factory_attendance fa
                  WHERE fa.company_id = ${companyId}
                    AND fa.attendance_date BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY fa.status ORDER BY fa.status
                `);
                const totalRecords = (rows.rows as any[]).reduce(
                  (s: number, r: any) => s + parseInt(r.count || "0"),
                  0
                );
                const stats: any[] = (rows.rows as any[]).map((r) => ({
                  label: r.status,
                  value: `${r.count} records · ${r.workers} worker(s)`,
                  highlight: r.status === "Present" ? "positive" : r.status === "Absent" ? "negative" : "muted",
                }));
                if (!stats.length)
                  stats.push({ label: "No Data", value: "No attendance records for this period.", highlight: "muted" });
                dataQueryResult = {
                  queryType: "worker_attendance",
                  title: "Worker Attendance",
                  subtitle: `${dateFrom} to ${dateTo} — ${totalRecords} record(s)`,
                  stats,
                };
                break;
              }

              case "bale_production": {
                const rows = await db.execute(sql`
                  SELECT fb.status, COUNT(*) AS count,
                    COALESCE(SUM(CAST(fb.weight_kg AS numeric)), 0) AS total_weight
                  FROM factory_bales fb
                  WHERE fb.company_id = ${companyId} AND fb.deleted_at IS NULL
                    AND fb.created_at::date BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY fb.status ORDER BY count DESC
                `);
                const totalBales = (rows.rows as any[]).reduce((s: number, r: any) => s + parseInt(r.count || "0"), 0);
                const totalWeight = (rows.rows as any[]).reduce(
                  (s: number, r: any) => s + parseFloat(r.total_weight || "0"),
                  0
                );
                const tableRows = (rows.rows as any[]).map((r) => [
                  String(r.status).replace(/_/g, " "),
                  String(r.count),
                  fmtDec(parseFloat(r.total_weight || "0")) + " kg",
                ]);
                dataQueryResult = {
                  queryType: "bale_production",
                  title: "Bale Production Summary",
                  subtitle: `${dateFrom} to ${dateTo}`,
                  stats: [
                    { label: "Total Bales", value: fmt(totalBales), highlight: "positive" },
                    { label: "Total Weight", value: fmtDec(totalWeight) + " kg", highlight: "positive" },
                  ],
                  table: tableRows.length > 0 ? { headers: ["Status", "Bales", "Weight"], rows: tableRows } : undefined,
                  noData: totalBales === 0,
                };
                break;
              }

              case "container_status": {
                const num = params.containerNumber || userMessage.match(/\b([A-Z]{4}\d{6,7})\b/)?.[1];
                if (!num) {
                  dataQueryResult = {
                    queryType: "container_status",
                    title: "Container Status",
                    summary: "Please specify a container number (e.g. ABCU1234567).",
                  };
                  break;
                }
                const [container] = await db
                  .select({
                    containerNumber: schema.containers.containerNumber,
                    status: schema.containers.status,
                    importDate: schema.containers.importDate,
                    eta: schema.containers.eta,
                    offloadDate: schema.containers.offloadDate,
                    transporter: schema.containers.transporter,
                    trackingLocation: schema.containers.trackingLocation,
                    trackingLastStatus: schema.containers.trackingLastStatus,
                    trackingLastDescription: schema.containers.trackingLastDescription,
                    trackingLastLocation: schema.containers.trackingLastLocation,
                    borderDate: schema.containers.borderDate,
                    grandTotal: schema.containers.grandTotal,
                  })
                  .from(schema.containers)
                  .where(
                    and(
                      eq(schema.containers.companyId, companyId),
                      ilike(schema.containers.containerNumber, `%${num}%`)
                    )
                  )
                  .limit(1);
                if (!container) {
                  dataQueryResult = {
                    queryType: "container_status",
                    title: `Container: ${num}`,
                    summary: "Container not found.",
                  };
                  break;
                }
                const stats: any[] = [
                  { label: "Container #", value: container.containerNumber, highlight: "neutral" },
                  {
                    label: "Status",
                    value: container.status,
                    highlight: container.status === "OFFLOADED" ? "positive" : "neutral",
                  },
                  { label: "Import Date", value: container.importDate || "—", highlight: "muted" },
                  { label: "ETA", value: container.eta || "—", highlight: "muted" },
                  {
                    label: "Offload Date",
                    value: container.offloadDate || "Not yet offloaded",
                    highlight: container.offloadDate ? "positive" : "muted",
                  },
                  { label: "Transporter", value: container.transporter || "—", highlight: "muted" },
                ];
                if (container.trackingLastStatus)
                  stats.push({ label: "Tracking Status", value: container.trackingLastStatus, highlight: "neutral" });
                if (container.trackingLastLocation)
                  stats.push({ label: "Last Location", value: container.trackingLastLocation, highlight: "neutral" });
                if (container.trackingLastDescription)
                  stats.push({ label: "Last Update", value: container.trackingLastDescription, highlight: "muted" });
                dataQueryResult = {
                  queryType: "container_status",
                  title: `Container: ${container.containerNumber}`,
                  subtitle: `Status: ${container.status}`,
                  stats,
                };
                break;
              }

              case "containers_pending_offload": {
                const pending = await db
                  .select({
                    containerNumber: schema.containers.containerNumber,
                    status: schema.containers.status,
                    eta: schema.containers.eta,
                    transporter: schema.containers.transporter,
                  })
                  .from(schema.containers)
                  .where(and(eq(schema.containers.companyId, companyId), isNull(schema.containers.offloadDate)))
                  .orderBy(asc(schema.containers.eta))
                  .limit(rowLimit);
                const tableRows = pending.map((c) => [c.containerNumber, c.status, c.eta || "—", c.transporter || "—"]);
                dataQueryResult = {
                  queryType: "containers_pending_offload",
                  title: "Containers Pending Offload",
                  subtitle: `${pending.length} container(s) not yet offloaded`,
                  table: { headers: ["Container #", "Status", "ETA", "Transporter"], rows: tableRows },
                  noData: pending.length === 0,
                };
                break;
              }

              // ── Phase 2 Cases ────────────────────────────────────────────────

              case "inventory_check": {
                const itemName = params.entityName;
                const locName = params.locationName;
                const rows = await db.execute(sql`
                  SELECT si.name AS item_name, si.code, si.uom,
                    l.name AS location_name,
                    CAST(inv.quantity AS numeric) AS qty,
                    CAST(inv.average_rate AS numeric) AS avg_rate,
                    CAST(inv.total_value AS numeric) AS total_value
                  FROM inventory inv
                  JOIN stock_items si ON si.id = inv.stock_item_id AND si.deleted_at IS NULL
                  JOIN locations l ON l.id = inv.location_id
                  WHERE inv.company_id = ${companyId}
                    AND inv.quantity > 0
                    ${itemName ? sql`AND si.name ILIKE ${"%" + itemName + "%"}` : sql``}
                    ${locName ? sql`AND l.name ILIKE ${"%" + locName + "%"}` : sql``}
                  ORDER BY total_value DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map((r) => [
                  r.item_name,
                  r.code,
                  r.location_name,
                  `${fmtDec(parseFloat(r.qty))} ${r.uom}`,
                  fmtDec(parseFloat(r.avg_rate)),
                  fmt(parseFloat(r.total_value)),
                ]);
                dataQueryResult = {
                  queryType: "inventory_check",
                  title: itemName ? `Stock Levels: ${itemName}` : "Inventory Stock Levels",
                  subtitle: locName ? `Location: ${locName}` : "All locations",
                  table: { headers: ["Item", "Code", "Location", "Qty", "Avg Rate", "Total Value"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "low_stock_items": {
                const rows = await db.execute(sql`
                  SELECT si.name, si.code, si.uom,
                    CAST(si.reorder_level AS numeric) AS reorder_level,
                    COALESCE(SUM(CAST(inv.quantity AS numeric)), 0) AS total_qty
                  FROM stock_items si
                  LEFT JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${companyId}
                  WHERE si.company_id = ${companyId}
                    AND si.active = true AND si.deleted_at IS NULL
                    AND CAST(si.reorder_level AS numeric) > 0
                  GROUP BY si.id, si.name, si.code, si.uom, si.reorder_level
                  HAVING COALESCE(SUM(CAST(inv.quantity AS numeric)), 0) < CAST(si.reorder_level AS numeric)
                  ORDER BY (COALESCE(SUM(CAST(inv.quantity AS numeric)), 0) / NULLIF(CAST(si.reorder_level AS numeric), 0)) ASC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map((r) => [
                  r.name,
                  r.code,
                  `${fmtDec(parseFloat(r.total_qty))} ${r.uom}`,
                  `${fmtDec(parseFloat(r.reorder_level))} ${r.uom}`,
                  `${Math.round((parseFloat(r.total_qty) / parseFloat(r.reorder_level)) * 100)}%`,
                ]);
                dataQueryResult = {
                  queryType: "low_stock_items",
                  title: "Items Below Reorder Level",
                  subtitle: `${tableRows2.length} item(s) need restocking`,
                  table: { headers: ["Item", "Code", "Current Stock", "Reorder Level", "Stock %"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "stock_movement": {
                const itemName = params.entityName;
                if (!itemName) {
                  dataQueryResult = {
                    queryType: "stock_movement",
                    title: "Stock Movement",
                    summary: "Please specify an item name.",
                  };
                  break;
                }
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, sav.adjustment_type, l.name AS location,
                    si.name AS item_name, si.uom,
                    CAST(sai.quantity AS numeric) AS qty,
                    CAST(sai.rate AS numeric) AS rate
                  FROM stock_adjustment_items sai
                  JOIN stock_adjustment_vouchers sav ON sav.id = sai.adjustment_id
                  JOIN vouchers v ON v.id = sav.voucher_id AND v.deleted_at IS NULL
                  JOIN stock_items si ON si.id = sai.stock_item_id
                  JOIN locations l ON l.id = sav.location_id
                  WHERE si.company_id = ${companyId}
                    AND si.name ILIKE ${"%" + itemName + "%"}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map((r) => [
                  String(r.voucher_date).slice(0, 10),
                  r.adjustment_type,
                  r.location,
                  `${fmtDec(Math.abs(parseFloat(r.qty)))} ${r.uom}`,
                  parseFloat(r.qty) >= 0 ? "IN" : "OUT",
                ]);
                dataQueryResult = {
                  queryType: "stock_movement",
                  title: `Stock Movement: ${itemName}`,
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: { headers: ["Date", "Type", "Location", "Qty", "Direction"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "open_purchase_orders": {
                const supplierName = params.entityName;
                const rows = await db.execute(sql`
                  SELECT po.po_number, s.legal_name AS supplier,
                    c.container_number, po.currency,
                    CAST(po.items_total AS numeric) AS items_total,
                    po.status, po.created_at
                  FROM purchase_orders po
                  JOIN suppliers s ON s.id = po.supplier_id
                  JOIN containers c ON c.id = po.container_id
                  WHERE po.company_id = ${companyId}
                    AND po.status = 'Open'
                    ${supplierName ? sql`AND s.legal_name ILIKE ${"%" + supplierName + "%"}` : sql``}
                  ORDER BY po.created_at DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map((r) => [
                  r.po_number,
                  r.supplier,
                  r.container_number,
                  r.currency,
                  fmtDec(parseFloat(r.items_total || "0")),
                  r.status,
                ]);
                dataQueryResult = {
                  queryType: "open_purchase_orders",
                  title: supplierName ? `Open POs — ${supplierName}` : "Open Purchase Orders",
                  subtitle: `${tableRows2.length} open PO(s)`,
                  table: {
                    headers: ["PO #", "Supplier", "Container", "Currency", "Items Total", "Status"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "customer_aging": {
                const rows = await db.execute(sql`
                  SELECT la.name,
                    COALESCE(CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0) AS ob,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 0 AND 30
                      THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS bucket_0_30,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 31 AND 60
                      THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS bucket_31_60,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 61 AND 90
                      THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS bucket_61_90,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) > 90
                      THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS bucket_over_90
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.active = true AND la.deleted_at IS NULL
                    AND la.account_type NOT IN ('Cash','Bank','Income','Expense','Direct Expense','Indirect Expense','Equity','Profit','Government Taxes','Accounts Payable','Loans')
                  GROUP BY la.id, la.name, la.opening_balance, la.opening_balance_side
                  HAVING (
                    COALESCE(CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0)
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) > 100
                  ORDER BY (
                    COALESCE(CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0)
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) DESC
                  LIMIT ${rowLimit}
                `);
                let grandTotal0_30 = 0,
                  grandTotal31_60 = 0,
                  grandTotal61_90 = 0,
                  grandTotalOver90 = 0,
                  grandTotalAll = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const balance = parseFloat(r.ob) + parseFloat(r.total_debit) - parseFloat(r.total_credit);
                  const b0 = parseFloat(r.bucket_0_30);
                  const b1 = parseFloat(r.bucket_31_60);
                  const b2 = parseFloat(r.bucket_61_90);
                  const b3 = parseFloat(r.bucket_over_90);
                  grandTotal0_30 += b0;
                  grandTotal31_60 += b1;
                  grandTotal61_90 += b2;
                  grandTotalOver90 += b3;
                  grandTotalAll += balance;
                  return [
                    r.name,
                    fmt(balance),
                    fmt(b0 > 0 ? b0 : 0),
                    fmt(b1 > 0 ? b1 : 0),
                    fmt(b2 > 0 ? b2 : 0),
                    fmt(b3 > 0 ? b3 : 0),
                  ];
                });
                tableRows2.push([
                  "TOTAL",
                  fmt(grandTotalAll),
                  fmt(grandTotal0_30),
                  fmt(grandTotal31_60),
                  fmt(grandTotal61_90),
                  fmt(grandTotalOver90),
                ]);
                dataQueryResult = {
                  queryType: "customer_aging",
                  title: "Customer Receivables Aging",
                  subtitle: `As of ${todayStr}`,
                  table: {
                    headers: ["Account", "Total", "0-30 days", "31-60 days", "61-90 days", "90+ days"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length <= 1,
                };
                break;
              }

              case "supplier_aging": {
                const rows = await db.execute(sql`
                  SELECT la.name,
                    COALESCE(CASE WHEN la.opening_balance_side = 'Dr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0) AS ob,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 0 AND 30
                      THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS bucket_0_30,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 31 AND 60
                      THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS bucket_31_60,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 61 AND 90
                      THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS bucket_61_90,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) > 90
                      THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS bucket_over_90
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.active = true AND la.deleted_at IS NULL
                    AND la.account_type IN ('Accounts Payable','Liability','Transporter Agent','Duty Agent')
                  GROUP BY la.id, la.name, la.opening_balance, la.opening_balance_side
                  HAVING (
                    COALESCE(CASE WHEN la.opening_balance_side = 'Dr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0)
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                  ) > 100
                  ORDER BY (
                    COALESCE(CASE WHEN la.opening_balance_side = 'Dr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0)
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                  ) DESC
                  LIMIT ${rowLimit}
                `);
                let sgTotal0_30 = 0,
                  sgTotal31_60 = 0,
                  sgTotal61_90 = 0,
                  sgTotalOver90 = 0,
                  sgTotalAll = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const balance = parseFloat(r.ob) + parseFloat(r.total_credit) - parseFloat(r.total_debit);
                  const b0 = parseFloat(r.bucket_0_30);
                  const b1 = parseFloat(r.bucket_31_60);
                  const b2 = parseFloat(r.bucket_61_90);
                  const b3 = parseFloat(r.bucket_over_90);
                  sgTotal0_30 += b0;
                  sgTotal31_60 += b1;
                  sgTotal61_90 += b2;
                  sgTotalOver90 += b3;
                  sgTotalAll += balance;
                  return [
                    r.name,
                    fmt(balance),
                    fmt(b0 > 0 ? b0 : 0),
                    fmt(b1 > 0 ? b1 : 0),
                    fmt(b2 > 0 ? b2 : 0),
                    fmt(b3 > 0 ? b3 : 0),
                  ];
                });
                tableRows2.push([
                  "TOTAL",
                  fmt(sgTotalAll),
                  fmt(sgTotal0_30),
                  fmt(sgTotal31_60),
                  fmt(sgTotal61_90),
                  fmt(sgTotalOver90),
                ]);
                dataQueryResult = {
                  queryType: "supplier_aging",
                  title: "Supplier Payables Aging",
                  subtitle: `As of ${todayStr}`,
                  table: {
                    headers: ["Supplier", "Total Owed", "0-30 days", "31-60 days", "61-90 days", "90+ days"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length <= 1,
                };
                break;
              }

              case "container_list": {
                const statusFilter = params.containerStatus;
                const rows = await db.execute(sql`
                  SELECT c.container_number, c.status, c.import_date, c.eta,
                    s.legal_name AS supplier,
                    CAST(c.grand_total AS numeric) AS grand_total,
                    c.currency, c.transporter
                  FROM containers c
                  JOIN suppliers s ON s.id = c.supplier_id
                  WHERE c.company_id = ${companyId}
                    ${statusFilter ? sql`AND c.status ILIKE ${"%" + statusFilter + "%"}` : sql``}
                    AND c.import_date BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY c.import_date DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map((r) => [
                  r.container_number,
                  r.status,
                  String(r.import_date).slice(0, 10),
                  r.eta ? String(r.eta).slice(0, 10) : "—",
                  r.supplier,
                  r.transporter || "—",
                  fmtDec(parseFloat(r.grand_total || "0")),
                ]);
                dataQueryResult = {
                  queryType: "container_list",
                  title: statusFilter ? `Containers — ${statusFilter}` : "Container List",
                  subtitle: `${dateFrom} → ${dateTo} · ${tableRows2.length} container(s)`,
                  table: {
                    headers: ["Container #", "Status", "Import Date", "ETA", "Supplier", "Transporter", "Grand Total"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "monthly_comparison": {
                const runPL = async (from: string, to: string) => {
                  const r = await db.execute(sql`
                    SELECT
                      COALESCE(SUM(CASE WHEN la.account_type IN ('Income') THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS revenue,
                      COALESCE(SUM(CASE WHEN la.account_type IN ('Expense','Direct Expense','Indirect Expense') THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS expenses
                    FROM voucher_entries ve
                    JOIN vouchers v ON v.id = ve.voucher_id AND v.deleted_at IS NULL AND v.optional = false
                    JOIN ledger_accounts la ON la.id = ve.ledger_account_id
                    WHERE la.company_id = ${companyId}
                      AND CAST(v.voucher_date AS text) BETWEEN ${from} AND ${to}
                  `);
                  const row = r.rows[0] as any;
                  const rev = parseFloat(row?.revenue || "0");
                  const exp = parseFloat(row?.expenses || "0");
                  return { revenue: rev, expenses: exp, net: rev - exp };
                };
                const [thisM, lastM] = await Promise.all([
                  runPL(thisMonthStart, todayStr),
                  runPL(lastMonthStart, lastMonthEnd),
                ]);
                const diff = (a: number, b: number) => {
                  if (b === 0) return a > 0 ? "+100%" : "—";
                  const pct = ((a - b) / Math.abs(b)) * 100;
                  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
                };
                const tableRows2 = [
                  ["Revenue", fmt(lastM.revenue), fmt(thisM.revenue), diff(thisM.revenue, lastM.revenue)],
                  ["Expenses", fmt(lastM.expenses), fmt(thisM.expenses), diff(thisM.expenses, lastM.expenses)],
                  ["Net Profit", fmt(lastM.net), fmt(thisM.net), diff(thisM.net, lastM.net)],
                ];
                dataQueryResult = {
                  queryType: "monthly_comparison",
                  title: "Month-over-Month Comparison",
                  subtitle: `Last month (${lastMonthStart.slice(0, 7)}) vs This month (${thisMonthStart.slice(0, 7)})`,
                  table: { headers: ["Metric", "Last Month", "This Month", "Change"], rows: tableRows2 },
                  noData: false,
                };
                break;
              }

              case "rental_summary": {
                const currentYear = todayDate.getFullYear();
                const currentMonth = todayDate.getMonth() + 1;
                const rows = await db.execute(sql`
                  SELECT pu.unit_number, pu.unit_type, pu.location_group,
                    pc.tenant_name, CAST(pc.rental_amount AS numeric) AS rental_amount, pc.status AS contract_status,
                    CAST(COALESCE(pml.expected_amount, 0) AS numeric) AS expected,
                    CAST(COALESCE(pml.paid_amount, 0) AS numeric) AS paid
                  FROM property_units pu
                  LEFT JOIN property_contracts pc ON pc.unit_id = pu.id AND pc.status = 'ACTIVE'
                  LEFT JOIN property_monthly_ledger pml ON pml.unit_id = pu.id
                    AND pml.year = ${currentYear} AND pml.month = ${currentMonth}
                  WHERE pu.company_id = ${companyId} AND pu.active = true
                  ORDER BY pu.unit_type, pu.location_group, pu.unit_number
                  LIMIT ${rowLimit}
                `);
                let totalExpected = 0,
                  totalPaid = 0,
                  occupied = 0,
                  vacant = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const exp = parseFloat(r.expected || "0");
                  const paid = parseFloat(r.paid || "0");
                  totalExpected += exp;
                  totalPaid += paid;
                  if (r.tenant_name) occupied++;
                  else vacant++;
                  const balance = exp - paid;
                  return [
                    r.unit_number,
                    r.unit_type,
                    r.location_group,
                    r.tenant_name || "VACANT",
                    fmt(exp),
                    fmt(paid),
                    fmt(balance),
                    balance > 0 ? "OUTSTANDING" : "OK",
                  ];
                });
                const stats2 = [
                  { label: "Occupied", value: String(occupied) },
                  { label: "Vacant", value: String(vacant) },
                  { label: "Total Expected", value: fmt(totalExpected) },
                  { label: "Total Collected", value: fmt(totalPaid) },
                  {
                    label: "Outstanding",
                    value: fmt(totalExpected - totalPaid),
                    highlight: totalExpected - totalPaid > 0 ? "negative" : "positive",
                  },
                ];
                dataQueryResult = {
                  queryType: "rental_summary",
                  title: "Rental Summary",
                  subtitle: `${currentYear}-${String(currentMonth).padStart(2, "0")} · ${occupied} occupied, ${vacant} vacant`,
                  stats: stats2,
                  table: {
                    headers: ["Unit", "Type", "Location", "Tenant", "Expected", "Paid", "Balance", "Status"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "payroll_summary": {
                const rows = await db.execute(sql`
                  SELECT fw.name AS worker_name,
                    fp.period_start, fp.period_end, fp.status,
                    CAST(fp.net_salary AS numeric) AS net_salary,
                    CAST(fp.base_salary AS numeric) AS base_salary,
                    CAST(fp.bale_earnings AS numeric) AS bale_earnings,
                    CAST(fp.deductions AS numeric) AS deductions,
                    fp.present_days, fp.absent_days
                  FROM factory_payrolls fp
                  JOIN factory_workers fw ON fw.id = fp.worker_id
                  WHERE fp.company_id = ${companyId}
                    AND fp.period_start >= ${dateFrom}
                    AND fp.period_end <= ${dateTo}
                  ORDER BY fp.period_start DESC, fw.name
                  LIMIT ${rowLimit}
                `);
                let totalNet = 0,
                  totalBase = 0,
                  totalBale = 0,
                  totalDed = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const net = parseFloat(r.net_salary || "0");
                  totalNet += net;
                  totalBase += parseFloat(r.base_salary || "0");
                  totalBale += parseFloat(r.bale_earnings || "0");
                  totalDed += parseFloat(r.deductions || "0");
                  return [
                    r.worker_name,
                    String(r.period_start).slice(0, 10),
                    String(r.period_end).slice(0, 10),
                    fmt(parseFloat(r.base_salary || "0")),
                    fmt(parseFloat(r.bale_earnings || "0")),
                    fmt(parseFloat(r.deductions || "0")),
                    fmt(net),
                    r.status,
                  ];
                });
                const stats2 = [
                  { label: "Total Workers", value: String(tableRows2.length) },
                  { label: "Total Base Salary", value: fmt(totalBase) },
                  { label: "Total Bale Earnings", value: fmt(totalBale) },
                  { label: "Total Deductions", value: fmt(totalDed) },
                  { label: "Total Net Payroll", value: fmt(totalNet), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "payroll_summary",
                  title: "Factory Payroll Summary",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats2,
                  table: {
                    headers: [
                      "Worker",
                      "Period From",
                      "Period To",
                      "Base",
                      "Bale Earn.",
                      "Deductions",
                      "Net",
                      "Status",
                    ],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              // ── Phase 3 Cases ────────────────────────────────────────────────

              case "sales_analysis": {
                const itemNameFilter = params.entityName;
                const rows = await db.execute(sql`
                  SELECT si.name AS item_name, si.code, si.uom,
                    COUNT(sal.id) AS tx_count,
                    SUM(CAST(sal.quantity AS numeric)) AS total_qty,
                    SUM(CAST(sal.total_sales AS numeric)) AS total_revenue,
                    SUM(CAST(sal.total_cost AS numeric)) AS total_cost,
                    SUM(CAST(sal.profit AS numeric)) AS total_profit
                  FROM sales_items sal
                  JOIN stock_items si ON si.id = sal.stock_item_id
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  WHERE si.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${itemNameFilter ? sql`AND si.name ILIKE ${"%" + itemNameFilter + "%"}` : sql``}
                  GROUP BY si.id, si.name, si.code, si.uom
                  ORDER BY total_revenue DESC
                  LIMIT ${rowLimit}
                `);
                let totRev = 0,
                  totCost = 0,
                  totProfit = 0,
                  totQty = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const rev = parseFloat(r.total_revenue || "0");
                  const cost = parseFloat(r.total_cost || "0");
                  const profit3 = parseFloat(r.total_profit || "0");
                  const qty = parseFloat(r.total_qty || "0");
                  const margin = rev > 0 ? ((profit3 / rev) * 100).toFixed(1) + "%" : "—";
                  totRev += rev;
                  totCost += cost;
                  totProfit += profit3;
                  totQty += qty;
                  return [r.item_name, `${fmtDec(qty)} ${r.uom}`, fmt(rev), fmt(cost), fmt(profit3), margin];
                });
                if (tableRows2.length) {
                  const totMargin = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "—";
                  tableRows2.push(["TOTAL", fmtDec(totQty), fmt(totRev), fmt(totCost), fmt(totProfit), totMargin]);
                }
                dataQueryResult = {
                  queryType: "sales_analysis",
                  title: itemNameFilter ? `Sales Analysis: ${itemNameFilter}` : "Sales Analysis by Item",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: { headers: ["Item", "Qty Sold", "Revenue", "Cost", "Profit", "Margin"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "top_selling_items": {
                const rows = await db.execute(sql`
                  SELECT si.name AS item_name, si.code, si.uom,
                    SUM(CAST(sal.quantity AS numeric)) AS total_qty,
                    SUM(CAST(sal.total_sales AS numeric)) AS total_revenue,
                    SUM(CAST(sal.profit AS numeric)) AS total_profit,
                    COUNT(DISTINCT v.id) AS num_transactions
                  FROM sales_items sal
                  JOIN stock_items si ON si.id = sal.stock_item_id
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  WHERE si.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY si.id, si.name, si.code, si.uom
                  ORDER BY total_revenue DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map((r, i) => [
                  String(i + 1),
                  r.item_name,
                  r.code,
                  `${fmtDec(parseFloat(r.total_qty || "0"))} ${r.uom}`,
                  fmt(parseFloat(r.total_revenue || "0")),
                  fmt(parseFloat(r.total_profit || "0")),
                  String(r.num_transactions),
                ]);
                dataQueryResult = {
                  queryType: "top_selling_items",
                  title: "Top Selling Items",
                  subtitle: `${dateFrom} → ${dateTo} · by revenue`,
                  table: {
                    headers: ["#", "Item", "Code", "Qty Sold", "Revenue", "Profit", "Transactions"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "container_profitability": {
                const rows = await db.execute(sql`
                  SELECT c.container_number,
                    s.legal_name AS supplier,
                    cu.legal_name AS customer,
                    c.currency,
                    CAST(c.grand_total AS numeric) AS cost,
                    CAST(cs.total_amount AS numeric) AS sale_amount,
                    CAST(cs.commission AS numeric) AS commission,
                    cs.payment_status,
                    c.import_date
                  FROM container_sales cs
                  JOIN containers c ON c.id = cs.container_id
                  JOIN suppliers s ON s.id = c.supplier_id
                  JOIN customers cu ON cu.id = cs.customer_id
                  WHERE c.company_id = ${companyId}
                    AND CAST(cs.sale_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY cs.sale_date DESC
                  LIMIT ${rowLimit}
                `);
                let totCost = 0,
                  totSale = 0,
                  totProfit = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const cost = parseFloat(r.cost || "0");
                  const sale = parseFloat(r.sale_amount || "0");
                  const comm = parseFloat(r.commission || "0");
                  const profit3 = sale - cost - comm;
                  const margin = sale > 0 ? ((profit3 / sale) * 100).toFixed(1) + "%" : "—";
                  totCost += cost;
                  totSale += sale;
                  totProfit += profit3;
                  return [
                    r.container_number,
                    r.supplier,
                    r.customer,
                    r.currency,
                    fmt(cost),
                    fmt(sale),
                    fmt(comm),
                    fmt(profit3),
                    margin,
                    r.payment_status,
                  ];
                });
                if (tableRows2.length) {
                  const totMargin = totSale > 0 ? ((totProfit / totSale) * 100).toFixed(1) + "%" : "—";
                  tableRows2.push(["TOTAL", "", "", "", fmt(totCost), fmt(totSale), "", fmt(totProfit), totMargin, ""]);
                }
                dataQueryResult = {
                  queryType: "container_profitability",
                  title: "Container Profitability",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: {
                    headers: [
                      "Container #",
                      "Supplier",
                      "Customer",
                      "Curr.",
                      "Cost",
                      "Sale",
                      "Comm.",
                      "Profit",
                      "Margin",
                      "Payment",
                    ],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "stock_valuation": {
                const rows = await db.execute(sql`
                  SELECT COALESCE(sg.name, 'Ungrouped') AS group_name,
                    COUNT(DISTINCT si.id) AS item_count,
                    SUM(CAST(inv.quantity AS numeric)) AS total_qty,
                    SUM(CAST(inv.total_value AS numeric)) AS total_value
                  FROM inventory inv
                  JOIN stock_items si ON si.id = inv.stock_item_id AND si.deleted_at IS NULL
                  LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
                  WHERE inv.company_id = ${companyId} AND inv.quantity > 0
                  GROUP BY sg.id, sg.name
                  ORDER BY total_value DESC
                  LIMIT ${rowLimit}
                `);
                let grandTotalValue = 0,
                  grandTotalItems = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const val = parseFloat(r.total_value || "0");
                  grandTotalValue += val;
                  grandTotalItems += parseInt(r.item_count || "0");
                  return [r.group_name, String(r.item_count), fmtDec(parseFloat(r.total_qty || "0")), fmt(val)];
                });
                tableRows2.push(["GRAND TOTAL", String(grandTotalItems), "—", fmt(grandTotalValue)]);
                const stats3 = [
                  { label: "Total Stock Groups", value: String(tableRows2.length - 1) },
                  { label: "Total Distinct Items", value: String(grandTotalItems) },
                  { label: "Total Inventory Value", value: fmt(grandTotalValue), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "stock_valuation",
                  title: "Stock Valuation by Group",
                  subtitle: `As of ${todayStr}`,
                  stats: stats3,
                  table: { headers: ["Stock Group", "Items", "Total Qty", "Total Value"], rows: tableRows2 },
                  noData: tableRows2.length <= 1,
                };
                break;
              }

              case "expense_breakdown": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.account_type,
                    SUM(CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric)) AS net_spend
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id AND v.deleted_at IS NULL AND v.optional = false
                  JOIN ledger_accounts la ON la.id = ve.ledger_account_id
                  WHERE la.company_id = ${companyId}
                    AND la.account_type IN ('Expense', 'Direct Expense', 'Indirect Expense', 'Government Taxes')
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY la.id, la.name, la.account_type
                  HAVING SUM(CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric)) > 0
                  ORDER BY net_spend DESC
                  LIMIT ${rowLimit}
                `);
                let grandSpend = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const spend = parseFloat(r.net_spend || "0");
                  grandSpend += spend;
                  return [r.name, r.account_type, fmt(spend)];
                });
                if (tableRows2.length) tableRows2.push(["TOTAL", "", fmt(grandSpend)]);
                dataQueryResult = {
                  queryType: "expense_breakdown",
                  title: "Expense Breakdown",
                  subtitle: `${dateFrom} → ${dateTo} · top ${tableRows2.length - 1} accounts`,
                  table: { headers: ["Account", "Type", "Amount"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "customer_order_status": {
                const statusFilter = (params.entityName || "").toUpperCase() || null;
                const rows = await db.execute(sql`
                  SELECT co.invoice_number, cu.legal_name AS customer,
                    co.order_date, co.status,
                    CAST(co.grand_total AS numeric) AS grand_total,
                    co.total_qty_bales, co.destination, co.container_number
                  FROM customer_orders co
                  JOIN customers cu ON cu.id = co.customer_id
                  WHERE co.company_id = ${companyId}
                    AND co.deleted_at IS NULL
                    ${statusFilter ? sql`AND co.status = ${statusFilter}` : sql``}
                    AND co.order_date BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY co.order_date DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map((r) => [
                  r.invoice_number || "—",
                  r.customer,
                  String(r.order_date).slice(0, 10),
                  r.status,
                  fmt(parseFloat(r.grand_total || "0")),
                  String(r.total_qty_bales || 0),
                  r.destination || "—",
                ]);
                dataQueryResult = {
                  queryType: "customer_order_status",
                  title: statusFilter ? `Customer Orders — ${statusFilter}` : "Customer Orders",
                  subtitle: `${dateFrom} → ${dateTo} · ${tableRows2.length} order(s)`,
                  table: {
                    headers: ["Invoice", "Customer", "Date", "Status", "Total", "Bales", "Destination"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "credit_notes_summary": {
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.description,
                    si.name AS item_name, si.uom,
                    l.name AS location,
                    CAST(cni.quantity AS numeric) AS qty,
                    CAST(cni.rate AS numeric) AS rate,
                    CAST(cni.total_value AS numeric) AS total_value
                  FROM credit_note_items cni
                  JOIN vouchers v ON v.id = cni.voucher_id AND v.deleted_at IS NULL
                  JOIN stock_items si ON si.id = cni.stock_item_id
                  JOIN locations l ON l.id = cni.location_id
                  WHERE si.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totValue = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const val = parseFloat(r.total_value || "0");
                  totValue += val;
                  return [
                    String(r.voucher_date).slice(0, 10),
                    r.item_name,
                    r.location,
                    `${fmtDec(parseFloat(r.qty))} ${r.uom}`,
                    fmtDec(parseFloat(r.rate)),
                    fmt(val),
                    (r.description || "").slice(0, 35),
                  ];
                });
                dataQueryResult = {
                  queryType: "credit_notes_summary",
                  title: "Credit Notes",
                  subtitle: `${dateFrom} → ${dateTo} · Total returned: ${fmt(totValue)}`,
                  table: {
                    headers: ["Date", "Item", "Location", "Qty", "Rate", "Value", "Description"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "bank_transactions": {
                const accountName = params.entityName || params.locationName;
                const acctTypes = ["Bank", "Cash"];
                const acctRows = await db.execute(sql`
                  SELECT id, name, account_type FROM ledger_accounts
                  WHERE company_id = ${companyId} AND account_type IN ('Bank','Cash') AND deleted_at IS NULL
                    ${accountName ? sql`AND name ILIKE ${"%" + accountName + "%"}` : sql``}
                  ORDER BY account_type, name
                  LIMIT 1
                `);
                if (!acctRows.rows.length) {
                  dataQueryResult = {
                    queryType: "bank_transactions",
                    title: "Bank/Cash Transactions",
                    summary: accountName
                      ? `No account found matching "${accountName}".`
                      : "Please specify an account name.",
                  };
                  break;
                }
                const acct3 = acctRows.rows[0] as any;
                const txRows3 = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_type, v.description,
                    CAST(ve.debit_amount AS numeric) AS debit,
                    CAST(ve.credit_amount AS numeric) AS credit
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id AND v.deleted_at IS NULL AND v.optional = false
                  WHERE ve.ledger_account_id = ${acct3.id}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY v.voucher_date DESC, v.id DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (txRows3.rows as any[]).map((r) => [
                  String(r.voucher_date).slice(0, 10),
                  r.voucher_type || "—",
                  (r.description || "").slice(0, 40),
                  parseFloat(r.debit || "0") > 0 ? fmt(parseFloat(r.debit)) : "—",
                  parseFloat(r.credit || "0") > 0 ? fmt(parseFloat(r.credit)) : "—",
                ]);
                dataQueryResult = {
                  queryType: "bank_transactions",
                  title: `Transactions: ${acct3.name}`,
                  subtitle: `${dateFrom} → ${dateTo} · ${acct3.account_type} account`,
                  table: { headers: ["Date", "Type", "Description", "In (Dr)", "Out (Cr)"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "fixed_assets_summary": {
                const categoryFilter = params.entityName;
                const rows = await db.execute(sql`
                  SELECT fa.code, fa.name, fa.category,
                    fa.purchase_date,
                    CAST(fa.purchase_amount AS numeric) AS purchase_amount,
                    fa.depreciation_method, fa.useful_life, fa.active
                  FROM fixed_assets fa
                  WHERE fa.company_id = ${companyId}
                    ${categoryFilter ? sql`AND fa.category ILIKE ${"%" + categoryFilter + "%"}` : sql``}
                  ORDER BY fa.category, fa.purchase_date DESC
                  LIMIT ${rowLimit}
                `);
                let grandTotal = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const amt = parseFloat(r.purchase_amount || "0");
                  grandTotal += amt;
                  return [
                    r.code,
                    r.name,
                    r.category,
                    String(r.purchase_date).slice(0, 10),
                    fmt(amt),
                    r.depreciation_method,
                    r.useful_life ? `${r.useful_life} yr` : "—",
                    r.active ? "Active" : "Inactive",
                  ];
                });
                const stats3 = [
                  { label: "Total Assets", value: String(tableRows2.length) },
                  { label: "Total Purchase Value", value: fmt(grandTotal), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "fixed_assets_summary",
                  title: categoryFilter ? `Fixed Assets — ${categoryFilter}` : "Fixed Assets Register",
                  subtitle: `${tableRows2.length} asset(s)`,
                  stats: stats3,
                  table: {
                    headers: ["Code", "Name", "Category", "Purchase Date", "Amount", "Depreciation", "Life", "Status"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "factory_kpi": {
                const rows = await db.execute(sql`
                  SELECT date,
                    CAST(total_kg_in AS numeric) AS kg_in,
                    CAST(total_kg_pressed AS numeric) AS kg_pressed,
                    total_bales_produced,
                    CAST(total_waste_kg AS numeric) AS waste_kg
                  FROM factory_daily_kpi_snapshots
                  WHERE company_id = ${companyId}
                    AND date BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY date DESC
                  LIMIT ${rowLimit}
                `);
                let totKgIn = 0,
                  totKgPressed = 0,
                  totBales = 0,
                  totWaste = 0;
                const tableRows2 = (rows.rows as any[]).map((r) => {
                  const kgIn = parseFloat(r.kg_in || "0");
                  const kgPressed = parseFloat(r.kg_pressed || "0");
                  const bales = parseInt(r.total_bales_produced || "0");
                  const waste = parseFloat(r.waste_kg || "0");
                  const efficiency = kgIn > 0 ? ((kgPressed / kgIn) * 100).toFixed(1) + "%" : "—";
                  totKgIn += kgIn;
                  totKgPressed += kgPressed;
                  totBales += bales;
                  totWaste += waste;
                  return [
                    String(r.date).slice(0, 10),
                    fmtDec(kgIn),
                    fmtDec(kgPressed),
                    String(bales),
                    fmtDec(waste),
                    efficiency,
                  ];
                });
                const avgEff = totKgIn > 0 ? ((totKgPressed / totKgIn) * 100).toFixed(1) + "%" : "—";
                if (tableRows2.length)
                  tableRows2.push([
                    "TOTAL",
                    fmtDec(totKgIn),
                    fmtDec(totKgPressed),
                    String(totBales),
                    fmtDec(totWaste),
                    avgEff,
                  ]);
                const stats3 = [
                  { label: "Total Kg In", value: fmtDec(totKgIn) },
                  { label: "Total Kg Pressed", value: fmtDec(totKgPressed) },
                  { label: "Total Bales", value: String(totBales) },
                  { label: "Total Waste Kg", value: fmtDec(totWaste) },
                  { label: "Avg Efficiency", value: avgEff, highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "factory_kpi",
                  title: "Factory Daily KPIs",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats3,
                  table: {
                    headers: ["Date", "Kg In", "Kg Pressed", "Bales", "Waste Kg", "Efficiency"],
                    rows: tableRows2,
                  },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              // ── Phase 4 Cases ────────────────────────────────────────────────

              case "pos_sales_summary": {
                const itemFilter = params.entityName;
                const rows = await db.execute(sql`
                  SELECT fpsi.product_name, fpsi.article_code,
                    SUM(fpsi.quantity) AS total_qty,
                    SUM(CAST(fpsi.total_amount AS numeric)) AS total_revenue,
                    COUNT(DISTINCT fps.id) AS num_sales,
                    fpsi.currency_code
                  FROM factory_pos_sale_items fpsi
                  JOIN factory_pos_sales fps ON fps.id = fpsi.sale_id AND fps.status = 'COMPLETED'
                  WHERE fps.company_id = ${companyId}
                    AND CAST(fps.tx_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${itemFilter ? sql`AND fpsi.product_name ILIKE ${"%" + itemFilter + "%"}` : sql``}
                  GROUP BY fpsi.product_name, fpsi.article_code, fpsi.currency_code
                  ORDER BY total_revenue DESC
                  LIMIT ${rowLimit}
                `);
                const totalsRow = await db.execute(sql`
                  SELECT COUNT(id) AS num_transactions,
                    SUM(CAST(total_amount AS numeric)) AS grand_total
                  FROM factory_pos_sales
                  WHERE company_id = ${companyId} AND status = 'COMPLETED'
                    AND CAST(tx_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                `);
                const t4 = totalsRow.rows[0] as any;
                let grandRev = 0;
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const rev = parseFloat(r.total_revenue || "0");
                  grandRev += rev;
                  return [
                    r.product_name,
                    r.article_code || "—",
                    String(r.total_qty),
                    fmt(rev),
                    r.currency_code,
                    String(r.num_sales),
                  ];
                });
                const stats4 = [
                  { label: "Total Transactions", value: String(t4?.num_transactions || 0) },
                  {
                    label: "Grand Total Revenue",
                    value: fmt(parseFloat(t4?.grand_total || "0")),
                    highlight: "positive",
                  },
                ];
                dataQueryResult = {
                  queryType: "pos_sales_summary",
                  title: itemFilter ? `POS Sales: ${itemFilter}` : "POS Sales Summary",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats4,
                  table: {
                    headers: ["Product", "Article Code", "Qty", "Revenue", "Currency", "Sales"],
                    rows: tableRows4,
                  },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "intercompany_transfers": {
                const rows = await db.execute(sql`
                  SELECT ict.transfer_date, ict.transfer_type,
                    fc.name AS from_company, tc.name AS to_company,
                    CAST(ict.amount AS numeric) AS amount,
                    ict.description
                  FROM inter_company_transfers ict
                  JOIN companies fc ON fc.id = ict.from_company_id
                  JOIN companies tc ON tc.id = ict.to_company_id
                  WHERE (ict.from_company_id = ${companyId} OR ict.to_company_id = ${companyId})
                    AND CAST(ict.transfer_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY ict.transfer_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalOut = 0,
                  totalIn = 0;
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const amt = parseFloat(r.amount || "0");
                  const isOut = r.from_company === (rows.rows[0] as any)?.from_company;
                  totalOut += amt; // simplified — show all
                  return [
                    String(r.transfer_date).slice(0, 10),
                    r.transfer_type,
                    r.from_company,
                    r.to_company,
                    fmt(amt),
                    (r.description || "").slice(0, 40),
                  ];
                });
                dataQueryResult = {
                  queryType: "intercompany_transfers",
                  title: "Inter-Company Transfers",
                  subtitle: `${dateFrom} → ${dateTo} · ${tableRows4.length} transfer(s)`,
                  table: { headers: ["Date", "Type", "From", "To", "Amount", "Description"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "container_offload_details": {
                const cnFilter = params.containerNumber || params.entityName;
                if (!cnFilter) {
                  dataQueryResult = {
                    queryType: "container_offload_details",
                    title: "Container Offload Details",
                    summary: "Please specify a container number.",
                  };
                  break;
                }
                const rows = await db.execute(sql`
                  SELECT c.container_number, l.name AS location,
                    si.name AS item_name, si.code, si.uom,
                    CAST(coi.quantity AS numeric) AS qty,
                    CAST(coi.rate AS numeric) AS rate,
                    CAST(coi.total_value AS numeric) AS total_value,
                    co.offloaded_at
                  FROM container_offload_items coi
                  JOIN container_offloads co ON co.id = coi.offload_id
                  JOIN containers c ON c.id = co.container_id
                  JOIN locations l ON l.id = co.location_id
                  JOIN stock_items si ON si.id = coi.stock_item_id
                  WHERE c.container_number ILIKE ${"%" + cnFilter + "%"}
                    AND c.company_id = ${companyId}
                  ORDER BY si.name
                  LIMIT ${rowLimit}
                `);
                let totalVal = 0;
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const val = parseFloat(r.total_value || "0");
                  totalVal += val;
                  return [
                    r.item_name,
                    r.code,
                    r.location,
                    `${fmtDec(parseFloat(r.qty))} ${r.uom}`,
                    fmtDec(parseFloat(r.rate)),
                    fmt(val),
                  ];
                });
                const cn = (rows.rows[0] as any)?.container_number || cnFilter;
                dataQueryResult = {
                  queryType: "container_offload_details",
                  title: `Offload Details: ${cn}`,
                  subtitle: `${tableRows4.length} line(s) · Total value: ${fmt(totalVal)}`,
                  table: { headers: ["Item", "Code", "Location", "Qty", "Rate", "Total Value"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "worker_productivity": {
                const rows = await db.execute(sql`
                  SELECT fw.full_name,
                    COUNT(fb.id) AS total_bales,
                    COALESCE(SUM(CAST(fb.weight_kg AS numeric)), 0) AS total_kg,
                    COALESCE(AVG(CAST(fb.weight_kg AS numeric)), 0) AS avg_kg_per_bale
                  FROM factory_bales fb
                  JOIN factory_workers fw ON fw.id = fb.worker_id
                  WHERE fb.company_id = ${companyId}
                    AND fb.status = 'Pressed'
                    AND CAST(fb.pressed_at AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY fw.id, fw.full_name
                  ORDER BY total_bales DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows4 = (rows.rows as any[]).map((r, i) => [
                  String(i + 1),
                  r.full_name,
                  String(r.total_bales),
                  fmtDec(parseFloat(r.total_kg || "0")),
                  fmtDec(parseFloat(r.avg_kg_per_bale || "0")),
                ]);
                dataQueryResult = {
                  queryType: "worker_productivity",
                  title: "Worker Productivity Ranking",
                  subtitle: `${dateFrom} → ${dateTo} · by bales pressed`,
                  table: { headers: ["Rank", "Worker", "Bales", "Total Kg", "Avg Kg/Bale"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "supplier_spend": {
                const supplierFilter = params.entityName;
                const rows = await db.execute(sql`
                  SELECT s.legal_name AS supplier,
                    COUNT(po.id) AS po_count,
                    SUM(CAST(po.items_total AS numeric)) AS total_items,
                    SUM(CAST(po.freight AS numeric) + CAST(po.surcharge AS numeric) + CAST(po.fumigation AS numeric)
                        + CAST(po.document_charges AS numeric) + CAST(po.other_charges AS numeric)
                        - CAST(po.discount AS numeric)) AS total_charges,
                    po.currency
                  FROM purchase_orders po
                  JOIN suppliers s ON s.id = po.supplier_id
                  WHERE po.company_id = ${companyId}
                    AND po.created_at >= ${dateFrom}
                    ${supplierFilter ? sql`AND s.legal_name ILIKE ${"%" + supplierFilter + "%"}` : sql``}
                  GROUP BY s.id, s.legal_name, po.currency
                  ORDER BY total_items DESC
                  LIMIT ${rowLimit}
                `);
                let grandItems = 0;
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const items = parseFloat(r.total_items || "0");
                  const charges = parseFloat(r.total_charges || "0");
                  grandItems += items;
                  return [r.supplier, String(r.po_count), fmt(items), fmt(charges), fmt(items + charges), r.currency];
                });
                dataQueryResult = {
                  queryType: "supplier_spend",
                  title: supplierFilter ? `Supplier Spend: ${supplierFilter}` : "Supplier Purchase Spend",
                  subtitle: `Since ${dateFrom} · ${tableRows4.length} supplier(s)`,
                  table: {
                    headers: ["Supplier", "POs", "Items Total", "Charges", "Grand Total", "Currency"],
                    rows: tableRows4,
                  },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "upcoming_arrivals": {
                const daysAhead = 30;
                const futureDate = new Date(todayDate.getTime() + daysAhead * 86400000).toISOString().slice(0, 10);
                const rows = await db.execute(sql`
                  SELECT c.container_number, c.status, c.eta,
                    s.legal_name AS supplier,
                    c.transporter, c.tracking_location,
                    c.import_date,
                    CAST(c.grand_total AS numeric) AS grand_total,
                    c.currency,
                    CAST(c.eta AS date) - CURRENT_DATE AS days_until_eta
                  FROM containers c
                  JOIN suppliers s ON s.id = c.supplier_id
                  WHERE c.company_id = ${companyId}
                    AND c.status NOT IN ('Offloaded', 'Arrived')
                    AND c.eta IS NOT NULL
                    AND CAST(c.eta AS date) <= ${futureDate}
                  ORDER BY c.eta ASC
                  LIMIT ${rowLimit}
                `);
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const days = parseInt(r.days_until_eta || "0");
                  const daysLabel = days <= 0 ? "TODAY/OVERDUE" : `${days}d`;
                  return [
                    r.container_number,
                    r.status,
                    String(r.eta).slice(0, 10),
                    daysLabel,
                    r.supplier,
                    r.transporter || "—",
                    r.tracking_location || "—",
                  ];
                });
                dataQueryResult = {
                  queryType: "upcoming_arrivals",
                  title: "Upcoming Container Arrivals",
                  subtitle: `Next ${daysAhead} days · ${tableRows4.length} container(s) expected`,
                  table: {
                    headers: ["Container #", "Status", "ETA", "Days Away", "Supplier", "Transporter", "Last Location"],
                    rows: tableRows4,
                  },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "factory_waste_analysis": {
                const rows = await db.execute(sql`
                  SELECT fwe.date, fwe.waste_type,
                    CAST(fwe.kg_waste AS numeric) AS kg_waste,
                    fwe.reason
                  FROM factory_waste_entries fwe
                  WHERE fwe.company_id = ${companyId}
                    AND fwe.date BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY fwe.date DESC
                  LIMIT ${rowLimit}
                `);
                let totalWaste = 0;
                const typeMap: Record<string, number> = {};
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const kg = parseFloat(r.kg_waste || "0");
                  totalWaste += kg;
                  const wt = r.waste_type || "Unknown";
                  typeMap[wt] = (typeMap[wt] || 0) + kg;
                  return [String(r.date).slice(0, 10), wt, fmtDec(kg), (r.reason || "—").slice(0, 40)];
                });
                const byType = Object.entries(typeMap)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, kg]) => `${t}: ${fmtDec(kg)} kg`)
                  .join(" | ");
                const stats4 = [
                  { label: "Total Waste Entries", value: String(tableRows4.length) },
                  { label: "Total Waste Kg", value: fmtDec(totalWaste), highlight: "negative" },
                  { label: "By Type", value: byType || "—" },
                ];
                dataQueryResult = {
                  queryType: "factory_waste_analysis",
                  title: "Factory Waste Analysis",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats4,
                  table: { headers: ["Date", "Waste Type", "Kg", "Reason"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "customer_payment_history": {
                const custName = params.entityName;
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_type, v.description, v.voucher_number,
                    CAST(v.total_amount AS numeric) AS amount, v.currency
                  FROM vouchers v
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.voucher_type IN ('Receipt', 'Payment')
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${custName ? sql`AND v.description ILIKE ${"%" + custName + "%"}` : sql``}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalReceipts = 0,
                  totalPayments = 0;
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const amt = parseFloat(r.amount || "0");
                  if (r.voucher_type === "Receipt") totalReceipts += amt;
                  else totalPayments += amt;
                  return [
                    String(r.voucher_date).slice(0, 10),
                    r.voucher_number,
                    r.voucher_type,
                    (r.description || "").slice(0, 40),
                    fmt(amt),
                    r.currency,
                  ];
                });
                const stats4 = [
                  { label: "Total Receipts", value: fmt(totalReceipts), highlight: "positive" },
                  { label: "Total Payments", value: fmt(totalPayments) },
                ];
                dataQueryResult = {
                  queryType: "customer_payment_history",
                  title: custName ? `Payment History: ${custName}` : "Customer Payment History",
                  subtitle: `${dateFrom} → ${dateTo} · ${tableRows4.length} transaction(s)`,
                  stats: stats4,
                  table: {
                    headers: ["Date", "Voucher #", "Type", "Description", "Amount", "Currency"],
                    rows: tableRows4,
                  },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "voucher_type_summary": {
                const rows = await db.execute(sql`
                  SELECT v.voucher_type,
                    COUNT(v.id) AS count,
                    SUM(CAST(v.total_amount AS numeric)) AS total_amount,
                    MIN(CAST(v.voucher_date AS text)) AS first_date,
                    MAX(CAST(v.voucher_date AS text)) AS last_date
                  FROM vouchers v
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY v.voucher_type
                  ORDER BY count DESC
                `);
                let grandCount = 0,
                  grandTotal = 0;
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const cnt = parseInt(r.count || "0");
                  const amt = parseFloat(r.total_amount || "0");
                  grandCount += cnt;
                  grandTotal += amt;
                  return [
                    r.voucher_type,
                    String(cnt),
                    fmt(amt),
                    r.first_date?.slice(0, 10) || "—",
                    r.last_date?.slice(0, 10) || "—",
                  ];
                });
                tableRows4.push(["TOTAL", String(grandCount), fmt(grandTotal), "", ""]);
                dataQueryResult = {
                  queryType: "voucher_type_summary",
                  title: "Voucher Summary by Type",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: { headers: ["Voucher Type", "Count", "Total Amount", "First", "Last"], rows: tableRows4 },
                  noData: tableRows4.length <= 1,
                };
                break;
              }

              case "location_stock_summary": {
                const locFilter = params.entityName || params.locationName;
                const rows = await db.execute(sql`
                  SELECT l.name AS location,
                    COUNT(DISTINCT inv.stock_item_id) AS item_count,
                    SUM(CAST(inv.quantity AS numeric)) AS total_qty,
                    SUM(CAST(inv.total_value AS numeric)) AS total_value
                  FROM inventory inv
                  JOIN locations l ON l.id = inv.location_id
                  WHERE inv.company_id = ${companyId}
                    AND inv.quantity > 0
                    ${locFilter ? sql`AND l.name ILIKE ${"%" + locFilter + "%"}` : sql``}
                  GROUP BY l.id, l.name
                  ORDER BY total_value DESC
                  LIMIT ${rowLimit}
                `);
                let grandItems = 0,
                  grandValue = 0;
                const tableRows4 = (rows.rows as any[]).map((r) => {
                  const items = parseInt(r.item_count || "0");
                  const val = parseFloat(r.total_value || "0");
                  grandItems += items;
                  grandValue += val;
                  return [r.location, String(items), fmtDec(parseFloat(r.total_qty || "0")), fmt(val)];
                });
                tableRows4.push(["GRAND TOTAL", String(grandItems), "—", fmt(grandValue)]);
                const stats4 = [
                  { label: "Locations", value: String(tableRows4.length - 1) },
                  { label: "Total Stock Items", value: String(grandItems) },
                  { label: "Total Value", value: fmt(grandValue), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "location_stock_summary",
                  title: locFilter ? `Stock Summary: ${locFilter}` : "Stock by Location",
                  subtitle: `As of ${todayStr}`,
                  stats: stats4,
                  table: { headers: ["Location", "Items", "Total Qty", "Total Value"], rows: tableRows4 },
                  noData: tableRows4.length <= 1,
                };
                break;
              }

              // ── Phase 5 Cases ────────────────────────────────────────────────

              case "trial_balance": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.account_type, la.code,
                    COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) AS total_dr,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_cr
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  WHERE la.company_id = ${companyId}
                    AND la.deleted_at IS NULL
                    AND la.is_hidden = false
                  GROUP BY la.id, la.name, la.account_type, la.code
                  HAVING COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) > 0
                    OR COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) > 0
                  ORDER BY la.account_type, la.name
                `);
                let grandDr = 0,
                  grandCr = 0;
                const tableRows5 = (rows.rows as any[]).map((r) => {
                  const dr = parseFloat(r.total_dr || "0");
                  const cr = parseFloat(r.total_cr || "0");
                  const net = dr - cr;
                  grandDr += dr;
                  grandCr += cr;
                  return [
                    r.code || "—",
                    r.name,
                    r.account_type,
                    fmt(dr),
                    fmt(cr),
                    net >= 0 ? fmt(net) : "—",
                    net < 0 ? fmt(Math.abs(net)) : "—",
                  ];
                });
                tableRows5.push([
                  "",
                  "GRAND TOTAL",
                  "",
                  fmt(grandDr),
                  fmt(grandCr),
                  grandDr >= grandCr ? fmt(grandDr - grandCr) : "—",
                  grandCr > grandDr ? fmt(grandCr - grandDr) : "—",
                ]);
                const stats5 = [
                  { label: "Total Accounts", value: String(tableRows5.length - 1) },
                  { label: "Total Debits", value: fmt(grandDr) },
                  { label: "Total Credits", value: fmt(grandCr) },
                  {
                    label: "Net",
                    value: fmt(Math.abs(grandDr - grandCr)),
                    highlight: Math.abs(grandDr - grandCr) < 0.01 ? "positive" : "negative",
                  },
                ];
                dataQueryResult = {
                  queryType: "trial_balance",
                  title: "Trial Balance",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats5,
                  table: {
                    headers: ["Code", "Account", "Type", "Debit", "Credit", "Dr Balance", "Cr Balance"],
                    rows: tableRows5,
                  },
                  noData: tableRows5.length <= 1,
                };
                break;
              }

              case "purchase_order_detail": {
                const poNum = params.containerNumber || params.entityName;
                if (!poNum) {
                  dataQueryResult = {
                    queryType: "purchase_order_detail",
                    title: "Purchase Order Detail",
                    summary: "Please specify a PO number.",
                  };
                  break;
                }
                const poRow = await db.execute(sql`
                  SELECT po.id, po.po_number, po.currency, po.status,
                    s.legal_name AS supplier, c.container_number,
                    CAST(po.items_total AS numeric) AS items_total,
                    CAST(po.freight AS numeric) AS freight,
                    CAST(po.surcharge AS numeric) AS surcharge,
                    CAST(po.fumigation AS numeric) AS fumigation,
                    CAST(po.document_charges AS numeric) AS doc_charges,
                    CAST(po.other_charges AS numeric) AS other_charges,
                    CAST(po.discount AS numeric) AS discount
                  FROM purchase_orders po
                  JOIN suppliers s ON s.id = po.supplier_id
                  JOIN containers c ON c.id = po.container_id
                  WHERE po.company_id = ${companyId}
                    AND po.po_number ILIKE ${"%" + poNum + "%"}
                  ORDER BY po.created_at DESC LIMIT 1
                `);
                if (!poRow.rows.length) {
                  dataQueryResult = {
                    queryType: "purchase_order_detail",
                    title: "Purchase Order Detail",
                    summary: `No PO found matching "${poNum}".`,
                  };
                  break;
                }
                const po5 = poRow.rows[0] as any;
                const lineRows = await db.execute(sql`
                  SELECT pli.item_name, si.code, si.uom,
                    CAST(pli.quantity AS numeric) AS qty,
                    CAST(pli.rate AS numeric) AS rate,
                    CAST(pli.line_total AS numeric) AS line_total
                  FROM po_line_items pli
                  JOIN stock_items si ON si.id = pli.stock_item_id
                  WHERE pli.po_id = ${po5.id}
                  ORDER BY pli.id
                `);
                let lineTotal = 0;
                const tableRows5 = (lineRows.rows as any[]).map((r) => {
                  const lt = parseFloat(r.line_total || "0");
                  lineTotal += lt;
                  return [
                    r.item_name,
                    r.code,
                    `${fmtDec(parseFloat(r.qty))} ${r.uom}`,
                    fmtDec(parseFloat(r.rate)),
                    fmt(lt),
                  ];
                });
                const charges = [
                  ["Freight", fmt(parseFloat(po5.freight || "0"))],
                  ["Surcharge", fmt(parseFloat(po5.surcharge || "0"))],
                  ["Fumigation", fmt(parseFloat(po5.fumigation || "0"))],
                  ["Document Charges", fmt(parseFloat(po5.doc_charges || "0"))],
                  ["Other Charges", fmt(parseFloat(po5.other_charges || "0"))],
                  ["Discount", `(${fmt(parseFloat(po5.discount || "0"))})`],
                ].filter(([, v]) => v !== fmt(0) && v !== `(${fmt(0)})`);
                const grandPO =
                  parseFloat(po5.items_total || "0") +
                  parseFloat(po5.freight || "0") +
                  parseFloat(po5.surcharge || "0") +
                  parseFloat(po5.fumigation || "0") +
                  parseFloat(po5.doc_charges || "0") +
                  parseFloat(po5.other_charges || "0") -
                  parseFloat(po5.discount || "0");
                const stats5 = [
                  { label: "Supplier", value: po5.supplier },
                  { label: "Container", value: po5.container_number },
                  { label: "Currency", value: po5.currency },
                  { label: "Items Total", value: fmt(parseFloat(po5.items_total || "0")) },
                  { label: "Grand Total", value: fmt(grandPO), highlight: "positive" },
                  { label: "Status", value: po5.status },
                ];
                const chargeRows = charges.map(([label, val]) => [label, "", "", "", val]);
                chargeRows.push(["GRAND TOTAL", "", "", "", fmt(grandPO)]);
                dataQueryResult = {
                  queryType: "purchase_order_detail",
                  title: `PO Detail: ${po5.po_number}`,
                  subtitle: `${tableRows5.length} line item(s)`,
                  stats: stats5,
                  table: { headers: ["Item", "Code", "Qty", "Rate", "Total"], rows: [...tableRows5, ...chargeRows] },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "container_cost_breakdown": {
                const cnFilter5 = params.containerNumber || params.entityName;
                if (!cnFilter5) {
                  dataQueryResult = {
                    queryType: "container_cost_breakdown",
                    title: "Container Cost Breakdown",
                    summary: "Please specify a container number.",
                  };
                  break;
                }
                const cRow = await db.execute(sql`
                  SELECT c.container_number, c.status, c.import_date, c.currency,
                    s.legal_name AS supplier,
                    CAST(c.items_total AS numeric) AS items_total,
                    CAST(c.charges_total AS numeric) AS charges_total,
                    CAST(c.grand_total AS numeric) AS grand_total,
                    CAST(c.total_kg AS numeric) AS total_kg,
                    CAST(c.rate_per_kg AS numeric) AS rate_per_kg,
                    CAST(c.transport_fee AS numeric) AS transport_fee,
                    CAST(c.duty_fee AS numeric) AS duty_fee,
                    c.transporter, c.agent
                  FROM containers c
                  JOIN suppliers s ON s.id = c.supplier_id
                  WHERE c.company_id = ${companyId}
                    AND c.container_number ILIKE ${"%" + cnFilter5 + "%"}
                  ORDER BY c.import_date DESC LIMIT 1
                `);
                if (!cRow.rows.length) {
                  dataQueryResult = {
                    queryType: "container_cost_breakdown",
                    title: "Container Cost Breakdown",
                    summary: `No container found matching "${cnFilter5}".`,
                  };
                  break;
                }
                const cc = cRow.rows[0] as any;
                const poRows5 = await db.execute(sql`
                  SELECT po.po_number, po.currency,
                    CAST(po.items_total AS numeric) AS items_total,
                    CAST(po.freight AS numeric) AS freight,
                    CAST(po.surcharge AS numeric) AS surcharge,
                    CAST(po.fumigation AS numeric) AS fumigation,
                    CAST(po.document_charges AS numeric) AS doc_charges,
                    CAST(po.other_charges AS numeric) AS other_charges,
                    CAST(po.discount AS numeric) AS discount
                  FROM purchase_orders po
                  JOIN containers c ON c.id = po.container_id
                  WHERE c.container_number ILIKE ${"%" + cnFilter5 + "%"}
                  LIMIT 10
                `);
                const stats5 = [
                  { label: "Supplier", value: cc.supplier },
                  { label: "Status", value: cc.status },
                  { label: "Import Date", value: String(cc.import_date).slice(0, 10) },
                  { label: "Total Kg", value: fmtDec(parseFloat(cc.total_kg || "0")) },
                  { label: "Rate/Kg", value: fmtDec(parseFloat(cc.rate_per_kg || "0")) },
                  { label: "Grand Total", value: fmt(parseFloat(cc.grand_total || "0")), highlight: "positive" },
                ];
                const breakdownRows: string[][] = [
                  ["Items Total", cc.currency, fmt(parseFloat(cc.items_total || "0"))],
                  ["Charges Total", cc.currency, fmt(parseFloat(cc.charges_total || "0"))],
                ];
                if (parseFloat(cc.transport_fee || "0") > 0)
                  breakdownRows.push(["Transport Fee", cc.currency, fmt(parseFloat(cc.transport_fee))]);
                if (parseFloat(cc.duty_fee || "0") > 0)
                  breakdownRows.push(["Duty Fee", cc.currency, fmt(parseFloat(cc.duty_fee))]);
                for (const po of poRows5.rows as any[]) {
                  if (parseFloat(po.freight || "0") > 0)
                    breakdownRows.push([`Freight (${po.po_number})`, po.currency, fmt(parseFloat(po.freight))]);
                  if (parseFloat(po.fumigation || "0") > 0)
                    breakdownRows.push([`Fumigation (${po.po_number})`, po.currency, fmt(parseFloat(po.fumigation))]);
                  if (parseFloat(po.surcharge || "0") > 0)
                    breakdownRows.push([`Surcharge (${po.po_number})`, po.currency, fmt(parseFloat(po.surcharge))]);
                  if (parseFloat(po.doc_charges || "0") > 0)
                    breakdownRows.push([`Doc Charges (${po.po_number})`, po.currency, fmt(parseFloat(po.doc_charges))]);
                  if (parseFloat(po.discount || "0") > 0)
                    breakdownRows.push([
                      `Discount (${po.po_number})`,
                      po.currency,
                      `(${fmt(parseFloat(po.discount))})`,
                    ]);
                }
                breakdownRows.push(["GRAND TOTAL", cc.currency, fmt(parseFloat(cc.grand_total || "0"))]);
                dataQueryResult = {
                  queryType: "container_cost_breakdown",
                  title: `Cost Breakdown: ${cc.container_number}`,
                  subtitle: cc.transporter
                    ? `Transporter: ${cc.transporter}${cc.agent ? ` · Agent: ${cc.agent}` : ""}`
                    : "",
                  stats: stats5,
                  table: { headers: ["Component", "Currency", "Amount"], rows: breakdownRows },
                  noData: false,
                };
                break;
              }

              case "worker_document_expiry": {
                const daysWindow = 60;
                const futureDoc = new Date(todayDate.getTime() + daysWindow * 86400000).toISOString().slice(0, 10);
                const rows = await db.execute(sql`
                  SELECT fw.full_name, fw.employee_code, fw.nationality,
                    fw.visa_expiry, fw.work_permit_expiry, fw.residential_permit_expiry,
                    fw.visa_number, fw.work_permit_number
                  FROM factory_workers fw
                  WHERE fw.company_id = ${companyId} AND fw.active = true
                    AND (
                      (fw.visa_expiry IS NOT NULL AND fw.visa_expiry <= ${futureDoc})
                      OR (fw.work_permit_expiry IS NOT NULL AND fw.work_permit_expiry <= ${futureDoc})
                      OR (fw.residential_permit_expiry IS NOT NULL AND fw.residential_permit_expiry <= ${futureDoc})
                    )
                  ORDER BY LEAST(
                    COALESCE(fw.visa_expiry, '9999-01-01'),
                    COALESCE(fw.work_permit_expiry, '9999-01-01'),
                    COALESCE(fw.residential_permit_expiry, '9999-01-01')
                  ) ASC
                  LIMIT ${rowLimit}
                `);
                const expired: string[] = [],
                  expiringSoon: string[] = [];
                const tableRows5 = (rows.rows as any[]).map((r) => {
                  const visaExp = r.visa_expiry ? String(r.visa_expiry).slice(0, 10) : "—";
                  const wpExp = r.work_permit_expiry ? String(r.work_permit_expiry).slice(0, 10) : "—";
                  const rpExp = r.residential_permit_expiry ? String(r.residential_permit_expiry).slice(0, 10) : "—";
                  const isExpired = (d: string) => d !== "—" && d < todayStr;
                  const label = (d: string) => (isExpired(d) ? `${d} ⚠ EXPIRED` : d);
                  if (isExpired(visaExp) || isExpired(wpExp) || isExpired(rpExp)) expired.push(r.full_name);
                  return [
                    r.full_name,
                    r.employee_code || "—",
                    r.nationality || "—",
                    label(visaExp),
                    label(wpExp),
                    label(rpExp),
                  ];
                });
                const stats5 = [
                  { label: "Workers With Expiring Docs", value: String(tableRows5.length) },
                  {
                    label: "Already Expired",
                    value: String(expired.length),
                    highlight: expired.length > 0 ? "negative" : undefined,
                  },
                  { label: "Window", value: `Next ${daysWindow} days` },
                ];
                dataQueryResult = {
                  queryType: "worker_document_expiry",
                  title: "Worker Document Expiry Alert",
                  subtitle: `Expiring within ${daysWindow} days (as of ${todayStr})`,
                  stats: stats5,
                  table: {
                    headers: ["Worker", "Code", "Nationality", "Visa Expiry", "Work Permit", "Residential Permit"],
                    rows: tableRows5,
                  },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "stock_transfers": {
                const locFilter5 = params.locationName || params.entityName;
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_number,
                    sl.name AS from_location, dl.name AS to_location,
                    si.name AS item_name, si.code,
                    CAST(sti.quantity AS numeric) AS qty, si.uom,
                    CAST(sti.rate AS numeric) AS rate,
                    CAST(sti.total_amount AS numeric) AS total_amount,
                    stv.notes
                  FROM stock_transfer_items sti
                  JOIN stock_transfer_vouchers stv ON stv.id = sti.transfer_id
                  JOIN vouchers v ON v.id = stv.voucher_id AND v.deleted_at IS NULL
                  JOIN stock_items si ON si.id = sti.stock_item_id
                  LEFT JOIN locations sl ON sl.id = sti.source_location_id
                  JOIN locations dl ON dl.id = stv.destination_location_id
                  WHERE si.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${locFilter5 ? sql`AND (sl.name ILIKE ${"%" + locFilter5 + "%"} OR dl.name ILIKE ${"%" + locFilter5 + "%"})` : sql``}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalTransferred = 0;
                const tableRows5 = (rows.rows as any[]).map((r) => {
                  const amt = parseFloat(r.total_amount || "0");
                  totalTransferred += amt;
                  return [
                    String(r.voucher_date).slice(0, 10),
                    r.voucher_number,
                    r.item_name,
                    `${fmtDec(parseFloat(r.qty))} ${r.uom}`,
                    r.from_location || "—",
                    r.to_location,
                    fmt(amt),
                  ];
                });
                dataQueryResult = {
                  queryType: "stock_transfers",
                  title: locFilter5 ? `Stock Transfers: ${locFilter5}` : "Stock Transfers",
                  subtitle: `${dateFrom} → ${dateTo} · Total value transferred: ${fmt(totalTransferred)}`,
                  table: { headers: ["Date", "Voucher #", "Item", "Qty", "From", "To", "Value"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "cash_flow_summary": {
                const rows = await db.execute(sql`
                  SELECT la.name AS account_name, la.account_type,
                    COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) AS total_in,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_out,
                    COUNT(DISTINCT v.id) AS tx_count
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  JOIN ledger_accounts la ON la.id = ve.ledger_account_id
                    AND la.account_type IN ('Bank', 'Cash')
                  WHERE la.company_id = ${companyId}
                  GROUP BY la.id, la.name, la.account_type
                  ORDER BY total_in DESC
                `);
                let grandIn = 0,
                  grandOut = 0;
                const tableRows5 = (rows.rows as any[]).map((r) => {
                  const inflow = parseFloat(r.total_in || "0");
                  const outflow = parseFloat(r.total_out || "0");
                  const net = inflow - outflow;
                  grandIn += inflow;
                  grandOut += outflow;
                  return [
                    r.account_name,
                    r.account_type,
                    fmt(inflow),
                    fmt(outflow),
                    net >= 0 ? fmt(net) : `(${fmt(Math.abs(net))})`,
                    String(r.tx_count),
                  ];
                });
                tableRows5.push([
                  "TOTAL",
                  "",
                  fmt(grandIn),
                  fmt(grandOut),
                  grandIn >= grandOut ? fmt(grandIn - grandOut) : `(${fmt(grandOut - grandIn)})`,
                  "",
                ]);
                const stats5 = [
                  { label: "Total Cash In", value: fmt(grandIn), highlight: "positive" },
                  { label: "Total Cash Out", value: fmt(grandOut) },
                  {
                    label: "Net Position",
                    value: grandIn >= grandOut ? fmt(grandIn - grandOut) : `(${fmt(grandOut - grandIn)})`,
                    highlight: grandIn >= grandOut ? "positive" : "negative",
                  },
                ];
                dataQueryResult = {
                  queryType: "cash_flow_summary",
                  title: "Cash Flow Summary",
                  subtitle: `${dateFrom} → ${dateTo} · Bank & Cash accounts`,
                  stats: stats5,
                  table: {
                    headers: ["Account", "Type", "Inflow (Dr)", "Outflow (Cr)", "Net", "Transactions"],
                    rows: tableRows5,
                  },
                  noData: tableRows5.length <= 1,
                };
                break;
              }

              case "ledger_account_balance": {
                const acctName5 = params.entityName || params.locationName;
                if (!acctName5) {
                  dataQueryResult = {
                    queryType: "ledger_account_balance",
                    title: "Ledger Account Balance",
                    summary: "Please specify an account name.",
                  };
                  break;
                }
                const acctRow5 = await db.execute(sql`
                  SELECT id, name, account_type, code,
                    CAST(opening_balance AS numeric) AS opening_balance, opening_balance_side
                  FROM ledger_accounts
                  WHERE company_id = ${companyId} AND deleted_at IS NULL
                    AND name ILIKE ${"%" + acctName5 + "%"}
                  ORDER BY name LIMIT 1
                `);
                if (!acctRow5.rows.length) {
                  dataQueryResult = {
                    queryType: "ledger_account_balance",
                    title: "Ledger Account Balance",
                    summary: `No account found matching "${acctName5}".`,
                  };
                  break;
                }
                const la5 = acctRow5.rows[0] as any;
                const txRows5 = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_type, v.voucher_number, v.description,
                    CAST(ve.debit_amount AS numeric) AS dr,
                    CAST(ve.credit_amount AS numeric) AS cr
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  WHERE ve.ledger_account_id = ${la5.id}
                  ORDER BY v.voucher_date, v.id
                  LIMIT ${rowLimit}
                `);
                const ob = parseFloat(la5.opening_balance || "0") * (la5.opening_balance_side === "Cr" ? -1 : 1);
                let runningBal = ob;
                let totalDr = 0,
                  totalCr = 0;
                const tableRows5 = (txRows5.rows as any[]).map((r) => {
                  const dr = parseFloat(r.dr || "0");
                  const cr = parseFloat(r.cr || "0");
                  runningBal += dr - cr;
                  totalDr += dr;
                  totalCr += cr;
                  return [
                    String(r.voucher_date).slice(0, 10),
                    r.voucher_number,
                    r.voucher_type,
                    (r.description || "").slice(0, 35),
                    dr > 0 ? fmt(dr) : "—",
                    cr > 0 ? fmt(cr) : "—",
                    fmt(Math.abs(runningBal)) + (runningBal >= 0 ? " Dr" : " Cr"),
                  ];
                });
                const stats5 = [
                  { label: "Account", value: `${la5.code ? la5.code + " — " : ""}${la5.name}` },
                  { label: "Type", value: la5.account_type },
                  { label: "Total Debit", value: fmt(totalDr) },
                  { label: "Total Credit", value: fmt(totalCr) },
                  {
                    label: "Closing Balance",
                    value: fmt(Math.abs(runningBal)) + (runningBal >= 0 ? " Dr" : " Cr"),
                    highlight: "positive",
                  },
                ];
                dataQueryResult = {
                  queryType: "ledger_account_balance",
                  title: `Ledger: ${la5.name}`,
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats5,
                  table: {
                    headers: ["Date", "Voucher #", "Type", "Description", "Dr", "Cr", "Balance"],
                    rows: tableRows5,
                  },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "daily_report": {
                const reportDate = params.dateFrom || todayStr;
                const rows = await db.execute(sql`
                  SELECT v.voucher_number, v.voucher_type, v.description,
                    CAST(v.total_amount AS numeric) AS amount,
                    v.currency, l.name AS location
                  FROM vouchers v
                  LEFT JOIN locations l ON l.id = v.location_id
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.optional = false
                    AND CAST(v.voucher_date AS text) = ${reportDate}
                  ORDER BY v.voucher_type, v.voucher_number
                  LIMIT ${rowLimit}
                `);
                const typeMap5: Record<string, number> = {};
                let grandAmt = 0;
                const tableRows5 = (rows.rows as any[]).map((r) => {
                  const amt = parseFloat(r.amount || "0");
                  typeMap5[r.voucher_type] = (typeMap5[r.voucher_type] || 0) + amt;
                  grandAmt += amt;
                  return [
                    r.voucher_number,
                    r.voucher_type,
                    (r.description || "").slice(0, 40),
                    r.location || "—",
                    fmt(amt),
                    r.currency,
                  ];
                });
                const stats5 = [
                  { label: "Date", value: reportDate },
                  { label: "Total Vouchers", value: String(tableRows5.length) },
                  { label: "Grand Total", value: fmt(grandAmt), highlight: "positive" },
                  ...Object.entries(typeMap5).map(([t, a]) => ({ label: t, value: fmt(a) })),
                ];
                dataQueryResult = {
                  queryType: "daily_report",
                  title: `Daily Report: ${reportDate}`,
                  subtitle: `${tableRows5.length} voucher(s) · Total: ${fmt(grandAmt)}`,
                  stats: stats5,
                  table: {
                    headers: ["Voucher #", "Type", "Description", "Location", "Amount", "Currency"],
                    rows: tableRows5,
                  },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "profit_by_location": {
                const rows = await db.execute(sql`
                  SELECT COALESCE(l.name, v.location_name, 'Unassigned') AS location,
                    COUNT(DISTINCT v.id) AS sales_count,
                    SUM(CAST(sal.total_sales AS numeric)) AS total_revenue,
                    SUM(CAST(sal.total_cost AS numeric)) AS total_cost,
                    SUM(CAST(sal.profit AS numeric)) AS total_profit
                  FROM sales_items sal
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  LEFT JOIN locations l ON l.id = v.location_id
                  WHERE v.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY l.id, l.name, v.location_name
                  ORDER BY total_profit DESC
                  LIMIT ${rowLimit}
                `);
                let grandRev = 0,
                  grandCost = 0,
                  grandProfit = 0;
                const tableRows5 = (rows.rows as any[]).map((r) => {
                  const rev = parseFloat(r.total_revenue || "0");
                  const cost = parseFloat(r.total_cost || "0");
                  const profit5 = parseFloat(r.total_profit || "0");
                  const margin = rev > 0 ? ((profit5 / rev) * 100).toFixed(1) + "%" : "—";
                  grandRev += rev;
                  grandCost += cost;
                  grandProfit += profit5;
                  return [r.location, String(r.sales_count), fmt(rev), fmt(cost), fmt(profit5), margin];
                });
                if (tableRows5.length) {
                  const totMargin = grandRev > 0 ? ((grandProfit / grandRev) * 100).toFixed(1) + "%" : "—";
                  tableRows5.push(["TOTAL", "", fmt(grandRev), fmt(grandCost), fmt(grandProfit), totMargin]);
                }
                const best = tableRows5.length > 1 ? tableRows5[0] : null;
                const stats5 = [
                  { label: "Total Revenue", value: fmt(grandRev) },
                  { label: "Total Cost", value: fmt(grandCost) },
                  { label: "Total Profit", value: fmt(grandProfit), highlight: "positive" },
                  ...(best ? [{ label: "Best Location", value: best[0] as string }] : []),
                ];
                dataQueryResult = {
                  queryType: "profit_by_location",
                  title: "Profit by Location",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats5,
                  table: { headers: ["Location", "Sales", "Revenue", "Cost", "Profit", "Margin"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "debit_note_summary": {
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_number, v.description,
                    CAST(v.total_amount AS numeric) AS amount, v.currency
                  FROM vouchers v
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.voucher_type = 'Debit Note'
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalDN = 0;
                const tableRows5 = (rows.rows as any[]).map((r) => {
                  const amt = parseFloat(r.amount || "0");
                  totalDN += amt;
                  return [
                    String(r.voucher_date).slice(0, 10),
                    r.voucher_number,
                    (r.description || "").slice(0, 50),
                    fmt(amt),
                    r.currency,
                  ];
                });
                const stats5 = [
                  { label: "Debit Notes Issued", value: String(tableRows5.length) },
                  { label: "Total Amount", value: fmt(totalDN), highlight: "negative" },
                ];
                dataQueryResult = {
                  queryType: "debit_note_summary",
                  title: "Debit Notes",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats5,
                  table: { headers: ["Date", "Voucher #", "Description", "Amount", "Currency"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              // ── Phase 6 Cases ────────────────────────────────────────────────

              case "customer_list": {
                const nameFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT c.code, c.legal_name, c.phone, c.payment_terms_days, c.active,
                    COALESCE(
                      CAST(c.opening_balance AS numeric) * CASE WHEN c.opening_balance_side = 'Dr' THEN 1 ELSE -1 END
                      + COALESCE(SUM(CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric)), 0),
                      CAST(c.opening_balance AS numeric) * CASE WHEN c.opening_balance_side = 'Dr' THEN 1 ELSE -1 END
                    ) AS net_balance
                  FROM customers c
                  LEFT JOIN ledger_accounts la ON la.id = c.ledger_account_id AND la.deleted_at IS NULL
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id AND v.deleted_at IS NULL AND v.optional = false
                  WHERE c.company_id = ${companyId}
                    AND c.deleted_at IS NULL
                    ${nameFilter6 ? sql`AND c.legal_name ILIKE ${"%" + nameFilter6 + "%"}` : sql``}
                  GROUP BY c.id, c.code, c.legal_name, c.phone, c.payment_terms_days, c.active, c.opening_balance, c.opening_balance_side
                  ORDER BY c.legal_name
                  LIMIT ${rowLimit}
                `);
                let totalBalance = 0;
                const tableRows6 = (rows.rows as any[]).map((r) => {
                  const bal = parseFloat(r.net_balance || "0");
                  totalBalance += Math.max(bal, 0);
                  const balLabel = bal >= 0 ? fmt(bal) + " Dr" : fmt(Math.abs(bal)) + " Cr";
                  return [
                    r.code,
                    r.legal_name,
                    r.phone || "—",
                    r.payment_terms_days ? `${r.payment_terms_days}d` : "—",
                    balLabel,
                    r.active ? "Active" : "Inactive",
                  ];
                });
                const stats6 = [
                  { label: "Total Customers", value: String(tableRows6.length) },
                  { label: "Total Outstanding (Dr)", value: fmt(totalBalance), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "customer_list",
                  title: nameFilter6 ? `Customers: ${nameFilter6}` : "Customer List",
                  subtitle: `${tableRows6.length} customer(s)`,
                  stats: stats6,
                  table: { headers: ["Code", "Name", "Phone", "Terms", "Balance", "Status"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "supplier_list": {
                const nameFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT s.code, s.legal_name, s.email, s.phone, s.payment_terms, s.active,
                    COUNT(DISTINCT po.id) AS po_count,
                    COALESCE(SUM(CAST(po.items_total AS numeric)), 0) AS total_ordered
                  FROM suppliers s
                  JOIN purchase_orders po ON po.supplier_id = s.id AND po.company_id = ${companyId}
                  WHERE s.deleted_at IS NULL
                    ${nameFilter6 ? sql`AND s.legal_name ILIKE ${"%" + nameFilter6 + "%"}` : sql``}
                  GROUP BY s.id, s.code, s.legal_name, s.email, s.phone, s.payment_terms, s.active
                  ORDER BY total_ordered DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows6 = (rows.rows as any[]).map((r) => [
                  r.code || "—",
                  r.legal_name,
                  r.email || "—",
                  r.phone || "—",
                  r.payment_terms || "—",
                  String(r.po_count),
                  fmt(parseFloat(r.total_ordered || "0")),
                  r.active ? "Active" : "Inactive",
                ]);
                const stats6 = [
                  { label: "Suppliers", value: String(tableRows6.length) },
                  { label: "Total POs", value: String(tableRows6.reduce((s, r) => s + parseInt(r[5]), 0)) },
                ];
                dataQueryResult = {
                  queryType: "supplier_list",
                  title: nameFilter6 ? `Suppliers: ${nameFilter6}` : "Supplier List",
                  subtitle: `${tableRows6.length} supplier(s) · ranked by total ordered`,
                  stats: stats6,
                  table: {
                    headers: ["Code", "Name", "Email", "Phone", "Terms", "POs", "Total Ordered", "Status"],
                    rows: tableRows6,
                  },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "stock_item_detail": {
                const itemName6 = params.entityName;
                if (!itemName6) {
                  dataQueryResult = {
                    queryType: "stock_item_detail",
                    title: "Stock Item Detail",
                    summary: "Please specify an item name.",
                  };
                  break;
                }
                const itemRow = await db.execute(sql`
                  SELECT si.id, si.code, si.name, si.uom, si.selling_price, si.reorder_level,
                    si.opening_qty, si.opening_rate, si.opening_value, si.active,
                    sg.name AS group_name
                  FROM stock_items si
                  LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
                  WHERE si.company_id = ${companyId}
                    AND si.deleted_at IS NULL
                    AND si.name ILIKE ${"%" + itemName6 + "%"}
                  ORDER BY si.name LIMIT 1
                `);
                if (!itemRow.rows.length) {
                  dataQueryResult = {
                    queryType: "stock_item_detail",
                    title: "Stock Item Detail",
                    summary: `No item found matching "${itemName6}".`,
                  };
                  break;
                }
                const si6 = itemRow.rows[0] as any;
                const invRows = await db.execute(sql`
                  SELECT l.name AS location,
                    CAST(inv.quantity AS numeric) AS qty,
                    CAST(inv.avg_rate AS numeric) AS avg_rate,
                    CAST(inv.total_value AS numeric) AS total_value
                  FROM inventory inv
                  JOIN locations l ON l.id = inv.location_id
                  WHERE inv.stock_item_id = ${si6.id}
                    AND inv.company_id = ${companyId}
                    AND inv.quantity > 0
                  ORDER BY inv.quantity DESC
                `);
                let totalQty = 0,
                  totalVal = 0;
                const tableRows6 = (invRows.rows as any[]).map((r) => {
                  const qty = parseFloat(r.qty || "0");
                  const val = parseFloat(r.total_value || "0");
                  totalQty += qty;
                  totalVal += val;
                  return [r.location, fmtDec(qty), fmtDec(parseFloat(r.avg_rate || "0")), fmt(val)];
                });
                const stats6 = [
                  { label: "Code", value: si6.code },
                  { label: "Group", value: si6.group_name || "—" },
                  { label: "UOM", value: si6.uom },
                  { label: "Selling Price", value: fmtDec(parseFloat(si6.selling_price || "0")) },
                  { label: "Reorder Level", value: `${fmtDec(parseFloat(si6.reorder_level || "0"))} ${si6.uom}` },
                  {
                    label: "Total Stock",
                    value: `${fmtDec(totalQty)} ${si6.uom}`,
                    highlight: totalQty > 0 ? "positive" : "negative",
                  },
                  { label: "Total Value", value: fmt(totalVal), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "stock_item_detail",
                  title: `Item: ${si6.name}`,
                  subtitle: `${tableRows6.length} location(s) with stock`,
                  stats: stats6,
                  table: { headers: ["Location", "Qty", "Avg Rate", "Value"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "factory_mix_batches": {
                const statusFilter6 = params.entityName?.toUpperCase() || null;
                const rows = await db.execute(sql`
                  SELECT fmb.batch_code, fmb.name, fmb.batch_date, fmb.status,
                    CAST(fmb.total_weight_kg AS numeric) AS total_kg,
                    CAST(fmb.used_kg AS numeric) AS used_kg,
                    CAST(fmb.cost_per_kg AS numeric) AS cost_per_kg,
                    CAST(fmb.total_cost AS numeric) AS total_cost,
                    fmb.operator_user
                  FROM factory_mix_batches fmb
                  WHERE fmb.company_id = ${companyId}
                    AND fmb.deleted_at IS NULL
                    ${statusFilter6 ? sql`AND fmb.status = ${statusFilter6}` : sql``}
                    ${params.dateFrom ? sql`AND fmb.batch_date >= ${params.dateFrom}` : sql``}
                  ORDER BY fmb.batch_date DESC, fmb.id DESC
                  LIMIT ${rowLimit}
                `);
                let totWeight = 0,
                  totUsed = 0,
                  totCost = 0;
                const tableRows6 = (rows.rows as any[]).map((r) => {
                  const totalKg = parseFloat(r.total_kg || "0");
                  const usedKg = parseFloat(r.used_kg || "0");
                  const remainKg = totalKg - usedKg;
                  const pct = totalKg > 0 ? ((usedKg / totalKg) * 100).toFixed(1) + "%" : "—";
                  totWeight += totalKg;
                  totUsed += usedKg;
                  totCost += parseFloat(r.total_cost || "0");
                  return [
                    r.batch_code,
                    r.name || "—",
                    r.batch_date ? String(r.batch_date).slice(0, 10) : "—",
                    r.status,
                    fmtDec(totalKg),
                    fmtDec(usedKg),
                    fmtDec(remainKg),
                    pct,
                    fmtDec(parseFloat(r.cost_per_kg || "0")),
                    r.operator_user || "—",
                  ];
                });
                const stats6 = [
                  { label: "Batches", value: String(tableRows6.length) },
                  { label: "Total Weight Kg", value: fmtDec(totWeight) },
                  { label: "Used Kg", value: fmtDec(totUsed) },
                  { label: "Remaining Kg", value: fmtDec(totWeight - totUsed), highlight: "positive" },
                  { label: "Total Cost", value: fmt(totCost) },
                ];
                dataQueryResult = {
                  queryType: "factory_mix_batches",
                  title: statusFilter6 ? `Mix Batches — ${statusFilter6}` : "Factory Mix Batches",
                  subtitle: `${tableRows6.length} batch(es)`,
                  stats: stats6,
                  table: {
                    headers: [
                      "Code",
                      "Name",
                      "Date",
                      "Status",
                      "Total Kg",
                      "Used Kg",
                      "Remaining",
                      "Usage%",
                      "Cost/Kg",
                      "Operator",
                    ],
                    rows: tableRows6,
                  },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "customer_proformas": {
                const custFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT cp.id, cp.name AS proforma_name, cu.legal_name AS customer,
                    cp.is_active, cp.created_at,
                    COUNT(cpl.id) AS line_count,
                    COALESCE(SUM(cpl.quantity), 0) AS total_qty,
                    COALESCE(SUM(CAST(cpl.price_per_bale AS numeric) * cpl.quantity), 0) AS total_value
                  FROM customer_proformas cp
                  JOIN customers cu ON cu.id = cp.customer_id
                  LEFT JOIN customer_proforma_lines cpl ON cpl.proforma_id = cp.id
                  WHERE cp.company_id = ${companyId}
                    AND cp.deleted_at IS NULL
                    ${custFilter6 ? sql`AND cu.legal_name ILIKE ${"%" + custFilter6 + "%"}` : sql``}
                  GROUP BY cp.id, cp.name, cu.legal_name, cp.is_active, cp.created_at
                  ORDER BY cp.is_active DESC, cu.legal_name
                  LIMIT ${rowLimit}
                `);
                const tableRows6 = (rows.rows as any[]).map((r) => [
                  r.proforma_name,
                  r.customer,
                  String(r.line_count),
                  String(r.total_qty),
                  fmt(parseFloat(r.total_value || "0")),
                  r.is_active ? "Active" : "Inactive",
                  String(r.created_at).slice(0, 10),
                ]);
                dataQueryResult = {
                  queryType: "customer_proformas",
                  title: custFilter6 ? `Customer Proformas: ${custFilter6}` : "Customer Proformas",
                  subtitle: `${tableRows6.length} proforma(s)`,
                  table: {
                    headers: ["Proforma", "Customer", "Items", "Total Qty", "Total Value", "Status", "Created"],
                    rows: tableRows6,
                  },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "supplier_proformas": {
                const suppFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT sp.id, sp.reference, s.legal_name AS supplier, sp.notes, sp.created_at,
                    COUNT(spl.id) AS line_count,
                    COALESCE(SUM(spl.qty), 0) AS total_qty,
                    COALESCE(SUM(CAST(spl.price_per_bale AS numeric) * spl.qty), 0) AS total_value
                  FROM supplier_proformas sp
                  JOIN suppliers s ON s.id = sp.supplier_id
                  LEFT JOIN supplier_proforma_lines spl ON spl.proforma_id = sp.id
                  WHERE sp.company_id = ${companyId}
                    ${suppFilter6 ? sql`AND s.legal_name ILIKE ${"%" + suppFilter6 + "%"}` : sql``}
                  GROUP BY sp.id, sp.reference, s.legal_name, sp.notes, sp.created_at
                  ORDER BY sp.created_at DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows6 = (rows.rows as any[]).map((r) => [
                  r.reference,
                  r.supplier,
                  String(r.line_count),
                  String(r.total_qty),
                  fmt(parseFloat(r.total_value || "0")),
                  String(r.created_at).slice(0, 10),
                  (r.notes || "").slice(0, 40),
                ]);
                dataQueryResult = {
                  queryType: "supplier_proformas",
                  title: suppFilter6 ? `Supplier Proformas: ${suppFilter6}` : "Supplier Proformas",
                  subtitle: `${tableRows6.length} proforma(s)`,
                  table: {
                    headers: ["Reference", "Supplier", "Items", "Total Qty", "Total Value", "Date", "Notes"],
                    rows: tableRows6,
                  },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "weekly_sales": {
                const rows = await db.execute(sql`
                  SELECT DATE_TRUNC('week', CAST(v.voucher_date AS date)) AS week_start,
                    COUNT(DISTINCT v.id) AS sales_count,
                    SUM(CAST(sal.total_sales AS numeric)) AS revenue,
                    SUM(CAST(sal.total_cost AS numeric)) AS cost,
                    SUM(CAST(sal.profit AS numeric)) AS profit
                  FROM sales_items sal
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  WHERE v.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY week_start
                  ORDER BY week_start DESC
                  LIMIT ${rowLimit}
                `);
                let totRev = 0,
                  totCost = 0,
                  totProfit = 0;
                const tableRows6 = (rows.rows as any[]).map((r) => {
                  const rev = parseFloat(r.revenue || "0");
                  const cost = parseFloat(r.cost || "0");
                  const profit6 = parseFloat(r.profit || "0");
                  const margin = rev > 0 ? ((profit6 / rev) * 100).toFixed(1) + "%" : "—";
                  totRev += rev;
                  totCost += cost;
                  totProfit += profit6;
                  const ws = String(r.week_start).slice(0, 10);
                  return [ws, String(r.sales_count), fmt(rev), fmt(cost), fmt(profit6), margin];
                });
                if (tableRows6.length) {
                  const totMargin = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "—";
                  tableRows6.push(["TOTAL", "", fmt(totRev), fmt(totCost), fmt(totProfit), totMargin]);
                }
                dataQueryResult = {
                  queryType: "weekly_sales",
                  title: "Weekly Sales Breakdown",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: {
                    headers: ["Week Starting", "Invoices", "Revenue", "Cost", "Profit", "Margin"],
                    rows: tableRows6,
                  },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "container_items_list": {
                const cn6 = params.containerNumber || params.entityName;
                if (!cn6) {
                  dataQueryResult = {
                    queryType: "container_items_list",
                    title: "Container Items",
                    summary: "Please specify a container number.",
                  };
                  break;
                }
                const rows = await db.execute(sql`
                  SELECT c.container_number, s.legal_name AS supplier, c.import_date,
                    pli.item_name, si.code, si.uom,
                    CAST(pli.quantity AS numeric) AS qty,
                    CAST(pli.rate AS numeric) AS rate,
                    CAST(pli.line_total AS numeric) AS line_total,
                    po.po_number, po.currency
                  FROM po_line_items pli
                  JOIN purchase_orders po ON po.id = pli.po_id
                  JOIN containers c ON c.id = po.container_id
                  JOIN suppliers s ON s.id = c.supplier_id
                  JOIN stock_items si ON si.id = pli.stock_item_id
                  WHERE c.container_number ILIKE ${"%" + cn6 + "%"}
                    AND po.company_id = ${companyId}
                  ORDER BY pli.item_name
                  LIMIT ${rowLimit}
                `);
                let grandItems = 0;
                const tableRows6 = (rows.rows as any[]).map((r) => {
                  const lt = parseFloat(r.line_total || "0");
                  grandItems += lt;
                  return [
                    r.item_name,
                    r.code,
                    `${fmtDec(parseFloat(r.qty))} ${r.uom}`,
                    fmtDec(parseFloat(r.rate)),
                    fmt(lt),
                    r.po_number,
                    r.currency,
                  ];
                });
                const hdr = rows.rows[0] as any;
                tableRows6.push(["TOTAL", "", "", "", fmt(grandItems), "", ""]);
                dataQueryResult = {
                  queryType: "container_items_list",
                  title: `Items in Container: ${hdr?.container_number || cn6}`,
                  subtitle: hdr ? `Supplier: ${hdr.supplier} · Import: ${String(hdr.import_date).slice(0, 10)}` : "",
                  table: { headers: ["Item", "Code", "Qty", "Rate", "Total", "PO #", "Currency"], rows: tableRows6 },
                  noData: tableRows6.length <= 1,
                };
                break;
              }

              case "employee_list": {
                const deptFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT e.code, e.first_name, e.last_name, e.department, e.employee_type,
                    CAST(e.monthly_salary AS numeric) AS monthly_salary,
                    CAST(e.current_balance AS numeric) AS current_balance,
                    e.join_date, e.active
                  FROM employees e
                  WHERE e.company_id = ${companyId}
                    AND e.active = true
                    AND e.deleted_at IS NULL
                    ${deptFilter6 ? sql`AND e.department ILIKE ${"%" + deptFilter6 + "%"}` : sql``}
                  ORDER BY e.department, e.first_name, e.last_name
                  LIMIT ${rowLimit}
                `);
                let totalSalary = 0,
                  totalBalance = 0;
                const tableRows6 = (rows.rows as any[]).map((r) => {
                  const sal = parseFloat(r.monthly_salary || "0");
                  const bal = parseFloat(r.current_balance || "0");
                  totalSalary += sal;
                  totalBalance += bal;
                  return [
                    r.code || "—",
                    `${r.first_name} ${r.last_name}`,
                    r.department || "—",
                    r.employee_type,
                    fmt(sal),
                    fmt(bal),
                    r.join_date ? String(r.join_date).slice(0, 10) : "—",
                  ];
                });
                const stats6 = [
                  { label: "Total Employees", value: String(tableRows6.length) },
                  { label: "Total Monthly Salary", value: fmt(totalSalary), highlight: "positive" },
                  { label: "Total Outstanding Balance", value: fmt(totalBalance) },
                ];
                dataQueryResult = {
                  queryType: "employee_list",
                  title: deptFilter6 ? `Employees — ${deptFilter6}` : "Employee Roster",
                  subtitle: `${tableRows6.length} active employee(s)`,
                  stats: stats6,
                  table: {
                    headers: ["Code", "Name", "Dept", "Type", "Monthly Salary", "Balance", "Join Date"],
                    rows: tableRows6,
                  },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "journal_entries": {
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_number, v.description,
                    CAST(v.total_amount AS numeric) AS total_amount,
                    v.currency,
                    json_agg(json_build_object(
                      'account', la.name,
                      'dr', CAST(ve.debit_amount AS numeric),
                      'cr', CAST(ve.credit_amount AS numeric)
                    ) ORDER BY ve.id) AS entries
                  FROM vouchers v
                  JOIN voucher_entries ve ON ve.voucher_id = v.id
                  JOIN ledger_accounts la ON la.id = ve.ledger_account_id
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.voucher_type = 'Journal'
                    AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY v.id, v.voucher_date, v.voucher_number, v.description, v.total_amount, v.currency
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows6: string[][] = [];
                for (const r of rows.rows as any[]) {
                  const entries = typeof r.entries === "string" ? JSON.parse(r.entries) : r.entries;
                  const firstEntry = entries?.[0];
                  tableRows6.push([
                    String(r.voucher_date).slice(0, 10),
                    r.voucher_number,
                    (r.description || "").slice(0, 35),
                    firstEntry?.account || "—",
                    firstEntry?.dr > 0 ? fmt(firstEntry.dr) : "—",
                    firstEntry?.cr > 0 ? fmt(firstEntry.cr) : "—",
                    r.currency,
                  ]);
                  for (let i = 1; i < (entries || []).length && i < 4; i++) {
                    const e = entries[i];
                    tableRows6.push([
                      "",
                      "",
                      "",
                      e.account,
                      e.dr > 0 ? fmt(e.dr) : "—",
                      e.cr > 0 ? fmt(e.cr) : "—",
                      "",
                    ]);
                  }
                }
                dataQueryResult = {
                  queryType: "journal_entries",
                  title: "Journal Entries",
                  subtitle: `${dateFrom} → ${dateTo} · ${rows.rows.length} journal(s)`,
                  table: {
                    headers: ["Date", "Voucher #", "Description", "Account", "Dr", "Cr", "Currency"],
                    rows: tableRows6,
                  },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              // ── Phase 7 Cases ────────────────────────────────────────────────

              case "audit_trail": {
                const tableFilter7 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT al.username, al.action, al.table_name, al.record_identifier,
                    al.created_at
                  FROM audit_log al
                  WHERE al.company_id = ${companyId}
                    AND al.created_at >= ${dateFrom}
                    ${tableFilter7 ? sql`AND (al.table_name ILIKE ${"%" + tableFilter7 + "%"} OR al.record_identifier ILIKE ${"%" + tableFilter7 + "%"})` : sql``}
                  ORDER BY al.created_at DESC
                  LIMIT ${rowLimit}
                `);
                const actionMap: Record<string, number> = {};
                const tableRows7 = (rows.rows as any[]).map((r) => {
                  actionMap[r.action] = (actionMap[r.action] || 0) + 1;
                  return [
                    String(r.created_at).slice(0, 16),
                    r.username,
                    r.action,
                    r.table_name,
                    r.record_identifier || "—",
                  ];
                });
                const stats7 = [
                  { label: "Total Events", value: String(tableRows7.length) },
                  ...Object.entries(actionMap).map(([a, c]) => ({
                    label: a.charAt(0).toUpperCase() + a.slice(1) + "s",
                    value: String(c),
                  })),
                ];
                dataQueryResult = {
                  queryType: "audit_trail",
                  title: tableFilter7 ? `Audit Trail: ${tableFilter7}` : "Audit Trail",
                  subtitle: `Since ${dateFrom} · most recent first`,
                  stats: stats7,
                  table: { headers: ["Timestamp", "User", "Action", "Table", "Record"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "bank_account_list": {
                const rows = await db.execute(sql`
                  SELECT ba.code, ba.name, ba.bank_name, ba.account_number,
                    CAST(ba.opening_balance AS numeric) AS opening_balance,
                    ba.opening_balance_side, ba.active,
                    COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) AS total_dr,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_cr
                  FROM bank_accounts ba
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = ba.linked_ledger_id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                  WHERE ba.company_id = ${companyId}
                    AND ba.deleted_at IS NULL
                  GROUP BY ba.id, ba.code, ba.name, ba.bank_name, ba.account_number,
                    ba.opening_balance, ba.opening_balance_side, ba.active
                  ORDER BY ba.name
                `);
                let grandBalance = 0;
                const tableRows7 = (rows.rows as any[]).map((r) => {
                  const ob = parseFloat(r.opening_balance || "0") * (r.opening_balance_side === "Cr" ? -1 : 1);
                  const dr = parseFloat(r.total_dr || "0");
                  const cr = parseFloat(r.total_cr || "0");
                  const balance = ob + dr - cr;
                  grandBalance += balance;
                  const balLabel = balance >= 0 ? fmt(balance) + " Dr" : fmt(Math.abs(balance)) + " Cr";
                  return [r.code, r.name, r.bank_name, r.account_number, balLabel];
                });
                tableRows7.push([
                  "",
                  "TOTAL BALANCE",
                  "",
                  "",
                  grandBalance >= 0 ? fmt(grandBalance) + " Dr" : fmt(Math.abs(grandBalance)) + " Cr",
                ]);
                const stats7 = [
                  { label: "Bank Accounts", value: String(tableRows7.length - 1) },
                  {
                    label: "Net Balance",
                    value: grandBalance >= 0 ? fmt(grandBalance) + " Dr" : fmt(Math.abs(grandBalance)) + " Cr",
                    highlight: grandBalance >= 0 ? "positive" : "negative",
                  },
                ];
                dataQueryResult = {
                  queryType: "bank_account_list",
                  title: "Bank Account Balances",
                  subtitle: `As of ${todayStr}`,
                  stats: stats7,
                  table: { headers: ["Code", "Account Name", "Bank", "Account No.", "Balance"], rows: tableRows7 },
                  noData: tableRows7.length <= 1,
                };
                break;
              }

              case "stock_adjustments": {
                const adjTypeFilter = params.entityName?.toLowerCase().includes("consum")
                  ? "Consumption"
                  : params.entityName?.toLowerCase().includes("prod")
                    ? "Production"
                    : null;
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_number, sav.adjustment_type,
                    l.name AS location, si.name AS item_name, si.code, si.uom,
                    CAST(sai.quantity AS numeric) AS qty,
                    CAST(sai.rate AS numeric) AS rate,
                    CAST(sai.total_amount AS numeric) AS total_amount
                  FROM stock_adjustment_items sai
                  JOIN stock_adjustment_vouchers sav ON sav.id = sai.adjustment_id
                  JOIN vouchers v ON v.id = sav.voucher_id AND v.deleted_at IS NULL
                  JOIN stock_items si ON si.id = sai.stock_item_id
                  JOIN locations l ON l.id = sav.location_id
                  WHERE v.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${adjTypeFilter ? sql`AND sav.adjustment_type = ${adjTypeFilter}` : sql``}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalProd = 0,
                  totalCons = 0;
                const tableRows7 = (rows.rows as any[]).map((r) => {
                  const qty = parseFloat(r.qty || "0");
                  const amt = parseFloat(r.total_amount || "0");
                  if (r.adjustment_type === "Production") totalProd += amt;
                  else totalCons += amt;
                  return [
                    String(r.voucher_date).slice(0, 10),
                    r.voucher_number,
                    r.adjustment_type,
                    r.location,
                    r.item_name,
                    `${fmtDec(Math.abs(qty))} ${r.uom}`,
                    fmt(Math.abs(amt)),
                  ];
                });
                const stats7 = [
                  { label: "Total Entries", value: String(tableRows7.length) },
                  { label: "Production Value", value: fmt(totalProd), highlight: "positive" },
                  { label: "Consumption Value", value: fmt(totalCons) },
                ];
                dataQueryResult = {
                  queryType: "stock_adjustments",
                  title: adjTypeFilter ? `Stock Adjustments — ${adjTypeFilter}` : "Stock Adjustments",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats7,
                  table: {
                    headers: ["Date", "Voucher #", "Type", "Location", "Item", "Qty", "Amount"],
                    rows: tableRows7,
                  },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "container_tracking": {
                const cn7 = params.containerNumber || params.entityName;
                if (!cn7) {
                  dataQueryResult = {
                    queryType: "container_tracking",
                    title: "Container Tracking",
                    summary: "Please specify a container number.",
                  };
                  break;
                }
                const containerRow7 = await db.execute(sql`
                  SELECT c.id, c.container_number, c.status, c.eta, c.transporter,
                    c.tracking_last_location, c.tracking_last_description, c.tracking_changed_at
                  FROM containers c
                  WHERE c.company_id = ${companyId}
                    AND c.container_number ILIKE ${"%" + cn7 + "%"}
                  LIMIT 1
                `);
                if (!containerRow7.rows.length) {
                  dataQueryResult = {
                    queryType: "container_tracking",
                    title: "Container Tracking",
                    summary: `No container found matching "${cn7}".`,
                  };
                  break;
                }
                const ctr7 = containerRow7.rows[0] as any;
                const evtRows = await db.execute(sql`
                  SELECT cte.event_time, cte.event_status, cte.event_location, cte.event_description, cte.provider
                  FROM container_tracking_events cte
                  WHERE cte.container_id = ${ctr7.id}
                  ORDER BY cte.event_time DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows7 = (evtRows.rows as any[]).map((r) => [
                  r.event_time ? String(r.event_time).slice(0, 16) : "—",
                  r.event_status || "—",
                  r.event_location || "—",
                  (r.event_description || "").slice(0, 50),
                  r.provider,
                ]);
                const stats7 = [
                  { label: "Container #", value: ctr7.container_number },
                  { label: "Status", value: ctr7.status },
                  { label: "ETA", value: ctr7.eta ? String(ctr7.eta).slice(0, 10) : "—" },
                  { label: "Transporter", value: ctr7.transporter || "—" },
                  { label: "Last Location", value: ctr7.tracking_last_location || "—" },
                ];
                dataQueryResult = {
                  queryType: "container_tracking",
                  title: `Tracking: ${ctr7.container_number}`,
                  subtitle: ctr7.tracking_last_description
                    ? `Latest: ${(ctr7.tracking_last_description as string).slice(0, 60)}`
                    : `${tableRows7.length} event(s)`,
                  stats: stats7,
                  table: { headers: ["Time", "Status", "Location", "Description", "Provider"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "pending_container_sales": {
                const rows = await db.execute(sql`
                  SELECT cs.sale_date, cs.invoice_number, c.container_number,
                    cu.legal_name AS customer, cs.currency,
                    CAST(cs.total_amount AS numeric) AS total_amount,
                    CAST(cs.paid_amount AS numeric) AS paid_amount,
                    CAST(cs.total_amount AS numeric) - CAST(cs.paid_amount AS numeric) AS outstanding,
                    cs.payment_status
                  FROM container_sales cs
                  JOIN containers c ON c.id = cs.container_id
                  JOIN customers cu ON cu.id = cs.customer_id
                  WHERE cs.company_id = ${companyId}
                    AND cs.payment_status != 'PAID'
                  ORDER BY cs.sale_date ASC
                  LIMIT ${rowLimit}
                `);
                let totalOutstanding = 0;
                const tableRows7 = (rows.rows as any[]).map((r) => {
                  const outstanding = parseFloat(r.outstanding || "0");
                  totalOutstanding += outstanding;
                  return [
                    String(r.sale_date).slice(0, 10),
                    r.invoice_number || "—",
                    r.container_number,
                    r.customer,
                    fmt(parseFloat(r.total_amount)),
                    fmt(parseFloat(r.paid_amount)),
                    fmt(outstanding),
                    r.payment_status,
                    r.currency,
                  ];
                });
                const stats7 = [
                  { label: "Pending Sales", value: String(tableRows7.length) },
                  { label: "Total Outstanding", value: fmt(totalOutstanding), highlight: "negative" },
                ];
                dataQueryResult = {
                  queryType: "pending_container_sales",
                  title: "Pending Container Sales",
                  subtitle: `${tableRows7.length} unpaid/partial container sale(s)`,
                  stats: stats7,
                  table: {
                    headers: [
                      "Sale Date",
                      "Invoice #",
                      "Container",
                      "Customer",
                      "Total",
                      "Paid",
                      "Outstanding",
                      "Status",
                      "Currency",
                    ],
                    rows: tableRows7,
                  },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "supplier_container_history": {
                const suppName7 = params.entityName;
                if (!suppName7) {
                  dataQueryResult = {
                    queryType: "supplier_container_history",
                    title: "Supplier Container History",
                    summary: "Please specify a supplier name.",
                  };
                  break;
                }
                const rows = await db.execute(sql`
                  SELECT c.container_number, c.status, c.import_date, c.eta,
                    CAST(c.grand_total AS numeric) AS grand_total, c.currency,
                    c.total_kg, c.rate_per_kg, c.item_name, s.legal_name AS supplier
                  FROM containers c
                  JOIN suppliers s ON s.id = c.supplier_id
                  WHERE c.company_id = ${companyId}
                    AND s.legal_name ILIKE ${"%" + suppName7 + "%"}
                  ORDER BY c.import_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalValue = 0,
                  totalKg = 0;
                const statusCounts: Record<string, number> = {};
                const tableRows7 = (rows.rows as any[]).map((r) => {
                  const val = parseFloat(r.grand_total || "0");
                  const kg = parseFloat(r.total_kg || "0");
                  totalValue += val;
                  totalKg += kg;
                  statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
                  return [
                    r.container_number,
                    r.status,
                    String(r.import_date).slice(0, 10),
                    r.eta ? String(r.eta).slice(0, 10) : "—",
                    fmtDec(kg),
                    fmt(val),
                    r.currency,
                    (r.item_name || "—").slice(0, 25),
                  ];
                });
                const supplier7 = (rows.rows[0] as any)?.supplier || suppName7;
                const stats7 = [
                  { label: "Supplier", value: supplier7 },
                  { label: "Total Containers", value: String(tableRows7.length) },
                  { label: "Total Kg", value: fmtDec(totalKg) },
                  { label: "Total Value", value: fmt(totalValue), highlight: "positive" },
                  ...Object.entries(statusCounts).map(([s, c]) => ({ label: s, value: String(c) })),
                ];
                dataQueryResult = {
                  queryType: "supplier_container_history",
                  title: `Containers from: ${supplier7}`,
                  subtitle: `${tableRows7.length} container(s) · most recent first`,
                  stats: stats7,
                  table: {
                    headers: ["Container #", "Status", "Import Date", "ETA", "Total Kg", "Value", "Currency", "Item"],
                    rows: tableRows7,
                  },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "income_breakdown": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.account_type,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric)), 0) AS net_income
                  FROM ledger_accounts la
                  JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  WHERE la.company_id = ${companyId}
                    AND la.account_type IN ('Income')
                    AND la.deleted_at IS NULL
                  GROUP BY la.id, la.name, la.account_type
                  HAVING COALESCE(SUM(CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric)), 0) > 0
                  ORDER BY net_income DESC
                  LIMIT ${rowLimit}
                `);
                let grandIncome = 0;
                const tableRows7 = (rows.rows as any[]).map((r) => {
                  const income = parseFloat(r.net_income || "0");
                  grandIncome += income;
                  return [r.name, r.account_type, fmt(income)];
                });
                if (tableRows7.length) tableRows7.push(["TOTAL", "", fmt(grandIncome)]);
                dataQueryResult = {
                  queryType: "income_breakdown",
                  title: "Income Breakdown by Account",
                  subtitle: `${dateFrom} → ${dateTo} · Total: ${fmt(grandIncome)}`,
                  table: { headers: ["Account", "Type", "Net Income"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "factory_worker_profile": {
                const workerName7 = params.entityName;
                if (!workerName7) {
                  dataQueryResult = {
                    queryType: "factory_worker_profile",
                    title: "Factory Worker Profile",
                    summary: "Please specify a worker name.",
                  };
                  break;
                }
                const wRow = await db.execute(sql`
                  SELECT fw.full_name, fw.employee_code, fw.position, fw.department,
                    fw.gender, fw.nationality, fw.date_of_birth, fw.date_joined,
                    fw.salary_type, fw.base_salary, fw.per_bale_rate, fw.per_kg_rate,
                    fw.phone1, fw.phone2, fw.active, fw.bank_name, fw.payment_method,
                    fw.visa_expiry, fw.work_permit_expiry, fw.shift_type,
                    fw.transport_allowance
                  FROM factory_workers fw
                  WHERE fw.company_id = ${companyId}
                    AND fw.full_name ILIKE ${"%" + workerName7 + "%"}
                  ORDER BY fw.full_name LIMIT 1
                `);
                if (!wRow.rows.length) {
                  dataQueryResult = {
                    queryType: "factory_worker_profile",
                    title: "Factory Worker Profile",
                    summary: `No worker found matching "${workerName7}".`,
                  };
                  break;
                }
                const w7 = wRow.rows[0] as any;
                const baleStats7 = await db.execute(sql`
                  SELECT COUNT(id) AS total_bales,
                    COALESCE(SUM(CAST(weight_kg AS numeric)), 0) AS total_kg
                  FROM factory_bales
                  WHERE company_id = ${companyId}
                    AND pressed_at IS NOT NULL
                    AND CAST(pressed_at AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    AND worker_name ILIKE ${"%" + workerName7 + "%"}
                `);
                const bs7 = baleStats7.rows[0] as any;
                const stats7 = [
                  { label: "Name", value: w7.full_name },
                  { label: "Code", value: w7.employee_code || "—" },
                  { label: "Position", value: w7.position || "—" },
                  { label: "Department", value: w7.department || "—" },
                  { label: "Status", value: w7.active ? "Active" : "Inactive" },
                  { label: "Salary Type", value: w7.salary_type },
                  { label: "Base Salary", value: fmt(parseFloat(w7.base_salary || "0")) },
                  { label: "Per Bale Rate", value: fmtDec(parseFloat(w7.per_bale_rate || "0")) },
                  { label: "Bales This Period", value: String(bs7?.total_bales || 0) },
                  { label: "Kg This Period", value: fmtDec(parseFloat(bs7?.total_kg || "0")) },
                ];
                const profileRows = [
                  ["Phone", w7.phone1 || "—"],
                  ["Nationality", w7.nationality || "—"],
                  ["Gender", w7.gender || "—"],
                  ["Date of Birth", w7.date_of_birth ? String(w7.date_of_birth).slice(0, 10) : "—"],
                  ["Date Joined", w7.date_joined ? String(w7.date_joined).slice(0, 10) : "—"],
                  ["Shift Type", w7.shift_type || "—"],
                  ["Bank", w7.bank_name || "—"],
                  ["Payment Method", w7.payment_method || "—"],
                  ["Visa Expiry", w7.visa_expiry ? String(w7.visa_expiry).slice(0, 10) : "—"],
                  ["Work Permit Expiry", w7.work_permit_expiry ? String(w7.work_permit_expiry).slice(0, 10) : "—"],
                  ["Transport Allowance", fmt(parseFloat(w7.transport_allowance || "0"))],
                ];
                dataQueryResult = {
                  queryType: "factory_worker_profile",
                  title: `Worker Profile: ${w7.full_name}`,
                  subtitle: `${dateFrom} → ${dateTo} performance`,
                  stats: stats7,
                  table: { headers: ["Field", "Value"], rows: profileRows },
                  noData: false,
                };
                break;
              }

              case "location_list": {
                const rows = await db.execute(sql`
                  SELECT l.code, l.name, l.city, l.country, l.active,
                    COUNT(DISTINCT inv.stock_item_id) AS item_count,
                    COALESCE(SUM(CAST(inv.total_value AS numeric)), 0) AS total_value
                  FROM locations l
                  LEFT JOIN inventory inv ON inv.location_id = l.id AND inv.quantity > 0
                  WHERE l.company_id = ${companyId}
                    AND l.deleted_at IS NULL
                  GROUP BY l.id, l.code, l.name, l.city, l.country, l.active
                  ORDER BY l.name
                `);
                let grandValue = 0,
                  grandItems = 0;
                const tableRows7 = (rows.rows as any[]).map((r) => {
                  const val = parseFloat(r.total_value || "0");
                  const items = parseInt(r.item_count || "0");
                  grandValue += val;
                  grandItems += items;
                  return [
                    r.code || "—",
                    r.name,
                    r.city || "—",
                    r.country || "—",
                    String(items),
                    fmt(val),
                    r.active ? "Active" : "Inactive",
                  ];
                });
                const stats7 = [
                  { label: "Total Locations", value: String(tableRows7.length) },
                  { label: "Total Stock Items", value: String(grandItems) },
                  { label: "Total Inventory Value", value: fmt(grandValue), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "location_list",
                  title: "Warehouse / Location List",
                  subtitle: `${tableRows7.length} location(s)`,
                  stats: stats7,
                  table: {
                    headers: ["Code", "Name", "City", "Country", "Items", "Inv. Value", "Status"],
                    rows: tableRows7,
                  },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "quarterly_comparison": {
                const yearStr = params.dateFrom ? params.dateFrom.slice(0, 4) : todayStr.slice(0, 4);
                const rows = await db.execute(sql`
                  SELECT EXTRACT(QUARTER FROM CAST(v.voucher_date AS date)) AS quarter,
                    SUM(CAST(sal.total_sales AS numeric)) AS revenue,
                    SUM(CAST(sal.total_cost AS numeric)) AS cost,
                    SUM(CAST(sal.profit AS numeric)) AS profit,
                    COUNT(DISTINCT v.id) AS sales_count
                  FROM sales_items sal
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  WHERE v.company_id = ${companyId}
                    AND EXTRACT(YEAR FROM CAST(v.voucher_date AS date)) = ${parseInt(yearStr)}
                  GROUP BY quarter
                  ORDER BY quarter
                `);
                let totRev = 0,
                  totCost = 0,
                  totProfit = 0;
                const qLabels = ["Q1 (Jan-Mar)", "Q2 (Apr-Jun)", "Q3 (Jul-Sep)", "Q4 (Oct-Dec)"];
                const tableRows7 = (rows.rows as any[]).map((r) => {
                  const q = parseInt(r.quarter || "1");
                  const rev = parseFloat(r.revenue || "0");
                  const cost = parseFloat(r.cost || "0");
                  const profit7 = parseFloat(r.profit || "0");
                  const margin = rev > 0 ? ((profit7 / rev) * 100).toFixed(1) + "%" : "—";
                  totRev += rev;
                  totCost += cost;
                  totProfit += profit7;
                  return [qLabels[q - 1] || `Q${q}`, String(r.sales_count), fmt(rev), fmt(cost), fmt(profit7), margin];
                });
                if (tableRows7.length) {
                  const totMargin = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "—";
                  tableRows7.push(["FULL YEAR", "", fmt(totRev), fmt(totCost), fmt(totProfit), totMargin]);
                }
                const stats7 = [
                  { label: "Year", value: yearStr },
                  { label: "Total Revenue", value: fmt(totRev) },
                  { label: "Total Cost", value: fmt(totCost) },
                  { label: "Total Profit", value: fmt(totProfit), highlight: "positive" },
                  { label: "Overall Margin", value: totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "—" },
                ];
                dataQueryResult = {
                  queryType: "quarterly_comparison",
                  title: `Quarterly Comparison — ${yearStr}`,
                  subtitle: `Sales revenue and profit by quarter`,
                  stats: stats7,
                  table: { headers: ["Quarter", "Invoices", "Revenue", "Cost", "Profit", "Margin"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }
            }

  return dataQueryResult;
}
