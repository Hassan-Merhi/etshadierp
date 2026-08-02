/**
 * LabelPreviewCard — extracted sub-component.
 *
 * Extracted from FactoryBaleRelabeling.tsx during the Phase 4 god-file split.
 */
import { useLabelDesignColors } from "@/hooks/useLabelDesignColors";

import type { LabelPreviewCardProps } from "../types";
import { useFactoryText } from "@/i18n/modules/factory";

export function LabelPreviewCard({ item, designColor, printFormat }: LabelPreviewCardProps) {
  const tUi = useFactoryText();
  const { colors } = useLabelDesignColors();
  const colorOpt = colors.find((o) => o.value === designColor);
  const accentColor = colorOpt?.color ?? "#6d28d9";

  if (printFormat === "STICKER") {
    return (
      <div
        className="rounded-md border bg-white text-black overflow-hidden shrink-0"
        style={{
          width: "3in",
          minWidth: "3in",
          height: "1.97in",
          padding: "3mm 4mm",
          fontFamily: "Arial, Helvetica, sans-serif",
          display: "flex",
          flexDirection: "column",
          gap: "1mm",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div style={{ fontSize: "11pt", fontWeight: 900, letterSpacing: "1px" }}>HMD</div>
          <div style={{ textAlign: "right", fontSize: "7pt", lineHeight: 1.3 }}>
            <div>
              <strong>{tUi("pieces")}</strong> 1
            </div>
            <div>
              <strong>{tUi("article.2")}</strong> {item.articleCode || "—"}
            </div>
            <div>
              <strong>{tUi("aprx.weight")}</strong> {parseFloat(item.weightKg || "0").toFixed(1)} KGS
            </div>
          </div>
        </div>
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
        >
          <img
            src={`/api/barcode/${encodeURIComponent(item.newRef)}`}
            alt="barcode"
            style={{ width: "100%", height: "11mm", objectFit: "fill" }}
          />
          <div style={{ fontSize: "11pt", fontWeight: 900, letterSpacing: "2px", marginTop: "0.5mm" }}>
            {item.newRef}
          </div>
        </div>
        <div
          style={{
            textAlign: "center",
            fontSize: "7pt",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            flexShrink: 0,
          }}
        >
          {item.productName}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border bg-white text-black overflow-hidden shrink-0"
      style={{ width: "220px", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <div
        style={{
          background: accentColor,
          color: "#fff",
          padding: "6px 10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "10pt", fontWeight: 900, letterSpacing: "1px" }}>HMD</span>
        <span style={{ fontSize: "7pt", fontWeight: 700, opacity: 0.9 }}>{printFormat}</span>
      </div>
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "7pt", lineHeight: 1.4 }}>
          <div>
            <strong>{tUi("pieces")}</strong> 1
          </div>
          <div>
            <strong>{tUi("article.2")}</strong> {item.articleCode || "—"}
          </div>
          <div>
            <strong>{tUi("weight.2")}</strong> {parseFloat(item.weightKg || "0").toFixed(1)} KGS
          </div>
        </div>
        <div style={{ textAlign: "center", borderTop: "1px solid #eee", paddingTop: "4px" }}>
          <img
            src={`/api/barcode/${encodeURIComponent(item.newRef)}`}
            alt="barcode"
            style={{ width: "100%", height: "32px", objectFit: "fill" }}
          />
          <div style={{ fontSize: "9pt", fontWeight: 900, letterSpacing: "2px", marginTop: "2px" }}>{item.newRef}</div>
        </div>
        <div
          style={{
            textAlign: "center",
            fontSize: "7pt",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "#333",
            borderTop: "1px solid #eee",
            paddingTop: "4px",
          }}
        >
          {item.productName}
        </div>
      </div>
    </div>
  );
}
