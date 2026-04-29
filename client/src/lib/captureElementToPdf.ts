import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/**
 * Captures a DOM element as a PDF and returns the base64-encoded string.
 *
 * Two modes:
 *  - Multi-page A4 (default): content taller than one A4 page is sliced into
 *    multiple A4 pages. May cut rows at slice boundaries.
 *  - Single-page (singlePage: true): creates ONE PDF page whose height exactly
 *    matches the rendered content at A4 width. No slicing, no cut-off text.
 *    Ideal for reports where content length is unknown (stock summaries etc.).
 *
 * Works with off-screen elements (position:fixed at negative coords).
 * Does NOT work with display:none or visibility:hidden elements.
 */
export async function captureElementToPdf(
  element: HTMLElement,
  opts?: { scale?: number; singlePage?: boolean }
): Promise<string> {
  const scale = opts?.scale ?? 2;
  const singlePage = opts?.singlePage ?? false;

  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    allowTaint: true,
  });

  const A4_W = 595.28; // pts

  // CSS-pixel dimensions of the captured content
  const imgW = canvas.width / scale;
  const imgH = canvas.height / scale;

  // Ratio that maps content width to A4 width (never upscale beyond original)
  const ratio = Math.min(A4_W / imgW, 1);
  const pdfH  = imgH * ratio;

  if (singlePage) {
    // One tall page sized to the content — no slicing, no cut-off rows
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: [A4_W, pdfH],
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(imgData, "JPEG", 0, 0, A4_W, pdfH);
    return pdf.output("datauristring").split(",")[1];
  }

  // ── Multi-page A4 mode ────────────────────────────────────────────────────
  const A4_H = 841.89; // pts
  const numPages = Math.max(1, Math.ceil(pdfH / A4_H));

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  for (let i = 0; i < numPages; i++) {
    if (i > 0) pdf.addPage("a4", "portrait");

    // Canvas pixels that correspond to one A4 page height
    const pxPerPage = (A4_H / ratio) * scale;
    const pxStart   = i * pxPerPage;
    const pxSliceH  = Math.min(pxPerPage, canvas.height - pxStart);

    if (pxSliceH <= 0) break;

    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width  = canvas.width;
    sliceCanvas.height = Math.ceil(pxSliceH);

    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) continue;

    ctx.drawImage(canvas, 0, -Math.floor(pxStart));

    const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.92);
    const pdfSliceH = (pxSliceH / scale) * ratio;

    pdf.addImage(sliceData, "JPEG", 0, 0, A4_W, pdfSliceH);
  }

  return pdf.output("datauristring").split(",")[1];
}
