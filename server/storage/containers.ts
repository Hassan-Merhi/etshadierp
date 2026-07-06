import { eq, and, isNull, asc, desc, sql, ne } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import type {
  Container,
  InsertContainer,
  PurchaseOrder,
  InsertPurchaseOrder,
  POLineItem,
  InsertPOLineItem,
  ContainerCharge,
  InsertContainerCharge,
  ImportLog,
  InsertImportLog,
  ContainerOffload,
} from "@shared/schema";
import { getParentCompanyId, addCustomerBalanceEntry } from "./accounting";
import { getLocationById } from "./inventory";

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export async function getAllContainers(companyId: number): Promise<Container[]> {
  return await db
    .select()
    .from(schema.containers)
    .where(eq(schema.containers.companyId, companyId))
    .orderBy(asc(schema.containers.containerNumber));
}

export async function getActiveContainers(companyId: number): Promise<Container[]> {
  return await db
    .select()
    .from(schema.containers)
    .where(and(eq(schema.containers.companyId, companyId), ne(schema.containers.status, "SOLD")))
    .orderBy(asc(schema.containers.containerNumber));
}

export async function getSoldContainers(companyId: number): Promise<any[]> {
  return await db
    .select({
      containerId: schema.containers.id,
      containerNumber: schema.containers.containerNumber,
      supplierId: schema.containers.supplierId,
      status: schema.containers.status,
      importDate: schema.containers.importDate,
      itemsTotal: schema.containers.itemsTotal,
      chargesTotal: schema.containers.chargesTotal,
      grandTotal: schema.containers.grandTotal,
      saleId: schema.containerSales.id,
      customerId: schema.containerSales.customerId,
      customerName: schema.customers.legalName,
      saleDate: schema.containerSales.saleDate,
      containerCost: schema.containerSales.containerCost,
      commission: schema.containerSales.commission,
      commissionAccountId: schema.containerSales.commissionAccountId,
      totalAmount: schema.containerSales.totalAmount,
      notes: schema.containerSales.notes,
    })
    .from(schema.containers)
    .innerJoin(schema.containerSales, eq(schema.containers.id, schema.containerSales.containerId))
    .innerJoin(schema.customers, eq(schema.containerSales.customerId, schema.customers.id))
    .where(and(eq(schema.containers.companyId, companyId), eq(schema.containers.status, "SOLD")))
    .orderBy(sql`${schema.containerSales.saleDate} DESC`);
}

export async function getContainerById(id: number): Promise<Container | undefined> {
  const [container] = await db.select().from(schema.containers).where(eq(schema.containers.id, id));
  return container;
}

export async function getContainerByNumber(containerNumber: string): Promise<Container | undefined> {
  const [container] = await db
    .select()
    .from(schema.containers)
    .where(eq(schema.containers.containerNumber, containerNumber));
  return container;
}

export async function createContainer(container: InsertContainer): Promise<Container> {
  const [created] = await db.insert(schema.containers).values(container).returning();
  return created;
}

export async function updateContainer(id: number, updates: Partial<InsertContainer>): Promise<Container> {
  const [updated] = await db.update(schema.containers).set(updates).where(eq(schema.containers.id, id)).returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------

export async function getAllPurchaseOrders(companyId: number): Promise<PurchaseOrder[]> {
  return await db
    .select()
    .from(schema.purchaseOrders)
    .where(eq(schema.purchaseOrders.companyId, companyId))
    .orderBy(asc(schema.purchaseOrders.poNumber));
}

export async function getPurchaseOrderById(id: number): Promise<PurchaseOrder | undefined> {
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
  return po;
}

export async function getPurchaseOrdersByContainer(containerId: number): Promise<PurchaseOrder[]> {
  return await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.containerId, containerId));
}

export async function getPurchaseOrdersBySupplier(supplierId: number, companyId: number): Promise<any[]> {
  return await db
    .select({
      id: schema.purchaseOrders.id,
      poNumber: schema.purchaseOrders.poNumber,
      companyId: schema.purchaseOrders.companyId,
      containerId: schema.purchaseOrders.containerId,
      containerNumber: schema.containers.containerNumber,
      importDate: schema.containers.importDate,
      itemsTotal: schema.purchaseOrders.itemsTotal,
      freight: schema.purchaseOrders.freight,
      surcharge: schema.purchaseOrders.surcharge,
      fumigation: schema.purchaseOrders.fumigation,
      documentCharges: schema.purchaseOrders.documentCharges,
      discount: schema.purchaseOrders.discount,
      otherCharges: schema.purchaseOrders.otherCharges,
      currency: schema.purchaseOrders.currency,
      createdAt: schema.purchaseOrders.createdAt,
      voucherId: schema.purchaseOrders.voucherId,
    })
    .from(schema.purchaseOrders)
    .leftJoin(schema.containers, eq(schema.purchaseOrders.containerId, schema.containers.id))
    .where(and(eq(schema.purchaseOrders.supplierId, supplierId), eq(schema.purchaseOrders.companyId, companyId)))
    .orderBy(sql`${schema.purchaseOrders.createdAt} DESC`);
}

