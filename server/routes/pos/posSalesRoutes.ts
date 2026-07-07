import { type Express } from "express";
import { getClientDate } from "../../lib/dateUtils";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, canModifyDate } from "../../auth";
import { logAudit, runIntercompanyPosTransfer } from "../_helpers";
import {
  inventory,
  stockItems,
  ledgerAccounts,
  bankAccounts,
  vouchers,
  voucherEntries,
  salesItems,
  customers,
  userLocations,
  companies,
  stockItemLocationPrices,
  userLocationCashAccounts,
} from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { adjustInventory } from "../../inventoryHelper";

export function registerPosSalesRoutes(app: Express): void {
  app.post("/api/pos/sales", requireAuth, canModifyDate("voucherDate"), async (req, res) => {
    const _t = Date.now();
    const _uid = (req as any).user?.id;
    const _cid = req.session.currentCompanyId;
    logger.info("POS sale create started", { module: "pos", action: "createSale", userId: _uid, companyId: _cid });
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      // Detect supplier_partner company — uses split accounting (Cr Payable + Cr Profit) instead of Cr Sales
      const [currentCoRow] = await db
        .select({ companyType: companies.companyType })
        .from(companies)
        .where(eq(companies.id, req.session.currentCompanyId!))
        .limit(1);
      const isSpCompany = currentCoRow?.companyType === "supplier_partner";

      const isPOSUser = req.user?.role === "POS";

      const {
        locationId,
        cashAccountId,
        paymentAccountType,
        paymentAccountId,
        items,
        notes,
        isCreditSale,
        voucherDate: providedVoucherDate,
        shiftId,
        clientSaleId,
        currency,
        exchangeRate,
      } = req.body;

      // POS cash account enforcement: look up the mapped cash account from DB.
      // For POS users on non-credit sales, the cash account is determined server-side
      // from user_location_cash_accounts, not from the frontend submission.
      let posEnforcedCashAccountId: number | null = null;
      if (isPOSUser && !isCreditSale) {
        const parsedLocId = locationId ? Number(locationId) : null;
        // Block immediately — POS users must always supply a location for cash sales.
        if (!parsedLocId) {
          return res.status(400).json({ message: "Location is required for POS sales" });
        }
        const [locMapping] = await db
          .select({ cashAccountId: userLocationCashAccounts.cashAccountId })
          .from(userLocationCashAccounts)
          .where(
            and(
              eq(userLocationCashAccounts.userId, req.user!.id),
              eq(userLocationCashAccounts.companyId, req.session.currentCompanyId!),
              eq(userLocationCashAccounts.locationId, parsedLocId)
            )
          )
          .limit(1);
        if (locMapping) {
          posEnforcedCashAccountId = locMapping.cashAccountId;
        } else {
          // Legacy fallback: only apply when this user has NO mappings at all
          // (pre-migration POS user). If any mapping exists, this location is
          // simply not configured — block with a clear error instead of using
          // a session account that belongs to a different location.
          const [anyMapping] = await db
            .select({ id: userLocationCashAccounts.id })
            .from(userLocationCashAccounts)
            .where(
              and(
                eq(userLocationCashAccounts.userId, req.user!.id),
                eq(userLocationCashAccounts.companyId, req.session.currentCompanyId!)
              )
            )
            .limit(1);
          if (!anyMapping && req.session.cashAccountId) {
            posEnforcedCashAccountId = req.session.cashAccountId;
          } else {
            return res.status(400).json({
              message: "No cash account assigned for this POS location. Contact admin.",
            });
          }
        }
      }

      // Determine account type and ID by validating against actual database records
      let accountType: string;
      let accountId: number;
      let customerAccount: any = null;

      if (isCreditSale) {
        // Credit sales must use a customer receivable ledger account (Asset type)
        if (!paymentAccountId) {
          return res.status(400).json({
            message: "Customer account is required for credit sales",
          });
        }

        const [fetchedCustomerAccount] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(eq(ledgerAccounts.id, paymentAccountId), eq(ledgerAccounts.companyId, req.session.currentCompanyId!))
          )
          .limit(1);

        if (!fetchedCustomerAccount) {
          return res.status(400).json({
            message: "Invalid customer account - account not found or does not belong to this company",
          });
        }

        if (fetchedCustomerAccount.accountType !== "Asset") {
          return res.status(400).json({
            message: `Invalid customer account type: ${fetchedCustomerAccount.accountType}. Credit sales require Asset-type accounts (customer receivables).`,
          });
        }

        customerAccount = fetchedCustomerAccount;
        accountType = "credit";
        accountId = paymentAccountId;
      } else if (posEnforcedCashAccountId !== null) {
        // POS users: use the server-enforced cash account from user_location_cash_accounts
        accountType = "cash";
        accountId = posEnforcedCashAccountId;
      } else if (cashAccountId) {
        // Legacy: cashAccountId parameter - validate it's a cash ledger account in current company
        const [cashLedger] = await db
          .select()
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, req.session.currentCompanyId!)))
          .limit(1);

        if (!cashLedger) {
          return res.status(400).json({
            message: "Invalid cash account - account not found or does not belong to this company",
          });
        }

        if (cashLedger.accountType !== "Cash") {
          return res.status(400).json({
            message: `Invalid cash account type: ${cashLedger.accountType}. The cashAccountId parameter must refer to a Cash-type ledger account.`,
          });
        }

        accountType = "cash";
        accountId = cashAccountId;
      } else if (paymentAccountId) {
        // Infer account type by checking if ID exists in ledger accounts or bank accounts
        // IMPORTANT: Scope by company to prevent cross-tenant access
        const [ledgerAccount] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(eq(ledgerAccounts.id, paymentAccountId), eq(ledgerAccounts.companyId, req.session.currentCompanyId!))
          )
          .limit(1);

        if (ledgerAccount) {
          // It's a ledger account - validate it's appropriate for POS sales
          if (ledgerAccount.accountType === "Cash") {
            accountType = "cash";
            accountId = paymentAccountId;
          } else if (ledgerAccount.accountType === "Asset") {
            // Asset accounts are customer receivables - should only be used for credit sales
            return res.status(400).json({
              message:
                "Asset accounts (customer receivables) can only be used for credit sales. Please enable 'Credit Sale' or select a Cash/Bank account.",
            });
          } else {
            // Other ledger account types (Expense, Liability, etc.) are not valid for POS sales
            return res.status(400).json({
              message: `Invalid payment account type: ${ledgerAccount.accountType}. POS sales require Cash accounts or Bank accounts for cash/bank payments, or Asset accounts for credit sales.`,
            });
          }
        } else {
          // Check if it's a bank account
          const [bankAccount] = await db
            .select()
            .from(bankAccounts)
            .where(
              and(eq(bankAccounts.id, paymentAccountId), eq(bankAccounts.companyId, req.session.currentCompanyId!))
            )
            .limit(1);

          if (bankAccount) {
            accountType = "bank";
            accountId = paymentAccountId;
          } else {
            return res.status(400).json({
              message: "Invalid payment account ID - account not found or does not belong to this company",
            });
          }
        }
      } else {
        return res.status(400).json({
          message: "Payment account is required",
        });
      }

      console.log("[POS Sale] Payment info:", {
        provided: { paymentAccountType, paymentAccountId, cashAccountId, isCreditSale },
        resolved: { accountType, accountId },
      });

      // Fix 4: Idempotency — if this clientSaleId was already saved, return the existing sale
      if (clientSaleId) {
        const [existingVoucher] = await db
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, req.session.currentCompanyId!),
              eq(vouchers.clientSaleId, clientSaleId),
              isNull(vouchers.deletedAt)
            )
          )
          .limit(1);
        if (existingVoucher) {
          const existingSalesItems = await db
            .select()
            .from(salesItems)
            .where(eq(salesItems.voucherId, existingVoucher.id));
          const existingLocation = existingVoucher.locationId
            ? await storage.getLocationById(existingVoucher.locationId)
            : null;
          return res.json({
            voucher: existingVoucher,
            location: existingLocation,
            items: existingSalesItems,
            grandTotal: existingVoucher.totalAmount,
            voucherNumber: existingVoucher.voucherNumber,
            saleDate: existingVoucher.voucherDate,
            isCreditSale: existingVoucher.isCreditSale,
            customer: null,
            _idempotent: true,
          });
        }
      }

      // Validate required fields
      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }

      // Validate shiftId if one was provided — if invalid/closed, just ignore it and proceed without a shift
      let effectiveShiftId: number | null = shiftId || null;
      if (effectiveShiftId) {
        const shift = await storage.getShiftById(effectiveShiftId);
        if (
          !shift ||
          shift.companyId !== req.session.currentCompanyId ||
          shift.locationId !== locationId ||
          shift.status !== "open" ||
          shift.userId !== req.user?.id
        ) {
          effectiveShiftId = null;
        }
      }
      if (!accountId) {
        return res.status(400).json({
          message: isCreditSale ? "Customer is required" : "Payment account is required",
        });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Input validation assertions for inventory safety
      const parsedLocationId = Number(locationId);
      if (!locationId || isNaN(parsedLocationId)) {
        return res.status(400).json({ message: `Invalid locationId: ${locationId}` });
      }
      for (const item of items) {
        if (!item.stockItemId || isNaN(Number(item.stockItemId))) {
          return res.status(400).json({ message: `Invalid stockItemId: ${item.stockItemId}` });
        }
        const qty = parseFloat(item.quantity);
        if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
          return res.status(400).json({ message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` });
        }
      }

      // Validate and calculate total
      let grandTotal = 0;
      for (const item of items) {
        if (!item.stockItemId) {
          return res.status(400).json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          return res.status(400).json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res.status(400).json({ message: "Rate must be non-negative for all items" });
        }
        grandTotal += parseFloat(item.quantity) * parseFloat(item.rate);
      }

      // Get or create SALES revenue account (outside transaction for simplicity)
      // Use getOrCreateLedgerAccount so soft-deleted duplicates don't cause a
      // unique-constraint crash — it handles the 23505 error and falls back to
      // fetching the existing (possibly soft-deleted) row.
      const salesAccount = await storage.getOrCreateLedgerAccount({
        companyId: req.session.currentCompanyId!,
        code: "SALES",
        name: "Sales Revenue",
        accountType: "Income",
        openingBalance: "0",
        active: true,
      });

      if (salesAccount.accountType !== "Income") {
        // Validate that Sales account is of type Income for proper import cycle balance
        console.warn(
          `[POS Sale] WARNING: SALES account has type "${salesAccount.accountType}" instead of "Income". This will cause import cycle imbalance!`
        );
        return res.status(400).json({
          message: `The SALES account is configured with type "${salesAccount.accountType}" but must be type "Income" for POS sales to work correctly. Please update the SALES account type in Accounts page.`,
        });
      }

      // Get location details
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Location does not belong to the current company" });
      }

      // Fix 2: POS users can only sell from their assigned locations
      if (isPOSUser) {
        const assignedLocs = await db
          .select({ locationId: userLocations.locationId })
          .from(userLocations)
          .where(
            and(eq(userLocations.userId, req.user!.id), eq(userLocations.companyId, req.session.currentCompanyId!))
          );
        const allowedIds = assignedLocs.map((l) => l.locationId);
        if (!allowedIds.includes(parsedLocationId)) {
          return res.status(403).json({ message: "You are not allowed to sell from this location." });
        }
      }

      // STEP 1: Validate inventory availability
      const voucherNumber = `SALES-${Date.now()}`;
      const voucherDate = providedVoucherDate || getClientDate(req);

      // Check if user can sell negative stock (same for all items — compute once)
      const canSellNegativeStock = req.user?.canSellNegativeStock || false;

      // Fix 5: Verify each stockItemId exists, belongs to this company, and is not deleted/merged
      for (const item of items) {
        const [si] = await db
          .select({ id: stockItems.id, name: stockItems.name, deletedAt: stockItems.deletedAt })
          .from(stockItems)
          .where(and(eq(stockItems.id, item.stockItemId), eq(stockItems.companyId, req.session.currentCompanyId!)))
          .limit(1);
        if (!si) {
          return res.status(400).json({
            message: `Item ID ${item.stockItemId} does not exist or does not belong to this company.`,
            code: "ITEM_NOT_FOUND",
            invalidItemId: item.stockItemId,
          });
        }
        if (si.deletedAt) {
          return res.status(400).json({
            message: `This item was merged or deleted. Please select it again.`,
            code: "ITEM_DELETED",
            invalidItemId: item.stockItemId,
          });
        }
      }

      // STEP 1a: Validate inventory rows (best-effort pre-check; authoritative check is inside the transaction)
      const inventoryValidation: Array<{
        item: any;
        inventoryRecord: any;
        currentQty: number;
        saleQty: number;
        newQty: number;
        currentRate: number;
      }> = [];

      for (const item of items) {
        const [inventoryRecord] = await db
          .select({
            id: inventory.id,
            locationId: inventory.locationId,
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            itemName: stockItems.name,
          })
          .from(inventory)
          .leftJoin(stockItems, eq(stockItems.id, inventory.stockItemId))
          .where(and(eq(inventory.locationId, locationId), eq(inventory.stockItemId, item.stockItemId)));

        if (!inventoryRecord) {
          throw new Error(`Inventory not found for item ${item.stockItemId} at location ${locationId}`);
        }

        const currentQty = parseFloat(inventoryRecord.quantity);
        const saleQty = parseFloat(item.quantity);
        const itemDisplayName = inventoryRecord.itemName || `item ${item.stockItemId}`;

        if (currentQty < saleQty && !canSellNegativeStock) {
          throw new Error(
            `Not enough stock for "${itemDisplayName}". Available: ${currentQty}, requested: ${saleQty}.`
          );
        }

        inventoryValidation.push({
          item,
          inventoryRecord,
          currentQty,
          saleQty,
          newQty: currentQty - saleQty,
          currentRate: parseFloat(inventoryRecord.averageRate),
        });
      }

      // Sort by stockItemId so all concurrent transactions acquire inventory row locks
      // in the same order — prevents deadlocks when two cashiers sell the same items.
      inventoryValidation.sort((a, b) => a.item.stockItemId - b.item.stockItemId);

      // ── SP company: fetch configured POS accounts & pre-compute supplier cost ──
      let spPosPayableAccountId: number | null = null;
      let spPosProfitAccountId: number | null = null;
      let spPosCostClrAccountId: number | null = null;
      let spPosDeductionClrAccountId: number | null = null;
      let totalSupplierCost = 0;
      // Per-qty deduction that silently reduces Supplier Cash Payable (not income/expense)
      const spPosDeductionPerQty = isSpCompany
        ? parseFloat(String((location as any).supplierPartnerPayableDeductionPerQty ?? "0")) || 0
        : 0;
      const spPosTotalQtySold = isSpCompany ? inventoryValidation.reduce((sum, v) => sum + v.saleQty, 0) : 0;
      if (isSpCompany) {
        const spSettings = await storage.getCompanySettings(req.session.currentCompanyId!);
        spPosPayableAccountId = spSettings?.spPosPayableAccountId ?? null;
        spPosProfitAccountId = spSettings?.spPosProfitAccountId ?? null;
        if (!spPosPayableAccountId || !spPosProfitAccountId) {
          return res.status(400).json({
            message: "Supplier POS payable/profit accounts are not configured. Go to SP Setup to set them up.",
          });
        }
        // Look up Stock Cost Payable Clearing account (sp_cost_clearing subType)
        const [clrAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!),
              eq(ledgerAccounts.subType, "sp_cost_clearing"),
              isNull(ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        spPosCostClrAccountId = clrAcct?.id ?? null;
        // Look up Supplier Payable Deduction Clearing account (sp_pay_deduction_clearing subType)
        const [ddcAcct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, req.session.currentCompanyId!),
              eq(ledgerAccounts.subType, "sp_pay_deduction_clearing"),
              isNull(ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        spPosDeductionClrAccountId = ddcAcct?.id ?? null;
        // Pre-compute total supplier cost from inventory averageRate (includes landed/offloading cost)
        totalSupplierCost = inventoryValidation.reduce((sum, v) => sum + v.saleQty * v.currentRate, 0);
      }

      // STEP 1b: Create accounting records, update inventory, and create sales items
      // All wrapped in a single DB transaction for atomicity
      let voucher: any;
      let saleItems: any[] = [];

      const txResult = await db.transaction(async (tx) => {
        const [txVoucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            locationName: location.name,
            voucherNumber,
            voucherType: "Sales",
            voucherDate,
            description:
              notes ||
              (isCreditSale
                ? `Credit Invoice Sale at ${location.name} - ${(customerAccount as any).name}`
                : `POS Sale at ${location.name}`),
            totalAmount: grandTotal.toFixed(2),
            shiftId: effectiveShiftId,
            clientSaleId: clientSaleId || null,
            currency: currency || "USD",
            exchangeRate: exchangeRate || null,
            isCreditSale: !!isCreditSale,
          })
          .returning();

        const creditSaleNarration = isCreditSale
          ? `Credit Invoice Sale at ${location.name} - ${(customerAccount as any).name}`
          : `POS Sale - ${voucherNumber}`;

        const debitEntry: any = {
          voucherId: txVoucher.id,
          debitAmount: grandTotal.toFixed(2),
          creditAmount: "0",
          narration: creditSaleNarration,
        };

        if (isCreditSale || accountType === "cash" || accountType === "credit") {
          debitEntry.ledgerAccountId = accountId;
          // For credit sales, also stamp the customerId on the receivable
          // entry whenever the receivable ledger is linked to a customer.
          // Without this, the customer ledger / statement views can't
          // attribute the entry to the customer.
          if (isCreditSale && accountType === "credit") {
            try {
              const [linkedCust] = await tx
                .select({ id: customers.id })
                .from(customers)
                .where(
                  and(eq(customers.ledgerAccountId, accountId), eq(customers.companyId, req.session.currentCompanyId!))
                )
                .limit(1);
              if (linkedCust) {
                debitEntry.customerId = linkedCust.id;
              }
            } catch (e) {
              console.error("[POS Sale] customer lookup for credit-sale entry failed:", e);
            }
          }
          console.log("[POS Sale] Using ledgerAccountId for cash/credit:", accountId);
        } else {
          debitEntry.bankAccountId = accountId;
          console.log("[POS Sale] Using bankAccountId for bank:", accountId);
        }

        console.log("[POS Sale] Debit entry:", debitEntry);
        await tx.insert(voucherEntries).values(debitEntry);

        if (!isSpCompany) {
          // Normal ERP: credit the full sale amount to the Sales Revenue account
          await tx.insert(voucherEntries).values({
            voucherId: txVoucher.id,
            ledgerAccountId: salesAccount.id,
            debitAmount: "0",
            creditAmount: grandTotal.toFixed(2),
            narration: creditSaleNarration,
          });
        } else {
          // Supplier Partner accounting:
          //   Dr Cash                           = grandTotal  (debit entry already written above)
          //   Cr Supplier Cash Payable          = grandTotal − deductionAmount
          //   Cr Deduction Clearing (hidden)    = deductionAmount          (if deduction > 0)
          //
          // The deduction is a silent per-qty reduction to what is owed to the supplier
          // (e.g. a warehouse loss charge). It is NOT income, profit, or an expense —
          // it flows into a hidden clearing liability that is excluded from all reports.
          const grandTotalRounded = Number(grandTotal.toFixed(2));
          const spDeductionAmount = Number((spPosTotalQtySold * spPosDeductionPerQty).toFixed(2));
          // Guard: deduction cannot exceed the sale total
          if (spDeductionAmount > Math.abs(grandTotalRounded)) {
            throw new Error(
              `Supplier payable deduction (${spDeductionAmount}) exceeds the sale total (${grandTotalRounded}). ` +
                `Adjust the deduction per qty setting on this location.`
            );
          }
          const spPayableAmount = Number((grandTotalRounded - spDeductionAmount).toFixed(2));

          if (grandTotalRounded > 0) {
            // Cr Supplier Cash Payable = reduced payable
            if (spPayableAmount > 0) {
              await tx.insert(voucherEntries).values({
                voucherId: txVoucher.id,
                ledgerAccountId: spPosPayableAccountId!,
                debitAmount: "0",
                creditAmount: spPayableAmount.toFixed(2),
                narration: `Supplier Cash Payable — ${voucherNumber}`,
              });
            }
            // Cr Deduction Clearing = deduction (keeps voucher balanced)
            if (spDeductionAmount > 0 && spPosDeductionClrAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId: txVoucher.id,
                ledgerAccountId: spPosDeductionClrAccountId,
                debitAmount: "0",
                creditAmount: spDeductionAmount.toFixed(2),
                narration: `Supplier Payable Deduction (${spPosTotalQtySold} qty × ${spPosDeductionPerQty}) — ${voucherNumber}`,
              });
            }
          } else if (grandTotalRounded < 0) {
            // Reversal: Dr Supplier Cash Payable
            if (spPayableAmount < 0) {
              await tx.insert(voucherEntries).values({
                voucherId: txVoucher.id,
                ledgerAccountId: spPosPayableAccountId!,
                debitAmount: Math.abs(spPayableAmount).toFixed(2),
                creditAmount: "0",
                narration: `Supplier Cash Payable reversal — ${voucherNumber}`,
              });
            }
            if (spDeductionAmount > 0 && spPosDeductionClrAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId: txVoucher.id,
                ledgerAccountId: spPosDeductionClrAccountId,
                debitAmount: spDeductionAmount.toFixed(2),
                creditAmount: "0",
                narration: `Supplier Payable Deduction reversal — ${voucherNumber}`,
              });
            }
          }
        }

        const txSaleItems: any[] = [];

        for (const validatedItem of inventoryValidation) {
          const { item, newQty, currentRate, inventoryRecord, currentQty, saleQty } = validatedItem;

          // Fix 3: Authoritative stock check inside the transaction with row lock.
          // Catches race conditions where two cashiers sell the last unit concurrently.
          // Use FOR UPDATE OF i (not the whole JOIN) because PostgreSQL rejects
          // FOR UPDATE on the nullable side of a LEFT JOIN.
          const stockLockResult = await (tx as any).execute(sql`
            SELECT i.quantity, i.average_rate, si.name AS item_name
            FROM inventory i
            LEFT JOIN stock_items si ON si.id = i.stock_item_id
            WHERE i.location_id = ${parsedLocationId} AND i.stock_item_id = ${item.stockItemId}
            FOR UPDATE OF i
          `);
          const lockedRow = stockLockResult.rows?.[0] ?? stockLockResult[0];
          const lockedQty = lockedRow ? parseFloat(lockedRow.quantity ?? "0") : 0;
          if (lockedQty < saleQty && !canSellNegativeStock) {
            throw new Error(
              `Not enough stock for "${lockedRow?.item_name || inventoryRecord?.itemName || item.stockItemId}". Available: ${lockedQty}, requested: ${saleQty}.`
            );
          }

          await adjustInventory(tx, locationId, item.stockItemId, -saleQty, req.session.currentCompanyId!);

          const [stockItem] = await tx.select().from(stockItems).where(eq(stockItems.id, item.stockItemId));

          const qty = parseFloat(item.quantity);
          const sellingPrice = parseFloat(item.rate) || 0;
          // Use the freshly-locked average_rate so two concurrent cashiers both
          // record the correct cost basis rather than a stale pre-read value.
          const costPrice = lockedRow ? parseFloat(lockedRow.average_rate ?? "0") : currentRate;
          const totalSales = qty * sellingPrice;
          const totalCost = qty * costPrice;
          const profit = totalSales - totalCost;

          // Get configured selling price from location prices BEFORE insert so we can persist it
          const [locPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, item.stockItemId),
                eq(stockItemLocationPrices.locationId, locationId)
              )
            )
            .limit(1);
          const configuredPrice = locPrice?.sellingPrice || stockItem?.sellingPrice || "0";
          const configuredPriceNum = parseFloat(configuredPrice);

          await tx.insert(salesItems).values({
            voucherId: txVoucher.id,
            stockItemId: item.stockItemId,
            quantity: qty.toString(),
            sellingPrice: sellingPrice.toFixed(2),
            costPrice: costPrice.toFixed(2),
            totalSales: totalSales.toFixed(2),
            totalCost: totalCost.toFixed(2),
            profit: profit.toFixed(2),
            configuredPrice: configuredPriceNum.toFixed(6),
          });
          const profitPerUnit = sellingPrice - configuredPriceNum;
          const totalProfitVsConfigured = profitPerUnit * qty;

          txSaleItems.push({
            ...item,
            stockItemName: stockItem?.name || "",
            stockItemCode: stockItem?.code || "",
            amount: totalSales.toFixed(2),
            configuredPrice: configuredPriceNum.toFixed(2),
            profitPerUnit: profitPerUnit.toFixed(2),
            totalProfitVsConfigured: totalProfitVsConfigured.toFixed(2),
          });
        }

        return { voucher: txVoucher, saleItems: txSaleItems };
      });

      voucher = txResult.voucher;
      saleItems = txResult.saleItems;

      const result = { voucher, saleItems };

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "vouchers",
          recordId: voucher.id,
          recordIdentifier: voucherNumber,
          changes: {
            voucherNumber: { new: voucherNumber },
            voucherType: { new: "Sales" },
            saleType: { new: isCreditSale ? "Credit Invoice" : "Cash Sale" },
            location: { new: location.name },
            totalAmount: { new: grandTotal.toFixed(2) },
            date: { new: voucherDate },
            itemCount: { new: saleItems.length },
            customer: { new: customerAccount ? (customerAccount as any).name : null },
          },
        });
      } catch {
        /* non-fatal */
      }

      // ── Intercompany POS auto-transfer (non-blocking, cash sales only) ──
      if (!isCreditSale && accountType === "cash") {
        // fire-and-forget; never let errors surface to the client
        runIntercompanyPosTransfer(req.session.currentCompanyId!, accountId, grandTotal, voucherDate).catch((err) =>
          console.error("[IntercompanyPOS] Unhandled:", err)
        );
      }

      // Return complete sale details
      logger.info("POS sale create succeeded", { module: "pos", action: "createSale", userId: _uid, companyId: _cid, voucherId: result.voucher?.id, durationMs: Date.now() - _t });
      res.json({
        voucher: result.voucher,
        location,
        items: result.saleItems,
        grandTotal: grandTotal.toFixed(2),
        voucherNumber,
        saleDate: voucherDate,
        isCreditSale,
        customer: customerAccount
          ? {
              id: customerAccount.id,
              code: customerAccount.code,
              name: customerAccount.name,
            }
          : null,
      });
    } catch (error: any) {
      logger.error("POS sale create failed", { module: "pos", action: "createSale", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      // Return appropriate status codes for different error types
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock") || error.message.includes("Not enough stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });
}
