/**
 * Broker balance calculations for the factory net-position report.
 *
 * A broker supplier's balance rolls up its linked children's containers,
 * payments, FX transfers and charges. Both functions were closures inside the
 * /api/factory/net-position handler and read ten values from its scope; those
 * are now an explicit context, which is the only change to the code that moved.
 *
 * config/report-characterization.json pins the endpoint's output across the move.
 */
export interface BrokerCalcContext {
  suppliersList: any[];
  allContainersF: any[];
  allPaymentsF: any[];
  allFxTransfersF: any[];
  allOffloadChargesF: any[];
  allContainerOtherChargesF: any[];
  allColOtherChargesF: any[];
  getConfigFx: (cc: string) => number;
  companyId: number;
  round2: (n: number) => number;
  brokerChildren: Map<number, number[]>;
  linkedSupplierParent: Map<number, number>;
  voucherPaidByCurrencyBySupplierId: Record<number, Record<string, number>>;
}

export const calcBrokerApproxUsd = (ctx: BrokerCalcContext, brokerId: number): number => {
  const groupIds = [brokerId, ...(ctx.brokerChildren.get(brokerId) || [])];
  const buckets: Record<string, number> = {};
  const add = (cc: string, amt: number) => {
    buckets[cc] = (buckets[cc] || 0) + amt;
  };

  // Opening balances for all group members (stored in USD)
  for (const s of ctx.suppliersList as any[]) {
    if (!groupIds.includes(s.id)) continue;
    const ob = parseFloat(s.openingBalance || "0");
    if (ob !== 0) add("USD", ob);
  }

  // Containers (goods + freight per currency)
  // USD commission from linked (child) suppliers also flows into the broker's USD bucket.
  for (const c of ctx.allContainersF as any[]) {
    if (!groupIds.includes(c.supplierId)) continue;
    const cc = c.currencyCode || "USD";
    const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
    const rate = parseFloat(c.ratePerKg || "0");
    add(cc, kg * rate);
    const freight = parseFloat(c.freight || "0");
    const freightCc = c.freightCurrencyCode || cc;
    if (freight > 0) add(freightCc, freight);
    // USD commission from linked (child) suppliers → broker USD bucket
    // (broker's own containers and non-USD commission stay excluded)
    if (
      c.supplierId !== brokerId &&
      ctx.linkedSupplierParent.has(c.supplierId) &&
      ctx.linkedSupplierParent.get(c.supplierId) === brokerId
    ) {
      const commAmt = parseFloat(c.commissionAmount || "0");
      if (commAmt > 0 && (c.commissionCurrencyCode || "USD") === "USD") {
        add("USD", commAmt);
      }
    }
  }

  // Offload additional charges (per-supplier, in their own currency)
  for (const oc of ctx.allOffloadChargesF as any[]) {
    if (!groupIds.includes(oc.supplierId)) continue;
    const cc = oc.currencyCode || "USD";
    add(cc, parseFloat(oc.amount || "0"));
  }

  // Container other charges table (linked via containerId → supplierId)
  for (const oc of ctx.allContainerOtherChargesF as any[]) {
    if (!groupIds.includes(oc.supplierId)) continue;
    const cc = oc.currencyCode || oc.containerCurrencyCode || "USD";
    add(cc, parseFloat(oc.amount || "0"));
  }

  // Container column other_charges (where otherChargesSupplierId is in group)
  for (const oc of ctx.allColOtherChargesF as any[]) {
    if (!groupIds.includes(oc.otherChargesSupplierId)) continue;
    const cc = oc.otherChargesCurrencyCode || "USD";
    add(cc, parseFloat(oc.otherCharges || "0"));
  }

  // Direct payments (reduce balance in payment currency)
  for (const p of ctx.allPaymentsF as any[]) {
    if (!groupIds.includes(p.supplierId)) continue;
    const cc = p.currencyCode || "USD";
    add(cc, -parseFloat(p.amount || "0"));
  }

  // Voucher payments per currency
  for (const sid of groupIds) {
    const currMap = ctx.voucherPaidByCurrencyBySupplierId[sid] || {};
    for (const [cc, amt] of Object.entries(currMap)) {
      add(cc, -amt);
    }
  }

  // FX transfers
  for (const t of ctx.allFxTransfersF as any[]) {
    const fromCc = t.fromCurrencyCode || "USD";
    const fromAmt = parseFloat(t.fromAmount || "0");
    const toUsd = parseFloat(t.toAmountUsd || "0");
    const isFromBroker = t.fromSupplierId === brokerId;
    // Non-USD source: subtract from the foreign-currency bucket
    if (groupIds.includes(t.fromSupplierId) && fromCc !== "USD") {
      add(fromCc, -fromAmt);
    }
    // FX In to broker pool
    if (t.toSupplierId === brokerId) {
      add("USD", toUsd);
    }
    // FX Out from broker in USD (broker redistributes USD out of its pool)
    if (isFromBroker && fromCc === "USD") {
      add("USD", -fromAmt);
    }
  }

  const usdBal = buckets["USD"] || 0;
  const otherBal = Object.entries(buckets)
    .filter(([cc]) => cc !== "USD")
    .reduce((s, [cc, v]) => s + v * ctx.getConfigFx(cc), 0);
  return usdBal + otherBal;
};

