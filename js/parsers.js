// Input parsers: turn files and pasted text into a list of callsigns.
import { extractCalls, parseCall, normalizeChars } from './sorter.js';

const CALL_HEADERS = ['CALL', 'CALLSIGN', 'CALL SIGN', 'CALL_SIGN', 'INDICATIF', 'ROEPNAAM', 'ROEPLETTERS', 'QSO_CALL', 'HISCALL', 'DXCALL'];

// ADIF: read every <CALL:n> field (not STATION_CALLSIGN or OPERATOR).
export function parseAdif(text) {
  const out = [];
  const re = /<CALL:(\d+)(?::[A-Z])?>/gi;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.substr(re.lastIndex, Number(m[1])).trim());
  }
  return out.filter(c => parseCall(c).ok);
}

// Cabrillo: "QSO: freq mode date time mycall [exch...] hiscall [exch...]"
// The received call is the first callsign after the own call.
export function parseCabrillo(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*QSO:/i.test(line)) continue;
    const tok = line.replace(/^\s*QSO:/i, '').trim().split(/\s+/);
    const rest = tok.slice(5);
    const call = rest.find(t => parseCall(t).ok);
    if (call) out.push(call);
  }
  return out;
}

// Rows (array of arrays) from CSV or Excel: use a call column if there is one,
// otherwise the column with the most callsigns, otherwise every cell.
export function callsFromRows(rows) {
  rows = rows.filter(r => r && r.some(c => String(c ?? '').trim()));
  if (!rows.length) return [];
  const width = Math.max(...rows.map(r => r.length));
  const head = (rows[0] || []).map(h => normalizeChars(h ?? '').trim());
  let col = head.findIndex(h => CALL_HEADERS.includes(h));
  let body = rows;
  if (col >= 0) body = rows.slice(1);
  else {
    let best = -1, bestScore = 0;
    for (let c = 0; c < width; c++) {
      const score = rows.filter(r => parseCall(String(r[c] ?? '').trim()).ok).length;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (best < 0) return [];
    col = best;
  }
  return body.map(r => String(r[col] ?? '').trim()).filter(c => parseCall(c).ok);
}

export function parseCsv(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const delim = [';', ',', '\t', '|'].reduce((a, b) => (first.split(b).length > first.split(a).length ? b : a));
  const rows = text.split(/\r?\n/).map(l => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim()));
  const calls = callsFromRows(rows);
  return calls.length ? calls : extractCalls(text);
}

export function parseExcel(arrayBuffer) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error('Excel library not loaded');
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const out = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    out.push(...callsFromRows(rows));
  }
  return out;
}

// Pick a parser from the file name (and content for .log/.txt).
export async function parseFile(file) {
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop();
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    return { type: 'Excel', calls: parseExcel(await file.arrayBuffer()) };
  }
  const text = await file.text();
  if (['adi', 'adif'].includes(ext) || /<EOR>/i.test(text)) return { type: 'ADIF', calls: parseAdif(text) };
  if (['cbr', 'log'].includes(ext) || /^START-OF-LOG:/im.test(text)) {
    const c = parseCabrillo(text);
    if (c.length) return { type: 'Cabrillo', calls: c };
  }
  if (['csv', 'tsv'].includes(ext)) return { type: 'CSV', calls: parseCsv(text) };
  return { type: 'TXT', calls: extractCalls(text) };
}
