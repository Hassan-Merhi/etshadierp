null,
          endDate: endDate || null,
          locationId: locationId || null,
          stockGroupId: stockGroupId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Movement Report
  app.get("/api/reports/stock-movement", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockGroupId } = req.query;

      // Get all stock items for this company
      const allStockItems = await storage.getAllStockItems(companyId);
      
      // Filter by stock group if provided
      const stockItemsToReport = stockGroupId 
        ? allStockItems.filter(item => item.stockGroupId === parseInt(stockGroupId as string))
        : allStockItems;

      // Get all inventory records
      const inventoryConditions = [eq(locations.companyId, companyId)];

      if (locationId) {
        inventoryConditions.push(eq(inventory.locationId, parseInt(locationId as string)));
      }

      const inventoryRecords = await db
        .select({
          stockItemId: inventory.stockItemId,
          locationId: inventory.locationId,
          locationName: locations.name,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          totalValue: inventory.totalValue,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(and(...inventoryConditions))
        .execute();

      // Build movement report
      const movementData = stockItemsToReport.map(item => {
        const itemInventory = inventoryRecords.filter(inv => inv.stockItemId === item.id);
        const totalQuantity = itemInventory.reduce((sum, inv) => sum + parseFloat(inv.quantity), 0);
        const totalValue = itemInventory.reduce((sum, inv) => sum + parseFloat(inv.totalValue), 0);

        return {
          stockItemId: item.id,
          stockItemCode: item.code,
          stockItemName: item.name,
          locations: itemInventory.map(inv => ({
            locationId: inv.locationId,
            locationName: inv.locationName,
            quantity: parseFloat(inv.quantity),
            averageRate: parseFloat(inv.averageRate),
            totalValue: parseFloat(inv.totalValue),
          })),
          totalQuantity,
          totalValue,
        };
      }).filter(item => item.totalQuantity > 0);

      const grandTotalQuantity = movementData.reduce((sum, item) => sum + item.totalQuantity, 0);
      const grandTotalValue = movementData.reduce((sum, item) => sum + item.totalValue, 0);

      res.json({
        items: movementData,
        summary: {
          totalItems: movementData.length,
          grandTotalQuantity,
          grandTotalValue,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          locationId: locationId || null,
          stockGroupId: stockGroupId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Container Report
  app.get("/api/reports/containers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { status, supplierId, startDate, endDate } = req.query;

      const conditions = [eq(containers.companyId, companyId)];

      if (status) {
        conditions.push(eq(containers.status, status as string));
      }
      if (supplierId) {
        conditions.push(eq(containers.supplierId, parseInt(supplierId as string)));
      }
      if (startDate) {
        conditions.push(sql`${containers.importDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${containers.importDate} <= ${endDate}`);
      }

      const containerData = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          supplierName: suppliers.legalName,
          status: containers.status,
          importDate: containers.importDate,
          itemsTotal: containers.itemsTotal,
          chargesTotal: containers.chargesTotal,
          grandTotal: containers.grandTotal,
        })
        .from(containers)
        .innerJoin(suppliers, eq(containers.supplierId, suppliers.id))
        .where(and(...conditions))
        .orderBy(containers.importDate);

      const totalItemsTotal = containerData.reduce((sum, c) => sum + parseFloat(c.itemsTotal || "0"), 0);
      const totalChargesTotal = containerData.reduce((sum, c) => sum + parseFloat(c.chargesTotal || "0"), 0);
      const totalGrandTotal = containerData.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);

      res.json({
        containers: containerData,
        summary: {
          totalContainers: containerData.length,
          totalItemsTotal,
          totalChargesTotal,
          totalGrandTotal,
        },
        filters: {
          status: status || null,
          supplierId: supplierId || null,
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ratio Analysis Report
  app.get("/api/reports/ratios", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate } = req.query;

      // Get all ledger accounts
      const companyAccounts = await storage.getAllLedgerAccounts(companyId);
      
      const incomeAccountIds = companyAccounts.filter(acc => acc.accountType === "Income").map(acc => acc.id);
      const expenseAccountIds = companyAccounts.filter(acc => acc.accountType === "Expense").map(acc => acc.id);
      const assetAccountIds = companyAccounts.filter(acc => acc.accountType === "Asset").map(acc => acc.id);
      const liabilityAccountIds = companyAccounts.filter(acc => acc.accountType === "Liability").map(acc => acc.id);

      // Get vouchers with date filter
      const conditions = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(...conditions))
        .execute();
      
      const companyVoucherIds = companyVouchers.map(v => v.id);

      const companyEntries = companyVoucherIds.length > 0
        ? await db
            .select()
            .from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, companyVoucherIds))
            .execute()
        : [];

      // Calculate totals
      let totalIncome = 0;
      let totalExpenses = 0;
      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const entry of companyEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          if (incomeAccountIds.includes(entry.ledgerAccountId)) {
            totalIncome += credit - debit;
          }
          if (expenseAccountIds.includes(entry.ledgerAccountId)) {
            totalExpenses += debit - credit;
          }
          if (assetAccountIds.includes(entry.ledgerAccountId)) {
            totalAssets += debit - credit;
          }
          if (liabilityAccountIds.includes(entry.ledgerAccountId)) {
            totalLiabilities += credit - debit;
          }
        }
      }

      // Get sales data for gross profit calculation
      const salesConditions = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        salesConditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        salesConditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const salesData = await db
        .select({
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(...salesConditions))
        .execute();

      const totalSales = salesData.reduce((sum, s) => sum + parseFloat(s.totalSales), 0);
      const totalCost = salesData.reduce((sum, s) => sum + parseFloat(s.totalCost), 0);
      const grossProfit = totalSales - totalCost;

      // Calculate ratios
      const netProfit = totalIncome - totalExpenses;
      const grossProfitMargin = totalSales > 0 ? (grossProfit / totalSales * 100) : 0;
      const netProfitMargin = totalIncome > 0 ? (netProfit / totalIncome * 100) : 0;
      const currentRatio = totalLiabilities > 0 ? totalAssets / totalLiabilities : 0;
      const debtToEquity = (totalAssets - totalLiabilities) > 0 ? totalLiabilities / (totalAssets - totalLiabilities) : 0;

      res.json({
        ratios: {
          grossProfitMargin,
          netProfitMargin,
          currentRatio,
          debtToEquity,
        },
        underlying: {
          totalIncome,
          totalExpenses,
          totalSales,
          totalCost,
          grossProfit,
          netProfit,
          totalAssets,
          totalLiabilities,
          totalEquity: totalAssets - totalLiabilities,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
