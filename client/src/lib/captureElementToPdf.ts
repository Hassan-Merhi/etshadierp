import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/**
 * Captures a DOM element as a multi-page A4 PDF and returns the base64-encoded string.
 *
 * - Content taller than one A4 page is automatically paginated.
 * - Works with off-screen elements (position:fixed at negative coords).
 * - Does NOT work with display:none or visibility:hidden elements.
 */
export async function captureElementToPdf(
  element: HTMLElement,
  opts?: { scale?: number }
): Promise<string> {
  const scale = opts?.scale ?? 2;

  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    allowTaint: true,
  });

  const A4_W = 595.28; // pts
  const A4_H = 841.89; // pts

  // CSS-pixel dimensions of the captured content
  const imgW = canvas.width / scale;
  const imgH = canvas.height / scale;

  // Ratio that maps content width to A4 width (never upscale beyond original)
  const ratio = Math.min(A4_W / imgW, 1);

  // Total PDF height if the whole image were one tall strip
  const totalPdfH = imgH * ratio;

  // Number of A4 pages needed
  const numPages = Math.max(1, Math.ceil(totalPdfH / A4_H));

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  for (let i = 0; i < numPages; i++) {
    if (i > 0) pdf.addPage("a4", "portrait");

    // How many canvas pixels correspond to one A4 page in height
    const pxPerPage = (A4_H / ratio) * scale;
    const pxStart   = i * pxPerPage;
    const pxSliceH  = Math.min(pxPerPage, canvas.height - pxStart);

    if (pxSliceH <= 0) break;

    // Extract just this page's vertical slice into a temporary canvas
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width  = canvas.width;
    sliceCanvas.height = Math.ceil(pxSliceH);

    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) continue;

    // Shift the source canvas upward so the desired slice sits at y = 0
    ctx.drawImage(canvas, 0, -Math.floor(pxStart));

    const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.92);

    // PDF height for this slice — may be shorter on the last page
    const pdfSliceH = (pxSliceH / scale) * ratio;

    pdf.addImage(sliceData, "JPEG", 0, 0, A4_W, pdfSliceH);
  }

  return pdf.output("datauristring").split(",")[1];
}
