import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, from, to, label) {
  const count = content.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  return content.replace(from, to);
}

// 1) Customer shipping company is persisted on the order, not on customers.
{
  const path = "server/routes/factory/customer-orders/orderCrudRoutes.ts";
  let content = read(path);
  content = replaceOnce(
    content,
`      if (shippingCompany && order.customerId) {
        await db
          .update(customers)
          .set({
            defaultShippingCompany: shippingCompany,
          })
          .where(eq(customers.id, order.customerId))
          .catch(() => {});
      }

`,
`      // Shipping company is order-specific. The customers table has no
      // defaultShippingCompany field, so do not perform a swallowed invalid update.

`,
    "remove stale customer defaultShippingCompany update"
  );
  write(path, content);
}

// 2) POS ownership is represented by vouchers.shiftId -> posShifts.userId.
for (const path of [
  "server/routes/reportsRoutes.ts",
  "server/routes/vouchers/voucherQueryRoutes.ts",
]) {
  let content = read(path);
  content = replaceOnce(
    content,
`  vouchers,
  voucherEntries,`,
`  vouchers,
  voucherEntries,
  posShifts,`,
    `${path}: import posShifts`
  );

  const oldGuard = `      // POS users can only access their own Sales vouchers
      if (req.user?.role === "POS" && voucher.voucherType === "Sales" && voucher.userId !== req.user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
`;
  const newGuard = `      // POS sales ownership is recorded through the linked shift.
      if (req.user?.role === "POS" && voucher.voucherType === "Sales") {
        const [ownedShift] = voucher.shiftId
          ? await db
              .select({ id: posShifts.id })
              .from(posShifts)
              .where(and(eq(posShifts.id, voucher.shiftId), eq(posShifts.userId, req.user.id)))
              .limit(1)
          : [];
        if (!ownedShift) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
`;
  content = replaceOnce(content, oldGuard, newGuard, `${path}: replace stale voucher.userId ownership guard`);
  write(path, content);
}

// 3) Supplier association belongs on voucher entries, not voucher headers.
{
  const path = "server/routes/sp/spContainerRoutes.ts";
  let content = read(path);

  const headerField = `              sourceModule: "SP",
              supplierId: supplierIdNum,
`;
  const headerReplacement = `              sourceModule: "SP",
`;
  const headerCount = content.split(headerField).length - 1;
  if (headerCount !== 2) {
    throw new Error(`SP voucher inserts: expected 2 supplierId header fields, found ${headerCount}`);
  }
  content = content.split(headerField).join(headerReplacement);

  content = replaceOnce(
    content,
`              totalAmount: String(totalUsd),
              supplierId: supplierIdNum,
            })`,
`              totalAmount: String(totalUsd),
            })`,
    "SP voucher update: remove stale supplierId header field"
  );

  const creditEntry = `            creditAmount: String(totalUsd),
            narration: `;
  const creditEntryWithSupplier = `            creditAmount: String(totalUsd),
            supplierId: supplierIdNum,
            narration: `;
  const creditCount = content.split(creditEntry).length - 1;
  if (creditCount !== 3) {
    throw new Error(`SP clearing entries: expected 3 credit entries, found ${creditCount}`);
  }
  content = content.split(creditEntry).join(creditEntryWithSupplier);

  write(path, content);
}

// 4) Imported barcodes are stored as stock item code aliases.
{
  const path = "server/storage/inventory/stockItemStorage.ts";
  let content = read(path);
  content = replaceOnce(
    content,
`export async function getStockItemByBarcode(barcode: string, companyId: number): Promise<schema.StockItem | undefined> {
  const [item] = await db
    .select()
    .from(schema.stockItems)
    .where(
      and(
        eq(schema.stockItems.barcode, barcode),
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.deletedAt)
      )
    );
  return item;
}
`,
`export async function getStockItemByBarcode(barcode: string, companyId: number): Promise<schema.StockItem | undefined> {
  // Barcodes are persisted in stock_item_code_aliases by the barcode import flow.
  return getStockItemByCodeOrAlias(barcode, companyId);
}
`,
    "replace removed stock_items.barcode lookup with alias lookup"
  );
  write(path, content);
}

// 5) Consumption is an existing runtime voucher type used by waste dispatches.
{
  const path = "shared/schema/erp.ts";
  let content = read(path);
  content = replaceOnce(
    content,
`      "Stock Transfer",
      "Credit Note",`,
`      "Stock Transfer",
      "Consumption",
      "Credit Note",`,
    "add Consumption to voucher insert validator"
  );
  write(path, content);
}

console.log("Combo 4G data-model patch applied successfully.");
