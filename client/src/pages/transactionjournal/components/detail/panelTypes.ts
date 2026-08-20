/**
 * Shared prop shape for the All Daybook voucher detail panels.
 *
 * `fmt` formats a money value through the currency context and `fmtNum`
 * formats a quantity — both are the exact helpers the original inline dialog
 * built, kept identical so amounts and quantities render unchanged.
 */
export interface DetailPanelFormatters {
  fmt: (v: number | string | null | undefined) => string;
  fmtNum: (v: number | string | null | undefined) => string;
}

export function createDetailFormatters(formatCashAmount: (n: number) => string): DetailPanelFormatters {
  return {
    fmt: (v) => {
      const n = typeof v === "number" ? v : parseFloat(v || "0");
      if (isNaN(n)) return "—";
      return formatCashAmount(n);
    },
    fmtNum: (v) => {
      const n = typeof v === "number" ? v : parseFloat(v || "0");
      if (isNaN(n)) return "0";
      return Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
    },
  };
}