export async function createPurchaseOrder(
  po: InsertPurchaseOrder,
  voucherDateOverride?: string
): Promise<PurchaseOrder> {
  const [created] = await db.insert(schema.purchaseOrders).values(po).returning();

  if (po.voucherId) {
    return created;
  }

  const poItemsTotal = parseFloat(po.itemsTotal || "0");
  const poFreight = parseFloat(po.freight || "0");
  const poSurcharge = parseFloat(po.surcharge || "0");
  const poFumigation = parseFloat(po.fumigation || "0");
  const poDocumentCharges = parseFloat(po.documentCharges || "0");
  const poDiscount = parseFloat(po.discount || "0");
  const poOtherCharges = parseFloat(po.otherCharges || "0");
  const poChargesAmount = poFreight + poSurcharge + poFumigation + poDocumentCharges - poDiscount + poOtherCharges;
  const poTotal = poItemsTotal + poChargesAmount;

  if (poTotal > 0 && po.companyId) {
    let containerNum = "";
    let supplierDisplayName = "";
    if (po.containerId) {
      const [cont] = await db
        .select({ containerNumber: schema.containers.containerNumber })
        .from(schema.containers)
        .where(eq(schema.containers.id, po.containerId))
        .limit(1);
      containerNum = cont?.containerNumber || "";
    }
    if (po.supplierId) {
      const [sup] = await db
        .select({ legalName: schema.suppliers.legalName })
        .from(schema.suppliers)
        .where(eq(schema.suppliers.id, po.supplierId))
        .limit(1);
      supplierDisplayName = sup?.legalName || "";
    }
    const descBase =
      containerNum || supplierDisplayName ? [containerNum, supplierDisplayName].filter(Boolean).join(" ") : "";

    const parentCompanyId = await getParentCompanyId();
    const allCompanies = await db.select().from(schema.companies);
    const parentCompany = parentCompanyId ? allCompanies.find((c) => c.id === parentCompanyId) : null;
    const currentCompany = allCompanies.find((c) => c.id === po.companyId);

    let purchasesAccount = await db
      .select()
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.companyId, po.companyId),
          eq(schema.ledgerAccounts.code, "PURCHASES"),
          isNull(schema.ledgerAccounts.deletedAt)
        )
      )
      .limit(1);

    if (!purchasesAccount.length) {
      const [newAccount] = await db
        .insert(schema.ledgerAccounts)
        .values({
          companyId: po.companyId,
          code: "PURCHASES",
          name: "Purchases",
          accountType: "Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
        })
        .returning();
      purchasesAccount = [newAccount];
    }

    const voucherDate = voucherDateOverride || new Date().toISOString().split("T")[0];

    // supplier_partner companies own their supplier relationships directly —
    // they must NOT go through the intercompany branch; the supplier credit
    // must live inside the SP company so its ledger/stats show the balance.
    const isSupplierPartner = currentCompany?.companyType === "supplier_partner";
    if (parentCompany && po.companyId !== parentCompany.id && !isSupplierPartner) {
      const isParentFreight = (po as any).freightPaidBy === "parent" && poFreight > 0;
      const poIntercoTotal = isParentFreight ? poTotal - poFreight : poTotal;
      const freightParentAcctId: number | null = isParentFreight ? ((po as any).freightParentAccountId ?? null) : null;

      const parentCreditCode = parentCompany.name.toUpperCase().replace(/\s+/g, "_") + "_CREDIT";
      const parentCreditName = parentCompany.name + " Credit";

      let parentCreditAccount = await db
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, po.companyId),
            eq(schema.ledgerAccounts.code, parentCreditCode),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);

      if (!parentCreditAccount.length) {
        const [newAccount] = await db
          .insert(schema.ledgerAccounts)
          .values({
            companyId: po.companyId,
            code: parentCreditCode,
            name: parentCreditName,
            accountType: "Liability",
            subType: "Current Liability",
            openingBalance: "0",
            openingBalanceSide: "Cr",
          })
          .returning();
        parentCreditAccount = [newAccount];
      }

      const subsidiaryVoucherNumber = `PURCH-${created.poNumber}-${Date.now()}`;
      const [subsidiaryVoucher] = await db
        .insert(schema.vouchers)
        .values({
          companyId: po.companyId,
          voucherNumber: subsidiaryVoucherNumber,
          voucherType: "Purchase",
          voucherDate,
          description: descBase || `Purchase for PO ${created.poNumber} (${parentCompany.name} paid supplier)`,
          totalAmount: poTotal.toFixed(2),
          optional: false,
        })
        .returning();

      await db.insert(schema.voucherEntries).values({
        voucherId: subsidiaryVoucher.id,
        ledgerAccountId: purchasesAccount[0].id,
        debitAmount: poIntercoTotal.toFixed(2),
        creditAmount: "0",
        narration: `PO ${created.poNumber} - Purchases`,
      });

      if (isParentFreight) {
        await db.insert(schema.voucherEntries).values({
          voucherId: subsidiaryVoucher.id,
          ledgerAccountId: purchasesAccount[0].id,
          debitAmount: poFreight.toFixed(2),
          creditAmount: "0",
          narration: `PO ${created.poNumber} - Freight (paid by ${parentCompany.name})`,
        });
      }

      await db.insert(schema.voucherEntries).values({
        voucherId: subsidiaryVoucher.id,
        ledgerAccountId: parentCreditAccount[0].id,
        debitAmount: "0",
        creditAmount: poTotal.toFixed(2),
        narration: `PO ${created.poNumber} - ${parentCompany.name} paid supplier`,
      });

      await db
        .update(schema.purchaseOrders)
        .set({ voucherId: subsidiaryVoucher.id })
        .where(eq(schema.purchaseOrders.id, created.id));

      const subsidiaryCode =
        currentCompany?.name?.toUpperCase().replace(/\s+/g, "_") + "_CREDIT" || "SUBSIDIARY_CREDIT";
      const subsidiaryName = (currentCompany?.name || "Subsidiary") + " Credit";

      let subsidiaryReceivableAccount = await db
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, parentCompany.id),
            eq(schema.ledgerAccounts.code, subsidiaryCode),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);

      if (!subsidiaryReceivableAccount.length) {
        const [newAccount] = await db
          .insert(schema.ledgerAccounts)
          .values({
            companyId: parentCompany.id,
            code: subsidiaryCode,
            name: subsidiaryName,
            accountType: "Asset",
            subType: "Current Asset",
            openingBalance: "0",
            openingBalanceSide: "Dr",
          })
          .returning();
        subsidiaryReceivableAccount = [newAccount];
      }

      const parentVoucherNumber = `INTERCO-PARENT-${created.poNumber}-${Date.now()}`;
      const [parentVoucher] = await db
        .insert(schema.vouchers)
        .values({
          companyId: parentCompany.id,
          voucherNumber: parentVoucherNumber,
          voucherType: "Journal",
          voucherDate,
          description: descBase
            ? `${descBase} - ${currentCompany?.name || "Subsidiary"}`
            : `Inter-company PO ${created.poNumber} - ${currentCompany?.name || "Subsidiary"}`,
          totalAmount: poTotal.toFixed(2),
          optional: false,
        })
        .returning();

      const intercoNarration = containerNum
        ? `${currentCompany?.name || "Subsidiary"} PO ${created.poNumber} - Container ${containerNum}`
        : `PO ${created.poNumber} - ${currentCompany?.name || "Subsidiary"} owes us`;

      await db.insert(schema.voucherEntries).values({
        voucherId: parentVoucher.id,
        ledgerAccountId: subsidiaryReceivableAccount[0].id,
        debitAmount: poTotal.toFixed(2),
        creditAmount: "0",
        narration: intercoNarration,
      });

      if (po.supplierId) {
        await db.insert(schema.voucherEntries).values({
          voucherId: parentVoucher.id,
          supplierId: po.supplierId,
          debitAmount: "0",
          creditAmount: poIntercoTotal.toFixed(2),
          narration: intercoNarration,
        });
      }

      if (isParentFreight && freightParentAcctId) {
        await db.insert(schema.voucherEntries).values({
          voucherId: parentVoucher.id,
          ledgerAccountId: freightParentAcctId,
          debitAmount: "0",
          creditAmount: poFreight.toFixed(2),
          narration: containerNum
            ? `Freight - ${currentCompany?.name || "Subsidiary"} PO ${created.poNumber} - Container ${containerNum}`
            : `Freight - PO ${created.poNumber}`,
        });
      }
    } else {
      const voucherNumber = `PURCH-${created.poNumber}-${Date.now()}`;
      const [purchaseVoucher] = await db
        .insert(schema.vouchers)
        .values({
          companyId: po.companyId,
          voucherNumber,
          voucherType: "Purchase",
          voucherDate,
          description: descBase || `Purchase for PO ${created.poNumber}`,
          totalAmount: poTotal.toFixed(2),
          optional: false,
        })
        .returning();

      await db.insert(schema.voucherEntries).values({
        voucherId: purchaseVoucher.id,
        ledgerAccountId: purchasesAccount[0].id,
        debitAmount: poTotal.toFixed(2),
        creditAmount: "0",
        narration: `PO ${created.poNumber} - Purchases`,
      });

      if (po.supplierId) {
        await db.insert(schema.voucherEntries).values({
          voucherId: purchaseVoucher.id,
          supplierId: po.supplierId,
          debitAmount: "0",
          creditAmount: poTotal.toFixed(2),
          narration: `PO ${created.poNumber} - Supplier`,
        });
      }

      await db
        .update(schema.purchaseOrders)
        .set({ voucherId: purchaseVoucher.id })
        .where(eq(schema.purchaseOrders.id, created.id));
    }
  }

  return created;
}

