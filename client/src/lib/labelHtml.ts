const HMD_LOGO_BASE64 = 'data:image/png;base64,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';

export function formatLabelNum(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return n % 1 === 0 ? n.toFixed(0) : parseFloat(n.toFixed(3)).toString();
}

export type LabelData = {
  referenceNumber: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
};

function buildDetailBlock(label: LabelData) {
  return `<div class="code-label">
    <div class="label-top">
      <div class="logo-section">
        <img class="logo-img" src="${HMD_LOGO_BASE64}" alt="HMD" />
      </div>
      <div class="info-section">
        <div class="info-row"><span class="info-key">PIECES:</span> <span class="info-val">${formatLabelNum(label.pieces)}</span></div>
        <div class="info-row"><span class="info-key">ARTICLE:</span> <span class="info-val">${label.articleCode}</span></div>
        <div class="info-row"><span class="info-key">APRX WEIGHT:</span> <span class="info-val">${formatLabelNum(label.approxWeightKg)} KGS</span></div>
      </div>
    </div>
    <div class="barcode-area">
      <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.referenceNumber)}" alt="Barcode" />
      <div class="barcode-number">${label.referenceNumber}</div>
    </div>
    <div class="article-barcode-area">
      <img class="article-barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
      <div class="article-barcode-number">${label.productName}</div>
    </div>
  </div>`;
}

export function generateCombinedLabelsHtml(labels: LabelData[]) {
  let labelsHtml = '';
  for (const label of labels) {
    labelsHtml += `
      <div class="a4-page">
        <div class="a4-top-half">
          <div class="a4-top-preprint-gap"></div>
          <div class="a4-top-content">
            <div class="a4-detail-left">
              ${buildDetailBlock(label)}
            </div>
            <div class="a4-name-right">
              <div class="a4-name-right-text">${label.productName}</div>
            </div>
          </div>
        </div>
        <div class="a4-bottom-half">
          <div class="a4-bottom-preprint-gap"></div>
          <div class="a4-bottom-namebox">
            <div class="a4-bottom-name-text">${label.productName}</div>
          </div>
        </div>
      </div>`;
  }
  return `<html><head><title>Stock Entry Labels - A4</title><style>
    @page { size: 210mm 297mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }

    .code-label { width: 76mm; height: 58.5mm; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: flex-start; gap: 1mm; background: #fff; overflow: hidden; }
    .label-top { display: flex; justify-content: space-between; align-items: center; }
    .logo-section { flex-shrink: 0; }
    .logo-img { height: 14mm; width: auto; object-fit: contain; display: block; }
    .info-section { text-align: right; font-size: 8pt; line-height: 1.4; }
    .info-key { font-weight: 900; }
    .info-val { font-weight: 900; }
    .barcode-area { text-align: center; margin-top: 1mm; }
    .barcode-img { width: 100%; height: 14mm; object-fit: fill; }
    .barcode-number { font-size: 14pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 1mm; letter-spacing: 2px; text-transform: uppercase; -webkit-text-stroke: 0.5px #000; }
    .article-barcode-area { text-align: center; margin-top: 1mm; border-top: 0.3mm dashed #ccc; padding-top: 1mm; }
    .article-barcode-img { width: 100%; height: 14mm; object-fit: fill; }
    .article-barcode-number { font-size: 12pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 0.5mm; letter-spacing: 1.5px; text-transform: uppercase; color: #000; text-align: center; }

    .a4-page { width: 210mm; height: 297mm; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; display: flex; flex-direction: column; background: #fff; }
    .a4-page:last-child { page-break-after: auto; }

    .a4-top-half { height: 148.5mm; flex-shrink: 0; overflow: hidden; display: flex; flex-direction: column; }
    .a4-top-preprint-gap { height: 90mm; flex-shrink: 0; }
    .a4-top-content { height: 58.5mm; flex-shrink: 0; display: flex; flex-direction: row; gap: 6mm; align-items: flex-start; padding: 0 10mm; }
    .a4-detail-left { flex-shrink: 0; width: 76mm; max-height: 58.5mm; overflow: hidden; border: 0.3mm solid #ccc; }
    .a4-name-right { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; height: 58.5mm; }
    .a4-name-right-text { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; overflow: hidden; font-size: clamp(18pt, 3.5vw, 36pt); line-height: 1.15; color: #000; word-break: break-word; }

    .a4-bottom-half { height: 148.5mm; flex-shrink: 0; overflow: hidden; display: flex; flex-direction: column; }
    .a4-bottom-preprint-gap { height: 90mm; flex-shrink: 0; }
    .a4-bottom-namebox { height: 58.5mm; width: 100%; display: flex; align-items: center; justify-content: center; padding: 0 10mm; }
    .a4-bottom-name-text { width: 100%; text-align: center; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; overflow: hidden; font-size: clamp(28pt, 6vw, 56pt); line-height: 1.15; color: #000; word-break: break-word; }

    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print {
      .print-note { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      * { color: #000 !important; }
      .info-key, .info-val, .barcode-number, .article-barcode-number { -webkit-text-stroke: 0.3px #000; }
      .a4-name-right-text, .a4-bottom-name-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
      img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
    }
  </style></head><body><div class="print-note">A4 Bale Labels. Set printer to BEST quality, max darkness. Disable "Headers and Footers".</div>${labelsHtml}</body></html>`;
}

