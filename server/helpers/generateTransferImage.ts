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
  const totalUom = uoms.length === 1 ? uoms[0] : "Mixed";

  const rows = data.items.map((item) =>
    "<tr>" +
    "<td class=\"item-name\">" + escHtml(item.name) + "</td>" +
    "<td class=\"qty\">" + formatQty(item.quantity) + "</td>" +
    "<td class=\"uom\">" + escHtml(item.uom) + "</td>" +
    "</tr>"
  ).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; width: 420px; padding: 0; }
.card { background: #ffffff; border-radius: 16px; overflow: hidden; margin: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.12); }
.header { background: #059669; padding: 16px 20px 14px; }
.header-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.icon-circle { width: 28px; height: 28px; border-radius: 8px; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; }
.title { color: #ffffff; font-size: 14px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
.date { color: #a7f3d0; font-size: 11px; margin-top: 2px; font-weight: 500; }
.route { background: #f8fafc; padding: 12px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #e2e8f0; }
.loc-block { flex: 1; }
.loc-label { color: #94a3b8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; margin-bottom: 2px; }
.loc-name { color: #1e293b; font-size: 14px; font-weight: 700; }
.arrow-circle { width: 28px; height: 28px; border-radius: 50%; background: #ecfdf5; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.arrow { color: #059669; font-size: 16px; font-weight: 800; }
.items-section { padding: 0 20px 6px; background: #ffffff; }
.items-header { display: flex; padding: 10px 0 6px; border-bottom: 2px solid #e2e8f0; }
.col-name { flex: 1; color: #94a3b8; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
.col-qty { width: 60px; text-align: right; color: #94a3b8; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
.col-uom { width: 44px; text-align: right; color: #94a3b8; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
table { width: 100%; border-collapse: collapse; }
table tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }
table td { padding: 8px 0; vertical-align: middle; }
td.item-name { color: #334155; font-size: 12px; padding-right: 8px; font-weight: 500; }
td.qty { width: 60px; text-align: right; color: #059669; font-size: 14px; font-weight: 800; }
td.uom { width: 44px; text-align: right; color: #94a3b8; font-size: 10px; padding-left: 4px; font-weight: 600; }
.footer { background: #f8fafc; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #e2e8f0; }
.total-label { color: #94a3b8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
.total-value { color: #059669; font-size: 20px; font-weight: 800; }
.total-suffix { color: #94a3b8; font-size: 11px; margin-left: 4px; font-weight: 600; }
</style></head><body>
<div class="card">
  <div class="header">
    <div class="header-top">
      <div class="icon-circle"><span style="color:white;font-size:14px;">&#8594;</span></div>
      <div class="title">Stock Transfer</div>
    </div>
    <div class="date">${escHtml(data.date)} &nbsp;&bull;&nbsp; ${escHtml(data.voucherNumber)}</div>
  </div>
  <div class="route">
    <div class="loc-block">
      <div class="loc-label">From</div>
      <div class="loc-name">${escHtml(data.sourceLocationName)}</div>
    </div>
    <div class="arrow-circle"><span class="arrow">&#8594;</span></div>
    <div class="loc-block" style="text-align:right">
      <div class="loc-label">To</div>
      <div class="loc-name">${escHtml(data.destLocationName)}</div>
    </div>
  </div>
  <div class="items-section">
    <div class="items-header">
      <div class="col-name">Item</div>
      <div class="col-qty">Qty</div>
      <div class="col-uom">Unit</div>
    </div>
    <table>${rows}</table>
  </div>
  <div class="footer">
    <div class="total-label">Total Items</div>
    <div style="text-align:right">
      <span class="total-value">${formatQty(totalQty)}</span>
      <span class="total-suffix">${escHtml(totalUom)}</span>
    </div>
  </div>
</div>
</body></html>`;
}

// ── Revised Transfer Image ────────────────────────────────────────────────────

export interface RevisedTransferItem {
  name: string;
  uom: string;
  before: number;
  delta: number;
  after: number;
}

export interface RevisedTransferImageData {
  voucherNumber: string;
  date: string;
  sourceLocationName: string;
  destLocationName: string;
  items: RevisedTransferItem[];
}

function buildRevisedHtml(data: RevisedTransferImageData): string {
  const rows = data.items.map((item) => {
    const deltaStr = item.delta > 0
      ? `+${formatQty(item.delta)}`
      : formatQty(item.delta);
    const deltaColor = item.delta > 0 ? "#059669" : item.delta < 0 ? "#ef4444" : "#94a3b8";
    return (
      "<tr>" +
      "<td class=\"item-name\">" + escHtml(item.name) + "</td>" +
      "<td class=\"qty muted\">" + formatQty(item.before) + "</td>" +
      "<td class=\"qty delta\" style=\"color:" + deltaColor + "\">" + deltaStr + "</td>" +
      "<td class=\"qty after\">" + formatQty(item.after) + "</td>" +
      "<td class=\"uom\">" + escHtml(item.uom) + "</td>" +
      "</tr>"
    );
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; width: 440px; padding: 0; }
.card { background: #ffffff; border-radius: 16px; overflow: hidden; margin: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.12); }
.header { background: #d97706; padding: 16px 20px 14px; }
.header-top { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.icon-circle { width: 28px; height: 28px; border-radius: 8px; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; }
.title { color: #ffffff; font-size: 14px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
.subtitle { color: #fde68a; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 2px; }
.date { color: #fef3c7; font-size: 11px; margin-top: 2px; font-weight: 500; }
.route { background: #f8fafc; padding: 12px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #e2e8f0; }
.loc-block { flex: 1; }
.loc-label { color: #94a3b8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; margin-bottom: 2px; }
.loc-name { color: #1e293b; font-size: 14px; font-weight: 700; }
.arrow-circle { width: 28px; height: 28px; border-radius: 50%; background: #fffbeb; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.arrow { color: #d97706; font-size: 16px; font-weight: 800; }
.items-section { padding: 0 20px 6px; background: #ffffff; }
.items-header { display: flex; padding: 10px 0 6px; border-bottom: 2px solid #e2e8f0; }
.col-name { flex: 1; color: #94a3b8; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
.col-qty { width: 52px; text-align: right; color: #94a3b8; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
.col-uom { width: 40px; text-align: right; color: #94a3b8; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
table { width: 100%; border-collapse: collapse; }
table tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }
table td { padding: 8px 0; vertical-align: middle; }
td.item-name { color: #334155; font-size: 12px; padding-right: 6px; font-weight: 500; }
td.qty { width: 52px; text-align: right; font-size: 13px; font-weight: 800; }
td.muted { color: #94a3b8; }
td.delta { font-size: 14px; }
td.after { color: #2563eb; }
td.uom { width: 40px; text-align: right; color: #94a3b8; font-size: 10px; padding-left: 3px; font-weight: 600; }
.footer { background: #fffbeb; padding: 12px 20px; border-top: 2px solid #fde68a; display: flex; justify-content: space-between; align-items: center; }
.badge { background: #d97706; color: #fff; font-size: 9px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; padding: 3px 10px; border-radius: 20px; }
.items-count { color: #92400e; font-size: 13px; font-weight: 700; }
</style></head><body>
<div class="card">
  <div class="header">
    <div class="header-top">
      <div class="icon-circle"><span style="color:white;font-size:12px;">&#9998;</span></div>
      <div class="title">Stock Transfer</div>
    </div>
    <div class="subtitle">Revised</div>
    <div class="date">${escHtml(data.date)} &nbsp;&bull;&nbsp; ${escHtml(data.voucherNumber)}</div>
  </div>
  <div class="route">
    <div class="loc-block">
      <div class="loc-label">From</div>
      <div class="loc-name">${escHtml(data.sourceLocationName)}</div>
    </div>
    <div class="arrow-circle"><span class="arrow">&#8594;</span></div>
    <div class="loc-block" style="text-align:right">
      <div class="loc-label">To</div>
      <div class="loc-name">${escHtml(data.destLocationName)}</div>
    </div>
  </div>
  <div class="items-section">
    <div class="items-header">
      <div class="col-name">Item</div>
      <div class="col-qty">Before</div>
      <div class="col-qty">Change</div>
      <div class="col-qty">After</div>
      <div class="col-uom">Unit</div>
    </div>
    <table>${rows}</table>
  </div>
  <div class="footer">
    <span class="badge">Revision</span>
    <span class="items-count">${data.items.length} item${data.items.length !== 1 ? "s" : ""} revised</span>
  </div>
</div>
</body></html>`;
}

async function renderHtmlToPng(html: string, width: number, height: number): Promise<Buffer> {
  const release = await acquirePuppeteerSlot();
  let browser: any = null;
  try {
    const { default: puppeteer } = await import("puppeteer");
    const chromePath = getChromiumPath();
    browser = await puppeteer.launch({
      headless: "new",
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-gpu", "--disable-accelerated-2d-canvas", "--no-first-run",
        "--no-zygote", "--disable-extensions", "--disable-background-networking",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 400));
    const cardEl = await page.$(".card");
    const screenshot = cardEl
      ? await cardEl.screenshot({ type: "png" })
      : await page.screenshot({ type: "png", fullPage: true });
    return Buffer.from(screenshot as Uint8Array);
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    release();
  }
}

export async function generateRevisedTransferImageBuffer(data: RevisedTransferImageData): Promise<Buffer> {
  const html = buildRevisedHtml(data);
  return renderHtmlToPng(html, 472, 700);
}

export async function generateTransferImageBuffer(data: TransferImageData): Promise<Buffer> {
  const html = buildHtml(data);
  return renderHtmlToPng(html, 452, 700);
}
