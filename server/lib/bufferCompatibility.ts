/**
 * Copy Node or library-owned binary data into a standalone ArrayBuffer.
 *
 * TypeScript 6 and Node 26 distinguish ArrayBuffer-backed views from views
 * backed by the wider ArrayBufferLike type. ExcelJS 3 and the Fetch BodyInit
 * declarations require an owned ArrayBuffer at these integration boundaries.
 */
export function toArrayBuffer(bytes: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
