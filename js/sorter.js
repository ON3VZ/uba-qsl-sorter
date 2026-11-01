// UBA QSL Bureau sorter: core logic (no DOM, works in browser and Node).
// Data source: data/sorteerlijst.csv (columns: prefix;country;bureau;remark)
//   bureau = packet code, or NONE (no IARU bureau), INVALID (invalid prefix),
//            USA (sorted by call area: W1 ... W9, W0)

export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Suffixes after a slash that do not change the country or the packet.
export const IGNORED_SUFFIXES = new Set([
  'P', 'M', 'MM', 'AM', 'QRP', 'QRPP', 'A', 'B', 'LH', 'R', 'J', 'PM', 'X', 'Z',
]);

// A complete callsign: 1 to 3 prefix chars, a digit, optional chars, ending in a letter,
// and at least one letter in the first two characters.
const CALL_RE = /^(?=[A-Z0-9]?[A-Z])[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,5}[A-Z]$/;

// ---------------------------------------------------------------- data

export function parseList(csvText) {
  const lines = csvText.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
  const header = lines.shift().split(';').map(h => h.trim().toLowerCase());
  const col = name => header.indexOf(name);
  const rows = lines.map((line, idx) => {
    const c = line.split(';');
    const prefix = normalizeChars(c[col('prefix')] || '').replace(/\s/g, '');
    const [from, to] = prefix.includes('-') ? prefix.split('-') : [prefix, prefix];
    return {
      idx,
      prefix,
      from,
      to,
      country: (c[col('country')] || '').trim(),
      bureau: normalizeChars(c[col('bureau')] || '').trim(),
      remark: (c[col('remark')] || '').trim(),
    };
  });
  return rows;
}

// Expand a range like "2A-2Z", "B0-B9", "U-UQ", "KL7-KL8" into explicit prefixes.
export function expandRange(from, to) {
  if (from === to) return [from];
  let base, lo, hi;
  if (from.length === to.length) {
    base = from.slice(0, -1);
    if (to.slice(0, -1) !== base) throw new Error(`Unsupported range ${from}-${to}`);
    lo = from.slice(-1);
    hi = to.slice(-1);
  } else if (from.length + 1 === to.length && to.startsWith(from)) {
    // "G-GZ", "U-UQ": every character after the base, up to the last one
    base = from;
    lo = ALPHABET[0];
    hi = to.slice(-1);
  } else {
    throw new Error(`Unsupported range ${from}-${to}`);
  }
  const a = ALPHABET.indexOf(lo), b = ALPHABET.indexOf(hi);
  if (a < 0 || b < 0 || a > b) throw new Error(`Bad range ${from}-${to}`);
  const out = [];
  for (let i = a; i <= b; i++) out.push(base + ALPHABET[i]);
  return out;
}

// Build the lookup index. When two rows produce the same prefix, the row with
// the smallest range wins (UJ-UM beats U-UQ). Equal size: first row wins.
export function buildIndex(rows) {
  const map = new Map();
  const conflicts = [];
  for (const row of rows) {
    const list = expandRange(row.from, row.to);
    row.size = list.length;
    for (const p of list) {
      const prev = map.get(p);
      if (!prev) { map.set(p, row); continue; }
      if (row.size < prev.size) map.set(p, row);
      if (row.size === prev.size && row.bureau !== prev.bureau) conflicts.push({ prefix: p, kept: prev, ignored: row });
    }
  }
  const maxLen = Math.max(...[...map.keys()].map(k => k.length));
  return { map, rows, maxLen, conflicts };
}

export function loadList(csvText) {
  return buildIndex(parseList(csvText));
}

// Longest prefix match.
export function lookup(index, s) {
  for (let n = Math.min(index.maxLen, s.length); n > 0; n--) {
    const row = index.map.get(s.slice(0, n));
    if (row) return row;
  }
  return null;
}

// ---------------------------------------------------------------- callsigns

export function normalizeChars(s) {
  return String(s)
    .replace(/[ØøÆæΦ∅]/g, '0')
    .toUpperCase();
}

export function isCallsign(s) {
  return CALL_RE.test(s);
}

