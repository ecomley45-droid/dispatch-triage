// Client-side file parsing for bulk import — CSV via PapaParse, XLSX via
// SheetJS. Both return the same shape ({ headers, rows }) so the rest of the
// import wizard (column mapping, chunked upload) doesn't care which format
// the file was.
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const isXlsx = (file) => /\.xlsx?$/i.test(file.name) || file.type.includes('spreadsheet') || file.type.includes('excel');

// rows: array of objects keyed by header (Papa's/XLSX's `header: 1`-free
// default shape); headers: the column order as they appeared in the file, so
// the mapping UI can present them in file order rather than alphabetized.
export function parseFile(file) {
  return isXlsx(file) ? parseXlsx(file) : parseCsv(file);
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta?.fields || [];
        resolve({ headers, rows: result.data });
      },
      error: reject,
    });
  });
}

async function parseXlsx(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // defval: '' so a row with a trailing blank cell still gets every header
  // key (undefined would otherwise drop it, and validation treats missing
  // vs. blank the same way anyway).
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const headers = rows.length ? Object.keys(rows[0]) : (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || []);
  return { headers, rows };
}

// Best-effort auto-mapping: match a file column to a target field when the
// header text is a close (case/space/punctuation-insensitive) match to the
// field's key or label. The admin can still override every guess in the
// mapping UI — this just saves re-picking the obvious ones.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function guessMapping(headers, fields) {
  const mapping = {};
  for (const header of headers) {
    const h = norm(header);
    const match = fields.find((f) => norm(f.key) === h || norm(f.label) === h || norm(f.label.replace(/\s*\(.*\)/, '')) === h);
    mapping[header] = match ? match.key : '';
  }
  return mapping;
}

// A downloadable CSV template for one entity type — header row only (labels,
// required fields starred), so an admin knows exactly what columns to fill
// in before mapping. Triggers a browser download; no server round-trip.
export function downloadTemplate(entityLabel, headers) {
  const csv = Papa.unparse([headers]);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${entityLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-import-template.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
