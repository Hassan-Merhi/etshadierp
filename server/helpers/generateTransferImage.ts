/**
 * generateTransferImage.ts
 * Renders a stock-transfer summary card as a PNG buffer using Puppeteer.
 * Uses the shared Puppeteer semaphore to keep peak Chrome memory predictable.
 */

import { acquirePuppeteerSlot } from "../lib/puppeteerSemaphore";
import { execSync } from "child_process";
import { existsSync } from "fs";

export interface TransferImageItem {
  name: string;
  quantity: number;
  uom: string;
}

export interface TransferImageData {
  voucherNumber: string;
  date: string;
  sourceLocationName: string;
  destLocationName: string;
  items: TransferImageItem[];
}

function getChromiumPath(): string | null {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  for (const cmd of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const p = execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf8", timeout: 3000 }).trim();
      if (p && existsSync(p)) return p;
    } catch { /* try next */ }
  }
  return null;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(3).replace(/\.?0+$/, "");
}

function buildHtml(data: TransferImageData): string {
  const totalQty = data.items.reduce((s, i) => s + i.quantity, 0);
  const uoms = [...new Set(data.items.map((i) => i.uom))];
  const totalUom = uoms.length === 1 ? uoms[0] : "BL";

  const rows = data.items.map((item) =>
    "<tr>" +
    "<td class=\"item-name\">" + escHtml(item.name) + "</td>" +
    "<td class=\"qty\">" + formatQty(item.quantity) + "</td>" +
    "<td class=\"uom\">" + escHtml(item.uom) + "</td>" +
    "</tr>"
  ).join("");

  return "<!DOCTYPE html>" +
    "<html><head><meta charset=\"utf-8\"/><style>" +
    "* { margin: 0; padding: 0; box-sizing: border-box; }" +
    "body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f2f5; width: 600px; padding: 0; }" +
    ".card { background: #ffffff; border-radius: 14px; overflow: hidden; margin: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.10); }" +
    ".header { background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%); padding: 20px 24px 16px; }" +
    ".title { color: #ffffff; font-size: 22px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }" +
    ".date { color: #bfdbfe; font-size: 13px; margin-top: 5px; font-weight: 500; }" +
    ".route { background: #f8fafc; padding: 14px 24px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #e2e8f0; }" +
    ".loc-block { flex: 1; }" +
    ".loc-label { color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; margin-bottom: 3px; }" +
    ".loc-name { color: #1e293b; font-size: 16px; font-weight: 700; }" +
    ".arrow { color: #3b82f6; font-size: 22px; flex-shrink: 0; }" +
    ".items-section { padding: 0 24px 8px; background: #ffffff; }" +
    ".items-header { display: flex; padding: 10px 0 6px; border-bottom: 2px solid #e2e8f0; }" +
    ".col-name { flex: 1; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }" +
    ".col-qty { width: 80px; text-align: right; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }" +
    ".col-uom { width: 60px; text-align: right; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }" +
    "table { width: 100%; border-collapse: collapse; }" +
    "table tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }" +
    "table td { padding: 10px 0; vertical-align: middle; }" +
    "td.item-name { color: #334155; font-size: 13px; padding-right: 12px; font-weight: 500; }" +
    "td.qty { width: 80px; text-align: right; color: #16a34a; font-size: 15px; font-weight: 800; }" +
    "td.uom { width: 60px; text-align: right; color: #94a3b8; font-size: 11px; padding-left: 6px; font-weight: 600; }" +
    ".footer { background: #f8fafc; padding: 13px 24px; display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #e2e8f0; }" +
    ".total-label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }" +
    ".total-value { color: #16a34a; font-size: 20px; font-weight: 800; }" +
    ".total-suffix { color: #94a3b8; font-size: 12px; margin-left: 5px; font-weight: 600; }" +
    "</style></head><body>" +
    "<div class=\"card\">" +
      "<div class=\"header\">" +
        "<div class=\"title\">Stock Transfer</div>" +
        "<div class=\"date\">" + escHtml(data.date) + "</div>" +
      "</div>" +
      "<div class=\"route\">" +
        "<div class=\"loc-block\">" +
          "<div class=\"loc-label\">From</div>" +
          "<div class=\"loc-name\">" + escHtml(data.sourceLocationName) + "</div>" +
        "</div>" +
        "<div class=\"arrow\">&#8594;</div>" +
        "<div class=\"loc-block\" style=\"text-align:right\">" +
          "<div class=\"loc-label\">To</div>" +
          "<div class=\"loc-name\">" + escHtml(data.destLocationName) + "</div>" +
        "</div>" +
      "</div>" +
      "<div class=\"items-section\">" +
        "<div class=\"items-header\">" +
          "<div class=\"col-name\">Item</div>" +
          "<div class=\"col-qty\">Qty</div>" +
          "<div class=\"col-uom\">UOM</div>" +
        "</div>" +
        "<table>" + rows + "</table>" +
      "</div>" +
      "<div class=\"footer\">" +
        "<div class=\"total-label\">Total Items</div>" +
        "<div style=\"text-align:right\">" +
          "<span class=\"total-value\">" + formatQty(totalQty) + "</span>" +
          "<span class=\"total-suffix\">" + escHtml(totalUom) + "</span>" +
        "</div>" +
      "</div>" +
    "</div>" +
    "</body></html>";
}

export async function generateTransferImageBuffer(data: TransferImageData): Promise<Buffer> {
  const html = buildHtml(data);
  const release = await acquirePuppeteerSlot();
  let browser: any = null;
  try {
    const { default: puppeteer } = await import("puppeteer");
    const chromePath = getChromiumPath();
    browser = await puppeteer.launch({
      headless: "new",
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-extensions",
        "--disable-background-networking",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 632, height: 800 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 300));
    const cardEl = await page.$(".card");
    const screenshot = cardEl
      ? await cardEl.screenshot({ type: "png" })
      : await page.screenshot({ type: "png", fullPage: true });
    return Buffer.from(screenshot as Uint8Array);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    release();
  }
}
