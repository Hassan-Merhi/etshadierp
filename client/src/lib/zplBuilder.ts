export interface ZplLabelData {
  referenceNumber: string;
  articleCode: string;
  pieces: number | string;
  approxWeightKg: number | string;
  productName: string;
}

function formatNum(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return n % 1 === 0 ? n.toFixed(0) : parseFloat(n.toFixed(3)).toString();
}

export function buildZplLabel(label: ZplLabelData): string {
  const pieces = formatNum(label.pieces);
  const weight = formatNum(label.approxWeightKg);
  const name = (label.productName || "").toUpperCase().substring(0, 40);
  const ref = label.referenceNumber || "";
  const article = label.articleCode || "";

  return [
    "^XA",
    "^MD30",
    "^PR3",
    "^PW609",
    "^LL495",
    "^LH0,0",
    "^CI28",

    "^FO20,20^A0N,32,32^FD" + name + "^FS",

    "^FO20,70^A0N,22,22^FDPIECES: " + pieces + "^FS",
    "^FO20,100^A0N,22,22^FDARTICLE: " + article + "^FS",
    "^FO20,130^A0N,22,22^FDAPRX WEIGHT: " + weight + " KGS^FS",

    "^FO20,175^BY2,3,90^BCN,90,Y,N,N^FD" + ref + "^FS",

    "^FO20,300^BY2,2,60^BCN,60,Y,N,N^FD" + article + "^FS",

    "^FO20,420^A0N,28,28^FD" + name + "^FS",

    "^XZ",
  ].join("\n");
}

export function buildZplNameOnlyLabel(productName: string): string {
  const name = (productName || "").toUpperCase().substring(0, 40);

  return [
    "^XA",
    "^MD30",
    "^PR3",
    "^PW609",
    "^LL495",
    "^LH0,0",
    "^CI28",

    "^FO30,180^A0N,60,60^FD" + name + "^FS",

    "^XZ",
  ].join("\n");
}

export function buildZplTestLabel(): string {
  return [
    "^XA",
    "^MD30",
    "^PR3",
    "^PW609",
    "^LL495",
    "^LH0,0",
    "^CI28",

    "^FO20,20^A0N,36,36^FDZEBRA DARKNESS TEST^FS",
    "^FO20,70^A0N,24,24^FDMD30 / PR3 ACTIVE^FS",

    "^FO20,120^BY2,3,80^BCN,80,Y,N,N^FDTEST123456^FS",

    "^FO20,260^A0N,20,20^FDIf this prints DARK, config is correct.^FS",
    "^FO20,290^A0N,20,20^FDIf light, increase MD value or check ribbon.^FS",

    "^FO20,340^GB560,0,3^FS",
    "^FO20,360^A0N,18,18^FDDarkness: ^MD30 | Speed: ^PR3^FS",

    "^XZ",
  ].join("\n");
}

export function buildZplBatch(labels: ZplLabelData[], dualLabel: boolean): string {
  const zplParts: string[] = [];
  for (const label of labels) {
    zplParts.push(buildZplLabel(label));
    if (dualLabel) {
      zplParts.push(buildZplNameOnlyLabel(label.productName));
    }
  }
  return zplParts.join("\n");
}