export async function updatePurchaseOrder(id: number, updates: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder> {
  const [updated] = await db
    .update(schema.purchaseOrders)
    .set(updates)
    .where(eq(schema.purchaseOrders.id, id))
    .returning();
  return updated;
}

export async function deletePurchaseOrder(id: number): Promise<void> {
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id)).limit(1);
  if (!po) throw new Error("Purchase order not found");

  const containerId = po.containerId;
  const poItemsTotal = parseFloat(po.itemsTotal || "0");
  const poFreight = parseFloat(po.freight || "0");
  const poOtherCharges = parseFloat(po.otherCharges || "0");
  const poCharges = poFreight + poOtherCharges;

  const [container] = await db.select().from(schema.containers).where(eq(schema.containers.id, containerId)).limit(1);

  await db.delete(schema.poLineItems).where(eq(schema.poLineItems.poId, id));
  await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));

  if (po.voucherId) {
    try {
      await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, po.voucherId));
      await db.delete(schema.vouchers).where(eq(schema.vouchers.id, po.voucherId));
    } catch (_hardDeleteErr) {
      try {
        await db
          .update(schema.vouchers)
          .set({ deletedAt: new Date() })
          .where(and(eq(schema.vouchers.id, po.voucherId), isNull(schema.vouchers.deletedAt)));
      } catch (_softDeleteErr) {
        // Already gone or soft-deleted
      }
    }
  }

  const remainingPOs = await db
    .select()
    .from(schema.purchaseOrders)
    .where(eq(schema.purchaseOrders.containerId, containerId))
    .limit(1);

  if (remainingPOs.length === 0 && container) {
    const chargeVouchers = await db
      .select()
      .from(schema.vouchers)
      .where(
        and(
          eq(schema.vouchers.companyId, po.companyId),
          sql`${schema.vouchers.description} LIKE ${"% - Container " + container.containerNumber}`
        )
      );
    for (const chargeVoucher of chargeVouchers) {
      await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, chargeVoucher.id));
      await db.delete(schema.vouchers).where(eq(schema.vouchers.id, chargeVoucher.id));
    }
    await db.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, containerId));
    await db.delete(schema.importLogs).where(eq(schema.importLogs.containerId, containerId));
    await db.delete(schema.containers).where(eq(schema.containers.id, containerId));
  } else if (container) {
    const newItemsTotal = Math.max(0, parseFloat(container.itemsTotal || "0") - poItemsTotal);
    const newChargesTotal = Math.max(0, parseFloat(container.chargesTotal || "0") - poCharges);
    const newGrandTotal = newItemsTotal + newChargesTotal;
    await db
      .update(schema.containers)
      .set({
        itemsTotal: newItemsTotal.toString(),
        chargesTotal: newChargesTotal.toString(),
        grandTotal: newGrandTotal.toString(),
      })
      .where(eq(schema.containers.id, containerId));
  }
}