export function generateA5LabelsHtml(labels: LabelData[]) {
  let labelsHtml = '';
  for (const label of labels) {
    labelsHtml += `
      <div class="a5-page a5-page1">
        <div class="a5-top-content">
          <div class="a5-detail-left">
            ${buildDetailBlock(label)}
          </div>
          <div class="a5-name-right">
            <div class="a5-name-right-text">${label.productName}</div>
          </div>
        </div>
      </div>
      <div class="a5-page a5-page2">
        <div class="a5-bottom-namebox">
          <div class="a5-bottom-name-text">${label.productName}</div>
        </div>
      </div>`;
  }
  return `<html><head><title>Stock Entry Labels - A5</title><style>
    @page { size: 148mm 210mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }

    .code-label { width: 62mm; padding: 2mm 2mm; display: flex; flex-direction: column; justify-content: flex-start; gap: 1mm; background: #fff; overflow: hidden; }
    .label-top { display: flex; justify-content: space-between; align-items: center; }
    .logo-section { flex-shrink: 0; }
    .logo-img { height: 12mm; width: auto; object-fit: contain; display: block; }
    .info-section { text-align: right; font-size: 7pt; line-height: 1.4; }
    .info-key { font-weight: 900; }
    .info-val { font-weight: 900; }
    .barcode-area { text-align: center; margin-top: 1mm; }
    .barcode-img { width: 100%; height: 12mm; object-fit: fill; }
    .barcode-number { font-size: 11pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 0.5mm; letter-spacing: 1.5px; text-transform: uppercase; -webkit-text-stroke: 0.5px #000; }
    .article-barcode-area { text-align: center; margin-top: 1mm; border-top: 0.3mm dashed #ccc; padding-top: 1mm; }
    .article-barcode-img { width: 100%; height: 12mm; object-fit: fill; }
    .article-barcode-number { font-size: 9pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 0.3mm; letter-spacing: 1px; text-transform: uppercase; color: #000; text-align: center; }

    .a5-page { width: 148mm; height: 210mm; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; display: flex; flex-direction: column; background: #fff; }
    .a5-page:last-child { page-break-after: auto; }
    .a5-page1 { padding-top: 80mm; }
    .a5-page2 { padding-top: 10mm; }

    .a5-top-content { flex: none; display: flex; flex-direction: row; gap: 4mm; align-items: stretch; padding: 2mm 5mm; }
    .a5-detail-left { flex-shrink: 0; width: 62mm; border: 0.3mm solid #ccc; }
    .a5-name-right { flex: 1; display: flex; align-items: center; justify-content: center; padding: 2mm 2mm; }
    .a5-name-right-text { width: 100%; display: flex; align-items: center; justify-content: center; text-align: center; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; font-size: clamp(14pt, 3.5vw, 26pt); line-height: 1.15; color: #000; word-break: break-word; }

    .a5-bottom-namebox { flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; padding: 0 5mm; }
    .a5-bottom-name-text { width: 100%; text-align: center; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; overflow: hidden; font-size: clamp(22pt, 5vw, 42pt); line-height: 1.15; color: #000; word-break: break-word; }

    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print {
      .print-note { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      * { color: #000 !important; }
      .info-key, .info-val, .barcode-number, .article-barcode-number { -webkit-text-stroke: 0.3px #000; }
      .a5-name-right-text, .a5-bottom-name-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
      img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
    }
  </style></head><body><div class="print-note">A5 Bale Labels (preprinted paper). Select A5 paper, Portrait, 100% scale. Set BEST quality, max darkness. Disable "Headers and Footers".</div>${labelsHtml}</body></html>`;
}

