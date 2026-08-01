import JSZip from "jszip";

export async function isXlsxCellLocked(
  buffer: Buffer,
  address: string,
  sheetPath = "xl/worksheets/sheet1.xml"
): Promise<boolean> {
  if (!/^[A-Z]+[1-9]\d*$/.test(address)) {
    throw new Error(`Invalid XLSX cell address: ${address}`);
  }

  const zip = await JSZip.loadAsync(buffer);
  const sheetFile = zip.file(sheetPath);
  const stylesFile = zip.file("xl/styles.xml");
  if (!sheetFile || !stylesFile) {
    throw new Error("Workbook protection XML is missing");
  }

  const sheetXml = await sheetFile.async("string");
  const stylesXml = await stylesFile.async("string");
  const cellTag = sheetXml.match(
    new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>`)
  )?.[0];
  if (!cellTag) throw new Error(`Workbook cell ${address} is missing`);

  const styleMatch = cellTag.match(/\bs="(\d+)"/);
  if (!styleMatch) return true;

  const cellXfs = stylesXml.match(
    /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/
  )?.[1];
  if (!cellXfs) return true;

  const styles = cellXfs.match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
  const style = styles[Number(styleMatch[1])];
  if (!style) return true;

  return !/<protection\b[^>]*locked="0"/.test(style);
}
