import fs from "fs";

export type ExportAttachmentSource =
  | Buffer
  | {
      filePath: string;
      sizeBytes: number;
    };

export function isFileExportAttachment(
  source: ExportAttachmentSource
): source is { filePath: string; sizeBytes: number } {
  return !Buffer.isBuffer(source);
}

export function getExportAttachmentSize(source: ExportAttachmentSource): number {
  return Buffer.isBuffer(source) ? source.length : source.sizeBytes;
}

export function toNodemailerAttachment(
  source: ExportAttachmentSource,
  filename: string,
  contentType: string
): { filename: string; contentType: string; content?: Buffer; path?: string } {
  if (Buffer.isBuffer(source)) {
    return { filename, contentType, content: source };
  }

  return { filename, contentType, path: source.filePath };
}

export async function readExportAttachmentBuffer(source: ExportAttachmentSource): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return source;
  return fs.promises.readFile(source.filePath);
}

export async function assertExportAttachmentAvailable(source: ExportAttachmentSource): Promise<void> {
  if (Buffer.isBuffer(source)) {
    if (source.length <= 0) throw new Error("Export attachment is empty");
    return;
  }

  const stat = await fs.promises.stat(source.filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Export attachment file is unavailable or empty");
  if (stat.size !== source.sizeBytes) {
    throw new Error(`Export attachment size changed unexpectedly (${source.sizeBytes} expected, ${stat.size} found)`);
  }
}
