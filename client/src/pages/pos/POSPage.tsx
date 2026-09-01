import POSOriginal from "./POS";

// ── Router entry ────────────────────────────────────────────────────────────
// Supplier Partner and normal ERP companies share the exact same POS UI
// (POSOriginal); SP-specific stock sourcing and accounting are handled
// internally by that component based on selectedCompany.companyType.

export default function POSPage() {
  return <POSOriginal />;
}
