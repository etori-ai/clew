import readXlsxFile from 'read-excel-file/web-worker';
import { checkOfficeContent } from './document-limits';

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    await checkOfficeContent(event.data);
    const sheets = await readXlsxFile(event.data, { trim: false, parseNumber: value => value });
    // A hard cell budget applies across all sheets, including blank coordinates. No row/header shifting.
    let remaining = 20_000;
    const output = sheets.slice(0, 20).map(sheet => {
      const columns = Math.min(50, Math.max(0, ...sheet.data.slice(0, 500).map(row => row.length)));
      const rows = Math.min(500, sheet.data.length, Math.floor(remaining / Math.max(1, columns)));
      remaining -= rows * columns;
      return {
        name: sheet.sheet,
        totalRows: sheet.data.length,
        columns,
        truncated: rows < sheet.data.length || sheet.data.some(row => row.length > columns),
        rows: sheet.data.slice(0, rows).map(row =>
          Array.from({ length: columns }, (_, i) => {
            const value = row[i];
            return value instanceof Date
              ? value.toISOString().slice(0, 10)
              : value == null
                ? ''
                : typeof value === 'boolean'
                  ? value
                    ? 'Ja'
                    : 'Nej'
                  : String(value);
          }),
        ),
      };
    });
    self.postMessage({ sheets: output, truncated: sheets.length > 20 });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Kalkylbladet kunde inte läsas.' });
  }
};
