import fs from "fs";
import path from "path";
import {
  parseFactoryCatalogLanguage,
  resolveFactoryProductName,
  type FactoryCatalogLanguage,
} from "@shared/factoryBilingualContract";

export type FactoryDocumentLanguage = FactoryCatalogLanguage;

export const FACTORY_DOCUMENT_LABELS = {
  en: {
    invoice: "INVOICE",
    commercialInvoice: "Commercial Invoice",
    loadingList: "Loading List",
    invoiceNo: "Invoice No.",
    customer: "Customer",
    date: "Date",
    container: "Container",
    destination: "Destination",
    articleCode: "Article Code",
    product: "Product",
    quantity: "Qty",
    weightPerBale: "Wt/Bale",
    totalWeight: "Total Wt",
    pricePerBale: "Price/Bale",
    pricePerKg: "Price/KG",
    total: "Total",
    totals: "Totals",
    subtotal: "Subtotal",
    freight: "Freight",
    otherCharges: "Other Charges",
    grandTotal: "Grand Total",
    notes: "Notes",
    reference: "Ref Code",
    weightKg: "Weight (kg)",
    cumulativeWeight: "Total Weight (kg)",
    status: "Status",
  },
  ar: {
    invoice: "فاتورة",
    commercialInvoice: "فاتورة تجارية",
    loadingList: "قائمة التحميل",
    invoiceNo: "رقم الفاتورة",
    customer: "العميل",
    date: "التاريخ",
    container: "الحاوية",
    destination: "الوجهة",
    articleCode: "رمز الصنف",
    product: "المنتج",
    quantity: "الكمية",
    weightPerBale: "وزن البالة",
    totalWeight: "الوزن الإجمالي",
    pricePerBale: "سعر البالة",
    pricePerKg: "سعر الكيلو",
    total: "الإجمالي",
    totals: "الإجماليات",
    subtotal: "المجموع الفرعي",
    freight: "الشحن",
    otherCharges: "رسوم أخرى",
    grandTotal: "المجموع الكلي",
    notes: "ملاحظات",
    reference: "المرجع",
    weightKg: "الوزن (كغ)",
    cumulativeWeight: "الوزن التراكمي (كغ)",
    status: "الحالة",
  },
} as const;

export function parseFactoryDocumentLanguage(value: unknown): FactoryDocumentLanguage {
  return parseFactoryCatalogLanguage(value, "en");
}

export function isArabicFactoryDocument(language: FactoryDocumentLanguage): boolean {
  return language === "ar";
}

export function resolveFactoryDocumentProductName(
  source: {
    articleCode?: string | null;
    baleName?: string | null;
    baleNameAr?: string | null;
    productName?: string | null;
    productNameAr?: string | null;
    name?: string | null;
    nameAr?: string | null;
  },
  language: FactoryDocumentLanguage
): string {
  const englishSnapshot = source.baleName ?? source.productName ?? source.name ?? null;
  const arabicSnapshot = source.baleNameAr ?? source.productNameAr ?? source.nameAr ?? null;
  return resolveFactoryProductName(
    {
      articleCode: source.articleCode,
      name: englishSnapshot,
      nameAr: arabicSnapshot,
    },
    language
  );
}

export function translateFactoryDocumentStatus(status: unknown, language: FactoryDocumentLanguage): string {
  const raw = typeof status === "string" ? status : "";
  if (language !== "ar") return raw.replaceAll("_", " ");
  const map: Record<string, string> = {
    DRAFT: "مسودة",
    PENDING: "قيد الانتظار",
    PENDING_LOADING: "بانتظار التحميل",
    LOADING: "قيد التحميل",
    LOADED: "تم التحميل",
    VERIFIED: "تم التحقق",
    FINALIZED: "نهائي",
    COMPLETED: "مكتمل",
    INVOICED: "تمت الفوترة",
    CANCELLED: "ملغى",
    DISPATCHED: "تم الإرسال",
  };
  return map[raw.toUpperCase()] ?? raw.replaceAll("_", " ");
}

export function configureFactoryArabicWorksheet(sheet: any, language: FactoryDocumentLanguage): void {
  if (language !== "ar") return;
  sheet.views = [{ rightToLeft: true, showGridLines: false }];
  sheet.eachRow((row: any) => {
    row.eachCell((cell: any) => {
      cell.alignment = {
        ...(cell.alignment ?? {}),
        horizontal: typeof cell.value === "number" ? "right" : "right",
        readingOrder: "rtl",
        vertical: cell.alignment?.vertical ?? "middle",
      };
    });
  });
}

export function findArabicPdfFont(): string | null {
  const candidates = [
    path.join(process.cwd(), "server", "fonts", "NotoNaskhArabic-Regular.ttf"),
    path.join(process.cwd(), "server", "fonts", "NotoSansArabic-Regular.ttf"),
    path.join(process.cwd(), "assets", "fonts", "NotoNaskhArabic-Regular.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function applyFactoryPdfLanguage(doc: any, language: FactoryDocumentLanguage): void {
  if (language !== "ar") return;
  const font = findArabicPdfFont();
  if (font) doc.font(font);
}