// Extended broker calculation that returns both the total and a line-by-line breakdown
export const calcBrokerDetail = (
  ctx: BrokerCalcContext,
  brokerId: number
): {
  total: number;
  breakdown: { label: string; native: string; usd: number }[];
} => {
  const groupIds = [brokerId, ...(ctx.brokerChildren.get(brokerId) || [])];
  const buckets: Record<string, number> = {};
  const add = (cc: string, amt: number) => {
    buckets[cc] = (buckets[cc] || 0) + amt;
  };
  const lines: { label: string; native: string; usd: number }[] = [];

  // Opening balances
  let obTotal = 0;
  for (const s of ctx.suppliersList as any[]) {
    if (!groupIds.includes(s.id)) continue;
    const ob = parseFloat(s.openingBalance || "0");
    if (ob !== 0) {
      add("USD", ob);
      obTotal += ob;
    }
  }
  if (obTotal !== 0) lines.push({ label: "Opening Balance", native: `$${obTotal.toFixed(2)}`, usd: obTotal });

  // Containers: goods + freight per currency + USD commission from children
  // Always use totalKg (declared/agreed weight) — weight differences at offload affect
  // inventory only, not what is owed to the supplier. Matches buildBrokerStatement.
  const containersByCurrency: Record<string, number> = {};
  let commTotal = 0;
  let usdFreightTotal = 0;
  for (const c of ctx.allContainersF as any[]) {
    if (!groupIds.includes(c.supplierId)) continue;
    const cc = c.currencyCode || "USD";
    const kg = parseFloat(c.totalKg || "0");
    const rate = parseFloat(c.ratePerKg || "0");
    const goodsAmt = kg * rate;
    add(cc, goodsAmt);
    containersByCurrency[cc] = (containersByCurrency[cc] || 0) + goodsAmt;

    const freight = parseFloat(c.freight || "0");
    const freightCc = c.freightCurrencyCode || cc;
    if (freight > 0) {
      add(freightCc, freight);
      containersByCurrency[freightCc] = (containersByCurrency[freightCc] || 0) + freight;
    }

    // Commission: include when this container's commission is designated for the broker.
    // Matches buildBrokerStatement: commissionSupplierId === brokerId OR null (default).
    const commSupplierId = c.commissionSupplierId ?? null;
    const commForBroker = commSupplierId === brokerId || commSupplierId === null;
    if (c.supplierId !== brokerId && commForBroker) {
      const commAmt = parseFloat(c.commissionAmount || "0");
      if (commAmt > 0 && (c.commissionCurrencyCode || "USD") === "USD") {
        add("USD", commAmt);
        commTotal += commAmt;
        usdFreightTotal += 0;
      }
    }
  }
  for (const [cc, amt] of Object.entries(containersByCurrency)) {
    if (Math.abs(amt) > 0.01)
      lines.push({
        label: `Container Goods + Freight (${cc})`,
        native: `${amt.toFixed(2)} ${cc}`,
        usd: cc === "USD" ? amt : 0,
      });
  }
  if (commTotal > 0)
    lines.push({ label: "Commission from Linked Suppliers", native: `$${commTotal.toFixed(2)}`, usd: commTotal });

  // Offload additional charges (match buildBrokerStatement)
  const offloadByCurrency: Record<string, number> = {};
  for (const oc of ctx.allOffloadChargesF as any[]) {
    if (!groupIds.includes(oc.supplierId)) continue;
    const cc = oc.currencyCode || "USD";
    const amt = parseFloat(oc.amount || "0");
    add(cc, amt);
    offloadByCurrency[cc] = (offloadByCurrency[cc] || 0) + amt;
  }
  for (const [cc, amt] of Object.entries(offloadByCurrency)) {
    if (amt > 0.01)
      lines.push({
        label: `Offload Additional Charges (${cc})`,
        native: `${amt.toFixed(2)} ${cc}`,
        usd: cc === "USD" ? amt : 0,
      });
  }

  // Container other charges table (linked via containerId → supplierId)
  const containerOcByCurrency: Record<string, number> = {};
  for (const oc of ctx.allContainerOtherChargesF as any[]) {
    if (!groupIds.includes(oc.supplierId)) continue;
    const cc = oc.currencyCode || oc.containerCurrencyCode || "USD";
    const amt = parseFloat(oc.amount || "0");
    add(cc, amt);
    containerOcByCurrency[cc] = (containerOcByCurrency[cc] || 0) + amt;
  }
  for (const [cc, amt] of Object.entries(containerOcByCurrency)) {
    if (amt > 0.01)
      lines.push({
        label: `Container Other Charges (${cc})`,
        native: `${amt.toFixed(2)} ${cc}`,
        usd: cc === "USD" ? amt : 0,
      });
  }

  // Container column other_charges (otherChargesSupplierId in group)
  const colOcByCurrency: Record<string, number> = {};
  for (const oc of ctx.allColOtherChargesF as any[]) {
    if (!groupIds.includes(oc.otherChargesSupplierId)) continue;
    const cc = oc.otherChargesCurrencyCode || "USD";
    const amt = parseFloat(oc.otherCharges || "0");
    add(cc, amt);
    colOcByCurrency[cc] = (colOcByCurrency[cc] || 0) + amt;
  }
  for (const [cc, amt] of Object.entries(colOcByCurrency)) {
    if (amt > 0.01)
      lines.push({
        label: `Other Charges — Column (${cc})`,
        native: `${amt.toFixed(2)} ${cc}`,
        usd: cc === "USD" ? amt : 0,
      });
  }

  // Direct payments
  const payTotal: Record<string, number> = {};
  for (const p of ctx.allPaymentsF as any[]) {
    if (!groupIds.includes(p.supplierId)) continue;
    const cc = p.currencyCode || "USD";
    const amt = parseFloat(p.amount || "0");
    add(cc, -amt);
    payTotal[cc] = (payTotal[cc] || 0) + amt;
  }
  for (const [cc, amt] of Object.entries(payTotal)) {
    if (amt > 0.01)
      lines.push({
        label: `Payments Made (${cc})`,
        native: `-${amt.toFixed(2)} ${cc}`,
        usd: cc === "USD" ? -amt : 0,
      });
  }

  // Voucher payments
  const voucherTotals: Record<string, number> = {};
  for (const sid of groupIds) {
    const currMap = ctx.voucherPaidByCurrencyBySupplierId[sid] || {};
    for (const [cc, amt] of Object.entries(currMap)) {
      add(cc, -amt);
      voucherTotals[cc] = (voucherTotals[cc] || 0) + amt;
    }
  }
  for (const [cc, amt] of Object.entries(voucherTotals)) {
    if (amt > 0.01)
      lines.push({
        label: `Voucher Payments (${cc})`,
        native: `-${amt.toFixed(2)} ${cc}`,
        usd: cc === "USD" ? -amt : 0,
      });
  }

  // FX transfers
  let fxInTotal = 0;
  let fxOutUsd = 0;
  const fxOutNative: Record<string, number> = {};
  for (const t of ctx.allFxTransfersF as any[]) {
    const fromCc = t.fromCurrencyCode || "USD";
    const fromAmt = parseFloat(t.fromAmount || "0");
    const toUsd = parseFloat(t.toAmountUsd || "0");
    const isFromBroker = t.fromSupplierId === brokerId;
    if (groupIds.includes(t.fromSupplierId) && fromCc !== "USD") {
      add(fromCc, -fromAmt);
      fxOutNative[fromCc] = (fxOutNative[fromCc] || 0) + fromAmt;
    }
    if (t.toSupplierId === brokerId) {
      add("USD", toUsd);
      fxInTotal += toUsd;
    }
    if (isFromBroker && fromCc === "USD") {
      add("USD", -fromAmt);
      fxOutUsd += fromAmt;
    }
  }
  if (fxInTotal > 0) lines.push({ label: "FX Received (USD)", native: `$${fxInTotal.toFixed(2)}`, usd: fxInTotal });
  if (fxOutUsd > 0) lines.push({ label: "FX Sent Out (USD)", native: `-$${fxOutUsd.toFixed(2)}`, usd: -fxOutUsd });
  for (const [cc, amt] of Object.entries(fxOutNative)) {
    if (amt > 0.01) lines.push({ label: `FX Converted Out (${cc})`, native: `-${amt.toFixed(2)} ${cc}`, usd: 0 });
  }

  const usdBal = buckets["USD"] || 0;
  const nonUsdEntries = Object.entries(buckets).filter(([cc]) => cc !== "USD");
  let nonUsdTotal = 0;
  for (const [cc, val] of nonUsdEntries) {
    if (Math.abs(val) > 0.01) {
      const fx = ctx.getConfigFx(cc);
      lines.push({
        label: `${cc} Net Balance × ${fx.toFixed(4)}`,
        native: `${val.toFixed(2)} ${cc}`,
        usd: val * fx,
      });
      nonUsdTotal += val * fx;
    }
  }
  lines.push({ label: "USD Net Balance", native: `$${usdBal.toFixed(2)}`, usd: usdBal });

  const total = usdBal + nonUsdTotal;
  return { total, breakdown: lines };
};