export async function deleteContainer(id: number): Promise<void> {
  const [container] = await db.select().from(schema.containers).where(eq(schema.containers.id, id)).limit(1);
  if (!container) throw new Error("Container not found");

  const pos = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.containerId, id));
  for (const po of pos) {
    await db.delete(schema.poLineItems).where(eq(schema.poLineItems.poId, po.id));
    if (po.voucherId) {
      await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, po.voucherId));
      await db.delete(schema.vouchers).where(eq(schema.vouchers.id, po.voucherId));
    }
    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po.id));
  }

  const chargeVouchers = await db
    .select()
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.companyId, container.companyId),
        sql`${schema.vouchers.description} LIKE ${"% - Container " + container.containerNumber}`
      )
    );
  for (const chargeVoucher of chargeVouchers) {
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, chargeVoucher.id));
    await db.delete(schema.vouchers).where(eq(schema.vouchers.id, chargeVoucher.id));
  }

  await db.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, id));

  const sales = await db.select().from(schema.containerSales).where(eq(schema.containerSales.containerId, id));
  for (const sale of sales) {
    if (sale.voucherId) {
      await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, sale.voucherId));
      await db.delete(schema.vouchers).where(eq(schema.vouchers.id, sale.voucherId));
    }
  }
  await db.delete(schema.containerSales).where(eq(schema.containerSales.containerId, id));

  const offloads = await db
    .select({ id: schema.containerOffloads.id })
    .from(schema.containerOffloads)
    .where(eq(schema.containerOffloads.containerId, id));
  for (const offload of offloads) {
    await db.delete(schema.containerOffloadItems).where(eq(schema.containerOffloadItems.offloadId, offload.id));
  }
  await db.delete(schema.containerOffloads).where(eq(schema.containerOffloads.containerId, id));

  const freights = await db
    .select({ id: schema.containerFreight.id })
    .from(schema.containerFreight)
    .where(eq(schema.containerFreight.containerId, id));
  for (const freight of freights) {
    await db
      .delete(schema.containerFreightPayments)
      .where(eq(schema.containerFreightPayments.containerFreightId, freight.id));
  }
  await db.delete(schema.containerFreight).where(eq(schema.containerFreight.containerId, id));
  await db.delete(schema.containerDocuments).where(eq(schema.containerDocuments.containerId, id));
  await db.delete(schema.importLogs).where(eq(schema.importLogs.containerId, id));
  await db.delete(schema.containers).where(eq(schema.containers.id, id));
}

// ---------------------------------------------------------------------------
// PO Line Items
// ---------------------------------------------------------------------------

export async function getLineItemsByPO(poId: number): Promise<POLineItem[]> {
  const items = await db
    .select({
      id: schema.poLineItems.id,
      poId: schema.poLineItems.poId,
      stockItemId: schema.poLineItems.stockItemId,
      stockItemCode: schema.stockItems.code,
      stockItemName: sql<string>`COALESCE(
        CASE WHEN ${schema.stockItems.deletedAt} IS NULL THEN ${schema.stockItems.name} ELSE NULL END,
        (SELECT si2.name FROM stock_items si2
           JOIN stock_item_merge_logs sml ON sml.kept_item_id = si2.id
           WHERE sml.merged_item_id = ${schema.poLineItems.stockItemId}
           AND si2.deleted_at IS NULL
           LIMIT 1),
        ${schema.poLineItems.itemName}
      )`,
      itemName: schema.poLineItems.itemName,
      quantity: schema.poLineItems.quantity,
      rate: schema.poLineItems.rate,
      lineTotal: schema.poLineItems.lineTotal,
      createdAt: schema.poLineItems.createdAt,
      totalCost: schema.poLineItems.lineTotal,
      stockGroupId: schema.stockItems.stockGroupId,
      stockGroupName: sql<string>`COALESCE(${schema.stockGroups.name}, '')`,
      gradeId: schema.stockItems.gradeId,
      gradeName: sql<string | null>`${schema.stockGrades.name}`,
      categoryId: schema.stockItems.categoryId,
      categoryName: sql<string | null>`${schema.stockCategories.name}`,
    })
    .from(schema.poLineItems)
    .leftJoin(schema.stockItems, eq(schema.poLineItems.stockItemId, schema.stockItems.id))
    .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
    .leftJoin(schema.stockGrades, eq(schema.stockItems.gradeId, schema.stockGrades.id))
    .leftJoin(schema.stockCategories, eq(schema.stockItems.categoryId, schema.stockCategories.id))
    .where(eq(schema.poLineItems.poId, poId));

  return items as any;
}

