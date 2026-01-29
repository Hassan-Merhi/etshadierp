export type CurrencyCode = "USD" | "CDF";

/**
 * Format a number to remove unnecessary .00 decimals and add comma separators
 * @param num - The number to format
 * @param maxDecimals - Maximum decimal places to show (default 2)
 * @returns Formatted string with commas and smart decimals
 */
export function formatNumber(num: number, maxDecimals: number = 2): string {
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

/**
 * Format a currency value (removes .00 for whole numbers, adds commas)
 * @param num - The number to format
 * @returns Formatted string ready for currency display (add $ prefix separately)
 */
export function formatCurrency(num: number): string {
  return formatNumber(num, 2);
}

/**
 * Format a currency value with currency label
 * @param num - The number to format
 * @param currency - The currency code (USD or CDF)
 * @returns Formatted string with currency symbol/label
 */
export function formatCurrencyWithLabel(num: number | string, currency: CurrencyCode = "USD"): string {
  const numValue = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(numValue)) return "";
  
  if (currency === "USD") {
    return `$ ${numValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else {
    return `CDF ${numValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
}

/**
 * Format a percentage value (removes .00 for whole numbers)
 * @param num - The number to format
 * @returns Formatted string with % suffix
 */
export function formatPercent(num: number): string {
  return `${formatNumber(num, 2)}%`;
}