// Split a raw entry into home call, operating prefix and call area.
//   "F/ON3VZ"   -> home ON3VZ, opPrefix F
//   "ON3VZ/P"   -> home ON3VZ
//   "W1AW/7"    -> home W1AW, area 7
//   "KH6/W1AW"  -> home W1AW, opPrefix KH6
export function parseCall(raw) {
  const call = normalizeChars(raw).replace(/\s/g, '');
  const res = { input: String(raw).trim(), call, home: null, opPrefix: null, area: null, ok: false };
  if (!call || !/^[A-Z0-9/]+$/.test(call)) return res;
  const parts = call.split('/').filter(Boolean);
  const calls = parts.filter(isCallsign);
  if (!calls.length) return res;
  // Home call: the longest part; on a tie the one with the longest suffix
  // (W1AW wins from VP2E in "VP2E/W1AW"), then the first one.
  const suffixLen = s => s.length - s.search(/[0-9][A-Z]*$/) - 1;
  res.home = calls.reduce((a, b) =>
    (b.length > a.length || (b.length === a.length && suffixLen(b) > suffixLen(a)) ? b : a));
  for (const p of parts) {
    if (p === res.home) continue;
    if (/^[0-9]$/.test(p)) res.area = p;
    else if (IGNORED_SUFFIXES.has(p)) continue;
    else if (!res.opPrefix) res.opPrefix = p;
  }
  res.ok = true;
  return res;
}

function firstDigit(s) {
  const m = s.match(/[0-9]/);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------- classify

// Portable calls are always sorted under the home call (UBA rule):
// F/ON4BB goes in packet ON, and the card should read "via ON4BB".
export function classify(index, raw) {
  const pc = parseCall(raw);
  const out = { ...pc, status: 'badcall', packet: null, country: null, row: null, via: null };
  if (!pc.ok) return out;
  if (pc.opPrefix) out.via = pc.home; // only when another country prefix is involved

  const row = lookup(index, pc.home);
  out.row = row;
  if (!row) { out.status = 'unknown'; return out; }
  out.country = row.country;

  if (row.bureau === 'NONE') { out.status = 'none'; return out; }
  if (row.bureau === 'INVALID') { out.status = 'invalid'; return out; }
  out.packet = row.bureau === 'USA' ? 'W' + firstDigit(pc.home) : row.bureau;
  out.status = 'ok';
  return out;
}

// ---------------------------------------------------------------- packet order

// Option A: a packet sits where its own code appears in the list.
// Ties (W1..W0) are ordered 1..9 then 0.
export function packetPosition(index, code) {
  const row = lookup(index, code);
  if (row) return row.idx;
  for (const r of index.rows) {
    if (expandRange(r.from, r.to).some(p => p.startsWith(code))) return r.idx;
  }
  return Number.MAX_SAFE_INTEGER;
}

const DIGIT_ORDER = '1234567890';
function tieKey(code) {
  const d = code.slice(-1);
  const i = DIGIT_ORDER.indexOf(d);
  return i >= 0 ? i : 10;
}

export function comparePackets(index, a, b) {
  return packetPosition(index, a) - packetPosition(index, b) || tieKey(a) - tieKey(b) || a.localeCompare(b);
}

// ---------------------------------------------------------------- sort

// calls: array of raw strings. Returns grouped result.
export function sortCalls(index, calls) {
  const seen = new Map();
  for (const raw of calls) {
    const c = classify(index, raw);
    const k = c.call || c.input;
    if (!k) continue;
    if (seen.has(k)) seen.get(k).count++;
    else seen.set(k, { ...c, count: 1 });
  }
  const byCall = (a, b) => a.call.localeCompare(b.call);
  const items = [...seen.values()];
  const groups = new Map();
  for (const it of items.filter(i => i.status === 'ok')) {
    if (!groups.has(it.packet)) groups.set(it.packet, []);
    groups.get(it.packet).push(it);
  }
  const packets = [...groups.keys()]
    .sort((a, b) => comparePackets(index, a, b))
    .map(code => {
      const list = groups.get(code).sort(byCall);
      return { code, items: list, cards: list.reduce((s, i) => s + i.count, 0) };
    });
  const pick = st => items.filter(i => i.status === st).sort(byCall);
  return {
    packets,
    none: pick('none'),        // no IARU bureau: warning
    invalid: pick('invalid'),  // invalid prefix per list
    unknown: pick('unknown'),  // prefix not in list
    badcalls: pick('badcall'), // not a callsign
    total: items.reduce((s, i) => s + i.count, 0),
  };
}

// ---------------------------------------------------------------- free text

// Pull callsigns out of pasted text (any separator).
export function extractCalls(text) {
  const tokens = normalizeChars(text).split(/[^A-Z0-9/]+/).filter(Boolean);
  return tokens.filter(t => parseCall(t).ok);
}
