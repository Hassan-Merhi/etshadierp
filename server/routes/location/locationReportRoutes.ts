import type { Express } from "express";
import { storage } from "../../storage";
import { requireAuth, requireNonPOS } from "../../auth";

export function registerLocationReportRoutes(app: Express) {
  // Send current stock list to the location's linked WhatsApp group
  app.post("/api/locations/:locationId/send-stock-whatsapp", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      const location = await storage.getLocationById(locationId);
      if (!location) return res.status(404).json({ message: "Location not found" });
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const chatId = (location as any).whatsappGroupChatId as string | null;
      if (!chatId) {
        return res
          .status(400)
          .json({ message: "No WhatsApp group linked to this location. Set one via the WhatsApp icon." });
      }

      const stockGroupId = req.body.stockGroupId ? parseInt(req.body.stockGroupId) : null;
      const groupName: string | null = req.body.groupName ?? null;

      // Get live inventory for this location
      const inventoryRows = await storage.getLocationInventory(req.session.currentCompanyId!, locationId);

      // Filter to specific group if requested, and exclude zero qty
      const rows = inventoryRows.filter((item: any) => {
        if (parseFloat(item.quantity || "0") === 0) return false;
        if (stockGroupId && item.stockGroupId !== stockGroupId) return false;
        return true;
      });

      if (rows.length === 0) {
        return res.status(400).json({ message: "No stock to send (all items are at zero)." });
      }

      // Build message
      const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
      const header = groupName
        ? `*Stock Report – ${groupName}*\n📍 ${location.name}  |  📅 ${today}`
        : `*Stock Report – ${location.name}*\n📅 ${today}`;

      const lines = rows.map((item: any) => {
        const qty = Math.floor(parseFloat(item.quantity || "0"));
        return `• ${item.stockItemName}  —  *${qty} ${item.stockItemUom || "BL"}*`;
      });

      const totalQty = Math.floor(rows.reduce((s: number, i: any) => s + parseFloat(i.quantity || "0"), 0));
      const footer = `\n*Total: ${totalQty} ${rows[0]?.stockItemUom || "BL"}*`;

      const message = `${header}\n\n${lines.join("\n")}${footer}`;

      const { sendWhatsAppTextToChatId } = await import("../../services/whatsappService");
      const result = await sendWhatsAppTextToChatId(chatId, message);

      if (!result.success) {
        return res.status(500).json({ message: result.error || "WhatsApp send failed" });
      }

      res.json({ message: "Stock list sent to WhatsApp", itemCount: rows.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
