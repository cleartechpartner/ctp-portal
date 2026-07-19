// Time tracking helpers (CTP-SPEC-0001). All date maths are local time;
// the portal has a single internal user in Europe/Madrid.

export function pad2(n) { return String(n).padStart(2, '0'); }

export function dateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

export function monthKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}`;
}

// Monday-start week.
export function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 1);
  return { from, to };
}

// ---------- durations ----------

export function secToHM(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad2(m)}`;
}

export function secToHMS(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

export function secToDec(sec) {
  return Math.round(((sec || 0) / 3600) * 100) / 100;
}

// Accepts "1:30", "1,5", "1.5", "90m", "2h" and plain hours.
export function parseDuration(input) {
  const v = String(input || '').trim().toLowerCase().replace(',', '.');
  if (!v) return null;
  let m = v.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (m) return (+m[1]) * 3600 + (+m[2]) * 60;
  m = v.match(/^(\d+(?:\.\d+)?)\s*m$/);
  if (m) return Math.round(+m[1] * 60);
  m = v.match(/^(\d+(?:\.\d+)?)\s*h?$/);
  if (m) return Math.round(+m[1] * 3600);
  return null;
}

// ---------- entries / caps ----------

export function entrySeconds(entries) {
  return entries.reduce((a, e) => a + (e.duration_seconds || 0), 0);
}

export function entryAmount(e, client) {
  const rate = e.rate != null ? +e.rate : (client && client.hourly_rate != null ? +client.hourly_rate : 0);
  return (e.duration_seconds / 3600) * rate;
}

export function entriesAmount(entries, client) {
  return entries.reduce((a, e) => a + (e.billable ? entryAmount(e, client) : 0), 0);
}

// Cap consumption for a set of entries against a cap definition.
// Returns null when no cap is set. Caps warn, they never block.
export function capState(entries, client, capType, capValue) {
  if (!capType || capValue == null || +capValue <= 0) return null;
  const used = capType === 'hours'
    ? entrySeconds(entries) / 3600
    : entriesAmount(entries, client);
  const ratio = used / +capValue;
  return {
    used,
    cap: +capValue,
    ratio,
    level: ratio > 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok'
  };
}

export function fmtMoney(n, currency = 'EUR') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n || 0);
}

// Format a { EUR: 120, USD: 80 } map as "€120.00 + $80.00". Amounts across
// clients can span currencies, so we never collapse them into one total.
// Stacked per-currency lines for the Billable amount card: euro line first,
// dollar line under it, plain symbols only (Intl en-GB writes USD as "US$").
const CUR_SYMBOL = { EUR: '€', USD: '$' };
export function fmtAmountLines(map) {
  const entries = Object.entries(map).filter(([, v]) => v);
  if (!entries.length) return [fmtMoney(0)];
  const rank = (c) => c === 'EUR' ? 0 : c === 'USD' ? 1 : 2;
  entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  return entries.map(([c, v]) => {
    const num = (v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return CUR_SYMBOL[c] ? CUR_SYMBOL[c] + num : fmtMoney(v, c);
  });
}

export function fmtAmountsByCurrency(map) {
  const parts = Object.entries(map)
    .filter(([, v]) => v)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([c, v]) => fmtMoney(v, c));
  return parts.length ? parts.join(' + ') : fmtMoney(0);
}

export function projectLabel(p) {
  return p ? `${p.type || 'Work'} | ${p.title}` : '';
}

// ---------- CSV export ----------

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildCsv(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(text, filename) {
  // BOM so Excel opens UTF-8 CSVs with accents intact.
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeFileName(name) {
  return (name || 'export').replace(/[^a-z0-9 _.-]/gi, '').trim().replace(/\s+/g, '_').slice(0, 60);
}
