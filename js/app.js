// UBA QSL Sorter: user interface.
import { loadList, sortCalls, extractCalls, parseCall } from './sorter.js';
import { parseFile } from './parsers.js';
import { T, LANGS } from './i18n.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  lang: 'en',
  index: null,
  meta: {},
  entries: new Map(), // call -> count, in order of input
  sources: [],
  result: null,
  ticked: new Set(),
  editing: null,
};
const t = () => T[state.lang];

// ---------------------------------------------------------------- language

function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

function setLang(lang) {
  state.lang = LANGS.includes(lang) ? lang : 'en';
  storeSet('uqs-lang', state.lang);
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t()[el.dataset.i18n];
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t()[el.dataset.i18nPh]; });
  document.querySelectorAll('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  if (state.index) {
    $('#status').hidden = true;
    renderSources(); renderReview(); renderResult(); renderList(); renderHow(); renderHelp(); renderVersion();
  }
}

// ---------------------------------------------------------------- routing

function route() {
  const view = (location.hash || '#sort').slice(1);
  const v = ['sort', 'list', 'help'].includes(view) ? view : 'sort';
  for (const id of ['sort', 'list', 'help']) $('#view-' + id).hidden = id !== v || !state.index;
  document.querySelectorAll('.navbar a').forEach(a => a.toggleAttribute('aria-current', a.dataset.view === v));
  document.querySelectorAll('.navbar a').forEach(a => { if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); });
}

// ---------------------------------------------------------------- input

function addCalls(calls, label) {
  let n = 0;
  for (const raw of calls) {
    const call = parseCall(raw).call;
    if (!call) continue;
    state.entries.set(call, (state.entries.get(call) || 0) + 1);
    n++;
  }
  state.sources.push({ label, n });
  state.result = null;
  renderSources(); renderReview(); renderResult();
}

function renderSources() {
  $('#sourcesBox').hidden = !state.sources.length;
  $('#sources').innerHTML = state.sources.map(s =>
    `<li class="${s.n ? '' : 'empty'}">${esc(s.label === '#manual' ? t().srcManual : s.label)}: ${s.n ? t().srcCalls(s.n) : t().srcNone}</li>`).join('');
}

async function handleFiles(files) {
  for (const f of files) {
    try {
      const { type, calls } = await parseFile(f);
      addCalls(calls, `${f.name} (${type})`);
    } catch (e) {
      addCalls([], `${f.name} (${e.message})`);
    }
  }
}

// ---------------------------------------------------------------- review

function renderReview() {
  const box = $('#chips');
  const entries = [...state.entries];
  const cards = entries.reduce((s, [, n]) => s + n, 0);
  $('#reviewInfo').textContent = entries.length ? `${t().uniqueCards(entries.length, cards)}. ${t().reviewHint}` : t().reviewEmpty;
  $('#sortBtn').disabled = !entries.length;
  $('#clearBtn').hidden = !entries.length;
  box.innerHTML = entries.map(([call, n]) => {
    if (state.editing === call) {
      return `<span class="chip"><input data-edit="${esc(call)}" value="${esc(call)}" aria-label="${esc(call)}"></span>`;
    }
    return `<span class="chip"><button type="button" data-e="${esc(call)}">${esc(call)}${n > 1 ? `<span class="n">×${n}</span>` : ''}</button><button type="button" class="x" data-x="${esc(call)}" aria-label="remove ${esc(call)}">×</button></span>`;
  }).join('');
  const inp = box.querySelector('input[data-edit]');
  if (inp) { inp.focus(); inp.select(); }
}

function commitEdit(oldCall, value) {
  state.editing = null;
  const count = state.entries.get(oldCall) || 1;
  const newCall = parseCall(value).call;
  if (newCall && newCall !== oldCall) {
    // keep the position in the list
    const list = [...state.entries];
    const i = list.findIndex(([c]) => c === oldCall);
    list.splice(i, 1);
    const j = list.findIndex(([c]) => c === newCall);
    if (j >= 0) list[j][1] += count; else list.splice(i, 0, [newCall, count]);
    state.entries = new Map(list);
  } else if (!newCall) {
    state.entries.delete(oldCall);
  }
  state.result = null;
  renderReview(); renderResult();
}

// ---------------------------------------------------------------- result

