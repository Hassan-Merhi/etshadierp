import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

function replaceOnceOrVerify(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count === 1) return source.replace(oldText, newText);
  if (count === 0 && source.includes(newText)) return source;
  throw new Error(`${label}: expected one source match or an already-applied replacement, found ${count}`);
}

function replaceRowFallbacks(source, expected, label) {
  const pattern = /\(([A-Za-z_$][\w$]*) as any\)\.rows \?\? \(\1 as any\[\]\)/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length === expected) {
    return source.replace(pattern, (_whole, variableName) => `${variableName}.rows`);
  }
  if (matches.length === 0) return source;
  throw new Error(`${label}: expected ${expected} raw-query fallback matches or zero after application, found ${matches.length}`);
}

const posHandlersPath = "client/src/pages/pos/hooks/usePosHandlers.ts";
let posHandlers = read(posHandlersPath);
posHandlers = replaceOnceOrVerify(
  posHandlers,
  "  stockPrintRef: React.MutableRefObject<HTMLDivElement>;",
  "  stockPrintRef: React.RefObject<HTMLDivElement>;",
  "usePosHandlers stockPrintRef"
);
posHandlers = replaceOnceOrVerify(
  posHandlers,
  "  exchangeRate: number;",
  "  exchangeRate: number | null;",
  "usePosHandlers exchangeRate"
);
posHandlers = replaceOnceOrVerify(
  posHandlers,
  "  dailyExchangeRate: number;",
  "  dailyExchangeRate: number | null;",
  "usePosHandlers dailyExchangeRate"
);
write(posHandlersPath, posHandlers);

const invoiceActionsPath = "client/src/pages/pos/hooks/usePosInvoiceActions.ts";
let invoiceActions = read(invoiceActionsPath);
invoiceActions = replaceOnceOrVerify(
  invoiceActions,
  "  stockPrintRef: React.MutableRefObject<HTMLDivElement>;",
  "  stockPrintRef: React.RefObject<HTMLDivElement>;",
  "usePosInvoiceActions stockPrintRef"
);
write(invoiceActionsPath, invoiceActions);

const rowCalculationsPath = "client/src/pages/pos/hooks/usePosRowCalculations.ts";
let rowCalculations = read(rowCalculationsPath);
rowCalculations = replaceOnceOrVerify(
  rowCalculations,
  "  exchangeRate: number;",
  "  exchangeRate: number | null;",
  "usePosRowCalculations exchangeRate"
);
rowCalculations = replaceOnceOrVerify(
  rowCalculations,
  "    const displayRate = activeCurrency === \"CFA\" ? Math.round(rateUSD * exchangeRate) : rateUSD;",
  "    const displayRate = activeCurrency === \"CFA\" ? Math.round(rateUSD * (exchangeRate ?? 0)) : rateUSD;",
  "usePosRowCalculations nullable multiplication"
);
write(rowCalculationsPath, rowCalculations);

const checkoutPath = "client/src/pages/pos/hooks/usePosCheckout.ts";
let checkout = read(checkoutPath);
checkout = replaceOnceOrVerify(
  checkout,
  "  exchangeRate: number;",
  "  exchangeRate: number | null;",
  "usePosCheckout exchangeRate"
);
checkout = replaceOnceOrVerify(
  checkout,
  "  dailyExchangeRate: number;",
  "  dailyExchangeRate: number | null;",
  "usePosCheckout dailyExchangeRate"
);
write(checkoutPath, checkout);

const saleGridPath = "client/src/pages/pos/pos-components/SaleGrid.tsx";
let saleGrid = read(saleGridPath);
saleGrid = replaceOnceOrVerify(
  saleGrid,
  "  exchangeRate: number;",
  "  exchangeRate: number | null;",
  "SaleGrid exchangeRate"
);
write(saleGridPath, saleGrid);

const invoiceTemplatePath = "client/src/pages/pos/pos-components/InvoiceTemplate.tsx";
let invoiceTemplate = read(invoiceTemplatePath);
invoiceTemplate = replaceOnceOrVerify(
  invoiceTemplate,
  "  exchangeRate: number;",
  "  exchangeRate: number | null;",
  "InvoiceTemplate exchangeRate"
);
write(invoiceTemplatePath, invoiceTemplate);

const allocationFiles = [
  ["server/routes/factory/factoryStockAllocationV2Routes.ts", 2],
  ["server/routes/factory/factoryStockAllocationV3Routes.ts", 12],
  ["server/routes/factory/factoryStockAllocationV5Routes.ts", 1],
];

for (const [path, expected] of allocationFiles) {
  const source = read(path);
  write(path, replaceRowFallbacks(source, expected, path));
}

console.log("Combo 4D first safe slice applied or already present.");
