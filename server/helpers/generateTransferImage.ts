/**
 * generateTransferImage.ts
 * Renders a stock-transfer summary card as a PNG buffer using Puppeteer.
 * Uses the shared Puppeteer semaphore to keep peak Chrome memory predictable.
 */

import { acquirePuppeteerSlot } from "../lib/puppeteerSemaphore";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { createRequire } from "module";

const _require = createRequire(import.meta.url);

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
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pup = _require("puppeteer");
    const p: string = typeof pup.executablePath === "function" ? pup.executablePath() : "";
    if (p && existsSync(p)) return p;
  } catch { /* not installed */ }
  return null;
}

function buildHtml(data: TransferImageData): string {
  const totalQty = data.items.reduce((s, i) => s + i.quantity, 0);

  const rows = data.items.map((item) => `
    <tr>
      <td class="item-name">${escHtml(item.name)}</td>
      <td class="qty">${formatQty(item.quantity)}</td>
      <td class="uom">${escHtml(item.uom)}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #0f1923;
    width: 600px;
    padding: 0;
  }
  .card {
    background: #162032;
    border-radius: 12px;
    overflow: hidden;
    margin: 16px;
  }
  .header {
    background: linear-gradient(135deg, #1a4b8c 0%, #0d3366 100%);
    padding: 20px 24px 16px;
  }
  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .title {
    color: #ffffff;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .voucher-badge {
    background: rgba(255,255,255,0.15);
    color: #b8d4f8;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 20px;
    letter-spacing: 0.5px;
  }
  .date {
    color: #7aabea;
    font-size: 13px;
    margin-top: 6px;
  }
  .route {
    background: #1e2f45;
    padding: 14px 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid #243650;
  }
  .loc-block {
    flex: 1;
  }
  .loc-label {
    color: #5a8ab8;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    font-weight: 600;
    margin-bottom: 3px;
  }
  .loc-name {
    color: #d4e9ff;
    font-size: 15px;
    font-weight: 600;
  }
  .arrow {
    color: #2e7de0;
    font-size: 22px;
    flex-shrink: 0;
  }
  .items-section {
    padding: 0 24px 8px;
  }
  .items-header {
    display: flex;
    padding: 10px 0 6px;
    border-bottom: 1px solid #243650;
  }
  .col-name  { flex: 1; color: #4a7ab0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
  .col-qty   { width: 80px; text-align: right; color: #4a7ab0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
  .col-uom   { width: 60px; text-align: right; color: #4a7ab0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  table tr:not(:last-child) td {
    border-bottom: 1px solid #1e2f45;
  }
  table td {
    padding: 9px 0;
    vertical-align: middle;
  }
  td.item-name { color: #c8dff5; font-size: 13px; padding-right: 12px; }
  td.qty       { width: 80px; text-align: right; color: #5ce0a0; font-size: 14px; font-weight: 700; }
  td.uom       { width: 60px; text-align: right; color: #7a9cbe; font-size: 11px; padding-left: 6px; }
  .footer {
    background: #1e2f45;
    padding: 12px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid #243650;
    margin-top: 4px;
  }
  .total-label { color: #5a8ab8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; }
  .total-value { color: #5ce0a0; font-size: 18px; font-weight: 800; }
  .total-suffix { color: #4a7ab0; font-size: 11px; margin-left: 4px; }
  .brand { color: #345a88; font-size: 11px; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="header-top">
      <div class="title">Stock Transfer</div>
      <div class="voucher-badge">${escHtml(data.voucherNumber)}</div>
    </div>
    <div class="date">${escHtml(data.date)}</div>
  </div>

  <div class="route">
    <div class="loc-block">
      <div class="loc-label">From</div>
      <div class="loc-name">${escHtml(data.sourceLocationName)}</div>
    </div>
    <div class="arrow">&#8594;</div>
    <div class="loc-block" style="text-align:right">
      <div class="loc-label">To</div>
      <div class="loc-name">${escHtml(data.destLocationName)}</div>
    </div>
  </div>

  <div class="items-section">
    <div class="items-header">
      <div class="col-name">Item</div>
      <div class="col-qty">Qty</div>
      <div class="col-uom">UOM</div>
    </div>
    <table>
      ${rows}
    </table>
  </div>

  <div class="footer">
    <div>
      <div class="total-label">Total Items</div>
    </div>
    <div style="text-align:right">
      <span class="total-value">${formatQty(totalQty)}</span>
      <span class="total-suffix">units</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(3).replace(/\.?0+$/, "");
}

export async function generateTransferImageBuffer(data: TransferImageData): Promise<Buffer> {
  const html = buildHtml(data);
  const release = await acquirePuppeteerSlot();
  let browser: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = _require("puppeteer");
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
    // Wait for fonts/layout
    await new Promise((r) => setTimeout(r, 300));
    // Screenshot just the card element
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
