import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/**
 * Captures a DOM element as a PDF and returns the base64-encoded PDF string.
 * Works with off-screen elements (position:fixed at negative coords).
 * Does NOT work with display:none or visibility:hidden elements.
 */
export async function captureElementToPdf(
  element: HTMLElement,
  opts?: { scale?: number; pageWidth?: number }
): Promise<string> {
  const scale = opts?.scale ?? 2;

  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    allowTaint: true,
  });

  const imgW = canvas.width / scale;
  const imgH = canvas.height / scale;

  const A4_W = 595.28;
  const A4_H = 841.89;
  const ratio = Math.min(A4_W / imgW, A4_H / imgH, 1);
  const pdfW = imgW * ratio;
  const pdfH = imgH * ratio;

  const pdf = new jsPDF({
    orientation: pdfH > pdfW ? "portrait" : "landscape",
    unit: "pt",
    format: [pdfW, pdfH],
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  pdf.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);

  return pdf.output("datauristring").split(",")[1];
}
