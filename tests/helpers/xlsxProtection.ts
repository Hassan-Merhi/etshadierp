import JSZip from "jszip";

export async function isXlsxCellLocked(
  buffer: Buffer,
  address: string,
  sheetPath = "xl/worksheets/sheet1.xml"
): Promise<boolean> {
  const zip = await JSZip.loadAsync(buffer);
  const sheetXml = await zip.file(sheetPath)?.async("string");
  const stylesXml = await zip.file("xl/styles.xml")?.async("string");
  if (!sheetXml || !stylesXml) {
    throw new Error("Workbook protection XML is missing");
  }

  const escapedAddress = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cellTag = sheetXml.match(
    new RegExp(`<c\\b[^>]*\\br="${escapedAddress}"[^>]*>`)
  )?.[0];
  if (!cellTag) throw new Error(`Workbook cell ${address} is missing`);

  const styleId = Number(cellTag.match(/\bs="(\d+)"/)?.[1] ?? 0);
  const cellXfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1];
  if (!cellXfs) throw new Error("Workbook cell styles are missing");

  const styles = cellXfs.match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
  const style = styles[styleId];
  if (!style) throw new Error(`Workbook style ${styleId} is missing`);

  return !/<protection\b[^>]*locked="0"/.test(style);
}
