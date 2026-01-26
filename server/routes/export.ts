import { Express } from "express";
import XLSX from "xlsx";
import { IStorage } from "../storage";

export function registerExportRoutes(app: Express, storage: IStorage, requireAuth: any, requireNonPOS: any) {
  
  // Export all inventory as Excel
  app.get("/api/export/inventory", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const inventory = await storage.getCompanyInventory(req.session.currentCompanyId);
      
      const data = inventory.map((item: any) => ({
        "Location": item.locationName || "",
        "Stock Code": item.stockItemCode || "",
        "Item Name": item.stockItemName || "",
        "Stock Group": item.stockGroupName || "",
        "Quantity": parseFloat(item.quantity) || 0,
        "UOM": item.stockItemUom || "",
        "Avg Rate": parseFloat(item.averageRate) || 0,
        "Total Value": parseFloat(item.totalValue) || 0,
        "Last Updated": item.lastUpdated ? new Date(item.lastUpdated).toLocaleDateString() : "",
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="inventory_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Export inventory error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export all stock items as Excel
  app.get("/api/export/stock-items", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const stockItems = await storage.getAllStockItems(req.session.currentCompanyId);
      const stockGroups = await storage.getAllStockGroups(req.session.currentCompanyId);
      const groupMap = new Map(stockGroups.map((g: any) => [g.id, g.name]));
      
      const data = stockItems.map((item: any) => ({
        "Code": item.code || "",
        "Name": item.name || "",
        "Stock Group": groupMap.get(item.stockGroupId!) || "",
        "UOM": item.uom || "",
        "Selling Price": parseFloat(item.sellingPrice || "0"),
        "Active": item.active ? "Yes" : "No",
        "Created": item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "",
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Items");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="stock_items_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Export stock items error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export vouchers as Excel (with date range filter)
  app.get("/api/export/vouchers", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, voucherType } = req.query;
      
      let vouchers = await storage.getVouchers(req.session.currentCompanyId);
      
      // Apply filters
      if (startDate) {
        vouchers = vouchers.filter((v: any) => new Date(v.date) >= new Date(startDate as string));
      }
      if (endDate) {
        vouchers = vouchers.filter((v: any) => new Date(v.date) <= new Date(endDate as string));
      }
      if (voucherType && voucherType !== "all") {
        vouchers = vouchers.filter((v: any) => v.voucherType === voucherType);
      }
      
      const data = vouchers.map((v: any) => ({
        "Voucher Number": v.voucherNumber || "",
        "Date": v.date ? new Date(v.date).toLocaleDateString() : "",
        "Type": v.voucherType || "",
        "Narration": v.narration || "",
        "Total Amount": parseFloat(v.totalAmount || "0"),
        "Draft": v.draft ? "Yes" : "No",
        "Created": v.createdAt ? new Date(v.createdAt).toLocaleDateString() : "",
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Vouchers");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="vouchers_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Export vouchers error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export suppliers as Excel
  app.get("/api/export/suppliers", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const suppliers = await storage.getAllSuppliers();
      
      const data = suppliers.map((s: any) => ({
        "Name": s.name || "",
        "Contact Person": s.contactPerson || "",
        "Phone": s.phone || "",
        "Email": s.email || "",
        "Address": s.address || "",
        "Country": s.country || "",
        "Active": s.active ? "Yes" : "No",
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Suppliers");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="suppliers_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Export suppliers error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export customers as Excel
  app.get("/api/export/customers", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const customers = await storage.getAllCustomers(req.session.currentCompanyId);
      
      const data = customers.map((c: any) => ({
        "Name": c.name || "",
        "Phone": c.phone || "",
        "Email": c.email || "",
        "Address": c.address || "",
        "Active": c.active ? "Yes" : "No",
        "Created": c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "",
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Customers");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="customers_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Export customers error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export ledger accounts as Excel
  app.get("/api/export/ledger-accounts", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accounts = await storage.getLedgerAccounts(req.session.currentCompanyId);
      
      const data = accounts.map((a: any) => ({
        "Code": a.code || "",
        "Name": a.name || "",
        "Account Type": a.accountType || "",
        "Opening Balance": parseFloat(a.openingBalance || "0"),
        "Active": a.active ? "Yes" : "No",
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Ledger Accounts");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="ledger_accounts_export_${new Date().toISOString().split('T')[0]}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Export ledger accounts error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
