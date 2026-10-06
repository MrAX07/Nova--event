import type { Response } from 'express';

/** Beskytter mod CSV-injektion (=, +, -, @ i starten af en celle køres som formel i Excel). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function streamCsv(res: Response, filename: string, headers: string[], batches: AsyncGenerator<unknown[][]>): Promise<void> {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.write('\uFEFF' + headers.map(csvCell).join(',') + '\n');
  for await (const rows of batches) for (const r of rows) res.write(r.map(csvCell).join(',') + '\n');
  res.end();
}