export async function createPOLineItem(lineItem: InsertPOLineItem): Promise<POLineItem> {
  const [created] = await db.insert(schema.poLineItems).values(lineItem).returning();
  return created;
}

// ---------------------------------------------------------------------------
// Container Charges
// ---------------------------------------------------------------------------

export async function getChargesByContainer(containerId: number): Promise<ContainerCharge[]> {
  return await db.select().from(schema.containerCharges).where(eq(schema.containerCharges.containerId, containerId));
}

export async function createContainerCharge(charge: InsertContainerCharge): Promise<ContainerCharge> {
  const [created] = await db.insert(schema.containerCharges).values(charge).returning();
  return created;
}

// ---------------------------------------------------------------------------
// Import Logs
// ---------------------------------------------------------------------------

export async function getImportLogByHash(hash: string): Promise<ImportLog | undefined> {
  const [log] = await db.select().from(schema.importLogs).where(eq(schema.importLogs.fileHash, hash));
  return log;
}

export async function createImportLog(log: InsertImportLog): Promise<ImportLog> {
  const [created] = await db.insert(schema.importLogs).values(log).returning();
  return created;
}

// ---------------------------------------------------------------------------
// Container Offload
// ---------------------------------------------------------------------------

export async function offloadContainer(
  containerId: number,
  locationId: number,
  duties: string,
  dutiesAccountId: number | null | undefined,
  officeCharges: string,
  officeChargesAccountId: number | null | undefined,
  officeChargesCashAccountId: number | null | undefined,
  transferCharges: string,
  transportFees: string,
  transportAccountId: number | null | undefined,
  additionalCharges: Array<{ description: string; amount: number; ledgerAccountId: number }> = [],
  offloadDate?: string,
  inventoryCostCorrections: Array<{ stockItemId: number; correctRate: number }> = []
): Promise<ContainerOffload> {
  const container = await getContainerById(containerId);
  if (!container) throw new Error(`Container ${containerId} not found`);

  const pos = await getPurchaseOrdersByContainer(containerId);
  const allLineItems: POLineItem[] = [];
  for (const po of pos) {
    const items = await getLineItemsByPO(po.id);
    allLineItems.push(...items);
  }

  const totalBales = allLineItems.reduce((sum, item) => {
    if (!item.stockItemId || item.stockItemId === 0) return sum;
    return sum + parseFloat(item.quantity);
  }, 0);

  const additionalChargesTotal = additionalCharges.reduce((sum, charge) => sum + charge.amount, 0);
  const poCharges = parseFloat(container.chargesTotal || "0");
  const totalCharges =
    parseFloat(duties) +
    parseFloat(officeCharges) +
    parseFloat(transferCharges) +
    parseFloat(transportFees) +
    additionalChargesTotal +
    poCharges;

  const additionalCostPerBale = totalBales > 0 ? Math.round((totalCharges / totalBales) * 100) / 100 : 0;
  const expectedChargesApplied = additionalCostPerBale * totalBales;
  const roundingDifference = Math.round((totalCharges - expectedChargesApplied) * 100) / 100;

  const itemsMap = new Map<number, { stockItemId: number; totalQuantity: number; weightedRateSum: number }>();
  for (const item of allLineItems) {
    const stockItemId = item.stockItemId;
    if (!stockItemId || stockItemId === 0) {
      console.warn(`Skipping line item ${item.id} - invalid stock item ID: ${stockItemId}`);
      continue;
    }
    const quantity = parseFloat(item.quantity);
    const rate = parseFloat(item.rate);
    if (itemsMap.has(stockItemId)) {
      const existing = itemsMap.get(stockItemId)!;
      existing.totalQuantity += quantity;
      existing.weightedRateSum += rate * quantity;
    } else {
      itemsMap.set(stockItemId, { stockItemId, totalQuantity: quantity, weightedRateSum: rate * quantity });
    }
  }

  const offloadItemsToStore: Array<{ stockItemId: number; quantity: number; rate: number; totalValue: number }> = [];
  const itemsArray = Array.from(itemsMap.entries());
  const lastItemIndex = itemsArray.length - 1;

  const offload = await db.transaction(async (tx) => {
    const validCorrectionItemIds = new Set(itemsMap.keys());
    if (inventoryCostCorrections.length > 0) {
      for (const correction of inventoryCostCorrections) {
        if (correction.correctRate <= 0) continue;
        if (!validCorrectionItemIds.has(correction.stockItemId)) continue;
        const correctionRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${correction.stockItemId} FOR UPDATE`
        );
        const corrRow = correctionRows.rows?.[0] || correctionRows[0];
        if (corrRow) {
          const existingQty = parseFloat(corrRow.quantity);
          if (existingQty > 0) {
            const newTotalValue = existingQty * correction.correctRate;
            await tx
              .update(schema.inventory)
              .set({
                averageRate: correction.correctRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
                lastUpdated: new Date(),
              })
              .where(eq(schema.inventory.id, corrRow.id));
          }
        }
      }
    }

    for (let i = 0; i < itemsArray.length; i++) {
      const [stockItemId, data] = itemsArray[i];
      const isLastItem = i === lastItemIndex;
      if (data.totalQuantity === 0) continue;

      const averageOriginalRate = data.weightedRateSum / data.totalQuantity;
      const newRate = averageOriginalRate + additionalCostPerBale;
      let offloadValueCents = Math.round(data.totalQuantity * newRate * 100);
      if (isLastItem && roundingDifference !== 0) {
        offloadValueCents += Math.round(roundingDifference * 100);
      }
      const offloadValue = offloadValueCents / 100;
      const adjustedRate = offloadValue / data.totalQuantity;

      offloadItemsToStore.push({
        stockItemId,
        quantity: data.totalQuantity,
        rate: adjustedRate,
        totalValue: offloadValue,
      });

      if (!isFinite(newRate)) throw new Error(`Calculated rate is infinite for stock item ${stockItemId}`);

      const existingRows = await (tx as any).execute(
        sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId} FOR UPDATE`
      );
      const existing = existingRows.rows?.[0] || existingRows[0];

      if (existing) {
        const existingQty = parseFloat(existing.quantity);
        const existingRate = parseFloat(existing.average_rate);
        const existingValue = parseFloat(existing.total_value || "0");
        const newQty = existingQty + data.totalQuantity;
        let weightedAvgRate: number, newTotalValue: number;

        if (newQty === 0) {
          weightedAvgRate = adjustedRate;
          newTotalValue = 0;
        } else if (newQty < 0) {
          weightedAvgRate = adjustedRate;
          newTotalValue = newQty * adjustedRate;
        } else {
          if (existingQty < 0) {
            newTotalValue = newQty * Math.max(adjustedRate, 0);
          } else {
            newTotalValue = existingValue + offloadValue;
            if (newQty > 0 && newTotalValue < 0) newTotalValue = newQty * Math.max(adjustedRate, 0);
          }
          weightedAvgRate = newQty > 0 ? newTotalValue / newQty : 0;
        }

        if (!isFinite(weightedAvgRate))
          throw new Error(`Calculated weighted average rate is infinite for stock item ${stockItemId}`);

        await tx
          .update(schema.inventory)
          .set({
            quantity: newQty.toString(),
            averageRate: weightedAvgRate.toFixed(2),
            totalValue: newTotalValue.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(schema.inventory.id, existing.id));
      } else {
        const [location] = await tx.select().from(schema.locations).where(eq(schema.locations.id, locationId));
        if (!location) throw new Error(`Location ${locationId} not found when creating inventory record`);
        await tx.insert(schema.inventory).values({
          companyId: location.companyId,
          locationId,
          stockItemId,
          quantity: data.totalQuantity.toString(),
          averageRate: adjustedRate.toFixed(2),
          totalValue: offloadValue.toFixed(2),
          lastUpdated: new Date(),
        });
      }
    }

    const resolvedOffloadDate = offloadDate || new Date().toISOString().split("T")[0];
    const containerUpdateSet: Record<string, unknown> = { status: "OFFLOADED", offloadDate: resolvedOffloadDate };
    const actualDuties = parseFloat(duties);
    if (actualDuties > 0) containerUpdateSet.dutyFee = duties;
    await tx.update(schema.containers).set(containerUpdateSet).where(eq(schema.containers.id, containerId));

    const location = await getLocationById(locationId);
    if (!location) throw new Error("Location not found");

    const voucherDate = offloadDate || new Date().toISOString().split("T")[0];

    const findOrCreateImportChargesParent = async () => {
      let [parentAccount] = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(eq(schema.ledgerAccounts.companyId, location.companyId), eq(schema.ledgerAccounts.code, "IMPORT_CHARGES"))
        )
        .limit(1);
      if (!parentAccount) {
        [parentAccount] = await tx
          .insert(schema.ledgerAccounts)
          .values({
            companyId: location.companyId,
            code: "IMPORT_CHARGES",
            name: "Import Charges",
            accountType: "Direct Expense",
            subType: "Direct Expense",
            openingBalance: "0",
            openingBalanceSide: "Dr",
          })
          .returning();
      }
      return parentAccount.id;
    };

    const findOrCreateExpenseAccount = async (code: string, name: string, parentId: number) => {
      let account = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.companyId, location.companyId), eq(schema.ledgerAccounts.code, code)))
        .limit(1);
      if (!account.length) {
        const [newAccount] = await tx
          .insert(schema.ledgerAccounts)
          .values({
            companyId: location.companyId,
            code,
            name,
            accountType: "Direct Expense",
            subType: "Direct Expense",
            parentId,
            openingBalance: "0",
            openingBalanceSide: "Dr",
          })
          .returning();
        account = [newAccount];
      }
      return account[0].id;
    };

    const importChargesParentId = await findOrCreateImportChargesParent();

    for (const po of pos) {
      if (po.voucherId) {
        await tx
          .update(schema.vouchers)
          .set({
            description: `Purchase Order ${po.poNumber} - Container ${container.containerNumber} (Offloaded)`,
          })
          .where(eq(schema.vouchers.id, po.voucherId));
      }
    }

    if (dutiesAccountId && parseFloat(duties) > 0) {
      const dutiesExpenseAccountId = await findOrCreateExpenseAccount("DUTIES", "Duties", importChargesParentId);
      const voucherNumber = `DUTY-${container.containerNumber}-${Date.now()}`;
      const [v] = await tx
        .insert(schema.vouchers)
        .values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `Duties for container ${container.containerNumber}`,
          totalAmount: duties,
        })
        .returning();
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: dutiesExpenseAccountId,
        debitAmount: duties,
        creditAmount: "0",
        narration: `Duties for container ${container.containerNumber}`,
      });
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: dutiesAccountId,
        debitAmount: "0",
        creditAmount: duties,
        narration: `Duties for container ${container.containerNumber}`,
      });
    }

    if (officeChargesAccountId && officeChargesCashAccountId && parseFloat(officeCharges) > 0) {
      const [officeChargesAccount] = await tx
        .select({ accountType: schema.ledgerAccounts.accountType, name: schema.ledgerAccounts.name })
        .from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.id, officeChargesAccountId), isNull(schema.ledgerAccounts.deletedAt)))
        .limit(1);
      const officeInvalidTypes = [
        "Expense",
        "Direct Expense",
        "Indirect Expense",
        "Income",
        "Liability",
        "Current Liability",
        "Profit",
        "Government Taxes",
        "COGS",
      ];
      if (!officeChargesAccount || officeInvalidTypes.includes(officeChargesAccount.accountType)) {
        throw new Error(
          `Office charges account "${officeChargesAccount?.name || `ID ${officeChargesAccountId}`}" has type "${officeChargesAccount?.accountType ?? "deleted/not found"}" which is invalid. It must be an Asset-type account.`
        );
      }
      const voucherNumber = `OFFICE-${container.containerNumber}-${Date.now()}`;
      const [v] = await tx
        .insert(schema.vouchers)
        .values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `Office charges for container ${container.containerNumber}`,
          totalAmount: officeCharges,
        })
        .returning();
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: officeChargesAccountId,
        debitAmount: officeCharges,
        creditAmount: "0",
        narration: `Office charges for container ${container.containerNumber}`,
      });
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: officeChargesCashAccountId,
        debitAmount: "0",
        creditAmount: officeCharges,
        narration: `Office charges for container ${container.containerNumber}`,
      });
    }

    if (parseFloat(transportFees) > 0) {
      const transportExpenseAccountId = await findOrCreateExpenseAccount(
        "TRANSPORT",
        "Transport Charges",
        importChargesParentId
      );
      const expenseTypes = ["Expense", "Direct Expense", "Indirect Expense"];

      const getTransportPayableAccount = async () => {
        let transportPayableAccount = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, location.companyId),
              eq(schema.ledgerAccounts.code, "TRANSPORT_PAYABLE"),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        if (!transportPayableAccount.length) {
          const [newAccount] = await tx
            .insert(schema.ledgerAccounts)
            .values({
              companyId: location.companyId,
              code: "TRANSPORT_PAYABLE",
              name: "Transport Fees Payable",
              accountType: "Liability",
              subType: "Current Liability",
              openingBalance: "0",
              openingBalanceSide: "Cr",
            })
            .returning();
          transportPayableAccount = [newAccount];
        }
        return transportPayableAccount[0].id;
      };

      let creditAccountId = transportAccountId;
      if (transportAccountId) {
        const [selectedAccount] = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(and(eq(schema.ledgerAccounts.id, transportAccountId), isNull(schema.ledgerAccounts.deletedAt)))
          .limit(1);
        if (!selectedAccount || expenseTypes.includes(selectedAccount.accountType)) {
          creditAccountId = await getTransportPayableAccount();
        }
      } else {
        creditAccountId = await getTransportPayableAccount();
      }
      if (!creditAccountId) creditAccountId = await getTransportPayableAccount();

      const voucherNumber = `TRANS-${container.containerNumber}-${Date.now()}`;
      const [v] = await tx
        .insert(schema.vouchers)
        .values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `Transport fees for container ${container.containerNumber}`,
          totalAmount: transportFees,
        })
        .returning();
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: transportExpenseAccountId,
        debitAmount: transportFees,
        creditAmount: "0",
        narration: `Transport fees for container ${container.containerNumber}`,
      });
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: creditAccountId,
        debitAmount: "0",
        creditAmount: transportFees,
        narration: `Transport fees for container ${container.containerNumber}`,
      });
    }

    if (parseFloat(transferCharges) > 0) {
      const transferExpenseAccountId = await findOrCreateExpenseAccount(
        "TRANSFER_CHARGES",
        "Transfer Charges",
        importChargesParentId
      );
      let transferPayableAccount = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, location.companyId),
            eq(schema.ledgerAccounts.code, "TRANSFER_PAYABLE"),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);
      if (!transferPayableAccount.length) {
        const [newAccount] = await tx
          .insert(schema.ledgerAccounts)
          .values({
            companyId: location.companyId,
            code: "TRANSFER_PAYABLE",
            name: "Transfer Charges Payable",
            accountType: "Liability",
            subType: "Current Liability",
            openingBalance: "0",
            openingBalanceSide: "Cr",
          })
          .returning();
        transferPayableAccount = [newAccount];
      }
      const voucherNumber = `XFER-${container.containerNumber}-${Date.now()}`;
      const [v] = await tx
        .insert(schema.vouchers)
        .values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `Transfer charges for container ${container.containerNumber}`,
          totalAmount: transferCharges,
        })
        .returning();
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: transferExpenseAccountId,
        debitAmount: transferCharges,
        creditAmount: "0",
        narration: `Transfer charges for container ${container.containerNumber}`,
      });
      await tx.insert(schema.voucherEntries).values({
        voucherId: v.id,
        ledgerAccountId: transferPayableAccount[0].id,
        debitAmount: "0",
        creditAmount: transferCharges,
        narration: `Transfer charges for container ${container.containerNumber}`,
      });
    }

    for (const charge of additionalCharges) {
      if (charge.amount > 0) {
        const [additionalCreditAccount] = await tx
          .select({ accountType: schema.ledgerAccounts.accountType, name: schema.ledgerAccounts.name })
          .from(schema.ledgerAccounts)
          .where(and(eq(schema.ledgerAccounts.id, charge.ledgerAccountId), isNull(schema.ledgerAccounts.deletedAt)))
          .limit(1);
        if (!additionalCreditAccount)
          throw new Error(
            `Additional charge "${charge.description}" references a deleted or non-existent ledger account (ID: ${charge.ledgerAccountId}).`
          );
        if (
          additionalCreditAccount.accountType === "Direct Expense" ||
          additionalCreditAccount.accountType === "Indirect Expense"
        ) {
          throw new Error(
            `Additional charge "${charge.description}" cannot credit the "${additionalCreditAccount.name}" account (type: ${additionalCreditAccount.accountType}).`
          );
        }
        const additionalExpenseAccountId = await findOrCreateExpenseAccount(
          "ADDITIONAL_CHARGES",
          "Additional Container Charges",
          importChargesParentId
        );
        const voucherNumber = `CHG-${container.containerNumber}-${Date.now()}`;
        const [v] = await tx
          .insert(schema.vouchers)
          .values({
            companyId: location.companyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate,
            description: `${charge.description} for container ${container.containerNumber}`,
            totalAmount: charge.amount.toFixed(2),
          })
          .returning();
        await tx.insert(schema.voucherEntries).values({
          voucherId: v.id,
          ledgerAccountId: additionalExpenseAccountId,
          debitAmount: charge.amount.toFixed(2),
          creditAmount: "0",
          narration: `${charge.description} for container ${container.containerNumber}`,
        });
        await tx.insert(schema.voucherEntries).values({
          voucherId: v.id,
          ledgerAccountId: charge.ledgerAccountId,
          debitAmount: "0",
          creditAmount: charge.amount.toFixed(2),
          narration: `${charge.description} for container ${container.containerNumber}`,
        });
      }
    }

    const [offloadRecord] = await tx
      .insert(schema.containerOffloads)
      .values({
        containerId,
        locationId,
        duties,
        officeCharges,
        transferCharges,
        transportFees,
        totalCharges: totalCharges.toFixed(2),
        totalBales: totalBales.toFixed(3),
        additionalCostPerBale: additionalCostPerBale.toFixed(2),
        offloadedAt: offloadDate ? new Date(offloadDate) : new Date(),
      })
      .returning();

    for (const item of offloadItemsToStore) {
      await tx.insert(schema.containerOffloadItems).values({
        offloadId: offloadRecord.id,
        stockItemId: item.stockItemId,
        quantity: item.quantity.toFixed(3),
        rate: item.rate.toFixed(2),
        totalValue: item.totalValue.toFixed(2),
      });
    }

    return offloadRecord;
  });

  return offload;
}

