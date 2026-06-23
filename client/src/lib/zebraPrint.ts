const PRINT_MODE_KEY = "LABEL_PRINT_MODE";
const PRINTER_NAME_KEY = "LABEL_PRINTER_NAME";

export type PrintMode = "BROWSER" | "ZEBRA_RAW";

export function getPrintMode(): PrintMode {
  return (localStorage.getItem(PRINT_MODE_KEY) as PrintMode) || "BROWSER";
}

export function setPrintMode(mode: PrintMode) {
  localStorage.setItem(PRINT_MODE_KEY, mode);
}

export function getPrinterName(): string {
  return localStorage.getItem(PRINTER_NAME_KEY) || "";
}

export function setPrinterName(name: string) {
  localStorage.setItem(PRINTER_NAME_KEY, name);
}

let qzInstance: any = null;

async function loadQzTray(): Promise<any> {
  if ((window as any).qz) return (window as any).qz;

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/qz-tray@2/qz-tray.min.js";
    script.onload = () => {
      const qz = (window as any).qz;
      if (qz) {
        qz.security.setCertificatePromise(() => Promise.resolve(""));
        qz.security.setSignaturePromise(() => Promise.resolve(""));
        resolve(qz);
      } else {
        reject(new Error("QZ Tray library failed to load"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load QZ Tray script"));
    document.head.appendChild(script);
  });
}

async function getConnection(): Promise<any> {
  const qz = await loadQzTray();
  if (!qz.websocket.isActive()) {
    try {
      await qz.websocket.connect();
    } catch (err: any) {
      throw new Error(
        "Cannot connect to QZ Tray. Make sure QZ Tray is installed and running on this computer. " +
          "Download from https://qz.io/download/. Error: " +
          (err.message || err)
      );
    }
  }
  qzInstance = qz;
  return qz;
}

export async function listPrinters(): Promise<string[]> {
  const qz = await getConnection();
  return await qz.printers.find();
}

export async function printRawZpl(zplData: string, printerName?: string): Promise<void> {
  const qz = await getConnection();
  const printer = printerName || getPrinterName();

  if (!printer) {
    throw new Error("No Zebra printer selected. Go to Print Settings and select your label printer.");
  }

  const config = qz.configs.create(printer, {
    altPrinting: false,
  });

  const data = [{ type: "raw", format: "plain", data: zplData }];

  await qz.print(config, data);
}

export function isZebraMode(): boolean {
  return getPrintMode() === "ZEBRA_RAW";
}