function doSort() {
  const raw = [];
  for (const [call, n] of state.entries) for (let i = 0; i < n; i++) raw.push(call);
  state.result = sortCalls(state.index, raw);
  state.ticked.clear();
  renderResult();
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function packetSub(p) {
  if (/^W[0-9]$/.test(p.code)) return t().packetUsa(p.code[1]);
  return [...new Set(p.items.map(i => i.country))].join(', ');
}

function cardsOf(list) { return list.reduce((s, i) => s + i.count, 0); }

function renderResult() {
  const r = state.result;
  $('#result').hidden = !r;
  if (!r) return;
  const L = t();
  const warnCount = r.none.length + r.unknown.length + r.invalid.length + r.badcalls.length;
  $('#stats').innerHTML = `
    <div class="stat"><b>${r.total}</b><span>${L.statCards}</span></div>
    <div class="stat"><b>${r.packets.length}</b><span>${L.statPackets}</span></div>
    <div class="stat ${warnCount ? 'warn' : ''}"><b>${warnCount}</b><span>${L.statWarn}</span></div>`;

  const li = i => `<li>${esc(i.call)}${i.count > 1 ? ` ×${i.count}` : ''}${i.country ? ` <small>${esc(i.country)}</small>` : ''}</li>`;
  let html = '';
  if (r.none.length) {
    html += `<div class="alert red"><h3>⚠ ${L.warnNoneTitle(cardsOf(r.none))}</h3><p>${L.warnNoneText}</p><ul>${r.none.map(li).join('')}</ul></div>`;
  }
  const via = r.packets.flatMap(p => p.items).filter(i => i.via);
  if (via.length) {
    html += `<div class="alert amber"><h3>${L.viaTitle}</h3><p>${L.viaText}</p><ul>${via.map(i => `<li>${esc(L.viaLine(i.call, i.via))}</li>`).join('')}</ul></div>`;
  }
  if (r.unknown.length) html += `<div class="alert grey"><h3>${L.unknownTitle}</h3><p>${L.unknownText}</p><ul>${r.unknown.map(li).join('')}</ul></div>`;
  if (r.invalid.length) html += `<div class="alert grey"><h3>${L.invalidTitle}</h3><p>${L.invalidText}</p><ul>${r.invalid.map(li).join('')}</ul></div>`;
  if (r.badcalls.length) html += `<div class="alert grey"><h3>${L.badTitle}</h3><ul>${r.badcalls.map(i => `<li>${esc(i.input)}</li>`).join('')}</ul></div>`;
  $('#alerts').innerHTML = html;

  const nr = n => String(n + 1).padStart(2, '0');
  const isDone = p => p.items.every(i => state.ticked.has(i.call));
  const doneCount = r.packets.filter(isDone).length;

  // Overview: the stacking order in one compact, numbered strip
  $('#order').innerHTML = `
    <div class="order-head"><h3>${L.orderTitle}</h3><span class="progress">${L.progress(doneCount, r.packets.length)}</span></div>
    <p class="muted">${L.orderHint}</p>
    <ol class="order">${r.packets.map((p, n) =>
      `<li class="${isDone(p) ? 'done' : ''}"><a href="#pk-${n}"><span>${nr(n)}</span>${esc(p.code)}</a></li>`).join('')}</ol>`;

  // Detail: one compact row per packet, top to bottom
  $('#packets').innerHTML = r.packets.map((p, n) => `
    <li class="prow ${isDone(p) ? 'done' : ''}" id="pk-${n}">
      <div class="pno">${nr(n)}</div>
      <div class="pcode"><b>${esc(p.code)}</b><small>${esc(packetSub(p))}</small></div>
      <div class="pcount">${L.cardsN(p.cards)}</div>
      <div class="pcalls">${p.items.map(i => `<label class="${state.ticked.has(i.call) ? 'ticked' : ''}">
        <input type="checkbox" data-tick="${esc(i.call)}" ${state.ticked.has(i.call) ? 'checked' : ''}><span class="c">${esc(i.call)}</span>${i.count > 1 ? `<span class="cnt">×${i.count}</span>` : ''}${i.via ? `<span class="via">via ${esc(i.via)}</span>` : ''}</label>`).join('')}</div>
    </li>`).join('');
}

// ---------------------------------------------------------------- export

function exportRows() {
  const r = state.result, L = t();
  const rows = [['#', L.colPacket, 'Call', 'Via', L.statCards, L.colCountry]];
  r.packets.forEach((p, n) => p.items.forEach(i => rows.push([n + 1, p.code, i.call, i.via || '', i.count, i.country])));
  for (const [list, label] of [[r.none, L.noneLabel], [r.unknown, L.unknownTitle], [r.invalid, L.invalidTitle], [r.badcalls, L.badTitle]]) {
    list.forEach(i => rows.push(['', label, i.call || i.input, i.via || '', i.count, i.country || '']));
  }
  return rows;
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function exportCsv() {
  const csv = exportRows().map(r => r.map(c => {
    const s = String(c);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  download(`qsl-sorted-${stamp()}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
}

function exportXlsx() {
  const XLSX = globalThis.XLSX;
  if (!XLSX) return exportCsv();
  const ws = XLSX.utils.aoa_to_sheet(exportRows());
  ws['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'QSL');
  XLSX.writeFile(wb, `qsl-sorted-${stamp()}.xlsx`);
}

// ---------------------------------------------------------------- sorting list view

function bureauCell(row) {
  const L = t();
  if (row.bureau === 'NONE') return L.noneLabel;
  if (row.bureau === 'INVALID') return L.invalidLabel;
  if (row.bureau === 'USA') return L.usaLabel;
  return esc(row.bureau);
}

function renderList() {
  const q = $('#search').value.trim().toUpperCase();
  const f = $('#filter').value;
  const rows = state.index.rows.filter(r => {
    if (f === 'none' && r.bureau !== 'NONE') return false;
    if (!q) return true;
    return [r.prefix, r.country, r.bureau].some(v => v.toUpperCase().includes(q)) || prefixMatches(r, q);
  });
  $('#rowsShown').textContent = t().rowsShown(rows.length, state.index.rows.length);
  $('#listBody').innerHTML = rows.map(r => {
    const note = r.remark.startsWith('CHECK') ? `<span class="note">${t().note}: ${esc(r.remark.replace(/^CHECK:\s*/, ''))}</span>` : '';
    const cls = r.bureau === 'NONE' ? 'none' : r.bureau === 'INVALID' ? 'invalid' : '';
    return `<tr class="${cls}"><td class="p">${esc(r.prefix.replace('-', ' - '))}</td><td>${esc(r.country)}${note}</td><td class="k">${bureauCell(r)}</td></tr>`;
  }).join('');
}

// typing a full call like "C31XX" also finds its row
function prefixMatches(row, q) {
  if (!/^[A-Z0-9]{2,}$/.test(q)) return false;
  const res = sortCalls(state.index, [q]);
  const hit = [...res.packets.flatMap(p => p.items), ...res.none, ...res.invalid][0];
  return !!hit && hit.row === row;
}

function renderHow() {
  $('#how').innerHTML = t().how.map(s => `<li>${esc(s)}</li>`).join('');
}

function renderHelp() {
  $('#helpBox').innerHTML = t().help.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
}

function renderVersion() {
  const v = state.meta.version ? t().listVersion(state.meta.version, state.meta.updated || '') : '';
  $('#version').textContent = v;
  $('#footVersion').textContent = v;
}

// ---------------------------------------------------------------- events

function bind() {
  document.querySelectorAll('.lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
  window.addEventListener('hashchange', route);

  $('#addBtn').addEventListener('click', () => {
    const txt = $('#paste').value;
    if (!txt.trim()) return;
    addCalls(extractCalls(txt), '#manual');
    $('#paste').value = '';
  });
  $('#paste').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#addBtn').click(); });

  const drop = $('#drop'), file = $('#file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => { handleFiles([...file.files]); file.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFiles([...e.dataTransfer.files]));
  // a file dropped anywhere else on the page should not open in the browser
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  $('#chips').addEventListener('click', e => {
    const x = e.target.closest('[data-x]');
    if (x) { state.entries.delete(x.dataset.x); state.result = null; renderReview(); renderResult(); return; }
    const ed = e.target.closest('[data-e]');
    if (ed) { state.editing = ed.dataset.e; renderReview(); }
  });
  $('#chips').addEventListener('keydown', e => {
    const inp = e.target.closest('input[data-edit]');
    if (!inp) return;
    if (e.key === 'Enter') commitEdit(inp.dataset.edit, inp.value);
    if (e.key === 'Escape') { state.editing = null; renderReview(); }
  });
  $('#chips').addEventListener('focusout', e => {
    const inp = e.target.closest('input[data-edit]');
    if (inp && state.editing === inp.dataset.edit) commitEdit(inp.dataset.edit, inp.value);
  });

  $('#clearBtn').addEventListener('click', () => {
    state.entries.clear(); state.sources = []; state.result = null;
    renderSources(); renderReview(); renderResult();
  });
  $('#sortBtn').addEventListener('click', doSort);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#csvBtn').addEventListener('click', exportCsv);
  $('#xlsxBtn').addEventListener('click', exportXlsx);

  $('#packets').addEventListener('change', e => {
    const c = e.target.dataset.tick;
    if (!c) return;
    if (e.target.checked) state.ticked.add(c); else state.ticked.delete(c);
    renderResult();
  });

  $('#order').addEventListener('click', e => {
    const a = e.target.closest('a[href^="#pk-"]');
    if (!a) return;
    e.preventDefault();
    document.querySelector(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#search').addEventListener('input', renderList);
  $('#filter').addEventListener('change', renderList);
}

// ---------------------------------------------------------------- start

async function init() {
  bind();
  setLang(storeGet('uqs-lang') || 'en');
  route();
  try {
    const [csv, meta] = await Promise.all([
      fetch('data/sorteerlijst.csv', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
      fetch('data/meta.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    state.index = loadList(csv);
    state.meta = meta;
    setLang(state.lang);
    route();
  } catch (e) {
    $('#status').textContent = t().loadError;
    $('#status').style.color = 'var(--red)';
  }
}

init();