// ---------------------------------------------------------------------------
// Container Sales
// ---------------------------------------------------------------------------

export async function createContainerSale(sale: schema.InsertContainerSale): Promise<schema.ContainerSale> {
  const [created] = await db.insert(schema.containerSales).values(sale).returning();

  await addCustomerBalanceEntry({
    companyId: sale.companyId,
    customerId: sale.customerId,
    transactionDate: sale.saleDate,
    transactionType: "SALE",
    referenceId: created.id,
    referenceType: "CONTAINER_SALE",
    debitAmount: sale.totalAmount,
    creditAmount: "0",
    balance: sale.totalAmount,
    currency: sale.currency || "USD",
    description: `Container sale - Invoice ${sale.invoiceNumber || created.id}`,
  });

  return created;
}

export async function getContainerSales(companyId: number): Promise<schema.ContainerSale[]> {
  return await db
    .select()
    .from(schema.containerSales)
    .where(eq(schema.containerSales.companyId, companyId))
    .orderBy(desc(schema.containerSales.saleDate));
}

export async function getContainerSaleById(id: number, companyId: number): Promise<schema.ContainerSale | undefined> {
  const [sale] = await db
    .select()
    .from(schema.containerSales)
    .where(and(eq(schema.containerSales.id, id), eq(schema.containerSales.companyId, companyId)));
  return sale;
}