export function generateStickerLabelsHtml(labels: LabelData[]) {
  let labelsHtml = '';
  for (const label of labels) {
    labelsHtml += `
      <div class="sticker-page">
        <div class="label">
          <div class="label-content">
            <div class="label-top">
              <div class="logo-section">
                <img class="sticker-logo" src="${HMD_LOGO_BASE64}" alt="HMD" />
              </div>
              <div class="info-section">
                <div><span class="info-label">PIECES:</span> <span class="info-value">${formatLabelNum(label.pieces)}</span></div>
                <div><span class="info-label">ARTICLE:</span> <span class="info-value">${label.articleCode}</span></div>
                <div><span class="info-label">APRX WEIGHT:</span> <span class="info-value">${formatLabelNum(label.approxWeightKg)} KGS</span></div>
              </div>
            </div>
            <div class="ref-barcode-section">
              <img class="ref-barcode-img" src="/api/barcode/${encodeURIComponent(label.referenceNumber)}" alt="Barcode" />
              <div class="ref-barcode-number">${label.referenceNumber}</div>
            </div>
            <div class="article-barcode-section">
              <img class="article-barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
            </div>
            <div class="product-section">
              <div class="product-name-text">${label.productName}</div>
            </div>
          </div>
        </div>
      </div>`;
  }
  return `<html><head><title>Sticker Labels</title><style>
    @page { size: 3in 1.97in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    .sticker-page { width: 3in; height: 1.97in; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
    .sticker-page:last-child { page-break-after: auto; }
    .label { width: 3in; height: 1.97in; padding: 1.5mm 3mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; position: relative; background: #fff; }
    .label-content { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: flex-start; gap: 0.5mm; height: 100%; }
    .label-top { display: flex; justify-content: space-between; align-items: center; }
    .logo-section { flex-shrink: 0; }
    .sticker-logo { height: 10mm; width: auto; object-fit: contain; display: block; }
    .info-section { text-align: right; font-size: 8pt; line-height: 1.3; }
    .info-label { font-weight: 900; }
    .info-value { font-weight: 900; }
    .ref-barcode-section { text-align: center; }
    .ref-barcode-img { width: 100%; height: 9mm; object-fit: fill; }
    .ref-barcode-number { font-size: 12pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 0.5mm; letter-spacing: 2px; text-transform: uppercase; -webkit-text-stroke: 0.5px #000; }
    .article-barcode-section { text-align: center; }
    .article-barcode-img { width: 100%; height: 9mm; object-fit: fill; }
    .product-section { text-align: center; border-top: 0.3mm dashed #ccc; padding-top: 0.5mm; }
    .product-name-text { font-size: 8pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; color: #000; text-transform: uppercase; word-break: break-word; line-height: 1.1; }

    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print {
      .print-note { display: none !important; }
      * { color: #000 !important; }
      .info-label, .info-value, .ref-barcode-number { -webkit-text-stroke: 0.3px #000; }
      .product-name-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
      .ref-barcode-img, .article-barcode-img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
    }
  </style></head><body><div class="print-note">Sticker Labels. Set printer to BEST quality, max darkness. Disable "Headers and Footers".</div>${labelsHtml}</body></html>`;
}
