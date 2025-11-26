       throw new Error(`Insufficient stock for item ${item.stockItemId}`);
          }
          
          await db
            .update(inventory)
            .set({
              quantity: newQty.toString(),
              lastUpdated: new Date(),
            })
            .where(eq(inventory.id, sourceInv.id));
        }
        
        // Add to destination
        const [destInv] = await db
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.locationId, destinationLocationId),
              eq(inventory.stockItemId, item.stockItemId)
            )
          )
          .limit(1);
        
        if (destInv) {
          const currentQty = parseFloat(destInv.quantity);
          const newQty = currentQty + quantity;
          const newAvgRate = (parseFloat(destInv.averageRate || "0") * currentQty + rate * quantity) / newQty;
          
          await db
            .update(inventory)
            .set({
              quantity: newQty.toString(),
              averageRate: newAvgRate.toFixed(2),
              totalValue: (newQty * newAvgRate).toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(inventory.id, destInv.id));
        } else {
          // Create new inventory record if it doesn't exist
          await db
            .insert(inventory)
            .values({
              locationId: destinationLocationId,
              stockItemId: item.stockItemId,
              quantity: quantity.toString(),
              averageRate: rate.toFixed(2),
              totalValue: (quantity * rate).toFixed(2),
              lastUpdated: new Date(),
            });
        }
      }
      
      res.json({ success: true, transferId: transfer.id });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inventory-by-location/:locationId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });
      
      const items = await db
        .select({
          id: inventory.id,
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          stockItemName: stockItems.name,
          stockItemCode: stockItems.code,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .where(
          and(
            eq(inventory.locationId, locationId),
            sql`CAST(${inventory.quantity} AS NUMERIC) > 0`
          )
        );
      
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bale Transfer Routes
  app.get("/api/bale-transfers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transfers = await storage.getAllBaleTransfers(companyId);
      res.json(transfers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bale-transfers/:id", requireAuth, async (req, res) => {
    try {
      const transfer = await storage.getBaleTransferById(parseInt(req.params.id));
      if (!transfer) return res.status(404).json({ message: "Transfer not found" });
      const items = await storage.getBaleTransferItems(transfer.id);
      res.json({ ...transfer, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bale-transfers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      const { sourceLocationId, destinationLocationId, transferDate, notes, items } = req.body;
      
      const transfer = await storage.createBaleTransfer({
        companyId,
        sourceLocationId,
        destinationLocationId,
        transferDate,
        notes,
        createdBy: req.session.userId!,
        status: "PENDING"
      });

      for (const item of items) {
        await storage.createBaleTransferItem({
          transferId: transfer.id,
          productionBaleId: item.productionBaleId,
          quantity: item.quantity,
          weightKg: item.weightKg.toString(),
          costPerKg: item.costPerKg.toString(),
          totalCost: item.totalCost.toString()
        });
      }

      res.json({ success: true, transferId: transfer.id });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/bale-transfers/:id", requireAuth, async (req, res) => {
    try {
      const { items, status, notes } = req.body;
      const transferId = parseInt(req.params.id);
      
      await storage.updateBaleTransfer(transferId, {
        status,
        notes,
        updatedBy: req.session.userId!
      });

      if (items) {
        for (const item of items) {
          if (item.id) {
            await storage.updateBaleTransferItem(item.id, {
              weightKg: item.weightKg.toString(),
              costPerKg: item.costPerKg.toString(),
              totalCost: item.totalCost.toString()
            });
          } else {
            await storage.createBaleTransferItem({
              transferId,
              productionBaleId: item.productionBaleId,
              quantity: item.quantity,
              weightKg: item.weightKg.toString(),
              costPerKg: item.costPerKg.toString(),
              totalCost: item.totalCost.toString()
            });
          }
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bales-by-location/:locationId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      const bales = await storage.getProductionBalesByLocation(companyId, parseInt(req.params.locationId));
      res.json(bales.map(b => ({
        id: b.id,
        baleCode: b.baleCode,
        category: b.category,
        grade: b.grade,
        weightKg: b.weightKg,
        costPerKg: b.costPerKg,
        totalCost: b.totalCost
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Orphaned Records Cleanup API - Find and reassign vouchers with deleted locations
  app.get("/api/orphaned-records", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      // Find vouchers that have a locationId but the location no longer exists
      const orphanedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          locationName: vouchers.locationName,
          totalAmount: vouchers.totalAmount,
          description: vouchers.description,
          createdAt: vouchers.createdAt,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.locationId} IS NOT NULL`,
            sql`${locations.id} IS NULL`
          )
        )
        .orderBy(sql`${vouchers.createdAt} DESC`);
      
      res.json(orphanedVouchers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/orphaned-records/reassign", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      
      const { voucherIds, newLocationId } = req.body;
      
      if (!voucherIds || !Array.isArray(voucherIds) || voucherIds.length === 0) {
        return res.status(400).json({ message: "No vouchers selected" });
      }
      
      if (!newLocationId) {
        return res.status(400).json({ message: "New location is required" });
      }
      
      // Verify the new location exists and belongs to current company
      const newLocation = await storage.getLocationById(newLocationId);
      if (!newLocation || newLocation.companyId !== companyId) {
        return res.status(400).json({ message: "Invalid location" });
      }
      
      // Verify all vouchers belong to current company
      const vouchersToUpdate = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            inArray(vouchers.id, voucherIds)
          )
        );
      
      if (vouchersToUpdate.length !== voucherIds.length) {
        return res.status(400).json({ message: "Some vouchers not found or belong to different company" });
      }
      
      // Update vouchers with new location
      await db
        .update(vouchers)
        .set({
          locationId: newLocationId,
          locationName: newLocation.name,
        })
        .where(inArray(vouchers.id, voucherIds));
      
      res.json({ success: true, updated: voucherIds.length, newLocationName: newLocation.name });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
