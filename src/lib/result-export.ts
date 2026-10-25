import type { ModelResult } from '../types/forecasting.ts';

export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  // Protect spreadsheet users when this helper is reused for labels.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function forecastCSV(result: ModelResult): string {
  const rows: (string | number | null)[][] = [['type', 'index', 'actual', 'prediction']];
  result.history.forEach(point => rows.push(['historical', point.index, point.value, null]));
  result.evaluation.actual.forEach((point, index) => rows.push(['evaluation', point.index, point.value, result.evaluation.predicted[index]?.value ?? null]));
  result.forecast.forEach(point => rows.push(['forecast', point.index, null, point.value]));
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function downloadText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
