export function colLetter(n: number): string {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
export function toUtcDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDays(d: Date, n: number): Date { return new Date(d.getTime() + n * 86_400_000); }
export function dateStr(d: Date): string { return d.toISOString().slice(0, 10); }
export function fmtDate(s: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [, m, dd] = s.split("-").map(Number);
  return `${dd}-${months[m-1]}`;
}
