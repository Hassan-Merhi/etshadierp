/**
 * Search matching for factory bale products across English, Arabic and French names.
 *
 * Arabic needs more than `toLowerCase()`: the same word is commonly written with
 * different alef/yeh/teh-marbuta forms, with or without diacritics, and operators
 * type both ASCII and Arabic-Indic digits. Normalising both sides of the comparison
 * keeps a search for "كيس كريمي" matching a stored "كِيس كريمى".
 */

const ARABIC_DIACRITICS = /[ً-ْٰـ]/g;
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

export function normalizeProductSearchText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .replace(ARABIC_DIACRITICS, "")
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) & 0x0f))
    .replace(/[آأإٱ]/g, "ا") // alef variants → bare alef
    .replace(/ى/g, "ي") // alef maksura → yeh
    .replace(/ة/g, "ه") // teh marbuta → heh
    .replace(/ؤ/g, "و") // waw hamza → waw
    .replace(/ئ/g, "ي") // yeh hamza → yeh
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface SearchableFactoryProduct {
  name?: string | null;
  nameAr?: string | null;
  nameFr?: string | null;
  articleCode?: string | null;
  code?: string | null;
}

/**
 * True when the product matches the term in any supported language, or by code.
 * An empty term matches everything so callers can pass raw input straight through.
 */
export function productMatchesSearch(product: SearchableFactoryProduct, term: string): boolean {
  const needle = normalizeProductSearchText(term);
  if (!needle) return true;
  return [product.articleCode, product.code, product.name, product.nameAr, product.nameFr].some((field) =>
    normalizeProductSearchText(field).includes(needle)
  );
}