export async function updateContainerSalePayment(
  id: number,
  companyId: number,
  paidAmount: string,
  paymentStatus: "PENDING" | "PARTIAL" | "PAID"
): Promise<schema.ContainerSale> {
  const [updated] = await db
    .update(schema.containerSales)
    .set({ paidAmount, paymentStatus, updatedAt: sql`now()` })
    .where(and(eq(schema.containerSales.id, id), eq(schema.containerSales.companyId, companyId)))
    .returning();
  return updated;
}

export async function getContainerSaleByContainerId(
  containerId: number,
  companyId: number
): Promise<schema.ContainerSale | undefined> {
  const [sale] = await db
    .select()
    .from(schema.containerSales)
    .where(and(eq(schema.containerSales.containerId, containerId), eq(schema.containerSales.companyId, companyId)));
  return sale;
}

export async function getContainerSalesByCustomer(
  customerId: number,
  companyId: number
): Promise<schema.ContainerSale[]> {
  return await db
    .select()
    .from(schema.containerSales)
    .where(and(eq(schema.containerSales.customerId, customerId), eq(schema.containerSales.companyId, companyId)))
    .orderBy(desc(schema.containerSales.saleDate));
}

export async function getContainerCountBySupplier(supplierId: number, companyId?: number): Promise<number> {
  const conditions = [eq(schema.containers.supplierId, supplierId)];
  if (companyId) conditions.push(eq(schema.containers.companyId, companyId));
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.containers)
    .where(and(...conditions));
  return Number(result[0]?.count || 0);
}
