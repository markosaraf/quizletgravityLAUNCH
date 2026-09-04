/** Number formatter matching the original NumberFormatters (comma grouping). */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}
