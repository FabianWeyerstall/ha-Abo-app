/* Haushaltsbuch sidebar panel for Home Assistant.
 * Plain web component without build step. Talks to the integration through
 * the WebSocket commands "haushaltsbuch/*" as the logged-in user.
 */

const ICON_LIST_URL = (() => {
  const url = new URL("mdi-icons.json", import.meta.url);
  url.search = new URL(import.meta.url).search;
  return url.href;
})();
let iconListPromise = null;

/** Load the list of Material Design Icons ([name, ...aliases]) once. */
function loadIconList() {
  if (!iconListPromise) {
    iconListPromise = fetch(ICON_LIST_URL)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return iconListPromise;
}

// German search words → English icon name parts, so "auto" also finds the car.
const GERMAN_ICON_WORDS = {
  abo: ["autorenew", "repeat"], arzt: ["doctor", "stethoscope"], auto: ["car"], bahn: ["train"],
  bank: ["bank"], baby: ["baby"], benzin: ["gas-station"], bonus: ["gift", "star"], buch: ["book"],
  diesel: ["gas-station"], einkauf: ["cart", "shopping"], essen: ["food", "silverware"],
  fahrrad: ["bicycle"], fernsehen: ["television"], film: ["movie"], fitness: ["dumbbell"],
  flug: ["airplane"], friseur: ["content-cut", "hair-dryer"], garten: ["flower", "shovel"],
  gas: ["fire", "gas-burner"], gehalt: ["cash", "briefcase"], geld: ["cash", "currency-eur", "wallet"],
  geschenk: ["gift"], gesundheit: ["medical", "heart-pulse"], handy: ["cellphone"], haus: ["home"],
  heizung: ["radiator", "fire"], hund: ["dog"], internet: ["web", "wifi", "router"], katze: ["cat"],
  kind: ["baby", "human-child"], kleidung: ["tshirt-crew", "hanger"], kredit: ["credit-card", "bank"],
  kfz: ["car"], lebensmittel: ["cart", "food-apple"], miete: ["home-city", "key"], müll: ["trash-can"],
  musik: ["music", "spotify"], pv: ["solar-power", "solar-panel"], rad: ["bicycle", "tire"],
  reifen: ["tire"], reise: ["airplane", "bag-suitcase"], rente: ["piggy-bank"], schule: ["school"],
  solar: ["solar-power", "solar-panel"], sparen: ["piggy-bank"], spende: ["hand-heart"],
  spiel: ["gamepad", "controller"], sport: ["dumbbell", "soccer"], steuer: ["file-document", "bank"],
  strom: ["flash", "lightning-bolt", "power-plug"], tanken: ["gas-station", "fuel"],
  telefon: ["phone"], tier: ["paw"], urlaub: ["beach", "airplane"], versicherung: ["shield", "umbrella"],
  wasser: ["water"], werkzeug: ["tools", "wrench"], wohnung: ["home", "key"], zeitung: ["newspaper"],
  zug: ["train"],
};

/** Best matching icon names for a search text, most relevant first. */
function searchIcons(list, query, limit = 40) {
  const q = query.trim().toLowerCase().replace(/^mdi:/, "").replace(/\s+/g, "-");
  if (!q) return [];
  const terms = [[q, 0]];
  if (q.length >= 3) {
    for (const [word, english] of Object.entries(GERMAN_ICON_WORDS)) {
      if (word.startsWith(q)) english.forEach((e, i) => terms.push([e, 5 - i]));
    }
  }
  const best = new Map();
  for (const [name, ...aliases] of list) {
    let top = 0;
    for (const [term, bonus] of terms) {
      let score = 0;
      if (name === term) score = 100;
      else if (name.startsWith(`${term}-`)) score = 85 - name.length / 100;
      else if (name.startsWith(term)) score = 80 - name.length / 100;
      else if (name.includes(term)) score = 60 - name.length / 100;
      else if (aliases.some((a) => a.startsWith(term))) score = 40 - name.length / 100;
      else if (aliases.some((a) => a.includes(term))) score = 20 - name.length / 100;
      if (score) top = Math.max(top, score + bonus);
    }
    if (top) best.set(name, top);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => `mdi:${name}`);
}

// Language of the panel: German for German HA users, English for everyone else.
let LANG = "de";
const tr = (de, en) => (LANG === "de" ? de : en);
const setLanguage = (language) => {
  LANG = String(language || "de").toLowerCase().startsWith("de") ? "de" : "en";
};
let DATE_LOCALE = "de-DE";
const fmtDate = (isoDate, opts) => parseIso(isoDate).toLocaleDateString(DATE_LOCALE, opts);
const monthName = (index, style = "long") => new Date(2020, index, 1).toLocaleDateString(LANG === "de" ? "de-DE" : DATE_LOCALE, { month: style }).replace(/\.$/, "");
const weekdayLong = (index) => new Date(2024, 0, 1 + index).toLocaleDateString(LANG === "de" ? "de-DE" : DATE_LOCALE, { weekday: "long" });
const WEEK_ORDINALS = [[1, "ersten", "first"], [2, "zweiten", "second"], [3, "dritten", "third"], [4, "vierten", "fourth"], [-1, "letzten", "last"]];
const weekdayName = (index) => new Date(2024, 0, 1 + index).toLocaleDateString(LANG === "de" ? "de-DE" : DATE_LOCALE, { weekday: "short" }).replace(/\.$/, "");

const SUGGEST_FIELDS = new Set(["icon", "category"]);
const INCOGNITO_KEY = "haushaltsbuch-incognito";

const CERTAINTY = {
  sicher: { de: "sicher", en: "certain", color: "var(--success-color, #43a047)" },
  wahrscheinlich: { de: "wahrscheinlich", en: "likely", color: "var(--warning-color, #ffa000)" },
  unsicher: { de: "unsicher", en: "uncertain", color: "var(--secondary-text-color, #888)" },
};
const certaintyLabel = (key) => (CERTAINTY[key] || CERTAINTY.unsicher)[LANG];

const FREQUENCY_PRESETS = [
  { key: "once", de: "einmalig", en: "once", frequency: "once", interval: 1 },
  { key: "weekly", de: "wöchentlich", en: "weekly", frequency: "weekly", interval: 1 },
  { key: "monthly", de: "monatlich", en: "monthly", frequency: "monthly", interval: 1 },
  { key: "monthly_weekday", de: "monatlich am Wochentag (z.B. letzter Do)", en: "monthly on a weekday (e.g. last Thu)", frequency: "monthly", interval: 1 },
  { key: "quarterly", de: "vierteljährlich", en: "quarterly", frequency: "monthly", interval: 3 },
  { key: "halfyearly", de: "halbjährlich", en: "every six months", frequency: "monthly", interval: 6 },
  { key: "yearly", de: "jährlich", en: "yearly", frequency: "yearly", interval: 1 },
  { key: "every_n_months", de: "alle X Monate", en: "every X months", frequency: "monthly", interval: null },
  { key: "fixed_dates", de: "feste Termine im Jahr", en: "fixed dates each year", frequency: "fixed_dates", interval: 1 },
  { key: "rolling", de: "gleitend (ab letztem Termin)", en: "rolling (from the last date)", frequency: "rolling", interval: null },
  { key: "budget", de: "Budget pro Monat (variable Ausgaben)", en: "monthly budget (variable spending)", frequency: "budget", interval: 1 },
];

const NOTICE_UNITS = { days: ["Tage", "days"], weeks: ["Wochen", "weeks"], months: ["Monate", "months"] };
const shortDay = (isoDate) => fmtDate(isoDate, { day: "2-digit", month: "2-digit" });
const shortDate = (isoDate) => fmtDate(isoDate, { day: "2-digit", month: "2-digit", year: "2-digit" });

const unitLabel = (n, unit) =>
  unit === "weeks" ? (n === 1 ? tr("Woche", "week") : tr("Wochen", "weeks")) : n === 1 ? tr("Monat", "month") : tr("Monate", "months");

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Parse an amount typed with comma or dot as decimal separator.
 * "1.234,56", "1,234.56", "12,5" and "12.5" all work. With only one kind of
 * separator, `decimal` (the user's decimal separator) decides about cases like
 * "1.200": a thousands separator for German users, 1.2 for English ones.
 * Returns NaN if empty or invalid.
 */
const parseAmount = (value, decimal = ",") => {
  if (typeof value === "number") return value;
  let text = String(value ?? "").trim().replace(/[\s\u00a0\u202f']/g, "");
  if (!text) return NaN;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    text = text.split(decimal === "," ? "." : ",").join("").replace(decimal, ".");
  } else if (lastComma > -1) {
    const grouped = /^-?\d{1,3}(,\d{3})+$/.test(text) && (decimal === "." || text.split(",").length > 2);
    text = grouped ? text.replace(/,/g, "") : text.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(text) && (decimal === "," || text.split(".").length > 2)) {
    text = text.replace(/\./g, "");
  }
  return /^-?\d*\.?\d+$/.test(text) ? Number(text) : NaN;
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseIso = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

// ------------------------------------------------------------- bank CSV import
// The CSV is read in the browser only. Nothing but the ticked suggestions is
// sent to Home Assistant, as a normal import of new entries.

const CSV_COLUMNS = {
  date: ["datum", "buchungstag", "buchungsdatum", "date"],
  amount: ["betrag", "betrag (eur)", "betrag in eur", "umsatz", "amount"],
  name: ["name", "empfänger", "zahlungsempfänger", "auftraggeber/empfänger", "beguenstigter/zahlungspflichtiger", "name zahlungsbeteiligter", "payee"],
  purpose: ["zweck", "verwendungszweck", "purpose", "description"],
  category: ["kategorie", "category"],
  text: ["buchungstext", "art der zahlung", "umsatzart"],
  mandate: ["mandatsreferenz", "mandate reference"],
  creditor: ["gläubiger id", "glaeubiger id", "gläubiger-id", "creditor id"],
  account: ["konto", "auftragskonto", "eigenes konto", "account"],
  main: ["hauptkategorie", "main category"],
  counter: ["nummer", "iban zahlungsbeteiligter", "kontonummer/iban", "iban", "counterparty iban"],
};

/** Split CSV text into rows of fields; handles quotes and ; , or tab. */
function splitCsv(text, forced = null) {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
  const delimiter = forced || [";", "\t", ","].sort((a, b) => firstLines.split(b).length - firstLines.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCsvDate(value) {
  const s = String(value || "").trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(new Date(year, Number(m[2]) - 1, Number(m[1])));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Bookings from a bank CSV: [{date, amount, name, purpose, category, text, mandate, creditor}]. */
function parseBankCsv(text) {
  const rows = splitCsv(text.replace(/^﻿/, ""));
  const headerIndex = rows.findIndex((r) => {
    const cells = r.map((c) => c.trim().toLowerCase());
    return CSV_COLUMNS.date.some((n) => cells.includes(n)) && CSV_COLUMNS.amount.some((n) => cells.includes(n));
  });
  if (headerIndex < 0) throw new Error(tr("In der Datei fehlen die Spalten Datum und Betrag.", "The file has no date and amount columns."));
  const header = rows[headerIndex].map((c) => c.trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(CSV_COLUMNS).map(([key, names]) => [key, names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1]));
  const bookings = [];
  for (const r of rows.slice(headerIndex + 1)) {
    const get = (key) => (col[key] >= 0 ? String(r[col[key]] ?? "").trim() : "");
    const date = parseCsvDate(get("date"));
    const amount = parseAmount(get("amount").replace(/[€]|EUR/g, ""), ",");
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    const account = get("account").replace(/\s/g, "").toUpperCase();
    const counter = get("counter").replace(/\s/g, "").toUpperCase();
    bookings.push({ date, amount, name: get("name") || get("purpose").slice(0, 40), purpose: get("purpose"), category: get("category"), main: get("main"), text: get("text"), mandate: get("mandate"), creditor: get("creditor"), account, counter });
  }
  if (!bookings.length) throw new Error(tr("In der Datei wurden keine Umsätze gefunden.", "No transactions were found in the file."));
  return bookings;
}

/**
 * Drop transfers between the imported accounts: the counterparty is one of
 * them, or the same amount leaves one account and arrives in another within
 * three days. Returns {bookings, transfers}.
 */
function dropOwnTransfers(bookings) {
  const accounts = new Set(bookings.map((b) => b.account).filter(Boolean));
  if (accounts.size < 2) return { bookings, transfers: 0 };
  const drop = new Set(bookings.filter((b) => b.counter && accounts.has(b.counter) && b.counter !== b.account));
  const incoming = bookings.filter((b) => b.amount > 0 && !drop.has(b));
  for (const out of bookings.filter((b) => b.amount < 0 && !drop.has(b) && !b.counter)) {
    const days = isCardSettlement(out.name, out.purpose) ? 10 : 3;
    const twin = incoming.find((b) => !drop.has(b) && b.account !== out.account && Math.abs(b.amount + out.amount) < 0.005 && Math.abs(daysBetween(out.date, b.date)) <= days);
    if (twin) drop.add(out).add(twin);
  }
  return { bookings: bookings.filter((b) => !drop.has(b)), transfers: drop.size };
}

// ------------------------------------------------------------ other banks
// Outbank files keep the path above unchanged. Every other bank goes through
// the reader below: it finds the header line itself, copes with debit/credit
// columns, other date and number formats and SEPA tags in the purpose, and
// asks the user which column is what when it is not sure (remembered per header).

const BANK_FIELDS = ["date", "amount", "debit", "credit", "sign", "name", "payer", "purpose", "category", "text", "mandate", "creditor", "account", "counter"];
const BANK_ALIASES = {
  date: ["buchungstag", "buchungsdatum", "datum", "buchung", "booking date", "transaction date", "date", "wertstellung", "valutadatum", "valuta", "value date"],
  amount: ["betrag", "betrag (eur)", "betrag in eur", "betrag eur", "betrag (€)", "umsatz", "umsatz in eur", "betrag in euro", "amount", "amount (eur)", "value"],
  debit: ["soll", "belastung", "ausgang", "debit", "abgang", "lastschrift (eur)", "soll (eur)"],
  credit: ["haben", "gutschrift", "eingang", "credit", "zugang", "haben (eur)"],
  sign: ["soll/haben", "s/h", "soll haben", "kennung", "debit/credit", "credit/debit indicator"],
  name: ["name", "empfaenger", "zahlungsempfaenger", "zahlungsempfaenger*in", "auftraggeber/empfaenger", "auftraggeber / beguenstigter", "beguenstigter/zahlungspflichtiger", "beguenstigter/auftraggeber", "auftraggeber/zahlungsempfaenger", "empfaenger/zahlungspflichtiger", "name zahlungsbeteiligter", "name des zahlungsbeteiligten", "zahlungsbeteiligter", "gegenpartei", "payee", "counterparty", "partner name", "beneficiary", "name gegenkonto", "gegenueber", "gegenkonto name"],
  // Some banks name the payer of incoming money in a column of its own.
  payer: ["zahlungspflichtige*r", "zahlungspflichtiger", "auftraggeber", "auftraggeber*in", "payer"],
  purpose: ["verwendungszweck", "zweck", "vorgang/verwendungszweck", "verwendungszweck/ kundenreferenz", "buchungsdetails", "beschreibung", "purpose", "description", "payment reference", "reference", "details"],
  category: ["kategorie", "category"],
  text: ["buchungstext", "umsatzart", "art der zahlung", "vorgang", "transaction type", "type", "art"],
  mandate: ["mandatsreferenz", "mandatsref", "mandate reference", "mandate"],
  creditor: ["glaeubiger id", "glaeubiger-id", "glaeubiger identifikation", "glaeubigerid", "creditor id"],
  account: ["auftragskonto", "eigenes konto", "kontonummer auftraggeber", "konto", "account", "iban auftragskonto"],
  counter: ["iban zahlungsbeteiligter", "kontonummer/iban", "iban", "gegenkonto", "iban gegenkonto", "counterparty iban", "kontonummer"],
};
const normCell = (c) => String(c ?? "").replace(/^﻿/, "").trim().toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/\s+/g, " ").replace(/^"|"$/g, "");

/** True for an Outbank export, which keeps the original reader. */
function isOutbankCsv(text) {
  return text.split(/\r?\n/, 12).some((line) => /(^|[;,\t])hauptkategorie([;,\t]|$)/i.test(line) && /(^|[;,\t])kategoriepfad([;,\t]|$)/i.test(line));
}

/** Bytes to text: UTF-8, or Windows-1252 for older exports. */
function decodeBankBytes(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (err) {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 40);
  let best = ";";
  let bestScore = -1;
  for (const d of [";", "\t", ",", "|"]) {
    const counts = lines.map((l) => l.split(d).length - 1).filter((c) => c > 0);
    if (!counts.length) continue;
    const freq = {};
    for (const c of counts) freq[c] = (freq[c] || 0) + 1;
    const [mode, times] = Object.entries(freq).sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0];
    const score = times * 10 + Number(mode);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** Column of each field in a header line: exact name first, then a name that starts like it. */
function bankColumns(header) {
  const cells = header.map(normCell);
  const used = new Set();
  const columns = {};
  for (const exact of [true, false]) {
    for (const field of BANK_FIELDS) {
      if (columns[field] !== undefined) continue;
      for (const alias of BANK_ALIASES[field]) {
        const i = cells.findIndex((c, idx) => !used.has(idx) && c && (exact ? c === alias : c.startsWith(`${alias} `) || c.startsWith(`${alias}(`)));
        if (i >= 0) { columns[field] = i; used.add(i); break; }
      }
    }
  }
  return columns;
}

const DATE_PATTERNS = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/;
function detectDateFormat(values) {
  let dmy = 0;
  let mdy = 0;
  let ymd = 0;
  for (const v of values) {
    const s = String(v || "").trim();
    if (/^\d{8}$/.test(s)) { ymd++; continue; }
    const m = s.match(DATE_PATTERNS);
    if (!m) continue;
    if (m[1].length === 4) ymd++;
    else if (s.includes(".")) dmy++;
    else if (Number(m[1]) > 12) dmy++;
    else if (Number(m[2]) > 12) mdy++;
  }
  return ymd > dmy && ymd > mdy ? "ymd" : mdy > dmy ? "mdy" : "dmy";
}
function parseDateAs(value, format) {
  const s = String(value || "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const m = s.match(DATE_PATTERNS);
  if (!m) return null;
  let [y, mo, d] = format === "ymd" || m[1].length === 4 ? [m[1], m[2], m[3]] : format === "mdy" ? [m[3], m[1], m[2]] : [m[3], m[2], m[1]];
  if (y.length === 2) y = `20${y}`;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || Number(y) < 1990 || Number(y) > 2100) return null;
  return iso(date);
}
function detectDecimal(values) {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    const s = String(v || "").replace(/[^\d.,]/g, "");
    if (/,\d{1,2}$/.test(s)) comma++;
    else if (/\.\d{1,2}$/.test(s)) dot++;
  }
  return dot > comma ? "." : ",";
}
/** A money cell: "1.234,56", "-12.50", "12,00 EUR", "12,00 S", "12,00-". */
function parseMoneyCell(value, decimal) {
  let s = String(value || "").trim();
  if (!s) return NaN;
  let sign = 1;
  if (/\s?S$/i.test(s) && !/EUR$/i.test(s)) { sign = -1; s = s.replace(/\s?S$/i, ""); }
  else if (/\s?H$/i.test(s)) s = s.replace(/\s?H$/i, "");
  if (/-$/.test(s)) { sign = -sign; s = s.slice(0, -1); }
  if (/^\(.*\)$/.test(s)) { sign = -sign; s = s.slice(1, -1); }
  s = s.replace(/€|eur|euro/gi, "").replace(/^\+/, "").trim();
  const v = parseAmount(s, decimal);
  return Number.isFinite(v) ? v * sign : NaN;
}

/** SEPA tags in a purpose ("EREF+… MREF+… CRED+… SVWZ+…"). */
function parseSepaTags(text) {
  const s = String(text || "");
  if (!/\b(EREF|MREF|CRED|SVWZ|KREF|ABWA)\+/.test(s)) return null;
  const parts = {};
  const re = /\b(EREF|KREF|MREF|CRED|DEBT|SVWZ|ABWA|ABWE|IBAN|BIC|COAM|OAMT)\+/g;
  const marks = [...s.matchAll(re)];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : s.length;
    parts[m[1]] = s.slice(m.index + m[0].length, end).trim();
  });
  const before = s.slice(0, marks[0].index).trim();
  return { purpose: [parts.SVWZ || "", before].filter(Boolean).join(" ").trim(), mandate: parts.MREF || "", creditor: parts.CRED || "", name: parts.ABWA || "" };
}

/** The Haushaltsbuch category of a booking from its texts, or "" without a rule. */
function ruleCategory(b) {
  const haystack = `${b.name} ${b.purpose}`.toLowerCase();
  for (const [re, category] of CSV_CATEGORY_RULES) if (re.test(haystack)) return category;
  return "";
}

/** Error that opens the "which column is what" dialog instead of a message. */
const needsMapping = (info) => Object.assign(new Error(tr("Die Spalten der Datei wurden nicht sicher erkannt.", "The file's columns were not recognised reliably.")), { needsMapping: true, info });

/** Header line and column guess of a CSV that is not from Outbank. */
function guessBankLayout(text) {
  const delimiter = detectDelimiter(text);
  const rows = splitCsv(text.replace(/^﻿/, ""), delimiter).filter((r) => r.some((c) => String(c).trim()));
  let headerRow = -1;
  let columns = {};
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const c = bankColumns(rows[i]);
    if (c.date !== undefined && (c.amount !== undefined || c.debit !== undefined || c.credit !== undefined)) { headerRow = i; columns = c; break; }
  }
  const sample = headerRow >= 0 ? rows.slice(headerRow + 1, headerRow + 41) : rows.slice(0, 40);
  const col = (field) => sample.map((r) => r[columns[field]]);
  return {
    rows,
    delimiter,
    headerRow,
    columns,
    date: columns.date !== undefined ? detectDateFormat(col("date")) : "dmy",
    decimal: detectDecimal([...(columns.amount !== undefined ? col("amount") : []), ...(columns.debit !== undefined ? col("debit") : []), ...(columns.credit !== undefined ? col("credit") : [])]),
  };
}

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const CREDITOR_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]{3,28}$/;
const MONEY_RE = /^[-+(]?\s?\d{1,3}([.,'\s]?\d{3})*([.,]\d{1,2})?\s?(€|eur)?\s?[-)SH]?$/i;

/** How well the values of a column fit a field: {fit, of} over the first data rows. */
function columnFit(rows, headerRow, index, field, dateFormat, decimal) {
  const values = rows.slice(headerRow + 1, headerRow + 41).map((r) => String(r[index] ?? "").trim());
  const filled = values.filter(Boolean);
  const test = {
    date: (v) => Boolean(parseDateAs(v, dateFormat)),
    amount: (v) => MONEY_RE.test(v) && Number.isFinite(parseMoneyCell(v, decimal)),
    debit: (v) => MONEY_RE.test(v),
    credit: (v) => MONEY_RE.test(v),
    sign: (v) => /^(s|h|soll|haben|d|c|dbit|crdt|debit|credit|\+|-)$/i.test(v),
    account: (v) => IBAN_RE.test(v.replace(/\s/g, "").toUpperCase()) || /^\d{5,12}$/.test(v),
    counter: (v) => IBAN_RE.test(v.replace(/\s/g, "").toUpperCase()) || /^\d{5,12}$/.test(v),
    creditor: (v) => CREDITOR_RE.test(v.replace(/\s/g, "").toUpperCase()) && /ZZZ/i.test(v),
    mandate: (v) => /^[\w./+-]{3,35}$/.test(v),
  }[field] || ((v) => /\p{L}/u.test(v));
  // Debit and credit columns are often empty in every other row.
  const base = ["debit", "credit"].includes(field) ? filled : values;
  return { fit: base.filter((v) => v && test(v)).length, of: base.length };
}

/**
 * Columns suggested from their contents, for files whose headings say nothing.
 * Keeps what the headings already gave.
 */
function suggestColumns(rows, headerRow, columns, dateFormat, decimal) {
  const result = { ...columns };
  const suggested = new Set();
  const width = Math.max(0, ...rows.slice(headerRow, headerRow + 20).map((r) => r.length));
  const used = new Set(Object.values(result));
  const free = () => Array.from({ length: width }, (_, i) => i).filter((i) => !used.has(i));
  const score = (i, field) => {
    const f = columnFit(rows, headerRow, i, field, dateFormat, decimal);
    return f.of ? f.fit / f.of : 0;
  };
  const take = (field, i) => { result[field] = i; used.add(i); suggested.add(field); };
  const sample = (i) => rows.slice(headerRow + 1, headerRow + 41).map((r) => String(r[i] ?? "").trim());
  if (result.date === undefined) {
    const best = free().find((i) => score(i, "date") >= 0.8);
    if (best !== undefined) take("date", best);
  }
  if (result.amount === undefined && result.debit === undefined && result.credit === undefined) {
    const money = free().filter((i) => score(i, "amount") >= 0.8 && sample(i).some((v) => /\d/.test(v)));
    // A column with minus signs is the amount; one without is often the balance.
    const signed = money.find((i) => sample(i).some((v) => /^-|-$|^\(/.test(v)));
    if (signed !== undefined) take("amount", signed);
    else {
      const halves = free().filter((i) => score(i, "debit") >= 0.8 && sample(i).some(Boolean) && sample(i).some((v) => !v));
      if (halves.length >= 2) { take("debit", halves[0]); take("credit", halves[1]); }
      else if (money.length) take("amount", money[0]);
    }
  }
  if (result.creditor === undefined) {
    const c = free().find((i) => sample(i).some((v) => /ZZZ/.test(v)) && score(i, "creditor") >= 0.3);
    if (c !== undefined) take("creditor", c);
  }
  const ibans = free().filter((i) => score(i, "counter") >= 0.5 && sample(i).some((v) => IBAN_RE.test(v.replace(/\s/g, "").toUpperCase())));
  for (const i of ibans) {
    const distinct = new Set(sample(i).filter(Boolean)).size;
    if (distinct === 1 && result.account === undefined) take("account", i);
    else if (distinct > 1 && result.counter === undefined) take("counter", i);
  }
  const texts = free().map((i) => {
    const v = sample(i).filter(Boolean);
    return { i, share: score(i, "name"), len: v.reduce((a, x) => a + x.length, 0) / Math.max(1, v.length), distinct: new Set(v).size / Math.max(1, v.length) };
  }).filter((t) => t.share >= 0.6);
  // Text columns: a clearly longer one is the purpose; otherwise banks put the payee first.
  const byLength = [...texts].sort((a, b) => b.len - a.len);
  if (result.purpose === undefined && byLength.length && byLength[0].len >= 15 && (byLength.length === 1 || byLength[0].len >= 1.8 * byLength[1].len)) {
    take("purpose", byLength[0].i);
    texts.splice(texts.indexOf(byLength[0]), 1);
  }
  if (result.name === undefined && texts.length) take("name", texts[0].i);
  if (result.purpose === undefined && texts.length > 1) take("purpose", texts[1].i);
  return { columns: result, suggested };
}

/** The line with the headings when no known heading was found: the one above the first dated line. */
function guessHeaderRow(rows) {
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const format = detectDateFormat(rows[i]);
    if (rows[i].some((c) => parseDateAs(String(c).trim(), format)) && rows[i].filter((c) => String(c).trim()).length >= 3) return Math.max(0, i - 1);
  }
  return 0;
}

const bankSignature = (rows, headerRow) => (rows[headerRow] || []).map(normCell).join(";").slice(0, 300);

/** Bookings of a CSV that is not from Outbank, with an optional hand-made profile. */
function parseGenericCsv(text, profiles = {}, force = null) {
  const layout = guessBankLayout(text);
  let { rows, headerRow, columns, date: dateFormat, decimal } = layout;
  const known = headerRow >= 0 ? profiles[bankSignature(rows, headerRow)] : null;
  // A remembered profile may have its header further down than the guess found.
  const profile = force || known || Object.values(profiles).find((p) => rows[p.header_row] && profiles[bankSignature(rows, p.header_row)] === p) || null;
  if (profile) {
    headerRow = profile.header_row;
    columns = profile.columns;
    dateFormat = profile.date || dateFormat;
    decimal = profile.decimal || decimal;
  }
  const info = { ...layout, headerRow: Math.max(0, headerRow), columns, date: dateFormat, decimal };
  if (headerRow < 0 || columns.date === undefined || (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined)) throw needsMapping(info);
  // Without payee and purpose nothing could be matched: better ask once.
  if (!profile && columns.name === undefined && columns.purpose === undefined) throw needsMapping(info);
  // Banks without an account column often name the IBAN above the table.
  const ibanAbove = rows.slice(0, headerRow).flat().map((c) => String(c).replace(/\s/g, "").toUpperCase()).find((c) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(c)) || "";
  const bookings = [];
  let bad = 0;
  for (const r of rows.slice(headerRow + 1)) {
    const get = (field) => (columns[field] !== undefined && columns[field] >= 0 ? String(r[columns[field]] ?? "").trim() : "");
    const day = parseDateAs(get("date"), dateFormat);
    let amount;
    if (columns.amount !== undefined) {
      amount = parseMoneyCell(get("amount"), decimal);
      const sign = get("sign").toLowerCase();
      if (sign) amount = Math.abs(amount) * (/^(s|d|soll|debit|dbit|-|belastung|ausgang)/.test(sign) ? -1 : 1);
    } else {
      const debit = parseMoneyCell(get("debit"), decimal);
      const credit = parseMoneyCell(get("credit"), decimal);
      amount = (Number.isFinite(credit) ? Math.abs(credit) : 0) - (Number.isFinite(debit) ? Math.abs(debit) : 0);
    }
    if (!day || !Number.isFinite(amount) || amount === 0) {
      if (r.filter((c) => String(c).trim()).length > 2) bad++;
      continue;
    }
    let purpose = get("purpose");
    let mandate = get("mandate");
    let creditor = get("creditor");
    let name = (amount > 0 && get("payer")) || get("name");
    const sepa = parseSepaTags(purpose);
    if (sepa) {
      purpose = sepa.purpose;
      mandate ||= sepa.mandate;
      creditor ||= sepa.creditor;
      name ||= sepa.name;
    }
    mandate ||= purpose.match(/mandat(?:sreferenz|sref\.?|s-?ref)?:?\s+([A-Z0-9][\w./-]{2,34})/i)?.[1] || "";
    creditor ||= purpose.match(/gl(?:ä|ae)ubiger-?(?:id|identifikation)?:?\s+([A-Z]{2}\d{2}[A-Z0-9]{3,30})/i)?.[1] || "";
    const b = {
      date: day, amount, name: name || purpose.slice(0, 40), purpose, category: get("category"), main: "", text: get("text"), mandate, creditor,
      account: get("account").replace(/\s/g, "").toUpperCase() || ibanAbove, counter: get("counter").replace(/\s/g, "").toUpperCase(), generic: true,
    };
    if (!b.category) b.category = ruleCategory(b);
    b.main = b.category;
    bookings.push(b);
  }
  // Mostly unreadable rows: the guess is wrong, so ask.
  if (!bookings.length || (!profile && bad > bookings.length)) throw needsMapping(info);
  return bookings;
}

// ------------------------------------------------------------ CAMT.053
const xmlKids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const xmlPath = (el, path) => path.split("/").reduce((node, name) => (node ? xmlKids(node, name)[0] || null : null), el);
const xmlText = (el, path) => (xmlPath(el, path)?.textContent || "").trim();

/** Bookings of a CAMT.053 statement (ISO 20022 XML). */
function parseCamt(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error(tr("Die XML-Datei ist beschädigt.", "The XML file is damaged."));
  const statements = [...doc.getElementsByTagNameNS("*", "Stmt"), ...doc.getElementsByTagNameNS("*", "Rpt")];
  const bookings = [];
  for (const st of statements) {
    const account = (xmlText(st, "Acct/Id/IBAN") || xmlText(st, "Acct/Id/Othr/Id")).replace(/\s/g, "").toUpperCase();
    for (const entry of xmlKids(st, "Ntry")) {
      if (xmlText(entry, "Sts") && !/BOOK/.test(xmlText(entry, "Sts"))) continue;
      const debit = xmlText(entry, "CdtDbtInd") === "DBIT";
      const day = (xmlText(entry, "BookgDt/Dt") || xmlText(entry, "BookgDt/DtTm") || xmlText(entry, "ValDt/Dt")).slice(0, 10);
      const details = xmlKids(xmlPath(entry, "NtryDtls"), "TxDtls");
      const entryAmount = Number(xmlText(entry, "Amt"));
      const parts = details.length ? details : [null];
      for (const tx of parts) {
        const own = tx && (xmlText(tx, "Amt") || xmlText(tx, "AmtDtls/TxAmt/Amt"));
        const value = parts.length > 1 && own ? Number(own) : entryAmount;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(value) || !value) continue;
        const txDebit = tx && xmlText(tx, "CdtDbtInd") ? xmlText(tx, "CdtDbtInd") === "DBIT" : debit;
        const other = txDebit ? "Cdtr" : "Dbtr";
        const name = tx ? (xmlText(tx, `RltdPties/${other}/Nm`) || xmlText(tx, `RltdPties/${other}/Pty/Nm`) || xmlText(tx, `RltdPties/Ultmt${other}/Nm`)) : "";
        const purpose = tx ? xmlKids(xmlPath(tx, "RmtInf"), "Ustrd").map((u) => u.textContent.trim()).join(" ") : "";
        const info = xmlText(entry, "AddtlNtryInf") || (tx ? xmlText(tx, "AddtlTxInf") : "");
        const creditor = tx ? (xmlText(tx, "RltdPties/Cdtr/Id/PrvtId/Othr/Id") || xmlText(tx, "RltdPties/Cdtr/Pty/Id/PrvtId/Othr/Id") || xmlText(tx, "Refs/CdtrSchmeId/Id/PrvtId/Othr/Id")) : "";
        const b = {
          date: day, amount: Math.round((txDebit ? -1 : 1) * value * 100) / 100, name: name || info || purpose.slice(0, 40), purpose: purpose || info,
          category: "", main: "", text: info, mandate: tx ? xmlText(tx, "Refs/MndtId") : "", creditor: txDebit ? creditor : "",
          account, counter: (tx ? xmlText(tx, `RltdPties/${other}Acct/Id/IBAN`) : "").replace(/\s/g, "").toUpperCase(), generic: true,
        };
        b.category = ruleCategory(b);
        b.main = b.category;
        bookings.push(b);
      }
    }
  }
  if (!bookings.length) throw new Error(tr("In der CAMT-Datei wurden keine gebuchten Umsätze gefunden.", "No booked transactions were found in the CAMT file."));
  return bookings;
}
const isCamt = (text) => /<\?xml|<Document/i.test(text.slice(0, 500)) && /BkToCstmr(Stmt|AcctRpt)/.test(text.slice(0, 5000));

/** The CSV and XML files inside a ZIP (CAMT exports often come zipped). */
async function unzipBankFiles(buffer) {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(tr("Die ZIP-Datei ist beschädigt.", "The ZIP file is damaged."));
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = [];
  for (let n = 0; n < count && view.getUint32(p, true) === 0x02014b50; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(xml|csv|txt)$/i.test(name) || name.startsWith("__MACOSX")) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = new Uint8Array(buffer, start, size);
    let bytes;
    if (method === 0) bytes = data.slice().buffer;
    else if (method === 8) bytes = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
    else continue;
    files.push({ name, text: decodeBankBytes(bytes) });
  }
  return files;
}

/** Files from the file picker as {name, text}; ZIP archives are unpacked. */
async function readBankSources(files) {
  const sources = [];
  for (const f of files) {
    const buffer = await f.arrayBuffer();
    const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4) sources.push(...(await unzipBankFiles(buffer)).map((x) => ({ name: `${f.name}/${x.name}`, text: x.text })));
    else sources.push({ name: f.name, text: decodeBankBytes(buffer) });
  }
  return sources;
}

/** Bookings of one file: Outbank as before, CAMT, or any other CSV. */
function parseBankSource(source, profiles, force = null) {
  if (isCamt(source.text)) return { kind: "camt", bookings: parseCamt(source.text) };
  if (!force && isOutbankCsv(source.text)) return { kind: "outbank", bookings: parseBankCsv(source.text) };
  try {
    return { kind: "csv", bookings: parseGenericCsv(source.text, profiles, force) };
  } catch (err) {
    if (force || !err.needsMapping) throw err;
    // Whatever the earlier reader understood keeps working.
    try {
      return { kind: "csv", bookings: parseBankCsv(source.text) };
    } catch (ignored) {
      throw err;
    }
  }
}

const LEGAL_FORMS = /\b(gmbh( & co\.? kg)?|ag|se|kg|e\.?\s?v\.?|aktiengesellschaft|deutschland|europe|sales|mbh)\b\.?/gi;
const nameKey = (name) => name.toLowerCase().replace(LEGAL_FORMS, "").replace(/[^a-zäöüß ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(" ");
const tidyName = (name) => {
  const clean = name.replace(LEGAL_FORMS, "").replace(/[\/,]+$/, "").replace(/\s{2,}/g, " ").trim() || name.trim();
  return clean === clean.toUpperCase() ? clean.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : clean;
};

// Bank category or text → [category, icon] of the Haushaltsbuch.
const CSV_CATEGORY_RULES = [
  [/gehalt|lohn|bezüge|salary/, "Gehalt", "mdi:briefcase"],
  [/rundfunk|beitragsservice/, "Rundfunk", "mdi:radio-tower"],
  [/einspeis|photovoltaik|pv-anlage|solar/, "Photovoltaik", "mdi:solar-power-variant"],
  [/strom|energie|stadtwerke/, "Strom", "mdi:flash"],
  [/wasser/, "Wasser", "mdi:water"],
  [/handy|mobilfunk/, "Internet & Telefon", "mdi:cellphone"],
  [/internet|telefon|festnetz/, "Internet & Telefon", "mdi:router-wireless"],
  [/lebensversicherung|rentenversicherung|altersvorsorge/, "Versicherungen", "mdi:shield-check"],
  [/\bkfz|\bauto(?!mat)|\bpkw\b|motorrad/, "Auto", "mdi:car"],
  [/versicherung/, "Versicherungen", "mdi:shield-check"],
  [/miete|wohnen|nebenkosten/, "Wohnen", "mdi:home"],
  [/kredit|darlehen|finanzierung/, "Kredite", "mdi:bank"],
  [/sparen|sparplan|bauspar|depot/, "Sparen", "mdi:piggy-bank"],
  [/steuer|finanzamt/, "Steuern", "mdi:bank"],
  [/streaming|tv|musik/, "TV & Streaming", "mdi:television"],
  [/verein|mitglied/, "Vereine", "mdi:account-group"],
  [/kinder|kita|kindergarten/, "Kinder", "mdi:human-male-child"],
  [/gesundheit|apotheke|arzt|fitness/, "Gesundheit & Pflege", "mdi:heart-pulse"],
  [/lebensmittel|supermarkt/, "Lebensmittel", "mdi:cart"],
  [/tanken|tankstelle/, "Auto", "mdi:gas-station"],
];
function csvCategory(booking) {
  // Payee and purpose first, the bank's category ("Handy & Internet") only as fallback.
  for (const haystack of [`${booking.name} ${booking.purpose}`, booking.category].map((t) => t.toLowerCase())) {
    for (const [re, category, icon] of CSV_CATEGORY_RULES) if (re.test(haystack)) return { category, icon };
  }
  return { category: booking.category || tr("Sonstiges", "Other"), icon: "mdi:repeat" };
}

const CSV_RHYTHMS = [
  { min: 6, max: 8, frequency: "weekly", interval: 1, minCount: 4 },
  { min: 13, max: 16, frequency: "weekly", interval: 2, minCount: 3 },
  { min: 26, max: 35, frequency: "monthly", interval: 1, minCount: 3 },
  { min: 55, max: 66, frequency: "monthly", interval: 2, minCount: 3 },
  { min: 84, max: 98, frequency: "monthly", interval: 3, minCount: 2 },
  { min: 170, max: 195, frequency: "monthly", interval: 6, minCount: 2 },
  { min: 350, max: 380, frequency: "yearly", interval: 1, minCount: 2 },
];
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** Week of the month (1-4, or -1 for the last) if all dates share weekday and week. */
function commonWeekday(dates) {
  const days = dates.map(parseIso);
  const weekday = (days[0].getDay() + 6) % 7;
  if (!days.every((d) => (d.getDay() + 6) % 7 === weekday)) return null;
  const isLast = (d) => d.getDate() + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  if (days.every(isLast)) return { weekday, week: -1 };
  const week = Math.ceil(days[0].getDate() / 7);
  return week <= 4 && days.every((d) => Math.ceil(d.getDate() / 7) === week) ? { weekday, week } : null;
}

function nthWeekday(year, month, weekday, week) {
  if (week === -1) {
    const d = new Date(year, month + 1, 0);
    while ((d.getDay() + 6) % 7 !== weekday) d.setDate(d.getDate() - 1);
    return d;
  }
  const d = new Date(year, month, 1);
  while ((d.getDay() + 6) % 7 !== weekday) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * (week - 1));
  return d;
}

function nextDue(dateIso, rhythm) {
  const d = parseIso(dateIso);
  if (rhythm.frequency === "weekly") return iso(addDays(d, 7 * rhythm.interval));
  if (rhythm.weekday !== undefined) return iso(nthWeekday(d.getFullYear(), d.getMonth() + 1, rhythm.weekday, rhythm.week));
  const months = rhythm.frequency === "yearly" ? 12 : rhythm.interval;
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay)));
}

const CARD_PAYMENT = /karte|kartenzahlung|debitkarte|visa|girocard|pos\b/i;
/** A credit card bill paid from the current account: the real purchases are on the card. */
const CARD_SETTLEMENT = /american express|\bamex\b|kreditkarten?[- ]?(abrechnung|ausgleich|saldo|rechnung)|(visa|mastercard)[- ]?(card )?(abrechnung|ausgleich)|kartenabrechnung/i;
const isCardSettlement = (name, purpose) => CARD_SETTLEMENT.test(`${name || ""} ${purpose || ""}`);
const RARE_WORDS = /versicherung|steuer|beitrag|verein|mitglied|jahres|wartung|tüv|gebühr|abo\b|lizenz/i;

// Words that say what kind of contract it is, not with whom: "Lebensversicherung"
// must not match an item called "Autoversicherung".
const GENERIC_WORDS = /^(versicherung(en)?|\w*versicherung|steuer(n)?|\w*steuer|beitr(ag|äge)|rechnung|gebühr(en)?|vertrag|kredit|darlehen|miete|sparen|sparplan|lastschrift|überweisung|dauerauftrag|zahlung|abschlag|rate|monat(lich)?|jahr(es)?|kosten|konto|bank|service|online|abo|kunde|kunden|mandat|referenz|gmbh)$/;
const wordsOf = (text) => String(text || "").toLowerCase().replace(LEGAL_FORMS, " ").replace(/[^a-zäöüß ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_WORDS.test(w));

/**
 * How well does this existing item fit a payee (0 = not at all)? A name hit
 * counts most, but only with a similar amount; without a name the amount must
 * be (almost) exact and day or category must agree.
 */
function similarity(item, name, purpose, category, amount, day, amounts = [amount]) {
  const expected = Number(item.current_amount ?? item.amount) || 0;
  if (!expected || !amount) return 0;
  const diff = Math.abs(expected - amount) / Math.max(expected, amount);
  const words = wordsOf(item.name);
  const hit = (text) => {
    const bank = wordsOf(text);
    return words.some((w) => bank.some((x) => x === w || x.startsWith(w) || (x.length >= 5 && w.startsWith(x))));
  };
  const itemDay = Number(String(item.start_date).slice(8));
  const dayGap = day && itemDay ? Math.abs(itemDay - day) : 99;
  const sameDay = Math.min(dayGap, 31 - dayGap) <= 4;
  const sameCategory = item.category === category;
  if (hit(name) && diff <= 0.35) return 4 - diff;
  if (hit(purpose) && diff <= 0.15) return 3.5 - diff;
  // Without the name, one equal amount is chance: most bookings of the payee must fit.
  const fitting = amounts.filter((a) => Math.abs(expected - a) / Math.max(expected, a) <= 0.15).length;
  if (fitting < Math.max(1, amounts.length * 0.75)) return 0;
  if (amounts.length < 2 && !(sameDay && sameCategory && diff <= 0.01)) return 0;
  if (diff <= 0.01 && (sameDay || sameCategory)) return 3 - diff;
  if (sameCategory && sameDay && diff <= 0.15) return 2 - diff;
  if (sameCategory && diff <= 0.05) return 1.5 - diff;
  return 0;
}

/** The existing item that fits best, or undefined. */
function bestItem(items, direction, name, purpose, category, amount, day, amounts) {
  let best;
  let bestScore = 0;
  for (const item of items) {
    if (item.direction !== direction) continue;
    const score = similarity(item, name, purpose, category, amount, day, amounts);
    if (score > bestScore) [best, bestScore] = [item, score];
  }
  return best;
}

/**
 * Compare bank bookings with the existing items.
 * - bookings that belong to an item (remembered bank key or a look-alike) are
 *   matched to its open dates and confirmed, price changes are noticed;
 * - card payments of a budget's category become its spendings;
 * - the rest is checked for regular, rare and rolling payments.
 * `entries` are forecast entries of the own items over the file's period,
 * `history` is the answer of haushaltsbuch/bank/history.
 */
function analyzeBank(bookings, items, history, entries) {
  const from = bookings.reduce((m, b) => (b.date < m ? b.date : m), bookings[0].date);
  const to = bookings.reduce((m, b) => (b.date > m ? b.date : m), bookings[0].date);
  const recurringItems = items.filter((i) => i.schedule?.frequency !== "budget");
  const budgetItems = items.filter((i) => i.schedule?.frequency === "budget");
  const keyOwner = new Map();
  for (const i of items) for (const k of history[i.id]?.bank_keys || []) keyOwner.set(k, i);

  // Suggestions look at the last two years; older history only shows what comes once a year.
  const recentFrom = iso(addDays(parseIso(to), -730));
  const groups = new Map();
  for (const b of bookings) {
    b.direction = b.amount < 0 ? "expense" : "income";
    b.key = bankKeyOf(b);
    if (!groups.has(b.key)) groups.set(b.key, { key: b.key, list: [] });
    groups.get(b.key).list.push(b);
  }

  const used = new Set();
  const matches = [];
  const suggestions = [];
  const others = [];
  for (const group of groups.values()) {
    const full = group.list.sort((a, b) => a.date.localeCompare(b.date));
    const recent = full.filter((b) => b.date >= recentFrom);
    if (!recent.length) continue; // ended long ago (old flat, old provider)
    // One-off amounts within a regular series (annual settlement, refund) are looked at separately.
    const usual = median(recent.map((b) => Math.abs(b.amount)));
    const cardGroup = full.every((b) => CARD_PAYMENT.test(`${b.text} ${b.purpose}`));
    // A second booking in the same month of a monthly payee is extra, e.g. the annual statement.
    const extra = new Set();
    if (!cardGroup) {
      const byMonth = {};
      for (const b of full) (byMonth[b.date.slice(0, 7)] ||= []).push(b);
      for (const same of Object.values(byMonth)) {
        if (same.length < 2) continue;
        same.sort((x, y) => Math.abs(Math.abs(x.amount) - usual) - Math.abs(Math.abs(y.amount) - usual)).slice(1).forEach((b) => extra.add(b));
      }
    }
    const isOutlier = (b) => !cardGroup && recent.length >= 4 && (extra.has(b) || (Math.abs(Math.abs(b.amount) - usual) > usual * 0.5 && Math.abs(b.amount) > 20));
    const list = recent.filter((b) => !isOutlier(b));
    const outliers = full.filter(isOutlier);
    if (outliers.length) {
      const settlement = keyOwner.get(`${group.key}|y`);
      if (settlement) {
        const match = matchItem(settlement, outliers.filter((b) => b.date >= recentFrom), entries, history[settlement.id]);
        if (match.confirmations.length) matches.push({ ...match, priceChange: null, key: `i:${settlement.id}`, bankKey: `${group.key}|y`, item: settlement, bankName: tidyName(outliers[0].name), remembered: true, checked: true, bookings: outliers.filter((b) => b.date >= recentFrom) });
      } else {
        const yearly = settlementSuggestion(group, outliers, to);
        if (yearly) others.push({ ...yearly, checked: false, target: "new" });
      }
      outliers.forEach((b) => used.add(b));
    }
    if (!list.length) continue;
    const last = list[list.length - 1];
    const amount = Math.abs(last.amount);
    const { category, icon } = csvCategory(last);
    const card = list.every((b) => CARD_PAYMENT.test(`${b.text} ${b.purpose}`));
    const day = Number(last.date.slice(8));
    // 1. Known item: remembered key, otherwise a look-alike (not for card payments).
    let item = keyOwner.get(group.key);
    if (item?.schedule?.frequency === "budget") continue; // handled with the budgets below
    let remembered = Boolean(item);
    if (!item && !card) item = bestItem(recurringItems, last.direction, last.name, last.purpose, category, amount, day, list.map((b) => Math.abs(b.amount)));
    if (item) {
      // Known payee: never suggested again, even when there is nothing to confirm
      // (e.g. the item was entered after these bookings).
      const match = matchItem(item, list, entries, history[item.id]);
      list.forEach((b) => used.add(b));
      if (remembered && !match.confirmations.length && !match.priceChange) continue; // known and up to date
      matches.push({ ...match, key: `i:${item.id}`, bankKey: group.key, item, bankName: tidyName(last.name), remembered, checked: true, bookings: list });
      continue;
    }
    // 2. New regular payment; yearly ones also from the whole history.
    let suggestion = recurringSuggestion(group, list, to, category, icon);
    if (!suggestion && full.length > list.length) {
      const longRun = recurringSuggestion(group, full.filter((b) => !isOutlier(b)), to, category, icon);
      if (longRun && (longRun.schedule.frequency === "yearly" || longRun.schedule.interval >= 6)) suggestion = longRun;
    }
    if (suggestion) {
      full.forEach((b) => used.add(b));
      if (suggestion.schedule.frequency === "yearly") {
        const all = full.filter((b) => !isOutlier(b));
        Object.assign(suggestion, { count: all.length, first: all[0].date });
      }
    }
    if (suggestion) {
      list.forEach((b) => used.add(b));
      const twin = bestItem(recurringItems, suggestion.direction, suggestion.name, last.purpose, category, amount, day, list.map((b) => Math.abs(b.amount)));
      suggestions.push({ ...suggestion, existing: twin ? twin.name : null, checked: !twin, target: "new" });
      continue;
    }
    // 3. Rare (seen once, yearly?) or rolling (irregular but repeating).
    const other = card ? null : rareSuggestion(group, list, to, category, icon);
    const rolling = rollingSuggestion(group, list, to, category, icon);
    if (other || rolling) {
      list.forEach((b) => used.add(b));
      others.push({ ...(rolling || other), checked: false, target: "new" });
    }
  }

  // Budgets: card payments by bank category, from the last two years.
  const months = Math.max(1, daysBetween(from > recentFrom ? from : recentFrom, to) / 30.4);
  const byCategory = new Map();
  for (const b of bookings) {
    if (used.has(b) || b.amount > 0 || b.date < recentFrom) continue;
    const { category, icon } = csvCategory(b);
    const name = b.category || category;
    if (!byCategory.has(name)) byCategory.set(name, { name, category, icon, total: 0, list: [] });
    const entry = byCategory.get(name);
    entry.total += -b.amount;
    entry.list.push(b);
  }
  // Which budget? A remembered bank category, or a word of the budget's name in
  // the bank category ("Tanken" ↔ "Tankstelle"), payee or purpose. The category
  // alone only counts for a budget named like it ("Auto" takes all car costs,
  // "Tanken" in category Auto does not take the workshop).
  const stems = (text) => wordsOf(text).map((w) => w.slice(0, Math.max(4, w.length - 2)));
  const budgetStems = budgetItems.map((i) => ({ item: i, stems: stems(i.name) }));
  const stemHit = (text, list) => {
    const words = wordsOf(text);
    return list.some((st) => words.some((w) => w.startsWith(st)));
  };
  const assigned = new Map();
  const assign = (budget, b, learnKey) => {
    if (!assigned.has(budget.id)) assigned.set(budget.id, { budget, list: [], keys: new Set() });
    const entry = assigned.get(budget.id);
    entry.list.push(b);
    if (learnKey) entry.keys.add(learnKey);
  };
  for (const c of [...byCategory.values()]) {
    const remembered = keyOwner.get(`c:${c.name}`);
    const byBankCategory = remembered?.schedule?.frequency === "budget" ? remembered : budgetStems.find((x) => stemHit(c.name, x.stems))?.item;
    const rest = [];
    for (const b of c.list) {
      const byPayee = keyOwner.get(b.key);
      if (byPayee?.schedule?.frequency === "budget") { assign(byPayee, b, null); continue; }
      if (byBankCategory) { assign(byBankCategory, b, `c:${c.name}`); continue; }
      const byText = budgetStems.find((x) => stemHit(`${b.name} ${b.purpose}`, x.stems))?.item;
      const sameCategory = budgetItems.filter((i) => i.category === c.category);
      const generic = sameCategory.length === 1 && sameCategory[0].name.toLowerCase() === sameCategory[0].category.toLowerCase() ? sameCategory[0] : null;
      if (byText || generic) assign(byText || generic, b, null);
      else rest.push(b);
    }
    c.list = rest;
    c.total = rest.reduce((t, b) => t - b.amount, 0);
  }
  const budgetMatches = [];
  for (const { budget, list, keys } of assigned.values()) {
    // Entered by hand already? Same amount within two days counts as the same purchase.
    const known = (history[budget.id]?.spendings || []).map(([date, amount]) => ({ date, amount, taken: false }));
    const fresh = list.filter((b) => {
      if (b.date < budget.start_date) return false;
      const twin = known.find((k) => !k.taken && Math.abs(k.amount - Math.abs(b.amount)) < 0.005 && Math.abs(daysBetween(k.date, b.date)) <= 2);
      if (twin) twin.taken = true;
      return !twin;
    }).sort((x, y) => y.date.localeCompare(x.date));
    if (!fresh.length) continue;
    budgetMatches.push({
      key: `s:${budget.id}`,
      item: budget,
      bankKeys: [...keys],
      remembered: [...keys].every((k) => keyOwner.get(k) === budget),
      spendings: fresh.map((b) => ({ target: budget.id, date: b.date, amount: Math.abs(b.amount), note: tidyName(b.name), category: csvCategory(b).category })),
      bookings: fresh,
      checked: true,
    });
  }
  // Recent payments that fit no budget can still be assigned by hand.
  const earliest = budgetItems.reduce((m, i) => (i.start_date < m ? i.start_date : m), "9999");
  const loose = [...byCategory.values()].flatMap((c) => c.list).filter((b) => b.date >= earliest).sort((x, y) => y.date.localeCompare(x.date));
  if (loose.length) {
    budgetMatches.push({
      key: "s:rest",
      rest: true,
      item: { id: "rest", name: tr("Weitere Zahlungen", "Other payments"), icon: "mdi:help-circle-outline" },
      bankKeys: [],
      remembered: true,
      spendings: loose.map((b) => ({ target: "skip", date: b.date, amount: Math.abs(b.amount), note: tidyName(b.name), category: csvCategory(b).category })),
      bookings: loose,
      checked: true,
    });
  }
  const budgets = [];
  for (const c of byCategory.values()) {
    if (c.list.length && c.list.length >= months * 2 && c.category !== tr("Sonstiges", "Other")) {
      budgets.push({ key: `b:${c.name}`, name: c.name, category: c.category, icon: c.icon, amount: Math.ceil(c.total / months / 10) * 10, count: c.list.length, bankKey: `c:${c.name}`, cardPayments: c.list, checked: false });
    }
  }
  budgets.sort((a, b) => b.amount - a.amount).splice(3);
  suggestions.sort((a, b) => (a.direction === b.direction ? b.amount / (b.schedule.interval || 1) - a.amount / (a.schedule.interval || 1) : a.direction === "income" ? -1 : 1));
  return { matches: [...matches, ...budgetMatches], suggestions, others, budgets, from, to, count: bookings.length };
}

const bankKeyOf = (b) => (b.creditor ? `m:${b.creditor}|${b.mandate}` : `n:${nameKey(b.name)}|${b.amount < 0 ? "expense" : "income"}`);

/** Annual settlement: unusual amounts of a regular payee, about the same time every year. */
function settlementSuggestion(group, outliers, to) {
  const years = new Set(outliers.map((b) => b.date.slice(0, 4)));
  if (years.size < 2) return null;
  const last = outliers[outliers.length - 1];
  if (daysBetween(last.date, to) > 420) return null;
  const dayOfYear = (b) => daysBetween(`${b.date.slice(0, 4)}-01-01`, b.date);
  const ref = dayOfYear(last);
  const near = outliers.filter((b) => {
    const diff = Math.abs(dayOfYear(b) - ref);
    return Math.min(diff, 365 - diff) <= 45;
  });
  if (new Set(near.map((b) => b.date.slice(0, 4))).size < 2) return null;
  const amounts = near.map((b) => b.amount);
  const typical = median(amounts.map(Math.abs));
  const refunds = amounts.filter((a) => a > 0).length;
  const direction = refunds > amounts.length / 2 ? "income" : "expense";
  const { category, icon } = csvCategory(last);
  const next = nextDue(last.date, { frequency: "yearly", interval: 1 });
  return {
    key: `${group.key}|y`, bankKey: `${group.key}|y`, kind: "settlement",
    name: tr(`Jahresabrechnung ${tidyName(last.name)}`, `Annual statement ${tidyName(last.name)}`),
    direction, amount: Math.round(typical * 100) / 100, variance: 100, category, icon: direction === "income" ? "mdi:cash-refund" : "mdi:file-document-alert",
    count: near.length, years: [...new Set(near.map((b) => b.date.slice(0, 4)))].sort(), mixed: refunds > 0 && refunds < amounts.length,
    first: near[0].date, last: last.date, due: last.date, next, debit: false,
    schedule: { frequency: "yearly", interval: 1, unit: "months" }, tolerance: 30, certainty: "unsicher",
  };
}

/** Bookings of an existing item → confirmations of its open dates, and a possible price change. */
function matchItem(item, list, entries, history) {
  const confirmed = new Set(history?.confirmed || []);
  const open = entries.filter((e) => e.item_id === item.id && e.status === null && !confirmed.has(e.due_date));
  const window = Math.max(10, (item.date_tolerance_days || 0) + 7);
  const taken = new Set();
  const confirmations = [];
  const pairs = [];
  for (const b of list) {
    const best = open
      .filter((e) => !taken.has(e.due_date) && Math.abs(daysBetween(e.date, b.date)) <= window)
      .sort((x, y) => Math.abs(daysBetween(x.date, b.date)) - Math.abs(daysBetween(y.date, b.date)))[0];
    if (!best) continue;
    taken.add(best.due_date);
    confirmations.push({ item_id: item.id, due_date: best.due_date, actual_date: b.date, actual_amount: Math.abs(b.amount) });
    pairs.push({ due: best.due_date, expected: Math.abs(best.amount), actual: Math.abs(b.amount) });
  }
  // Price change: the last bookings agree with each other but not with the item.
  let priceChange = null;
  const variance = Number(item.amount_variance_pct) || 0;
  const recent = pairs.slice(-3);
  if (variance === 0 && recent.length >= 2) {
    const now = recent[recent.length - 1].actual;
    const steady = recent.every((p) => Math.abs(p.actual - now) < 0.01);
    const differs = Math.abs(recent[recent.length - 1].expected - now) > Math.max(0.5, now * 0.005);
    if (steady && differs) {
      let firstNew = pairs.length - 1;
      while (firstNew > 0 && Math.abs(pairs[firstNew - 1].actual - now) < 0.01) firstNew--;
      priceChange = { item_id: item.id, from: pairs[firstNew].due, amount: now, before: recent[recent.length - 1].expected, checked: true };
    }
  }
  return { confirmations, priceChange, lastDate: list[list.length - 1].date };
}

function recurringSuggestion(group, list, to, category, icon) {
  if (list.length < 2) return null;
  const gaps = list.slice(1).map((b, i) => daysBetween(list[i].date, b.date)).filter((g) => g > 3);
  if (!gaps.length) return null;
  const gap = median(gaps);
  let rhythm = CSV_RHYTHMS.find((r) => gap >= r.min && gap <= r.max);
  if (!rhythm || list.length < rhythm.minCount) return null;
  if (gaps.filter((g) => Math.abs(g - gap) > gap * 0.25).length > gaps.length / 4) return null;
  const last = list[list.length - 1];
  // A booking that stopped well before the end of the file is probably cancelled.
  if (daysBetween(last.date, to) > gap * 1.6) return null;
  const sameDay = list.every((b) => b.date.slice(8) === list[0].date.slice(8));
  const weekdayRule = rhythm.frequency === "monthly" && rhythm.interval === 1 && !sameDay ? commonWeekday(list.map((b) => b.date)) : null;
  if (weekdayRule) rhythm = { ...rhythm, ...weekdayRule };
  const amount = Math.abs(last.amount);
  // A step in the amount (e.g. new electricity instalment) is a price change, not a variation.
  let since = list.length - 1;
  while (since > 0 && Math.abs(Math.abs(list[since - 1].amount) - amount) < 0.01) since--;
  const steadyNow = list.length - since >= 2 && since > 0;
  const considered = steadyNow ? list.slice(since) : list.slice(-6);
  const spread = Math.max(...considered.map((b) => Math.abs(Math.abs(b.amount) - amount))) / amount;
  const variance = spread < 0.005 ? 0 : Math.min(100, Math.ceil((spread * 100) / 5) * 5);
  // Nominal date: the usual day of the month when booked after a weekend.
  let due = last.date;
  if (rhythm.frequency !== "weekly" && !weekdayRule) {
    const counts = {};
    for (const b of list) counts[b.date.slice(8)] = (counts[b.date.slice(8)] || 0) + 1;
    const usual = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
    const d = parseIso(last.date);
    const candidate = new Date(d.getFullYear(), d.getMonth(), Math.min(usual, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    if (Math.abs(daysBetween(iso(candidate), last.date)) <= 4) due = iso(candidate);
  }
  return {
    key: group.key,
    bankKey: group.key,
    name: category === "Gehalt" ? tr("Gehalt", "Salary") : tidyName(last.name),
    direction: last.direction,
    amount,
    variance,
    category,
    icon,
    count: list.length,
    first: list[0].date,
    last: last.date,
    due,
    next: nextDue(due, rhythm),
    debit: Boolean(last.mandate || /lastschrift/i.test(last.text)),
    priceStep: steadyNow ? { since: list[since].date, before: Math.abs(list[since - 1].amount) } : null,
    schedule: { frequency: rhythm.frequency, interval: rhythm.interval, unit: "months", ...(weekdayRule || {}) },
    tolerance: 0,
    certainty: variance > 20 ? "unsicher" : variance > 0 ? "wahrscheinlich" : "sicher",
  };
}

/** Seen once, looks like a yearly fee (insurance, club, tax): ask whether it repeats. */
function rareSuggestion(group, list, to, category, icon) {
  if (list.length !== 1) return null;
  const b = list[0];
  if (b.amount > -30 || !RARE_WORDS.test(`${b.name} ${b.purpose} ${b.category}`)) return null;
  // In a file of more than a year it would have come again already.
  if (daysBetween(b.date, to) > 380) return null;
  const rhythm = { frequency: "yearly", interval: 1 };
  return {
    key: group.key, bankKey: group.key, kind: "rare",
    name: tidyName(b.name), direction: "expense", amount: -b.amount, variance: 0, category, icon,
    count: 1, first: b.date, last: b.date, due: b.date, next: nextDue(b.date, rhythm),
    debit: Boolean(b.mandate || /lastschrift/i.test(b.text)),
    schedule: { frequency: "yearly", interval: 1, unit: "months" }, tolerance: 14, certainty: "unsicher",
  };
}

/** Irregular but repeating, like the hairdresser: rolling from the last date. */
function rollingSuggestion(group, list, to, category, icon) {
  if (list.length < 3) return null;
  const gaps = list.slice(1).map((b, i) => daysBetween(list[i].date, b.date));
  const gap = median(gaps);
  if (gap < 20 || gap > 120 || Math.min(...gaps) < 10) return null;
  const last = list[list.length - 1];
  if (daysBetween(last.date, to) > gap * 2) return null;
  const amounts = list.map((b) => Math.abs(b.amount));
  const avg = amounts.reduce((a, x) => a + x, 0) / amounts.length;
  const spread = Math.max(...amounts.map((a) => Math.abs(a - avg))) / avg;
  if (spread > 0.4) return null;
  const weeks = gap < 63;
  const interval = Math.max(1, Math.round(weeks ? gap / 7 : gap / 30.4));
  const unit = weeks ? "weeks" : "months";
  return {
    key: group.key, bankKey: group.key, kind: "rolling",
    name: tidyName(last.name), direction: last.direction, amount: Math.round(avg * 100) / 100,
    variance: Math.min(100, Math.ceil((spread * 100) / 5) * 5), category, icon,
    count: list.length, first: list[0].date, last: last.date, due: last.date,
    next: iso(addDays(parseIso(last.date), Math.round(gap))), debit: false, learnedDays: Math.round(gap),
    schedule: { frequency: "rolling", interval, unit }, tolerance: 0, certainty: "wahrscheinlich",
  };
}

function presetOf(schedule) {
  const { frequency, interval } = schedule || {};
  if (frequency === "monthly" && schedule.weekday !== undefined && schedule.weekday !== null) return "monthly_weekday";
  if (frequency === "monthly") {
    if (interval === 1) return "monthly";
    if (interval === 3) return "quarterly";
    if (interval === 6) return "halfyearly";
    return "every_n_months";
  }
  if (frequency === "yearly") return "yearly";
  if (frequency === "weekly") return "weekly";
  if (frequency === "fixed_dates") return "fixed_dates";
  if (frequency === "rolling") return "rolling";
  if (frequency === "budget") return "budget";
  return "once";
}

// Items that are booked every month (or more often) are the "normal" ones in
// the month view; everything else is a special item that stands out.
function isRegular(item) {
  const preset = presetOf(item?.schedule);
  return preset === "monthly" || preset === "monthly_weekday" || preset === "weekly" || preset === "rolling" || preset === "budget";
}

// Months between two bookings (Infinity for one-off items, 0 for frequent ones).
function intervalMonths(item) {
  const s = item?.schedule || {};
  if (s.frequency === "once") return Infinity;
  if (s.frequency === "monthly") return s.interval || 1;
  if (s.frequency === "yearly") return 12 * (s.interval || 1);
  if (s.frequency === "fixed_dates") return 12 / Math.max(1, (s.dates || []).length);
  return 0;
}

const SPECIAL_OPTIONS = [
  [2, "alles, was nicht jeden Monat kommt", "everything not due every month"],
  [3, "ab vierteljährlich", "quarterly or less often"],
  [6, "ab halbjährlich", "every six months or less often"],
  [12, "nur jährlich und einmalig", "only yearly and one-off"],
  [999, "nur einmalige Posten", "only one-off entries"],
];

function scheduleLabel(item) {
  const s = item.schedule || {};
  const preset = presetOf(s);
  if (preset === "every_n_months") return tr(`alle ${s.interval} Monate`, `every ${s.interval} months`);
  if (preset === "rolling") {
    if (item.learned_days) return tr(`gleitend, gelernt alle ~${item.learned_days} Tage`, `rolling, learned every ~${item.learned_days} days`);
    return tr(`gleitend, alle ${s.interval || 1} ${unitLabel(s.interval || 1, s.unit)}`, `rolling, every ${s.interval || 1} ${unitLabel(s.interval || 1, s.unit)}`);
  }
  if (preset === "budget") return tr("Budget pro Monat", "monthly budget");
  if (preset === "monthly_weekday") {
    const ord = WEEK_ORDINALS.find(([w]) => w === (s.week ?? -1)) || WEEK_ORDINALS[4];
    return tr(`jeden ${ord[1]} ${weekdayLong(s.weekday)} im Monat`, `every ${ord[2]} ${weekdayLong(s.weekday)} of the month`);
  }
  if (preset === "weekly" && s.interval > 1) return tr(`alle ${s.interval} Wochen`, `every ${s.interval} weeks`);
  if (preset === "yearly" && s.interval > 1) return tr(`alle ${s.interval} Jahre`, `every ${s.interval} years`);
  if (preset === "fixed_dates") return (s.dates || []).map((md) => fmtDate(`2020-${md}`, { day: "2-digit", month: "2-digit" })).join(" & ");
  return FREQUENCY_PRESETS.find((p) => p.key === preset)[LANG];
}

function monthlyEquivalent(item) {
  const s = item.schedule || {};
  const amount = Number(item.current_amount ?? item.amount) || 0;
  const interval = s.interval || 1;
  switch (s.frequency) {
    case "budget":
      return amount;
    case "weekly":
      return (amount * 52) / 12 / interval;
    case "monthly":
      return amount / interval;
    case "yearly":
      return amount / 12 / interval;
    case "fixed_dates":
      return (amount * (s.dates || []).length) / 12;
    case "rolling":
      if (item.learned_days) return (amount * 365) / 12 / item.learned_days;
      return s.unit === "weeks" ? (amount * 52) / 12 / interval : amount / interval;
    default:
      return 0;
  }
}

class HaushaltsbuchPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._state = null;
    this._scope = "me";
    this._view = "timeline";
    this._range = 30;
    this._month = today();
    this._month.setDate(1);
    this._selectedDay = null;
    this._forecast = null;
    this._calendar = null;
    this._summary = null;
    this._pending = [];
    this._dialog = null;
    this._error = null;
    this._loaded = false;
    try {
      this._incognito = localStorage.getItem(INCOGNITO_KEY) === "1";
    } catch (err) {
      this._incognito = false;
    }
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
    this.shadowRoot.addEventListener("mouseover", (ev) => {
      const help = ev.target.closest?.(".help");
      if (help && help !== this._helpFor) {
        this._showHelp(help);
        this._helpByHover = true;
      }
    });
    this.shadowRoot.addEventListener("mouseout", (ev) => {
      // Only a text opened by hovering closes when the mouse leaves; a tapped one stays.
      if (this._helpByHover && ev.target.closest?.(".help") && !ev.relatedTarget?.closest?.(".help")) this._hideHelp();
    });
    window.addEventListener("scroll", () => this._hideHelp(), { passive: true, capture: true });
    window.addEventListener("resize", () => {
      if (this._view !== "dashboard" || !this.isConnected) return;
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._render(), 200);
    });
    this.shadowRoot.addEventListener("change", (ev) => this._onChange(ev));
    this.shadowRoot.addEventListener("submit", (ev) => this._onSubmit(ev));
    this.shadowRoot.addEventListener("input", (ev) => {
      if (ev.target.name === "item-search") {
        this._search = ev.target.value;
        this._applySearch();
        return;
      }
      if (!SUGGEST_FIELDS.has(ev.target.name)) return;
      if (ev.target.name === "icon") {
        const preview = ev.target.closest("label")?.querySelector(".icon-preview");
        if (preview) preview.innerHTML = this._icon(ev.target.value.trim(), 20);
      }
      this._suggest(ev.target);
    });
    this.shadowRoot.addEventListener("focusin", (ev) => {
      if (SUGGEST_FIELDS.has(ev.target.name)) this._suggest(ev.target);
    });
    this.shadowRoot.addEventListener("focusout", (ev) => {
      if (!SUGGEST_FIELDS.has(ev.target.name)) return;
      const box = ev.target.closest(".suggest-field")?.querySelector(".suggest");
      if (box && !box.contains(ev.relatedTarget)) setTimeout(() => (box.hidden = true), 250);
    });
    this.shadowRoot.addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches?.('[role="button"][data-action]')) {
        ev.preventDefault();
        ev.target.click();
        return;
      }
      if (!SUGGEST_FIELDS.has(ev.target.name)) return;
      const box = ev.target.closest(".suggest-field")?.querySelector(".suggest");
      if (!box || box.hidden) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        box.hidden = true;
      } else if (ev.key === "Enter" && ev.target.name === "icon") {
        // Icons: Enter takes the best match. Categories: Enter keeps the typed text.
        const first = box.querySelector("[data-value]");
        if (first) {
          ev.preventDefault();
          this._pickSuggestion(ev.target, first.dataset.value);
        }
      } else if (ev.key === "Enter") {
        box.hidden = true;
      }
    });
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    const language = hass?.locale?.language || hass?.language || "de";
    setLanguage(language);
    DATE_LOCALE = LANG === "de" ? "de-DE" : language;
    if (first) this._reload();
    else this._updateMenuButton();
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this._narrow = value;
    this._updateMenuButton();
  }

  set panel(value) {
    this._panel = value;
  }

  // ------------------------------------------------------------------ data

  _ws(type, payload = {}) {
    return this._hass.callWS({ type: `haushaltsbuch/${type}`, ...payload });
  }

  async _reload() {
    try {
      this._state = await this._ws("state");
      if (this._scope !== "me" && !this._state.households.some((h) => h.id === this._scope)) this._scope = "me";
      await this._loadView();
      this._error = null;
    } catch (err) {
      this._error = this._errorText(err);
    }
    this._loaded = true;
    this._render();
  }

  async _loadView() {
    const scope = this._scope;
    const t = today();
    if (this._view === "timeline") {
      const [ahead, past] = await Promise.all([
        this._ws("forecast", { scope, start: iso(t), end: iso(addDays(t, this._range)) }),
        this._ws("forecast", { scope, start: iso(addDays(t, -21)), end: iso(addDays(t, -1)) }),
      ]);
      this._forecast = ahead;
      this._pending = past.days.flatMap((d) => d.entries).filter((e) => e.status === null);
    } else if (this._view === "calendar") {
      const first = new Date(this._month.getFullYear(), this._month.getMonth(), 1);
      const last = new Date(this._month.getFullYear(), this._month.getMonth() + 1, 0);
      this._calendar = await this._ws("forecast", { scope, start: iso(first), end: iso(last) });
    } else if (this._view === "months") {
      this._summary = await this._ws("summary", { scope, months: 12 });
    } else if (this._view === "households" && this._state.user.is_admin) {
      this._backups = await this._ws("backup/list");
    } else if (this._view === "stats") {
      const [ledger, history] = await Promise.all([this._ws("ledger/rows"), this._ws("bank/history")]);
      this._ledger = ledger;
      this._bankHistory = history;
    } else if (this._view === "dashboard") {
      const [trend, summary] = await Promise.all([
        this._ws("forecast", { scope, start: iso(t), end: iso(addDays(t, 90)) }),
        this._ws("summary", { scope, months: 12 }),
      ]);
      this._trend = trend;
      this._summary = summary;
    }
  }

  async _run(action) {
    try {
      await action();
      this._dialog = null;
      await this._reload();
    } catch (err) {
      this._error = this._errorText(err);
      this._render();
    }
  }

  /** Readable error text in the panel language. */
  _errorText(err) {
    const detail = err?.message || String(err);
    if (err?.code === "unauthorized") return tr(`Kein Zugriff: ${detail}`, `Access denied: ${detail}`);
    if (err?.code === "invalid_format") return tr(`Ungültiger Wert: ${detail}`, `Invalid value: ${detail}`);
    if (err?.code === "not_loaded") return tr("Haushaltsbuch ist nicht geladen.", "Household Budget is not loaded.");
    return detail;
  }

  // -------------------------------------------------------------- formatting

  /** Locale for numbers, following the number format in the user's HA profile. */
  _numberLocale() {
    const loc = this._hass?.locale || {};
    switch (loc.number_format) {
      case "comma_decimal":
      case "none":
        return "en-US";
      case "decimal_comma":
        return "de-DE";
      case "space_comma":
        return "fr-FR";
      case "system":
        return navigator.language || "de-DE";
      default:
        return loc.language || this._hass?.language || navigator.language || "de-DE";
    }
  }

  _decimalSeparator() {
    try {
      return new Intl.NumberFormat(this._numberLocale()).formatToParts(1.5).find((p) => p.type === "decimal")?.value || ",";
    } catch (err) {
      return ",";
    }
  }

  /** Value for an amount input field, written with the user's decimal separator. */
  _amountValue(value) {
    if (value === null || value === undefined || value === "") return "";
    const n = parseAmount(value, ".");
    if (!Number.isFinite(n)) return esc(value);
    const rounded = Math.round(n * 100) / 100;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)).replace(".", this._decimalSeparator());
  }

  /** Number from an amount field; empty or invalid input gives `empty`. */
  _parsedAmount(value, empty = "") {
    const n = parseAmount(value, this._decimalSeparator());
    return Number.isFinite(n) ? n : empty;
  }

  /** Attributes for a text field that takes an amount. */
  _amountAttrs(allowNegative = false) {
    const example = `12${this._decimalSeparator()}99`;
    return `type="text" inputmode="decimal" autocomplete="off" data-amount pattern="${allowNegative ? "-?" : ""}[0-9][0-9., ]*" title="${tr("Betrag, z.B.", "Amount, e.g.")} ${example}" placeholder="0${this._decimalSeparator()}00"`;
  }

  _moneyPlain(value) {
    const currency = this._state?.currency || "EUR";
    return `<span class="money">${new Intl.NumberFormat(this._numberLocale(), { style: "currency", currency }).format(value)}</span>`;
  }

  _money(value, signed = false) {
    const currency = this._state?.currency || "EUR";
    const text = new Intl.NumberFormat(this._numberLocale(), { style: "currency", currency }).format(Math.abs(value));
    const sign = value < 0 ? "−" : signed ? "+" : "";
    return `<span class="money">${sign}${text}</span>`;
  }

  _dateLabel(isoDate) {
    const d = parseIso(isoDate);
    const diff = Math.round((d - today()) / 86400000);
    const wd = weekdayName((d.getDay() + 6) % 7);
    const base = LANG === "de" ? `${wd}, ${d.getDate()}. ${monthName(d.getMonth())}` : `${wd}, ${monthName(d.getMonth())} ${d.getDate()}`;
    if (diff === 0) return `${tr("Heute", "Today")} · ${base}`;
    if (diff === 1) return `${tr("Morgen", "Tomorrow")} · ${base}`;
    return base;
  }

  _icon(icon, size = 24) {
    if (!icon) return `<span class="icon-fallback" style="--size:${size}px"></span>`;
    if (icon.startsWith("mdi:") || icon.includes(":")) return `<ha-icon icon="${esc(icon)}" style="--mdc-icon-size:${size}px"></ha-icon>`;
    return `<span class="emoji" style="font-size:${size - 4}px">${esc(icon)}</span>`;
  }

  _chip(certainty) {
    const c = CERTAINTY[certainty] || CERTAINTY.unsicher;
    return `<span class="chip" style="--chip:${c.color}">${c[LANG]}</span>`;
  }

  _templates() {
    return (LANG === "de" ? this._state.templates : this._state.templates_en) || this._state.templates || [];
  }

  _isHousehold() {
    return this._scope !== "me";
  }

  _applySearch() {
    const q = (this._search || "").trim().toLowerCase();
    for (const group of this.shadowRoot.querySelectorAll(".item-group")) {
      let visible = 0;
      for (const row of group.querySelectorAll(".entry")) {
        const hit = !q || row.dataset.search.includes(q);
        row.hidden = !hit;
        if (hit) visible++;
      }
      group.hidden = visible === 0;
    }
  }

  // Item object when the booking belongs to a special (not monthly) item, else null.
  _specialOf(e) {
    const item = this._state.items.find((i) => i.id === e.item_id);
    return this._isSpecial(item, e.amount) ? item : null;
  }

  // Whether a booking counts as special under the user's settings.
  _isSpecial(item, amount) {
    if (!item || isRegular(item)) return false;
    const st = this._state.user.settings || {};
    const minMonths = st.special_min_months ?? 2;
    const minAmount = st.special_min_amount ?? 0;
    const months = intervalMonths(item);
    if (minMonths >= 999 ? months !== Infinity : months < minMonths) return false;
    return Math.abs(amount ?? item.current_amount ?? item.amount) >= minAmount;
  }

  // The income the user's months start with (payday to payday), if it is in view.
  _salaryItem() {
    const id = this._state.user.settings?.salary_item_id;
    return id ? this._scopeItems().find((i) => i.id === id) || null : null;
  }

  _scopeItems() {
    return this._state.items.filter((i) => (this._isHousehold() ? i.household_id === this._scope : i.owner === this._state.user.id));
  }

  _scopeBalance() {
    if (!this._state) return {};
    if (this._scope === "me") return this._state.user;
    return this._state.households.find((h) => h.id === this._scope) || {};
  }

  // ---------------------------------------------------------------- render

  _render() {
    const s = this._state;
    this._helpTip = null;
    this._helpFor = null;
    this.classList.toggle("incognito", !!this._incognito);
    this.classList.toggle("dark", !!this._hass?.themes?.darkMode);
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="toolbar">
        <ha-menu-button></ha-menu-button>
        <div class="title">${tr("Haushaltsbuch", `<span class="title-long">Household Budget</span><span class="title-short">Budget</span>`)}</div>
        ${s ? `<button class="incognito-toggle ${this._incognito ? "on" : ""}" data-action="incognito" title="${this._incognito ? tr("Beträge wieder zeigen", "Show amounts again") : tr("Inkognito: Beträge verbergen", "Incognito: hide amounts")}" aria-pressed="${this._incognito}">${this._icon(this._incognito ? "mdi:eye-off" : "mdi:eye", 22)}</button>` : ""}
        ${s ? this._renderScopeSelect() : ""}
      </div>
      ${s ? this._renderTabs() : ""}
      <div class="content">
        ${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}
        ${!this._loaded ? `<div class="empty">${tr("Lade …", "Loading …")}</div>` : s ? this._renderView() : ""}
      </div>
      ${this._dialog ? this._renderDialog() : ""}
    `;
    this._updateMenuButton();
    if (this._search && this._view === "items") this._applySearch();
  }

  _updateMenuButton() {
    const button = this.shadowRoot.querySelector("ha-menu-button");
    if (button) {
      button.hass = this._hass;
      button.narrow = this._narrow;
    }
  }

  _renderScopeSelect() {
    const options = [{ id: "me", name: tr("Meine Posten", "My entries") }, ...this._state.households.map((h) => ({ id: h.id, name: `${tr("Haushalt", "Household")}: ${h.name}` }))];
    return `<select class="scope" data-change="scope" aria-label="${tr("Ansicht", "View")}">
      ${options.map((o) => `<option value="${esc(o.id)}" ${o.id === this._scope ? "selected" : ""}>${esc(o.name)}</option>`).join("")}
    </select>`;
  }

  _renderTabs() {
    const tabs = [
      ["timeline", tr("Zeitleiste", "Timeline"), "mdi:timeline-clock-outline"],
      ["calendar", tr("Kalender", "Calendar"), "mdi:calendar-month"],
      ["items", tr("Posten", "Entries"), "mdi:format-list-bulleted"],
      ["months", tr("Monate", "Months"), "mdi:chart-bar"],
      ["dashboard", tr("Übersicht", "Overview"), "mdi:view-dashboard-outline"],
      ["stats", tr("Statistik", "Statistics"), "mdi:chart-box-outline"],
      ["households", tr("Haushalt", "Household"), "mdi:home-account"],
    ];
    return `<nav class="tabs">${tabs
      .map(([key, label, icon]) => `<button class="tab ${this._view === key ? "active" : ""}" data-action="view" data-view="${key}">${this._icon(icon, 20)}<span>${label}</span></button>`)
      .join("")}</nav>`;
  }

  _renderView() {
    switch (this._view) {
      case "calendar":
        return this._renderBalanceCard() + this._renderCalendar();
      case "items":
        return this._renderItems();
      case "months":
        return this._renderMonths();
      case "dashboard":
        return this._renderDashboard();
      case "stats":
        return this._renderStats();
      case "households":
        return this._renderHouseholds();
      default:
        return this._renderBalanceCard() + this._renderTimeline();
    }
  }

// ------------------------------------------------------------ statistics

  /**
   * The saved transactions as the statistics use them: credit card bills that
   * reached an imported card account are transfers and drop out; the others get
   * their own category instead of e.g. "bank fees". `index` maps each row to
   * its position in the saved ledger.
   */
  _cleanLedger() {
    const raw = this._ledger?.rows || [];
    if (this._ledgerClean?.raw === raw) return this._ledgerClean;
    const accounts = new Set(raw.map((r) => r[5]).filter(Boolean));
    const bills = raw.filter((r) => r[1] < 0 && isCardSettlement(r[2], r[6]));
    const drop = new Set();
    if (accounts.size > 1) {
      for (const out of bills) {
        const twin = raw.find((b) => b[1] > 0 && !drop.has(b) && b[5] !== out[5] && Math.abs(b[1] + out[1]) < 0.005 && Math.abs(daysBetween(out[0], b[0])) <= 10);
        if (twin) drop.add(out).add(twin);
      }
    }
    const billSet = new Set(bills);
    const index = new Map();
    const rows = [];
    raw.forEach((r, i) => {
      if (drop.has(r)) return;
      let row = r;
      if (billSet.has(r)) {
        row = [r[0], r[1], r[2], tr("Kreditkarte", "Credit card"), tr("Kreditkarten-Abrechnung", "Card statement"), r[5], r[6]];
        row.cardBill = true;
      }
      index.set(row, i);
      rows.push(row);
    });
    this._ledgerClean = { raw, rows, index, transfers: drop.size / 2, bills: bills.length - drop.size / 2 };
    return this._ledgerClean;
  }

  _renderStats() {
    const clean = this._cleanLedger();
    const rows = clean.rows;
    if (!rows.length) {
      return `<div class="card empty">${tr("Noch keine Umsätze gespeichert. Importiere unter „Posten“ → „Importieren“ eine oder mehrere CSV-Dateien aus deiner Banking-App und lass „Umsätze für die Statistik speichern“ angehakt.", "No transactions saved yet. Import one or more CSV files from your banking app under “Entries” → “Import” and keep “Save transactions for statistics” ticked.")}</div>`;
    }
    const accounts = [...new Set(rows.map((r) => r[5]).filter(Boolean))].sort();
    const account = accounts.includes(this._statsAccount) ? this._statsAccount : "all";
    const mine = account === "all" ? rows : rows.filter((r) => r[5] === account);
    const years = [...new Set(mine.map((r) => r[0].slice(0, 4)))].sort();
    const monthsAll = [...new Set(mine.map((r) => r[0].slice(0, 7)))].sort();
    const year = this._statsYear === "all" || years.includes(this._statsYear) ? this._statsYear : years[years.length - 1];
    const all = year === "all";
    const lastDate = mine[mine.length - 1][0];
    const inYear = (r, y) => r[0].startsWith(y);
    const month = !all && this._statsMonth?.startsWith(`${year}-`) ? this._statsMonth : null;
    const mode = all ? "all" : month ? "month" : "year";
    // A running year is compared with the same part of the year before.
    const running = mode === "year" ? year === lastDate.slice(0, 4) : mode === "month" && month === lastDate.slice(0, 7);
    const cutoff = running ? lastDate.slice(5) : "12-31";
    const prevYear = String(Number(year) - 1);
    const period = all ? mine : mine.filter((r) => (month ? r[0].startsWith(month) : inYear(r, year)));
    const before = all || !years.includes(prevYear) ? null : month ? mine.filter((r) => r[0].startsWith(`${prevYear}-${month.slice(5)}`) && r[0].slice(5) <= cutoff) : mine.filter((r) => inYear(r, prevYear) && r[0].slice(5) <= cutoff);
    const sums = (list) => list.reduce((s, r) => (r[1] > 0 ? (s.income += r[1]) : (s.expense -= r[1]), s), { income: 0, expense: 0 });
    const now = sums(period);
    const was = before && before.length ? sums(before) : null;
    const fullYears = years.filter((y) => y !== lastDate.slice(0, 4) && mine.some((r) => r[0] < `${y}-02-01` && r[0] >= `${y}-01-01`));
    const perYear = all ? Math.max(1, daysBetween(mine[0][0], lastDate) / 365.25) : 1;
    const pctOf = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
    const badge = (pct, goodWhenUp, suffix = "") => {
      if (pct === null || !Number.isFinite(pct)) return "";
      const cls = pct === 0 ? "" : pct > 0 === goodWhenUp ? "good" : "bad";
      return `<span class="badge ${cls}">${pct > 0 ? "▲ " : pct < 0 ? "▼ " : ""}${Math.abs(pct)} %${suffix}</span>`;
    };
    const monthLabel = (key) => `${monthName(Number(key.slice(5)) - 1)} ${key.slice(0, 4)}`;
    const rest = now.income - now.expense;
    const insights = this._statsTab === "insights";

    // Where a transaction went: budget spending or confirmed booking of an entry.
    const indexOf = clean.index;
    const itemNames = Object.fromEntries(this._state.items.map((i) => [i.id, i.name]));
    const assignedTo = new Map();
    for (const [id, h] of Object.entries(this._bankHistory || {})) {
      for (const [date, amount] of [...(h.spendings || []), ...(h.booked || [])]) if (amount != null && itemNames[id]) assignedTo.set(`${date}|${Number(amount).toFixed(2)}`, itemNames[id]);
    }
    const keyOwner = new Map();
    for (const [id, h] of Object.entries(this._bankHistory || {})) for (const k of h.bank_keys || []) if (itemNames[id] && k.startsWith("n:")) keyOwner.set(k, itemNames[id]);
    const assignChip = (r) => {
      const name = assignedTo.get(`${r[0]}|${Math.abs(r[1]).toFixed(2)}`) || keyOwner.get(`n:${nameKey(r[2] || "")}|${r[1] < 0 ? "expense" : "income"}`);
      return `<button class="assign-chip ${name ? "set" : ""}" data-action="ledger-assign" data-row="${indexOf.get(r)}" data-current="${esc(name || "")}">${name ? `→ ${esc(name)}` : tr("zuordnen", "assign")}</button>`;
    };

    // Top: period, navigation, account, tabs.
    const steps = mode === "month" ? monthsAll : mode === "year" ? years : [];
    const at = steps.indexOf(mode === "month" ? month : year);
    const prev = at > 0 ? steps[at - 1] : null;
    const next = at >= 0 && at < steps.length - 1 ? steps[at + 1] : null;
    const navLabel = mode === "month" ? monthLabel(month) : mode === "year" ? year : tr(`seit ${years[0]}`, `since ${years[0]}`);
    const pill = (p, text) => `<button class="${mode === p ? "on" : ""}" data-action="stats-period" data-period="${p}">${text}</button>`;
    const top = `<div class="st-top">
        <div class="st-pills" role="tablist">${pill("month", tr("Monat", "Month"))}${pill("year", tr("Jahr", "Year"))}${pill("all", tr("Alle Jahre", "All years"))}</div>
        <div class="st-nav">
          ${mode === "all" ? "" : `<button class="st-arrow" ${prev ? `data-action="stats-step" data-to="${prev}"` : "disabled"} aria-label="${tr("zurück", "back")}">‹</button>`}
          <span>${esc(navLabel)}</span>
          ${mode === "all" ? "" : `<button class="st-arrow" ${next ? `data-action="stats-step" data-to="${next}"` : "disabled"} aria-label="${tr("weiter", "next")}">›</button>`}
        </div>
        ${accounts.length > 1 ? `<select class="st-chip" data-change="stats-account" aria-label="${tr("Konto", "Account")}">
          <option value="all">${tr("Alle Konten", "All accounts")}</option>
          ${accounts.map((a) => `<option value="${esc(a)}" ${a === account ? "selected" : ""}>${tr("Konto", "Account")} …${esc(a.slice(-4))}</option>`).join("")}
        </select>` : ""}
      </div>
      <div class="st-tabs" role="tablist">
        <button class="${insights ? "" : "on"}" data-action="stats-tab" data-tab="numbers">${tr("Zahlen", "Numbers")}</button>
        <button class="${insights ? "on" : ""}" data-action="stats-tab" data-tab="insights">${tr("Auswertungen", "Insights")}</button>
      </div>`;

    const manage = `<div class="card st-card"><div class="row-between"><p class="hint">${tr(`Gespeichert sind ${rows.length} Umsätze vom ${shortDate(rows[0][0])} bis ${shortDate(lastDate)}, nur in deinem Home Assistant und nur für dich sichtbar. Umbuchungen zwischen deinen Konten zählen nicht mit.`, `${rows.length} transactions from ${shortDate(rows[0][0])} to ${shortDate(lastDate)} are saved, only in your Home Assistant and only visible to you. Transfers between your accounts are not counted.`)}${clean.bills ? tr(` ${clean.bills === 1 ? "1 Kreditkarten-Abrechnung steht" : `${clean.bills} Kreditkarten-Abrechnungen stehen`} unter „Kreditkarte“. Importierst du auch die CSV der Kreditkarte, fallen sie als Umbuchung raus und du siehst die einzelnen Käufe.`, ` ${clean.bills} credit card bills are listed under “Credit card”. Import the card's CSV as well and they drop out as transfers, showing the single purchases instead.`) : ""}</p>
      <button class="secondary small" data-action="stats-clear">${tr("Alle löschen", "Delete all")}</button></div></div>`;
    const insightCards = this._renderInsights(mine, lastDate, year, all);
    if (insights) return top + `<div class="st-grid single">${insightCards}</div>` + manage;

    // Hero: what is left, with income and spending beside it.
    const heroLabel = mode === "month" ? (running ? tr(`Übrig im ${monthLabel(month)} bis ${shortDay(lastDate)}`, `Left over in ${monthLabel(month)} until ${shortDay(lastDate)}`) : tr(`Übrig im ${monthLabel(month)}`, `Left over in ${monthLabel(month)}`))
      : mode === "year" ? (cutoff !== "12-31" ? tr(`Übrig ${year} bis ${shortDay(lastDate)}`, `Left over ${year} until ${shortDay(lastDate)}`) : tr(`Übrig ${year}`, `Left over ${year}`))
      : tr(`Übrig pro Jahr, Ø seit ${years[0]}`, `Left over per year, avg since ${years[0]}`);
    const vsLabel = mode === "month" ? `${monthName(Number(month.slice(5)) - 1)} ${prevYear}` : prevYear;
    const restDiff = was ? rest - (was.income - was.expense) : null;
    const share = now.income ? Math.round((rest / now.income) * 100) : null;
    // Small trend lines: the buckets around the chosen period.
    const sparkKeys = mode === "all" ? years : mode === "year" ? monthsAll.filter((m) => m.startsWith(year)) : monthsAll.slice(Math.max(0, monthsAll.indexOf(month) - 11), monthsAll.indexOf(month) + 1);
    const sparkSums = sparkKeys.map((k) => sums(mine.filter((r) => r[0].startsWith(k))));
    const spark = (values, color) => {
      if (values.length < 2) return "";
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${hi === lo ? 15 : 27 - ((v - lo) / (hi - lo)) * 24}`).join(" ");
      return `<svg class="st-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/></svg>`;
    };
    const hero = `<div class="card st-card st-hero">
      <div>
        <div class="st-label">${esc(heroLabel)}</div>
        <div class="st-big-row"><span class="st-big ${rest < 0 ? "neg" : ""}">${this._money(rest / perYear)}</span>
          ${restDiff !== null && Math.abs(restDiff) >= 1 ? `<span class="badge ${restDiff > 0 ? "good" : "bad"}">${restDiff > 0 ? "▲" : "▼"} ${this._moneyPlain(Math.abs(restDiff))} ${tr(`ggü. ${vsLabel}`, `vs ${vsLabel}`)}</span>` : ""}</div>
        <div class="hint">${share === null ? "" : rest >= 0 ? tr(`Du hast ${share} % deines Einkommens behalten.`, `You kept ${share} % of your income.`) : tr(`Du hast ${this._moneyPlain(-rest / perYear)} mehr ausgegeben als eingenommen.`, `You spent ${this._moneyPlain(-rest / perYear)} more than you earned.`)}</div>
      </div>
      ${share !== null ? `<div class="st-rate"><div class="st-rate-bar"><span style="width:${Math.max(0, Math.min(100, share))}%"></span></div><span class="hint">${tr(`Sparquote ${share} %`, `Savings rate ${share} %`)}</span></div>` : ""}
      <div class="st-kpis">
        <div class="st-kpi"><span class="st-label">${tr("Eingenommen", "Income")}</span><span class="st-kpi-v">${this._money(now.income / perYear)}</span>${was ? badge(pctOf(now.income, was.income), true) : ""}${spark(sparkSums.map((s) => s.income), "var(--success-color, #1baf7a)")}</div>
        <div class="st-kpi"><span class="st-label">${tr("Ausgegeben", "Spent")}</span><span class="st-kpi-v">${this._money(now.expense / perYear)}</span>${was ? badge(pctOf(now.expense, was.expense), false) : ""}${spark(sparkSums.map((s) => s.expense), "var(--error-color, #e34948)")}</div>
      </div>
    </div>`;

    // History: years, or the months of the year.
    const buckets = all ? years.map((y) => [y, y]) : Array.from({ length: 12 }, (_, i) => [`${year}-${String(i + 1).padStart(2, "0")}`, monthName(i, "short").slice(0, 3)]);
    const bucketSums = buckets.map(([key, name]) => ({ key, name, ...sums(mine.filter((r) => r[0].startsWith(key))) }));
    const peak = Math.max(1, ...bucketSums.map((b) => Math.max(b.income, b.expense)));
    const magnitude = Math.pow(10, Math.floor(Math.log10(peak / 3)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => s * 3 >= peak) || magnitude * 10;
    const axisMax = step * Math.ceil(peak / step);
    const compact = new Intl.NumberFormat(this._numberLocale(), { notation: "compact", maximumFractionDigits: 1 });
    const W = 360;
    const H = 150;
    const T = 8;
    const left = 30;
    const slot = (W - left) / buckets.length;
    const barW = Math.max(3, Math.min(12, slot * 0.3));
    const selected = mode === "month" ? month : null;
    let chart = "";
    for (let v = 0; v <= axisMax + 0.1; v += step) {
      const y = T + H - (v / axisMax) * H;
      chart += `<line x1="${left}" x2="${W}" y1="${y}" y2="${y}" class="st-grid-line"/><text x="0" y="${y + 4}" class="st-axis">${v ? compact.format(v) : "0"}</text>`;
    }
    const bar = (x, value, cls) => {
      const h = (value / axisMax) * H;
      if (h <= 0) return "";
      const r = Math.min(barW / 2, 4, h);
      return `<path class="${cls}" d="M${x},${T + H} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z"/>`;
    };
    bucketSums.forEach((b, i) => {
      const x = left + i * slot + (slot - (2 * barW + 2)) / 2;
      const on = b.key === selected;
      const dim = selected && !on;
      const target = all ? `data-action="stats-step" data-to="${b.key}"` : b.income || b.expense ? `data-action="stats-month" data-month="${b.key}"` : "";
      chart += `<g class="st-col ${on ? "on" : ""} ${dim ? "dim" : ""}" ${target}>
        ${on ? `<rect class="st-col-hl" x="${left + i * slot + 2}" y="${T}" width="${slot - 4}" height="${H}" rx="8"/>` : ""}
        <rect class="st-hit" x="${left + i * slot}" y="0" width="${slot}" height="${H + T + 22}"/>
        ${bar(x, b.income, "st-in")}${bar(x + barW + 2, b.expense, "st-out")}
        <text x="${left + i * slot + slot / 2}" y="${T + H + 16}" class="st-axis st-xl ${on ? "on" : ""}" text-anchor="middle">${esc(all ? `’${b.name.slice(2)}` : b.name)}</text>
        <title>${esc(all ? b.key : monthLabel(b.key))}: +${Math.round(b.income)} / −${Math.round(b.expense)}</title></g>`;
    });
    const sel = selected ? bucketSums.find((b) => b.key === selected) : null;
    const history = `<div class="card st-card">
      <div class="st-head"><h3>${all ? tr("Verlauf pro Jahr", "By year") : tr(`Monatsverlauf ${year}`, `${year} by month`)}</h3>
        <div class="st-legend"><span style="--c:var(--success-color, #1baf7a)">${tr("ein", "in")}</span><span style="--c:var(--error-color, #e34948)">${tr("aus", "out")}</span></div></div>
      <svg class="st-chart" viewBox="0 0 ${W} ${T + H + 24}" role="img" aria-label="${tr("Einnahmen und Ausgaben", "Income and spending")}">${chart}</svg>
      ${sel ? `<div class="st-sel"><b>${esc(monthLabel(sel.key))}</b><span class="pos">+${this._moneyPlain(sel.income)}</span><span class="neg">−${this._moneyPlain(sel.expense)}</span><span>= ${this._moneyPlain(sel.income - sel.expense)} ${tr("übrig", "left")}</span></div>` : ""}
      <p class="hint">${all ? tr("Tippe auf ein Jahr für seine Monate.", "Tap a year for its months.") : mode === "month" ? tr("Gewählten Monat nochmal antippen zeigt das ganze Jahr.", "Tap the chosen month again for the whole year.") : tr("Tippe auf einen Monat für seine Umsätze.", "Tap a month for its transactions.")}</p>
    </div>`;

    // Categories: ring + list, each with sub categories, payees and bookings.
    const group = (list) => {
      const map = new Map();
      for (const r of list) {
        if (r[1] >= 0) continue;
        const main = r[3] || r[4] || tr("Ohne Kategorie", "Uncategorised");
        if (!map.has(main)) map.set(main, { name: main, total: 0, subs: new Map(), payees: new Map() });
        const g = map.get(main);
        g.total -= r[1];
        const sub = r[4] || main;
        g.subs.set(sub, (g.subs.get(sub) || 0) - r[1]);
        const payee = r[2] || "?";
        g.payees.set(payee, (g.payees.get(payee) || 0) - r[1]);
      }
      return map;
    };
    const cats = [...group(period).values()].sort((a, b) => b.total - a.total);
    const prevCats = before ? group(before) : null;
    const firstFull = fullYears[0];
    const lastFull = fullYears[fullYears.length - 1];
    const trendCats = all && firstFull && lastFull && firstFull !== lastFull ? [group(mine.filter((r) => inYear(r, firstFull))), group(mine.filter((r) => inYear(r, lastFull)))] : null;
    const colorOf = new Map(cats.map((c, i) => [c.name, i < 6 ? `var(--viz-${i + 1})` : "var(--viz-other)"]));
    const totalOut = cats.reduce((a, c) => a + c.total, 0);
    const slices = [...cats.slice(0, 6), ...(cats.length > 6 ? [{ name: "", total: cats.slice(6).reduce((a, c) => a + c.total, 0), other: true }] : [])];
    let ring = "";
    let a0 = -Math.PI / 2;
    const R = 58;
    const r0 = 41;
    for (const s of slices) {
      if (!s.total) continue;
      const a1 = a0 + (s.total / totalOut) * 2 * Math.PI;
      const gap = slices.length > 1 ? 0.03 : 0;
      const s0 = a0 + gap / 2;
      const s1 = Math.max(s0 + 0.001, a1 - gap / 2);
      const p = (a, rr) => `${(66 + rr * Math.cos(a)).toFixed(2)},${(66 + rr * Math.sin(a)).toFixed(2)}`;
      const large = s1 - s0 > Math.PI ? 1 : 0;
      ring += slices.length === 1
        ? `<circle cx="66" cy="66" r="${(R + r0) / 2}" fill="none" stroke="${s.other ? "var(--viz-other)" : colorOf.get(s.name)}" stroke-width="${R - r0}"/>`
        : `<path d="M${p(s0, R)} A${R},${R} 0 ${large} 1 ${p(s1, R)} L${p(s1, r0)} A${r0},${r0} 0 ${large} 0 ${p(s0, r0)} Z" fill="${s.other ? "var(--viz-other)" : colorOf.get(s.name)}"/>`;
      a0 = a1;
    }
    // Whole euros keep the centre readable; long sums get a smaller font so they stay inside the ring.
    const ringText = `${new Intl.NumberFormat(this._numberLocale(), { maximumFractionDigits: 0 }).format(totalOut / perYear)} ${this._state.currency === "EUR" ? "€" : this._state.currency}`;
    const ringSize = ringText.length > 10 ? 11 : ringText.length > 8 ? 13 : 15;
    ring += `<text x="66" y="61" text-anchor="middle" class="st-ring-l">${all ? tr("Ø JAHR", "AVG YEAR") : tr("GESAMT", "TOTAL")}</text><text x="66" y="79" text-anchor="middle" class="st-ring-v" style="font-size:${ringSize}px">${esc(ringText)}</text>`;
    const catRows = cats.map((c) => {
      const open = this._statsOpen === c.name;
      let side = "";
      if (trendCats) {
        const a = trendCats[0].get(c.name)?.total || 0;
        const b = trendCats[1].get(c.name)?.total || 0;
        side = a && b ? badge(pctOf(b, a), false) : "";
      } else if (prevCats) side = badge(pctOf(c.total, prevCats.get(c.name)?.total || 0), false);
      const pick = open ? this._statsPick : null;
      const list = (map, kind) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, v]) => {
        const active = pick?.kind === kind && pick.name === n;
        return `<button class="stats-sub ${active ? "active" : ""}" data-action="stats-pick" data-kind="${kind}" data-name="${esc(n)}"><span>${esc(n)}</span><span>${this._moneyPlain(v / perYear)}</span></button>`;
      }).join("");
      let bookingsList = "";
      if (pick) {
        const hits = period
          .filter((r) => r[1] < 0 && (r[3] || r[4] || tr("Ohne Kategorie", "Uncategorised")) === c.name && (pick.kind === "sub" ? (r[4] || c.name) === pick.name : (r[2] || "?") === pick.name))
          .sort((a, b) => b[0].localeCompare(a[0]));
        const shown = hits.slice(0, this._statsMore ? hits.length : 40);
        const sum = hits.reduce((t, r) => t - r[1], 0);
        bookingsList = `<div class="stats-bookings">
          <div class="row-between"><h4>${esc(pick.name)} · ${hits.length === 1 ? tr("1 Buchung", "1 booking") : tr(`${hits.length} Buchungen`, `${hits.length} bookings`)}</h4><span>${this._moneyPlain(sum)}</span></div>
          <ul>${shown.map((r) => `<li><div class="csv-detail-head"><span>${shortDate(r[0])}</span><b>${this._moneyPlain(r[1])}</b>${pick.kind === "payee" ? (r[4] ? `<span class="what">${esc(r[4])}</span>` : "") : `<span class="what">${esc(r[2] || "")}</span>`}</div><div class="csv-detail-text assign-line"><span>${esc((r[6] || "").slice(0, 100))}</span>${assignChip(r)}</div></li>`).join("")}</ul>
          ${hits.length > shown.length ? `<button class="link" data-action="stats-more">${tr(`alle ${hits.length} anzeigen`, `show all ${hits.length}`)}</button>` : ""}
        </div>`;
      }
      return `<div class="st-cat ${open ? "open" : ""}">
        <button class="st-cat-row" data-action="stats-cat" data-cat="${esc(c.name)}" aria-expanded="${open}">
          <span class="st-dot" style="--c:${colorOf.get(c.name)}"></span>
          <span class="st-cat-n">${esc(c.name)}</span>
          <span class="st-cat-a">${this._moneyPlain(c.total / perYear)}</span>
          <span class="st-cat-d">${side}</span>
        </button>
        ${open ? `<div class="stats-detail"><div><h4>${tr("Unterkategorien", "Sub categories")}</h4>${list(c.subs, "sub")}</div><div><h4>${tr("Größte Empfänger", "Biggest payees")}</h4>${list(c.payees, "payee")}</div></div>${bookingsList}` : ""}
      </div>`;
    }).join("");
    const categories = `<div class="card st-card">
      <div class="st-head"><h3>${tr("Ausgaben nach Kategorie", "Spending by category")}</h3><span class="hint">${trendCats ? `${firstFull} → ${lastFull}` : prevCats ? tr(`ggü. ${vsLabel}`, `vs ${vsLabel}`) : ""}</span></div>
      ${cats.length ? `<div class="st-donut"><svg viewBox="0 0 132 132" role="img" aria-label="${tr("Anteile der Kategorien", "Category shares")}">${ring}</svg><div class="st-cats">${catRows}</div></div>
      <p class="hint">${tr("Antippen zeigt Unterkategorien und Empfänger, darin ein Eintrag die einzelnen Buchungen.", "Tap for sub categories and payees, then an entry for its bookings.")}</p>` : `<p class="hint">${tr("Keine Ausgaben in diesem Zeitraum.", "No spending in this period.")}</p>`}
    </div>`;

    // At a glance: the insights in one line each.
    const glance = `<div class="card st-card">
      <div class="st-head"><h3>${tr("Auf einen Blick", "At a glance")}</h3><button class="link" data-action="stats-tab" data-tab="insights">${tr("alle Auswertungen ›", "all insights ›")}</button></div>
      <div class="st-tiles">${(this._insightTiles || []).map((t) => `<button class="st-tile" style="--c:var(--viz-${t.color})" data-action="stats-tab" data-tab="insights">
          <span class="st-tile-ic">${this._icon(t.icon, 18)}</span><span class="st-tile-t">${esc(t.title)}</span><span class="st-tile-v">${t.value}</span></button>`).join("")}</div>
    </div>`;

    // Transactions of the chosen month, by day.
    let txCard = "";
    if (mode === "month") {
      const byDay = new Map();
      for (const r of [...period].sort((a, b) => b[0].localeCompare(a[0]) || a[1] - b[1])) {
        if (!byDay.has(r[0])) byDay.set(r[0], []);
        byDay.get(r[0]).push(r);
      }
      txCard = `<div class="card st-card st-span">
        <div class="st-head"><h3>${tr(`Umsätze ${monthLabel(month)}`, `Transactions ${monthLabel(month)}`)}</h3><span class="hint">${period.length === 1 ? tr("1 Buchung", "1 booking") : tr(`${period.length} Buchungen`, `${period.length} bookings`)}</span></div>
        ${[...byDay.entries()].map(([day, list]) => `<div class="st-day">${esc(fmtDate(day, { weekday: "short", day: "numeric", month: "long" }))}</div>
          ${list.map((r) => {
            const cat = r[3] || r[4] || tr("Ohne Kategorie", "Uncategorised");
            const c = r[1] > 0 ? "var(--success-color, #1baf7a)" : colorOf.get(cat) || "var(--viz-other)";
            return `<div class="st-tx"><span class="st-av" style="--c:${c}">${esc((r[2] || "?").trim().charAt(0).toUpperCase())}</span>
              <div class="st-tx-main"><div class="st-tx-n">${esc(r[2] || "?")}</div><div class="st-tx-m"><span>${esc(r[4] || r[3] || "")}</span>${assignChip(r)}</div>${r[6] ? `<div class="st-tx-p">${esc(r[6].slice(0, 90))}</div>` : ""}</div>
              <span class="st-tx-a ${r[1] > 0 ? "pos" : ""}">${r[1] > 0 ? "+" : ""}${this._moneyPlain(r[1])}</span></div>`;
          }).join("")}`).join("")}
      </div>`;
    }

    return top + `<div class="st-grid">${hero}${history}${categories}${glance}${txCard}</div>` + manage;
  }


  // ---------------------------------------------------------- insights

  /** Evaluations of the saved transactions that help keep the book complete and realistic. */
  _renderInsights(mine, lastDate, year, all) {
    const items = this._state.items;
    const history = this._bankHistory || {};
    const ignored = new Set(this._state.user.settings?.stats_ignored || []);
    const money = (v) => this._moneyPlain(v);
    const card = (title, hint, body) => `<div class="card insight"><h3>${title}</h3>${hint ? `<p class="hint">${hint}</p>` : ""}${body}</div>`;
    const empty = (text) => `<p class="hint">${text}</p>`;
    const assigned = new Map();
    for (const [id, h] of Object.entries(history)) {
      for (const [date, amount] of [...(h.spendings || []), ...(h.booked || [])]) if (amount != null) assigned.set(`${date}|${Number(amount).toFixed(2)}`, id);
    }
    const byKey = new Map();
    for (const i of items) for (const k of history[i.id]?.bank_keys || []) byKey.set(k, i);
    const rowKey = (b) => `${b.date}|${Math.abs(b.amount).toFixed(2)}`;

    // Payees with their bookings, as the CSV import keys them without mandate.
    const groups = new Map();
    for (const r of mine) {
      if (r.cardBill) continue;
      const b = { date: r[0], amount: r[1], name: r[2] || "?", purpose: r[6] || "", category: r[4] || r[3] || "", main: r[3] || "", text: "", mandate: "", creditor: "", direction: r[1] < 0 ? "expense" : "income" };
      const key = `n:${nameKey(b.name)}|${b.direction}`;
      if (!groups.has(key)) groups.set(key, { key, list: [] });
      groups.get(key).list.push(b);
    }
    const recentFrom = iso(addDays(parseIso(lastDate), -730));
    const plainItems = items.filter((i) => !["budget", "once"].includes(i.schedule?.frequency));
    const regular = [];
    for (const g of groups.values()) {
      const list = g.list.sort((a, b) => a.date.localeCompare(b.date));
      if (list.every((b) => CARD_PAYMENT.test(b.purpose))) continue;
      const last = list[list.length - 1];
      const { category, icon } = csvCategory(last);
      const recent = list.filter((b) => b.date >= recentFrom);
      const now = recent.length >= 2 ? recurringSuggestion(g, recent, lastDate, category, icon) : null;
      const ever = list.length >= 3 ? recurringSuggestion(g, list, last.date, category, icon) : null;
      if (!now && !ever) continue;
      let item = byKey.get(g.key) || null;
      if (!item) for (const b of list) if (!item && assigned.get(rowKey(b))) item = items.find((i) => i.id === assigned.get(rowKey(b))) || null;
      if (!item && now) item = bestItem(plainItems, last.direction, last.name, last.purpose, category, now.amount, Number(now.due.slice(8)), recent.map((b) => Math.abs(b.amount))) || null;
      regular.push({ g, now, ever, item, last });
    }

    // 1. Regular debits that belong to no entry.
    const missing = regular.filter((x) => x.now && !x.item && x.last.direction === "expense" && !ignored.has(x.g.key))
      .sort((a, b) => monthlyEquivalent(b.now) - monthlyEquivalent(a.now));
    this._insightSuggestions = Object.fromEntries(missing.map((x) => [x.g.key, x.now]));
    const hidden = [...ignored].filter((key) => !key.startsWith("x:")).map((key) => ({ key, name: groups.get(key)?.list.slice(-1)[0]?.name || key.replace(/^n:/, "").replace(/\|expense$/, "") }));
    const hiddenBlock = hidden.length ? `<div class="insight-hidden"><button class="link" data-action="insight-show-ignored">${this._showIgnored ? tr("Ausgeblendete verbergen", "Hide them again") : tr(`${hidden.length} mit „Ist ok“ ausgeblendet · anzeigen`, `${hidden.length} marked “fine” · show`)}</button>
      ${this._showIgnored ? `<ul>${hidden.map((h) => `<li><span>${esc(h.name)}</span><button class="small secondary" data-action="insight-unignore" data-key="${esc(h.key)}">${tr("Wieder anzeigen", "Show again")}</button></li>`).join("")}</ul>` : ""}</div>` : "";
    const missingCard = card(
      tr("Vergessene Abos?", "Forgotten subscriptions?"),
      tr("Regelmäßige Abbuchungen der letzten zwei Jahre, die zu keinem deiner Posten gehören.", "Regular debits of the last two years that belong to none of your entries."),
      missing.length
        ? `<div class="insight-list">${missing.map(({ g, now }) => `<div class="insight-row">
            <div class="entry-icon">${this._icon(now.icon)}</div>
            <div class="entry-main"><div class="entry-name">${esc(now.name)}</div>
              <div class="entry-meta plain">${esc(scheduleLabel(now))} · ${now.count}× · ${tr("zuletzt", "last")} ${shortDate(now.last)}</div>
              <div class="insight-actions"><button class="small" data-action="insight-create" data-key="${esc(g.key)}">${tr("Als Posten anlegen", "Create entry")}</button><button class="small secondary" data-action="insight-ignore" data-key="${esc(g.key)}">${tr("Ist ok", "Fine")}</button></div>
            </div>
            <div class="entry-amount neg">${money(-now.amount)}</div></div>`).join("")}</div>`
        : empty(tr("Alles erfasst: Jede regelmäßige Abbuchung gehört zu einem Posten.", "All covered: every regular debit belongs to an entry.")),
    ).replace(/<\/div>$/, () => `${hiddenBlock}</div>`);

    // 2. How the price of regular payments developed over the years.
    // Payees assigned to the same entry (e.g. electricity from several providers
    // over the years) form one line.
    const priceGroups = new Map();
    for (const x of regular) {
      if (x.last.direction !== "expense") continue;
      const id = x.item && byKey.get(x.g.key) === x.item ? `i:${x.item.id}` : x.g.key;
      const pg = priceGroups.get(id) || { name: x.item && id.startsWith("i:") ? x.item.name : x.item?.name || (x.now || x.ever).name, list: [], payees: new Set() };
      pg.list.push(...x.g.list);
      pg.payees.add(x.last.name);
      priceGroups.set(id, pg);
    }
    const prices = [];
    for (const pg of priceGroups.values()) {
      pg.list.sort((a, b) => a.date.localeCompare(b.date));
      if (daysBetween(pg.list[pg.list.length - 1].date, lastDate) > 400) continue;
      const perYear = {};
      // Each year against its own typical amount, so a cheaper former provider still counts.
      const byYear = {};
      for (const b of pg.list) (byYear[b.date.slice(0, 4)] ||= []).push(Math.abs(b.amount));
      for (const [y, list] of Object.entries(byYear)) {
        const typical = median(list);
        perYear[y] = list.filter((v) => Math.abs(v - typical) <= typical * 0.6);
      }
      const ys = Object.keys(perYear).sort();
      if (ys.length < 2) continue;
      const first = median(perYear[ys[0]]);
      const latest = median(perYear[ys[ys.length - 1]]);
      const pct = Math.round(((latest - first) / first) * 100);
      if (Math.abs(pct) < 3) continue;
      prices.push({ name: pg.name, payees: pg.payees.size, from: ys[0], to: ys[ys.length - 1], first, latest, pct, steps: ys.map((y) => [y, median(perYear[y])]) });
    }
    prices.sort((a, b) => Math.abs(b.latest - b.first) * 12 - Math.abs(a.latest - a.first) * 12);
    const priceCard = card(
      tr("Preisentwicklung deiner Verträge", "How your contracts got pricier"),
      tr("Typischer Betrag im ersten und im letzten Jahr. Antippen zeigt jedes Jahr.", "Typical amount in the first and the latest year. Tap for every year."),
      prices.length
        ? `<div class="insight-list">${prices.slice(0, 12).map((p) => `<details class="insight-price"><summary>
            <span class="entry-name">${esc(p.name)}</span>
            <span class="insight-change">${money(p.first)} → ${money(p.latest)} <span class="delta ${p.pct > 0 ? "neg" : "pos"}">${p.pct > 0 ? "+" : ""}${p.pct} %</span></span>
            <span class="hint">${p.from}–${p.to}${p.payees > 1 ? tr(` · ${p.payees} Anbieter`, ` · ${p.payees} providers`) : ""}</span></summary>
            <div class="insight-steps">${p.steps.map(([y, v]) => `<span>${y}: ${money(v)}</span>`).join("")}</div></details>`).join("")}</div>`
        : empty(tr("Keine Preisänderungen bei laufenden Verträgen gefunden.", "No price changes found in running contracts.")),
    );

    // 3. Budgets compared with the real spending of the last 12 months.
    const yearAgo = iso(addDays(parseIso(lastDate), -365));
    const budgets = items.filter((i) => i.schedule?.frequency === "budget");
    const stemsOf = (text) => wordsOf(text).map((w) => w.slice(0, Math.max(4, w.length - 2)));
    const rowIndex = this._cleanLedger().index;
    const exKey = (budgetId, date, amount, name) => `x:${budgetId}|${date}|${amount.toFixed(2)}|${nameKey(name).slice(0, 40)}`;
    const budgetRows = budgets.map((budget) => {
      const stems = stemsOf(budget.name);
      const keys = new Set(history[budget.id]?.bank_keys || []);
      const generic = budget.name.toLowerCase() === String(budget.category).toLowerCase();
      const hits = mine.filter((r) => {
        if (r[1] >= 0 || r[0] < yearAgo) return false;
        const b = { date: r[0], amount: r[1], name: r[2] || "", purpose: r[6] || "", category: r[4] || r[3] || "" };
        const owner = assigned.get(rowKey(b));
        if (owner) return owner === budget.id;
        if (keys.has(`c:${b.category}`) || keys.has(`n:${nameKey(b.name)}|expense`)) return true;
        const words = wordsOf(`${b.category} ${b.name} ${b.purpose}`);
        if (stems.some((st) => words.some((w) => w.startsWith(st)))) return true;
        return generic && csvCategory(b).category === budget.category;
      }).map((r) => ({ date: r[0], amount: -r[1], name: r[2] || "?", row: rowIndex.get(r), key: exKey(budget.id, r[0], -r[1], r[2] || "?"), own: assigned.get(`${r[0]}|${Math.abs(r[1]).toFixed(2)}`) === budget.id }));
      // Payments the user took out of this budget by hand.
      const removed = hits.filter((h) => ignored.has(h.key));
      for (const h of removed) hits.splice(hits.indexOf(h), 1);
      // Spending entered in the app (e.g. cash) counts as well.
      const seen = new Set(hits.map((h) => `${h.date}|${h.amount.toFixed(2)}`));
      for (const [date, amount] of history[budget.id]?.spendings || []) {
        if (amount == null || date < yearAgo || date > lastDate || seen.has(`${date}|${Number(amount).toFixed(2)}`)) continue;
        hits.push({ date, amount: Number(amount), name: tr("in der App eingetragen", "entered in the app") });
      }
      hits.sort((a, b) => b.date.localeCompare(a.date));
      const from = mine[0][0] > yearAgo ? mine[0][0] : yearAgo;
      const monthKeys = [];
      for (let d = parseIso(`${from.slice(0, 7)}-01`); iso(d) <= lastDate; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) monthKeys.push(iso(d).slice(0, 7));
      // The running month is incomplete and would pull the numbers down.
      if (monthKeys.length > 1 && lastDate.slice(8) < "25") monthKeys.pop();
      const perMonth = Object.fromEntries(monthKeys.map((m) => [m, 0]));
      for (const h of hits) if (h.date.slice(0, 7) in perMonth) perMonth[h.date.slice(0, 7)] += h.amount;
      const values = Object.values(perMonth);
      const activeMonths = values.filter((v) => v > 0).length;
      const typical = values.length ? median(values) : 0;
      const peak = Math.max(0, ...values);
      const planned = Number(budget.current_amount ?? budget.amount) || 0;
      // Only propose when the payments clearly cover the budget: most months, enough payments.
      const enough = hits.length >= 6 && values.length >= 3 && activeMonths >= Math.ceil(values.length * 0.75);
      const proposal = Math.ceil(typical / 10) * 10;
      return { budget, hits, removed, count: hits.length, typical, peak, planned, enough, proposal, months: values.length, activeMonths, pot: planned === 0 };
    });
    const budgetCard = card(
      tr("Budgets aus echten Zahlen", "Budgets from real numbers"),
      tr("Was du in einem typischen Monat der letzten 12 Monate wirklich ausgegeben hast. Einzelne teure Monate verzerren das nicht. Ein Vorschlag kommt nur, wenn in fast jedem Monat Zahlungen zum Budget gefunden wurden.", "What you really spent in a typical month of the last 12 months. Single expensive months don't distort it. A proposal only appears when payments were found in almost every month."),
      budgets.length
        ? `<div class="insight-list">${budgetRows.map((x) => {
            const diff = x.planned ? Math.round(((x.typical - x.planned) / x.planned) * 100) : 0;
            const tone = diff > 10 ? "neg" : diff < -10 ? "pos" : "";
            let meta;
            if (x.pot) meta = x.count ? tr(`Sammeltopf · typisch ${this._moneyPlain(x.typical)} pro Monat · ${x.count} Zahlungen`, `Collection pot · typically ${this._moneyPlain(x.typical)} per month · ${x.count} payments`) : tr("Sammeltopf · keine passenden Umsätze gefunden", "Collection pot · no matching transactions found");
            else if (!x.count) meta = tr(`geplant ${this._moneyPlain(x.planned)} · keine passenden Umsätze gefunden`, `planned ${this._moneyPlain(x.planned)} · no matching transactions found`);
            else if (!x.enough) meta = tr(`geplant ${this._moneyPlain(x.planned)} · nur ${x.count === 1 ? "1 Zahlung" : `${x.count} Zahlungen`} in ${x.activeMonths} von ${x.months} Monaten erkannt, zu wenig für einen Vorschlag`, `planned ${this._moneyPlain(x.planned)} · only ${x.count} payments in ${x.activeMonths} of ${x.months} months found, too few for a proposal`);
            else meta = tr(`geplant ${this._moneyPlain(x.planned)} · typisch ${this._moneyPlain(x.typical)} pro Monat · teuerster Monat ${this._moneyPlain(x.peak)} · ${x.count} Zahlungen`, `planned ${this._moneyPlain(x.planned)} · typically ${this._moneyPlain(x.typical)} per month · most expensive month ${this._moneyPlain(x.peak)} · ${x.count} payments`);
            const propose = !x.pot && x.enough && x.budget.editable !== false && Math.abs(x.proposal - x.planned) >= Math.max(10, x.planned * 0.05);
            const shown = x.hits.slice(0, 30);
            return `<div class="insight-row">
              <div class="entry-icon">${this._icon(x.budget.icon)}</div>
              <div class="entry-main"><div class="entry-name">${esc(x.budget.name)}</div>
                <div class="entry-meta plain">${meta}</div>
                ${!x.pot && x.count && !x.enough ? `<p class="hint">${tr("Ordne unter „Zahlen“ weitere Umsätze diesem Budget zu, dann wird der Vorschlag genauer.", "Assign more transactions to this budget under “Numbers” to get a proposal.")}</p>` : ""}
                ${propose ? `<div class="insight-actions"><button class="small" data-action="insight-budget" data-id="${esc(x.budget.id)}" data-amount="${x.proposal}">${tr(`Budget auf ${this._moneyPlain(x.proposal)} setzen`, `Set budget to ${this._moneyPlain(x.proposal)}`)}</button></div>` : ""}
                ${x.count || x.removed.length ? `<details class="insight-hits" data-budget="${esc(x.budget.id)}" ${this._openHits === x.budget.id ? "open" : ""}><summary>${tr("gezählte Zahlungen ansehen", "show counted payments")}</summary>
                  <p class="hint">${tr("Passt eine Zahlung nicht: „raus“ nimmt sie aus dieser Rechnung, „zuordnen“ ordnet sie woanders hin.", "If a payment doesn't fit: “remove” takes it out of this calculation, “assign” moves it elsewhere.")}</p>
                  <ul>${shown.map((h) => `<li><span class="hit-main"><span>${shortDate(h.date)}</span> ${esc(h.name)}</span><b>${this._moneyPlain(h.amount)}</b>${h.row === undefined ? `<span class="hit-actions hint">${tr("in der App eingetragen", "entered in the app")}</span>` : `<span class="hit-actions"><button type="button" class="assign-chip" data-action="ledger-assign" data-row="${h.row}" data-current="${h.own ? esc(x.budget.name) : ""}">${tr("zuordnen", "assign")}</button><button type="button" class="assign-chip" data-action="budget-hit-remove" data-budget="${esc(x.budget.id)}" data-key="${esc(h.key)}">${tr("raus", "remove")}</button></span>`}</li>`).join("")}</ul>
                  ${x.hits.length > shown.length ? `<p class="hint">${tr(`und ${x.hits.length - shown.length} weitere`, `and ${x.hits.length - shown.length} more`)}</p>` : ""}
                  ${x.removed.length ? `<button type="button" class="link" data-action="budget-hit-restore" data-budget="${esc(x.budget.id)}">${tr(`${x.removed.length} rausgenommen · zurückholen`, `${x.removed.length} removed · restore`)}</button>` : ""}</details>` : ""}
              </div>
              ${!x.pot && x.enough ? `<div class="insight-badge ${tone}">${diff > 0 ? "+" : ""}${diff} %</div>` : ""}</div>`;
          }).join("")}</div>`
        : empty(tr("Du hast noch keine Budgets. Unter „Posten“ legst du eins an, z. B. für Lebensmittel.", "You have no budgets yet. Create one under “Entries”, e.g. for groceries.")),
    );

    // 4. Expensive months of the year and what to put aside for them.
    const years = [...new Set(mine.map((r) => r[0].slice(0, 4)))].sort();
    const fullYears = years.filter((y) => mine.some((r) => r[0].startsWith(`${y}-01`)) && mine.some((r) => r[0].startsWith(`${y}-12`)));
    let seasonCard;
    let seasonTile = null;
    if (fullYears.length) {
      const perMonth = Array.from({ length: 12 }, () => 0);
      for (const r of mine) if (r[1] < 0 && fullYears.includes(r[0].slice(0, 4))) perMonth[Number(r[0].slice(5, 7)) - 1] -= r[1];
      const avgMonth = perMonth.map((v) => v / fullYears.length);
      const mean = avgMonth.reduce((a, v) => a + v, 0) / 12;
      const top = Math.max(...avgMonth);
      const reserve = avgMonth.reduce((a, v) => a + Math.max(0, v - mean), 0) / 12;
      const expensive = avgMonth.map((v, i) => [i, v]).filter(([, v]) => v > mean * 1.1).sort((a, b) => b[1] - a[1]);
      if (expensive.length) seasonTile = { month: expensive[0][0], reserve: Math.ceil(reserve / 5) * 5 };
      seasonCard = card(
        tr("Teure Monate", "Expensive months"),
        tr(`Durchschnittliche Ausgaben je Monat aus ${fullYears.length === 1 ? `dem Jahr ${fullYears[0]}` : `${fullYears.length} vollen Jahren (${fullYears[0]}–${fullYears[fullYears.length - 1]})`}.`, `Average spending per month from ${fullYears.length === 1 ? fullYears[0] : `${fullYears.length} full years (${fullYears[0]}–${fullYears[fullYears.length - 1]})`}.`),
        `<div class="stats-columns season">${avgMonth.map((v, i) => `<div class="stats-col"><div class="stats-bars"><span class="bar-out ${v > mean * 1.1 ? "hot" : ""}" style="height:${(v / top) * 100}%"></span></div><span class="stats-col-label">${esc(monthName(i, "short"))}</span></div>`).join("")}</div>
        <p>${tr(`Im Schnitt gibst du <b>${this._moneyPlain(mean)}</b> pro Monat aus.`, `On average you spend <b>${this._moneyPlain(mean)}</b> per month.`)}
        ${expensive.length ? tr(` Teurer sind: ${expensive.map(([i, v]) => `${monthName(i)} (+${this._moneyPlain(v - mean)})`).join(", ")}.`, ` More expensive: ${expensive.map(([i, v]) => `${monthName(i)} (+${this._moneyPlain(v - mean)})`).join(", ")}.`) : ""}</p>
        ${reserve >= 5 ? `<p class="insight-tip">${tr(`Leg jeden Monat etwa <b>${this._moneyPlain(Math.ceil(reserve / 5) * 5)}</b> zurück, dann tun die teuren Monate nicht weh.`, `Put aside about <b>${this._moneyPlain(Math.ceil(reserve / 5) * 5)}</b> each month and the expensive months won't hurt.`)}</p>` : ""}`,
      );
    } else {
      seasonCard = card(tr("Teure Monate", "Expensive months"), "", empty(tr("Dafür braucht es mindestens ein volles Kalenderjahr an Umsätzen.", "This needs at least one full calendar year of transactions.")));
    }

    // 5. Year in review.
    const reviewYear = !all ? year : fullYears[fullYears.length - 1] || years[years.length - 1];
    const yearRows = mine.filter((r) => r[0].startsWith(reviewYear));
    const income = yearRows.filter((r) => r[1] > 0).reduce((a, r) => a + r[1], 0);
    const spent = yearRows.filter((r) => r[1] < 0).reduce((a, r) => a - r[1], 0);
    const monthsLeft = {};
    for (const r of yearRows) monthsLeft[r[0].slice(5, 7)] = (monthsLeft[r[0].slice(5, 7)] || 0) + r[1];
    const monthEntries = Object.entries(monthsLeft).sort((a, b) => b[1] - a[1]);
    // Rent and other regular payments would fill this list; only one-off expenses count.
    const regularKeys = new Set(regular.filter((x) => x.now || x.ever).map((x) => x.g.key));
    const biggest = yearRows.filter((r) => r[1] < 0 && !regularKeys.has(`n:${nameKey(r[2] || "?")}|expense`)).sort((a, b) => a[1] - b[1]).slice(0, 5);
    const payees = new Map();
    for (const r of yearRows) if (r[1] < 0) payees.set(r[2] || "?", (payees.get(r[2] || "?") || 0) - r[1]);
    const topPayees = [...payees.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const line = (left, right) => `<div class="stats-sub static"><span>${left}</span><span>${right}</span></div>`;
    const reviewCard = card(
      tr(`Jahresrückblick ${reviewYear}`, `${reviewYear} in review`),
      all ? tr("Das letzte volle Jahr. Wähle oben ein Jahr für einen anderen Rückblick.", "The latest full year. Pick a year above for another review.") : "",
      yearRows.length
        ? `<div class="totals">
            <div><div class="label">${tr("Eingenommen", "Income")}</div><div class="big pos">${this._money(income)}</div></div>
            <div><div class="label">${tr("Ausgegeben", "Spent")}</div><div class="big neg">${this._money(spent)}</div></div>
            <div><div class="label">${tr("Übrig", "Left over")}</div><div class="big">${this._money(income - spent)}</div>${income ? `<div class="hint">${tr(`${Math.round(((income - spent) / income) * 100)} % gespart`, `${Math.round(((income - spent) / income) * 100)} % saved`)}</div>` : ""}</div>
          </div>
          ${monthEntries.length > 1 ? `<p class="hint">${tr(`Bester Monat: ${monthName(Number(monthEntries[0][0]) - 1)} (${this._moneyPlain(monthEntries[0][1])} übrig) · knappster Monat: ${monthName(Number(monthEntries[monthEntries.length - 1][0]) - 1)} (${this._moneyPlain(monthEntries[monthEntries.length - 1][1])})`, `Best month: ${monthName(Number(monthEntries[0][0]) - 1)} (${this._moneyPlain(monthEntries[0][1])} left) · tightest month: ${monthName(Number(monthEntries[monthEntries.length - 1][0]) - 1)} (${this._moneyPlain(monthEntries[monthEntries.length - 1][1])})`)}</p>` : ""}
          <div class="stats-detail"><div><h4>${tr("Größte Einzelausgaben (ohne Regelmäßiges)", "Biggest one-off expenses")}</h4>${biggest.map((r) => line(`${shortDate(r[0])} ${esc(r[2] || "?")}`, money(-r[1]))).join("")}</div>
          <div><h4>${tr("Meistes Geld ging an", "Most money went to")}</h4>${topPayees.map(([n, v]) => line(esc(n), money(v))).join("")}</div></div>`
        : empty(tr("Für dieses Jahr sind keine Umsätze gespeichert.", "No transactions saved for this year.")),
    );

    // 6. Personal price increase per category between the first and the latest full year.
    let inflationCard;
    let inflationTile = null;
    if (fullYears.length >= 2) {
      const fy = fullYears[0];
      const ly = fullYears[fullYears.length - 1];
      const span = Number(ly) - Number(fy);
      const sumBy = (y) => {
        const m = new Map();
        for (const r of mine) if (r[1] < 0 && r[0].startsWith(y)) m.set(r[4] || r[3] || "?", (m.get(r[4] || r[3] || "?") || 0) - r[1]);
        return m;
      };
      const a = sumBy(fy);
      const b = sumBy(ly);
      const totalA = [...a.values()].reduce((s, v) => s + v, 0);
      const totalB = [...b.values()].reduce((s, v) => s + v, 0);
      const rows = [...b.entries()].filter(([c, v]) => (a.get(c) || 0) >= 120 && v >= 120).sort((x, y) => y[1] - x[1]).slice(0, 8)
        .map(([c, v]) => ({ c, before: a.get(c) / 12, now: v / 12 }));
      const rate = (x, y) => new Intl.NumberFormat(this._numberLocale(), { maximumFractionDigits: 1 }).format(Math.round((Math.pow(y / x, 1 / span) - 1) * 1000) / 10);
      const pct = (x, y) => Math.round(((y - x) / x) * 100);
      if (totalA && totalB) inflationTile = span > 1 ? tr(`${rate(totalA, totalB)} % pro Jahr`, `${rate(totalA, totalB)} % per year`) : `${pct(totalA, totalB) > 0 ? "+" : ""}${pct(totalA, totalB)} %`;
      inflationCard = card(
        tr("Dein persönlicher Preisanstieg", "Your personal price increase"),
        tr(`Ausgaben pro Monat ${fy} und ${ly}. Mehr kann auch heißen: mehr gekauft, nicht nur teurer.`, `Spending per month in ${fy} and ${ly}. More can also mean you bought more, not only higher prices.`),
        `<div class="insight-list">
          ${[{ c: tr("Alle Ausgaben", "All spending"), before: totalA / 12, now: totalB / 12, total: true }, ...rows].map((x) => `<div class="stats-sub static ${x.total ? "total" : ""}">
            <span>${esc(x.c)}</span>
            <span>${money(x.before)} → ${money(x.now)} <span class="delta ${x.now > x.before ? "neg" : "pos"}">${pct(x.before, x.now) > 0 ? "+" : ""}${pct(x.before, x.now)} %</span>${span > 1 ? ` <span class="hint">(${tr(`${rate(x.before, x.now)} % pro Jahr`, `${rate(x.before, x.now)} % per year`)})</span>` : ""}</span></div>`).join("")}
        </div>`,
      );
    } else {
      inflationCard = card(tr("Dein persönlicher Preisanstieg", "Your personal price increase"), "", empty(tr("Dafür braucht es mindestens zwei volle Kalenderjahre an Umsätzen.", "This needs at least two full calendar years of transactions.")));
    }

    // Short versions for the "at a glance" tiles.
    const missingSum = missing.reduce((a, x) => a + monthlyEquivalent(x.now), 0);
    const worst = budgetRows.filter((x) => !x.pot && x.enough && x.planned).map((x) => ({ x, d: Math.round(((x.typical - x.planned) / x.planned) * 100) })).sort((a, b) => b.d - a.d)[0];
    const topPrice = prices[0];
    this._insightTiles = [
      { icon: "mdi:magnify", color: 1, title: tr("Vergessene Abos", "Forgotten subscriptions"), value: missing.length ? tr(`${missing.length} · ${money(missingSum)}/Monat`, `${missing.length} · ${money(missingSum)}/month`) : tr("alles erfasst", "all covered") },
      { icon: "mdi:cart-outline", color: 2, title: tr("Budgets", "Budgets"), value: worst ? (worst.d > 10 ? `${esc(worst.x.budget.name)} +${worst.d} %` : worst.d < -10 ? tr(`${esc(worst.x.budget.name)} ${worst.d} %`, `${esc(worst.x.budget.name)} ${worst.d} %`) : tr("passen", "fit")) : tr("zu wenig Daten", "not enough data") },
      { icon: "mdi:trending-up", color: 3, title: tr("Preisentwicklung", "Price changes"), value: topPrice ? `${esc(topPrice.name)} ${topPrice.pct > 0 ? "+" : ""}${topPrice.pct} %` : tr("keine", "none") },
      { icon: "mdi:calendar-alert", color: 4, title: tr("Teurer Monat", "Expensive month"), value: seasonTile ? tr(`${monthName(seasonTile.month)} · ${money(seasonTile.reserve)} zurücklegen`, `${monthName(seasonTile.month)} · put aside ${money(seasonTile.reserve)}`) : "—" },
      { icon: "mdi:star-outline", color: 5, title: tr(`Rückblick ${reviewYear}`, `${reviewYear} review`), value: yearRows.length ? tr(`${money(income - spent)} übrig`, `${money(income - spent)} left`) : "—" },
      { icon: "mdi:chart-line", color: 6, title: tr("Dein Preisanstieg", "Your price increase"), value: inflationTile || "—" },
    ];

    return missingCard + budgetCard + priceCard + seasonCard + reviewCard + inflationCard;
  }

  _renderBalanceCard() {
    const b = this._scopeBalance();
    const days = this._view === "timeline" ? this._forecast?.days : this._calendar?.days;
    const last = days && days.length ? days[days.length - 1] : null;
    const known = b.balance !== null && b.balance !== undefined;
    return `<div class="card balance">
      <div>
        <div class="label">${this._isHousehold() ? tr("Haushaltskonto", "Household account") : tr("Mein Kontostand", "My balance")}</div>
        <div class="big">${known ? this._money(b.balance) : "—"}</div>
        <div class="sub">${known ? `${tr("Stand", "As of")} ${fmtDate(b.balance_date)}` : tr("Noch kein Kontostand hinterlegt", "No balance entered yet")}</div>
      </div>
      ${known && last && last.balance_likely !== null ? `<div>
        <div class="label">${tr("Am", "On")} ${fmtDate(last.date)}</div>
        <div class="big ${last.balance_likely < 0 ? "neg" : ""}">${this._money(last.balance_likely)}</div>
        <div class="sub">${tr("vorsichtig", "cautious")}: ${this._money(last.balance_sure)}</div>
      </div>` : ""}
      <button class="secondary" data-action="edit-balance">${tr("Kontostand setzen", "Set balance")}</button>
    </div>`;
  }

  _renderEntry(e, { showBalance = false, confirm = false, special = null } = {}) {
    const owner = this._isHousehold() ? `<span class="owner">${esc(e.owner_name)}</span>` : "";
    const status = e.budget ? `<span class="chip budget">Budget</span>` : e.status === "booked" ? `<span class="chip booked">${tr("gebucht", "booked")}</span>` : e.status === "skipped" ? `<span class="chip skipped">${tr("ausgefallen", "skipped")}</span>` : e.planned ? `<span class="chip planned">${tr("Termin", "scheduled")}</span>` : this._chip(e.certainty);
    return `<div class="entry ${e.status === "skipped" ? "skipped-row" : ""}" data-action="${e.budget ? "edit-item" : "open-entry"}" data-item="${esc(e.item_id)}" data-due="${esc(e.due_date)}" data-amount="${Math.abs(e.amount)}" data-date="${esc(e.date)}" data-status="${esc(e.status ?? "")}" data-planned="${e.planned ? "1" : ""}">
      <div class="entry-icon">${this._icon(e.icon)}</div>
      <div class="entry-main">
        <div class="entry-name">${esc(e.name)}</div>
        <div class="entry-meta">${special ? `<span class="chip special">★ ${esc(scheduleLabel(special))}</span> ` : ""}${esc(e.category)} ${owner} ${status}</div>
      </div>
      <div class="entry-amount ${e.amount < 0 ? "neg" : "pos"}">${this._money(e.amount, true)}</div>
      ${confirm ? `<div class="entry-actions">
        <button class="small" data-action="quick-confirm" data-status="booked" data-item="${esc(e.item_id)}" data-due="${esc(e.due_date)}">${tr("gebucht", "booked")}</button>
        <button class="small secondary" data-action="quick-confirm" data-status="skipped" data-item="${esc(e.item_id)}" data-due="${esc(e.due_date)}">${tr("ausgefallen", "skipped")}</button>
      </div>` : ""}
    </div>`;
  }

  // Budget money taken off the balance between two listed days, keyed by the
  // listed day, so every change of the balance is visible as a row.
  _budgetGaps(allDays, shown, balanceDate) {
    const listed = new Set(shown.map((d) => d.date));
    const gaps = {};
    let sum = 0, n = 0, from = null;
    for (const d of allDays) {
      if (d.budget && d.balance_likely !== null && (!balanceDate || d.date > balanceDate)) {
        sum += d.budget;
        n += 1;
        from ??= d.date;
      }
      if (listed.has(d.date)) {
        if (Math.abs(sum) >= 0.005) gaps[d.date] = { sum, n, from, to: d.date };
        sum = 0; n = 0; from = null;
      }
    }
    return gaps;
  }

  _renderBudgetRow(g) {
    if (!g) return "";
    const budgets = this._scopeItems().filter((i) => i.schedule?.frequency === "budget" && i.start_date <= g.to && (!i.end_date || i.end_date >= g.from));
    const names = budgets.map((i) => i.name).join(", ");
    const span = g.n === 1 ? tr("1 Tag", "1 day") : tr(`${g.n} Tage, ${shortDay(g.from)}–${shortDay(g.to)}`, `${g.n} days, ${shortDay(g.from)}–${shortDay(g.to)}`);
    const one = budgets.length === 1 ? budgets[0] : null;
    return `<div class="entry budget-row" ${one ? `data-action="edit-item" data-item="${esc(one.id)}"` : ""}>
      <div class="entry-icon">${this._icon(one?.icon || "mdi:wallet-outline")}</div>
      <div class="entry-main">
        <div class="entry-name">${tr("Budget", "Budget")}${names ? `: ${esc(names)}` : ""}</div>
        <div class="entry-meta">${span} <span class="chip budget">Budget</span>${this._help(tr("Budgets wie Lebensmittel haben keine festen Termine. Die App zieht jeden Tag ein Stück vom erwarteten Kontostand ab: Was vom Budget noch übrig ist, verteilt auf die restlichen Tage des Monats. Trägst du Ausgaben ein, zählen für vergangene Tage die echten Beträge. Hier steht, wie viel seit dem letzten Tag in der Liste abgezogen wurde.", "Budgets such as groceries have no fixed dates. The app takes a little off the expected balance every day: what is left of the budget, spread over the remaining days of the month. Once you enter spendings, past days count the real amounts. This row shows how much was taken off since the previous day in the list."))}</div>
      </div>
      <div class="entry-amount ${g.sum < 0 ? "neg" : "pos"}">${this._money(g.sum, true)}</div>
    </div>`;
  }

  /** Budgets of the current scope that are running this month. */
  _budgets() {
    const t = iso(today());
    const active = (i) => i.start_date <= t && (!i.end_date || i.end_date >= t);
    return this._scopeItems()
      .filter((i) => i.schedule?.frequency === "budget" && i.direction === "expense" && i.budget_status && (active(i) || i.budget_status.spent > 0))
      .sort((a, b) => b.budget_status.budget - a.budget_status.budget);
  }

  _renderBudgetCard() {
    const budgets = this._budgets();
    if (!budgets.length) return "";
    const s0 = budgets[0].budget_status;
    const period = this._salaryItem() ? ` <small class="period">${shortDay(s0.start)}–${shortDay(s0.end)}</small>` : "";
    return `<div class="card budgets">
      <div class="row-between">
        <h3>${tr("Budgets diesen Monat", "Budgets this month")}${period}${this._help(tr("Trag hier ein, was du wirklich ausgibst. Der Balken zeigt, wie viel vom Budget weg ist, der Strich, wie viel bis heute gleichmäßig verteilt dran wäre. Orange heißt: schneller ausgegeben als geplant. Rot heißt: Budget überzogen. Was am Monatsende übrig ist, verfällt, der neue Monat startet wieder mit dem vollen Budget. Ein Budget mit 0 € ist ein Sammeltopf, z.B. für Ungeplantes: Dort zählt nur, was du einträgst.", "Enter what you really spend. The bar shows how much of the budget is gone, the line how much would be due by today if spread evenly. Orange means faster than planned, red means over budget. Whatever is left at the end of the month expires; the next month starts with the full budget again. A budget of 0 is a pot, e.g. for unplanned purchases: only what you enter counts."))}</h3>
        <button class="small" data-action="spending-new">+ ${tr("Ausgabe", "Spending")}</button>
      </div>
      ${budgets.map((i) => this._renderBudgetBar(i)).join("")}
    </div>`;
  }

  _renderBudgetBar(i, { list = true } = {}) {
    const s = i.budget_status;
    // A budget of 0 is a pot for unplanned spending: only entries count.
    const pot = s.budget < 0.005;
    const over = !pot && s.rest < -0.005;
    const ahead = !over && s.spent > s.planned_by_today + 0.005;
    const pct = s.budget > 0 ? Math.min(100, (s.spent / s.budget) * 100) : 100;
    const mark = s.budget > 0 ? Math.min(100, (s.planned_by_today / s.budget) * 100) : 0;
    const open = list && this._budgetOpen === i.id;
    const sub = pot
      ? tr("ohne festen Betrag, es zählt nur, was du einträgst", "no fixed amount, only what you enter counts")
      : over
      ? tr(`${this._money(-s.rest)} drüber`, `${this._money(-s.rest)} over`)
      : s.days_left > 1
        ? tr(`noch ${this._money(s.rest)} für ${s.days_left} Tage, etwa ${this._money(s.rest / s.days_left)} am Tag`, `${this._money(s.rest)} left for ${s.days_left} days, about ${this._money(s.rest / s.days_left)} a day`)
        : tr(`noch ${this._money(s.rest)}`, `${this._money(s.rest)} left`);
    const users = Object.fromEntries((this._state.users || []).map((u) => [u.id, u.name]));
    const rows = s.spendings.length
      ? s.spendings
          .map(
            (x) => `<div class="spending" data-action="spending-edit" data-item="${esc(i.id)}" data-id="${esc(x.id)}">
              <span class="spending-date">${shortDay(x.date)}</span>
              <span class="spending-note">${esc(x.note || tr("Ausgabe", "Spending"))}${this._isHousehold() && users[x.by] ? ` <span class="owner">${esc(users[x.by])}</span>` : ""}</span>
              <span class="spending-amount neg">${this._money(-x.amount)}</span>
              <button class="icon-button small-x" data-action="spending-delete" data-item="${esc(i.id)}" data-id="${esc(x.id)}" aria-label="${tr("Ausgabe löschen", "Delete spending")}">✕</button>
            </div>`
          )
          .join("")
      : `<p class="hint">${tr("Noch nichts eingetragen. Bis dahin rechnet die App mit dem vollen Budget, gleichmäßig verteilt.", "Nothing entered yet. Until then the app counts the full budget, spread evenly.")}</p>`;
    return `<div class="budget-block">
      <div class="budget-line" ${list ? `data-action="budget-toggle" data-item="${esc(i.id)}" aria-expanded="${open}"` : ""}>
        <div class="entry-icon">${this._icon(i.icon || "mdi:wallet-outline")}</div>
        <div class="budget-main">
          <div class="budget-head"><span class="entry-name">${esc(i.name)}</span><span class="budget-figures">${pot ? `${this._money(s.spent)} ${tr("ausgegeben", "spent")}` : `${this._money(s.spent)} ${tr("von", "of")} ${this._money(s.budget)}`}</span></div>
          ${pot ? "" : `<div class="budget-bar ${over ? "over" : ahead ? "ahead" : ""}"><span style="width:${pct}%"></span><i style="left:${mark}%"></i></div>`}
          <div class="budget-sub ${over ? "neg" : ""}">${sub}${list ? ` · ${s.spendings.length === 1 ? tr("1 Eintrag", "1 entry") : tr(`${s.spendings.length} Einträge`, `${s.spendings.length} entries`)} <span class="chev">${open ? "▴" : "▾"}</span>` : ""}</div>
        </div>
      </div>
      ${open ? `<div class="spendings">${s.spendings.length ? `<p class="hint">${tr("Antippen zum Ändern.", "Tap to edit.")}</p>` : ""}${rows}<button class="secondary small" data-action="spending-new" data-item="${esc(i.id)}">+ ${tr(`Ausgabe für ${esc(i.name)}`, `Spending for ${esc(i.name)}`)}</button></div>` : ""}
    </div>`;
  }

  _renderSpendingForm(d) {
    const budgets = this._budgets();
    const chosen = budgets.find((i) => i.id === d.item_id) || budgets[0];
    const x = d.spending || {};
    return `<form data-form="spending">
      <h2>${x.id ? tr("Ausgabe bearbeiten", "Edit spending") : tr("Ausgabe erfassen", "Add spending")}</h2>
      <div class="grid">
        ${budgets.length > 1
          ? `<label class="full">${tr("Budget", "Budget")}<select name="item_id">${budgets.map((i) => `<option value="${esc(i.id)}" ${i.id === chosen.id ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select></label>`
          : `<input type="hidden" name="item_id" value="${esc(chosen?.id || "")}"><p class="hint full">${tr("Budget", "Budget")}: <b>${esc(chosen?.name || "")}</b></p>`}
        <label>${tr("Betrag", "Amount")} (${esc(this._state.currency)})<input name="amount" ${this._amountAttrs()} required ${x.id ? `value="${this._amountValue(x.amount)}"` : "autofocus"}></label>
        <label>${tr("Datum", "Date")}<input name="date" type="date" required value="${esc(x.date || iso(today()))}"></label>
        <label class="full">${tr("Notiz", "Note")}<input name="note" maxlength="200" placeholder="${tr("z.B. Wocheneinkauf", "e.g. weekly shop")}" value="${esc(x.note || "")}"></label>
      </div>
      <p class="hint">${tr("Vergessen einzutragen? Stell einfach das Datum zurück. Die Ausgabe zählt in dem Monat, in dem das Datum liegt.", "Forgot to enter something? Just set the date back. The spending counts in the month its date falls in.")}</p>
      ${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}
      <div class="dialog-actions">${x.id ? `<button type="button" class="danger" data-action="spending-delete" data-item="${esc(d.item_id)}" data-id="${esc(x.id)}">${tr("Löschen", "Delete")}</button>` : "<span></span>"}<div>
        <button type="button" class="secondary" data-action="close">${tr("Abbrechen", "Cancel")}</button>
        <button type="submit">${tr("Speichern", "Save")}</button>
      </div></div>
    </form>`;
  }

  /** The assign dialog with a sensible preselection and "remember" only for clear payees. */
  _assignDialog(r, current) {
    const direction = r[1] < 0 ? "expense" : "income";
    const key = `n:${nameKey(r[2] || "")}|${direction}`;
    const history = this._bankHistory || {};
    const items = this._state.items.filter((i) => i.direction === direction);
    let target = items.find((i) => (history[i.id]?.bank_keys || []).includes(key))?.id;
    if (!target) {
      const plain = items.filter((i) => !["budget", "once"].includes(i.schedule?.frequency));
      target = bestItem(plain, direction, r[2] || "", r[6] || "", r[4] || r[3] || "", Math.abs(r[1]), Number(r[0].slice(8)), [Math.abs(r[1])])?.id;
    }
    // A payee with transactions of different kinds (e.g. your own name on loan
    // payments and transfers) must not be assigned automatically next time.
    const same = (this._ledger?.rows || []).filter((x) => nameKey(x[2] || "") === nameKey(r[2] || "") && (x[1] < 0) === (r[1] < 0));
    const kinds = new Set(same.map((x) => x[4] || x[3] || ""));
    const mixed = kinds.size > 1 || !nameKey(r[2] || "");
    return { type: "assign", row: r, current, target: target || "", mixed };
  }

  _renderAssignForm(d) {
    const r = d.row;
    const direction = r[1] < 0 ? "expense" : "income";
    const items = this._state.items.filter((i) => i.direction === direction || (direction === "expense" && i.schedule?.frequency === "budget"));
    const budgets = direction === "expense" ? items.filter((i) => i.schedule?.frequency === "budget") : [];
    const regular = items.filter((i) => !["budget", "once"].includes(i.schedule?.frequency));
    const option = (i) => `<option value="${esc(i.id)}" ${d.target === i.id ? "selected" : ""}>${esc(i.name)}${i.editable === false ? ` (${esc(i.owner_name)})` : ""}</option>`;
    return `<form data-form="assign">
      <h2>${tr("Umsatz zuordnen", "Assign transaction")}</h2>
      <div class="assign-row"><b>${this._moneyPlain(r[1])}</b> · ${fmtDate(r[0])}<br>${esc(r[2] || "?")}<div class="hint">${esc([r[4] || r[3], r[6]].filter(Boolean).join(" · "))}</div></div>
      ${d.current ? `<p class="hint">${tr(`Schon zugeordnet zu „${esc(d.current)}“. Eine weitere Zuordnung kommt dazu, die alte bleibt. Falsche Budget-Ausgaben löschst du im Budget.`, `Already assigned to “${esc(d.current)}”. Another assignment is added; the old one stays. Remove wrong budget spendings in the budget.`)}</p>` : ""}
      <div class="grid">
        <label class="full">${tr("Gehört zu", "Belongs to")}<select name="target" required>
          <option value="" disabled ${d.target ? "" : "selected"}>${tr("Bitte wählen", "Please choose")}</option>
          ${budgets.length ? `<optgroup label="${tr("Budgets", "Budgets")}">${budgets.map(option).join("")}</optgroup>` : ""}
          ${regular.length ? `<optgroup label="${tr("Posten", "Entries")}">${regular.map(option).join("")}</optgroup>` : ""}
          <option value="once" ${d.target === "once" ? "selected" : ""}>${tr("Neuer einmaliger Posten", "New one-off entry")}</option>
        </select></label>
        <label class="full">${tr("Name, falls neuer Posten", "Name, if new entry")}<input name="name" maxlength="80" value="${esc(r[2] || "")}"></label>
      </div>
      <label class="check"><input type="checkbox" name="remember" ${d.mixed ? "" : "checked"}> ${tr(`Alle Umsätze von „${esc(r[2] || "?")}“ gehören dazu, auch frühere und künftige`, `All transactions from “${esc(r[2] || "?")}” belong to it, past and future`)}</label>
      <p class="hint">${tr("So kannst du auch alte Anbieter dem heutigen Posten zuordnen, z. B. den früheren Stromanbieter dem Posten Strom. Die Preisentwicklung zeigt dann alles in einer Zeile.", "This also lets you assign old providers to today's entry, e.g. the former electricity provider to Electricity. Price changes then show everything in one line.")}</p>
      ${d.mixed ? `<p class="hint">${tr(`Von „${esc(r[2] || "?")}“ gibt es verschiedene Arten von Umsätzen. Deshalb ist das Häkchen aus.`, `“${esc(r[2] || "?")}” has different kinds of transactions, so this is off.`)}</p>` : ""}
      <p class="hint">${tr("Budget: wird als Ausgabe mit diesem Datum eingetragen. Posten: hakt den nächstgelegenen offenen Termin mit echtem Datum und Betrag ab.", "Budget: added as a spending on this date. Entry: confirms the nearest open date with the real date and amount.")}</p>
      ${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}
      <div class="dialog-actions"><span></span><div>
        <button type="button" class="secondary" data-action="close">${tr("Abbrechen", "Cancel")}</button>
        <button type="submit">${tr("Zuordnen", "Assign")}</button>
      </div></div>
    </form>`;
  }

  _renderTimeline() {
    const allDays = this._forecast?.days || [];
    const days = allDays.filter((d) => d.entries.length);
    const gaps = this._budgetGaps(allDays, days, this._forecast?.balance_date);
    const ranges = [7, 30, 90];
    const pending = this._pending.length
      ? `<div class="card">
          <h3>${tr("Zu bestätigen", "To confirm")}</h3>
          <div class="row-between">
            <p class="hint">${tr("Diese Buchungen waren in den letzten drei Wochen fällig. Bestätigen hilft der App, die Sicherheit besser einzuschätzen.", "These bookings were due in the last three weeks. Confirming them helps the app judge how certain future bookings are.")}</p>
            ${this._pending.length > 1 ? `<button class="small" data-action="confirm-all">${tr(`Alle ${this._pending.length} gebucht`, `All ${this._pending.length} booked`)}</button>` : ""}
          </div>
          ${this._pending.map((e) => `<div class="pending-date">${this._dateLabel(e.date)}</div>${this._renderEntry(e, { confirm: true, special: this._specialOf(e) })}`).join("")}
        </div>`
      : "";
    const list = days.length
      ? days
          .map(
            (d) => `<div class="day">
              <div class="day-head"><span>${this._dateLabel(d.date)}</span>${d.balance_likely !== null ? `<span class="day-balance ${d.balance_likely < 0 ? "neg" : ""}">${this._money(d.balance_likely)}</span>` : ""}</div>
              ${d.entries.map((e) => this._renderEntry(e, { special: this._specialOf(e) })).join("")}
              ${this._renderBudgetRow(gaps[d.date])}
            </div>`
          )
          .join("")
      : `<div class="empty">${tr("In diesem Zeitraum ist nichts fällig.", "Nothing is due in this period.")}${this._state.items.length ? "" : tr(" Lege unter „Posten“ deine ersten Einträge an.", " Add your first entries under “Entries”.")}</div>`;
    const deadlines = this._scopeItems()
      .filter((i) => i.contract_info && !i.contract_info.ended && i.contract_info.days_left <= 60)
      .sort((a, b) => a.contract_info.cancel_by.localeCompare(b.contract_info.cancel_by));
    const deadlineCard = deadlines.length
      ? `<div class="card">
          <h3>${tr("Kündigungsfristen", "Cancellation deadlines")}</h3>
          <p class="hint">${tr("Verträge, die du in den nächsten 60 Tagen kündigen müsstest, wenn du sie loswerden willst.", "Contracts you would have to cancel within the next 60 days if you want to get rid of them.")}</p>
          ${deadlines
            .map((i) => {
              const c = i.contract_info;
              return `<div class="entry" data-action="edit-item" data-item="${esc(i.id)}">
                <div class="entry-icon">${this._icon(i.icon)}</div>
                <div class="entry-main">
                  <div class="entry-name">${esc(i.name)}</div>
                  <div class="entry-meta">${tr("Vertragsende", "Contract ends")} ${shortDate(c.end)}${c.renews ? tr(", verlängert sich sonst", ", renews otherwise") : ""}</div>
                </div>
                <div class="deadline ${c.days_left <= 14 ? "urgent" : ""}">${tr("bis", "by")} ${shortDate(c.cancel_by)}<small>${c.days_left === 0 ? tr("heute", "today") : tr(`noch ${c.days_left} Tage`, `${c.days_left} days left`)}</small></div>
              </div>`;
            })
            .join("")}
        </div>`
      : "";
    const budgetMonthly = this._scopeItems()
      .filter((i) => i.schedule?.frequency === "budget" && i.direction === "expense" && (!i.end_date || i.end_date >= iso(today())))
      .reduce((a, i) => a + Number(i.current_amount ?? i.amount), 0);
    return `${this._renderBudgetCard()}${pending}${deadlineCard}
      <div class="card">
        <div class="row-between">
          <h3>${tr(`Die nächsten ${this._range} Tage`, `Next ${this._range} days`)}</h3>
          <div class="segmented">${ranges.map((r) => `<button class="${r === this._range ? "active" : ""}" data-action="range" data-range="${r}">${r} ${tr("Tage", "days")}</button>`).join("")}</div>
        </div>
        <p class="hint">${tr("Rechts neben jedem Tag steht der erwartete Kontostand mit sicheren und wahrscheinlichen Posten. Unsichere Posten werden gezeigt, aber nicht eingerechnet.", "Next to each day is the expected balance with certain and likely entries. Uncertain entries are shown but not counted.")}${budgetMonthly ? tr(` Budgets (${this._money(budgetMonthly)} pro Monat) sind eingerechnet: was noch übrig ist, verteilt auf die restlichen Tage.`, ` Budgets (${this._money(budgetMonthly)} per month) are included: what is left, spread over the remaining days.`) : ""}</p>
        ${list}
      </div>`;
  }

  _renderCalendar() {
    const month = this._month;
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const byDate = Object.fromEntries((this._calendar?.days || []).map((d) => [d.date, d]));
    const t = iso(today());
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(`<div class="cal-cell blank"></div>`);
    for (let day = 1; day <= daysInMonth; day++) {
      const key = iso(new Date(month.getFullYear(), month.getMonth(), day));
      const entries = (byDate[key]?.entries || []).filter((e) => e.status !== "skipped");
      const sum = entries.reduce((acc, e) => acc + e.amount, 0);
      cells.push(`<button class="cal-cell ${key === t ? "today" : ""} ${key === this._selectedDay ? "selected" : ""}" data-action="select-day" data-day="${key}">
        <span class="cal-day">${day}</span>
        <span class="cal-icons">${entries.slice(0, 4).map((e) => `<span class="cal-dot" style="--chip:${CERTAINTY[e.certainty]?.color}">${this._icon(e.icon, 16)}</span>`).join("")}${entries.length > 4 ? `<span class="more">+${entries.length - 4}</span>` : ""}</span>
        ${entries.length ? `<span class="cal-sum ${sum < 0 ? "neg" : "pos"}">${this._money(sum, true)}</span>` : ""}
      </button>`);
    }
    const selected = this._selectedDay && byDate[this._selectedDay];
    return `<div class="card">
      <div class="row-between">
        <button class="icon-button" data-action="month" data-delta="-1" aria-label="${tr("Vorheriger Monat", "Previous month")}">‹</button>
        <h3>${monthName(month.getMonth())} ${month.getFullYear()}</h3>
        <button class="icon-button" data-action="month" data-delta="1" aria-label="${tr("Nächster Monat", "Next month")}">›</button>
      </div>
      <div class="cal-grid">${[0, 1, 2, 3, 4, 5, 6].map((w) => `<div class="cal-head">${weekdayName(w)}</div>`).join("")}${cells.join("")}</div>
    </div>
    ${!selected ? this._renderMonthList() : ""}
    ${selected ? `<div class="card"><div class="row-between"><h3>${this._dateLabel(this._selectedDay)}</h3><button class="secondary small" data-action="select-day" data-day="">${tr("ganzer Monat", "whole month")}</button></div>
      ${selected.entries.length ? selected.entries.map((e) => this._renderEntry(e, { special: this._specialOf(e) })).join("") : `<div class="empty">${tr("Nichts fällig.", "Nothing due.")}</div>`}
      ${selected.balance_likely !== null ? `<p class="hint">${tr("Erwarteter Kontostand am Ende des Tages", "Expected balance at the end of the day")}: ${this._money(selected.balance_likely)} (${tr("vorsichtig", "cautious")}: ${this._money(selected.balance_sure)})</p>` : ""}
    </div>` : ""}`;
  }

  _renderMonthList() {
    const allDays = this._calendar?.days || [];
    const days = allDays.filter((d) => d.entries.some((e) => e.status !== "skipped"));
    const t = iso(today());
    const gaps = this._budgetGaps(allDays, days, this._calendar?.balance_date);
    return `<div class="card">
      <h3>${tr(`Alle Buchungen im ${monthName(this._month.getMonth())}`, `All bookings in ${monthName(this._month.getMonth())}`)}</h3>
      <p class="hint">${tr("Tippe oben auf einen Tag, um nur diesen Tag zu sehen.", "Tap a day above to see only that day.")}</p>
      ${days.length
        ? days
            .map(
              (d) => `<div class="day ${d.date < t ? "past" : ""}">
                <div class="day-head"><span>${this._dateLabel(d.date)}</span>${d.balance_likely !== null && d.date >= t ? `<span class="day-balance ${d.balance_likely < 0 ? "neg" : ""}">${this._money(d.balance_likely)}</span>` : ""}</div>
                ${d.entries.map((e) => this._renderEntry(e, { special: this._specialOf(e) })).join("")}
                ${d.date >= t ? this._renderBudgetRow(gaps[d.date]) : ""}
              </div>`
            )
            .join("")
        : `<div class="empty">${tr("In diesem Monat ist nichts fällig.", "Nothing is due this month.")}</div>`}
    </div>`;
  }

  _renderItems() {
    const items = this._scopeItems();
    const groups = {};
    for (const item of items) (groups[item.category] ||= []).push(item);
    const monthlyIn = items.filter((i) => i.direction === "income").reduce((a, i) => a + monthlyEquivalent(i), 0);
    const monthlyOut = items.filter((i) => i.direction === "expense").reduce((a, i) => a + monthlyEquivalent(i), 0);
    const households = Object.fromEntries(this._state.households.map((h) => [h.id, h.name]));
    return `<div class="card">
      <div class="row-between">
        <h3>${this._isHousehold() ? tr("Posten im Haushalt", "Household entries") : tr("Meine Posten", "My entries")}</h3>
        <button data-action="new-item">+ ${tr("Neuer Posten", "New entry")}</button>
      </div>
      <div class="totals">
        <div><div class="label">${tr("Einnahmen pro Monat", "Income per month")}</div><div class="big pos">${this._money(monthlyIn)}</div></div>
        <div><div class="label">${tr("Ausgaben pro Monat", "Expenses per month")}</div><div class="big neg">${this._money(monthlyOut)}</div></div>
        <div><div class="label">${tr("Ausgaben pro Jahr", "Expenses per year")}</div><div class="big">${this._money(monthlyOut * 12)}</div></div>
      </div>
      <p class="hint">${tr("Wiederkehrende Posten auf einen Monat umgerechnet, einmalige Posten zählen hier nicht mit.", "Recurring entries converted to one month; one-off entries are not included here.")}</p>
      ${this._isHousehold() ? "" : `<p class="hint">${tr("Importieren nimmt eine Export-Datei des Haushaltsbuchs oder eine CSV mit Umsätzen aus deiner Banking-App. Aus der CSV schlägt das Haushaltsbuch wiederkehrende Abbuchungen vor.", "Import takes a Household Budget export file or a CSV of transactions from your banking app. From a CSV, recurring payments are suggested.")}</p>`}
      ${this._isHousehold() ? "" : `<div class="row-actions">
        <button class="secondary small" data-action="export">${tr("Exportieren", "Export")}</button>
        <button class="secondary small" data-action="import">${tr("Importieren", "Import")}</button>
        <input type="file" accept=".json,.csv,.txt,.xml,.zip,application/json,text/csv,application/xml,text/xml,application/zip" data-change="import-file" multiple hidden>
      </div>`}
      ${items.length > 5 ? `<input class="search" type="search" name="item-search" placeholder="${tr("Posten suchen …", "Search entries …")}" aria-label="${tr("Posten suchen", "Search entries")}" value="${esc(this._search || "")}">` : ""}
    </div>
    ${items.length ? Object.keys(groups)
      .sort()
      .map(
        (cat) => `<div class="card item-group"><h3>${esc(cat)}</h3>${groups[cat]
          .map(
            (i) => `<div class="entry" data-action="edit-item" data-item="${esc(i.id)}" data-search="${esc(`${i.name} ${i.category} ${i.note || ""}`.toLowerCase())}">
              <div class="entry-icon">${this._icon(i.icon)}</div>
              <div class="entry-main">
                <div class="entry-name">${esc(i.name)}</div>
                <div class="entry-meta">${esc(scheduleLabel(i))} · ${tr("ab", "from")} ${fmtDate(i.start_date)}${i.end_date ? ` ${tr("bis", "until")} ${fmtDate(i.end_date)}` : ""}
                  ${i.household_id && !this._isHousehold() ? `<span class="chip shared">${esc(households[i.household_id] || tr("Haushalt", "Household"))}</span>` : ""}
                  ${!i.editable ? `<span class="owner">${esc(i.owner_name)}</span>` : ""}
                  ${i.contract_info && !i.contract_info.ended ? `<span class="chip contract ${i.contract_info.days_left <= 30 ? "urgent" : ""}">${tr("kündbar bis", "cancel by")} ${shortDate(i.contract_info.cancel_by)}</span>` : ""}
                  ${i.contract_info?.ended ? `<span class="chip skipped">${tr("Vertrag beendet", "contract ended")}</span>` : ""}</div>
              </div>
              <div class="entry-amount ${i.direction === "expense" ? "neg" : "pos"}">${this._money(i.direction === "expense" ? -(i.current_amount ?? i.amount) : i.current_amount ?? i.amount, true)}${(i.price_changes || []).some((c) => c.from > iso(today())) ? `<small class="price-note">${tr("ab", "from")} ${shortDate(i.price_changes.find((c) => c.from > iso(today())).from)}: ${this._money(i.price_changes.find((c) => c.from > iso(today())).amount)}</small>` : ""}</div>
            </div>`
          )
          .join("")}</div>`
      )
      .join("") : `<div class="card empty">${tr("Noch keine Posten. Tippe auf „Neuer Posten“ und wähle eine Vorlage wie GEZ, Gehalt oder Räderwechsel.", "No entries yet. Tap “New entry” and pick a template such as salary, rent or tyre change.")}</div>`}`;
  }

  _renderMonths() {
    const rows = this._summary || [];
    const salary = this._salaryItem();
    const itemsById = Object.fromEntries(this._state.items.map((i) => [i.id, i]));
    const max = Math.max(1, ...rows.map((r) => Math.max(r.income + r.uncertain_income, r.expense + r.uncertain_expense)));
    const barLine = (sure, unsure, cls) => {
      const label = [sure ? this._money(sure) : "", unsure ? `+ ${this._money(unsure)} ${tr("unsicher", "uncertain")}` : ""].filter(Boolean).join(" ");
      return `<div class="bar-line"><span class="bar ${cls}" style="width:${(sure / max) * 100}%"></span><span class="bar ${cls} light" style="width:${(unsure / max) * 100}%"></span>${label ? `<span class="bar-value">${label}</span>` : ""}</div>`;
    };
    return `<div class="card">
      <h3>${tr("Monatsübersicht", "Monthly overview")}</h3>
      <p class="hint">${tr("Was in welchem Monat tatsächlich gebucht wird. Sichere und wahrscheinliche Posten als volle Balken, unsichere als heller Zusatz. Tippe auf einen Monat für die einzelnen Buchungen.", "What is actually booked in each month. Certain and likely entries as solid bars, uncertain ones as a lighter extra. Tap a month to see its bookings.")}</p>
      ${salary ? `<p class="hint">${tr(`Deine Monate laufen von Gehalt zu Gehalt (<b>${esc(salary.name)}</b>). Ein Gehalt Ende Oktober zählt also zum November. Ändern kannst du das im Posten selbst.`, `Your months run from payday to payday (<b>${esc(salary.name)}</b>), so a salary at the end of October counts for November. You can change this in the entry itself.`)}</p>` : `<p class="hint">${tr("Tipp: Kommt dein Gehalt am Monatsende? Öffne den Gehalts-Posten und setze „Mein Monat beginnt mit dieser Einnahme“. Dann laufen die Monate von Gehalt zu Gehalt.", "Tip: Is your salary paid at the end of the month? Open the salary entry and tick “My month starts with this income”. Months then run from payday to payday.")}</p>`}
      ${this._renderSpecialSettings()}
      <div class="months">
        ${rows
          .map((r) => {
            const [y, m] = r.month.split("-").map(Number);
            const open = this._openMonth === r.month;
            const entries = r.entries || [];
            const special = entries.filter((e) => this._isSpecial(itemsById[e.item_id], e.amount));
            const regular = entries.filter((e) => !this._isSpecial(itemsById[e.item_id], e.amount));
            const specialSum = special.reduce((a, e) => a + e.amount, 0);
            const entryRow = (e) => `<div class="pending-date">${this._dateLabel(e.date)}</div>${this._renderEntry({ owner_name: "", ...e }, { special: this._isSpecial(itemsById[e.item_id], e.amount) && itemsById[e.item_id] })}`;
            return `<div class="month-block">
              <button class="month-row ${open ? "open" : ""}" data-action="toggle-month" data-month="${r.month}" aria-expanded="${open}">
                <div class="month-name">${monthName(m - 1).slice(0, 3)} ${String(y).slice(2)}${salary && r.start ? `<small title="${shortDay(r.start)}–${shortDay(r.end)}">${tr("ab", "from")} ${shortDay(r.start)}</small>` : ""}</div>
                <div class="bars">
                  ${barLine(r.income, r.uncertain_income, "pos-bg")}
                  ${barLine(r.expense, r.uncertain_expense, "neg-bg")}
                </div>
                <div class="month-net ${r.net < 0 ? "neg" : "pos"}">${this._money(r.net, true)}</div>
                ${special.length ? `<div class="month-specials">${special
                  .map((e) => `<span class="special-pill ${e.amount < 0 ? "" : "income"}">${this._icon(e.icon, 14)}<span>${esc(e.name)}</span><b>${this._money(e.amount, true)}</b></span>`)
                  .join("")}</div>` : ""}
              </button>
              ${open ? `<div class="month-entries">${entries.length ? `
                ${special.length ? `<div class="month-section special">★ ${tr("Sonderposten diesen Monat", "Special entries this month")} <b>${this._money(specialSum, true)}</b></div>${special.map(entryRow).join("")}` : ""}
                ${regular.length ? `<div class="month-section">${tr("Laufende Posten (jeden Monat)", "Regular entries (every month)")}</div>${regular.map(entryRow).join("")}` : ""}` : `<div class="empty">${tr("Keine Buchungen in diesem Monat.", "No bookings this month.")}</div>`}</div>` : ""}
            </div>`;
          })
          .join("")}
      </div>
    </div>
    ${this._renderCategoryTotals(rows)}`;
  }

  _renderSpecialSettings() {
    const st = this._state.user.settings || {};
    const minMonths = st.special_min_months ?? 2;
    return `<div class="special-settings">
      <span class="special-pill inline">★ ${tr("Sonderposten", "Special entries")}</span>
      <select data-change="special-months" aria-label="${tr("Sonderposten ab Turnus", "Special entries from interval")}">
        ${SPECIAL_OPTIONS.map(([v, de, en]) => `<option value="${v}" ${v === minMonths ? "selected" : ""}>${tr(de, en)}</option>`).join("")}
      </select>
      <label class="inline-amount">${tr("ab", "from")}<input type="number" min="0" step="1" inputmode="decimal" data-change="special-amount" value="${st.special_min_amount || 0}" aria-label="${tr("Sonderposten ab Betrag", "Special entries from amount")}"> ${esc(this._state.currency === "EUR" ? "€" : this._state.currency)}</label>
    </div>`;
  }

  _saveSpecialSettings(patch) {
    const st = { special_min_months: 2, special_min_amount: 0, ...(this._state.user.settings || {}), ...patch };
    this._state.user.settings = st;
    this._render();
    this._ws("settings", { settings: st }).catch((err) => {
      this._error = this._errorText(err);
      this._render();
    });
  }

  _renderCategoryTotals(rows) {
    const totals = {};
    for (const r of rows) {
      for (const e of r.entries || []) {
        if (e.amount >= 0 || e.certainty === "unsicher") continue;
        const t = (totals[e.category || tr("Sonstiges", "Other")] ||= { sum: 0, items: new Set() });
        t.sum += -e.amount;
        t.items.add(e.name);
      }
    }
    const list = Object.entries(totals).sort((a, b) => b[1].sum - a[1].sum);
    if (!list.length) return "";
    const total = list.reduce((a, [, t]) => a + t.sum, 0);
    const max = list[0][1].sum;
    return `<div class="card">
      <h3>${tr("Ausgaben nach Kategorie", "Expenses by category")}</h3>
      <p class="hint">${tr(
        `Durchschnitt pro Monat über die nächsten ${rows.length} Monate (sichere und wahrscheinliche Ausgaben, inklusive Budgets): <b>${this._money(total / rows.length)}</b> pro Monat, zusammen ${this._money(total)}. Klein darunter steht die Summe der ${rows.length} Monate.`,
        `Average per month over the next ${rows.length} months (certain and likely expenses, budgets included): <b>${this._money(total / rows.length)}</b> per month, ${this._money(total)} in total. The small figure is the sum over all ${rows.length} months.`
      )}</p>
      ${list
        .map(
          ([cat, t]) => `<div class="cat-row">
            <div class="cat-name">${esc(cat)}<small>${esc([...t.items].slice(0, 4).join(", "))}${t.items.size > 4 ? " …" : ""}</small></div>
            <div class="cat-bar"><span style="width:${(t.sum / max) * 100}%"></span></div>
            <div class="cat-sum">${this._money(t.sum / rows.length)}<small>${this._money(t.sum)} · ${Math.round((t.sum / total) * 100)} %</small></div>
          </div>`
        )
        .join("")}
    </div>`;
  }

  // ------------------------------------------------------------- dashboard

  _renderDashboard() {
    const items = this._scopeItems();
    const rows = this._summary || [];
    const days = this._trend?.days || [];
    const b = this._scopeBalance();
    const known = b.balance !== null && b.balance !== undefined;
    const itemsById = Object.fromEntries(this._state.items.map((i) => [i.id, i]));
    const active = items.filter((i) => !i.end_date || i.end_date >= iso(today()));
    const monthlyIn = active.filter((i) => i.direction === "income").reduce((a, i) => a + monthlyEquivalent(i), 0);
    const monthlyOut = active.filter((i) => i.direction === "expense").reduce((a, i) => a + monthlyEquivalent(i), 0);
    const free = monthlyIn - monthlyOut;
    const monthEnd = iso(new Date(today().getFullYear(), today().getMonth() + 1, 0));
    const endDay = [...days].reverse().find((d) => d.date <= monthEnd && d.balance_likely !== null);
    const salary = this._salaryItem();
    const todayIso = iso(today());
    const payIndex = salary ? days.findIndex((d) => d.date > todayIso && d.entries.some((e) => e.item_id === salary.id && e.status !== "skipped")) : -1;
    const beforePay = payIndex > 0 && days[payIndex - 1].balance_likely !== null ? days[payIndex - 1] : null;
    const lowest = days.filter((d) => d.balance_likely !== null).reduce((m, d) => (m && m.balance_likely <= d.balance_likely ? m : d), null);
    const tile = (label, value, sub = "", cls = "", help = "") =>
      `<div class="kpi"><div class="label">${label}${help ? this._help(help) : ""}</div><div class="kpi-value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
    const kpis = `<div class="card"><div class="kpis">
      ${tile(this._isHousehold() ? tr("Haushaltskonto", "Household account") : tr("Kontostand", "Balance"), known ? this._money(b.balance) : "—", known ? `${tr("Stand", "As of")} ${fmtDate(b.balance_date)}` : tr("noch nicht gesetzt", "not set yet"))}
      ${salary
        ? tile(tr("Vor dem nächsten Gehalt", "Before next payday"), beforePay ? this._money(beforePay.balance_likely) : "—", beforePay ? `${tr("am", "on")} ${fmtDate(beforePay.date)} · ${tr("vorsichtig", "cautious")}: ${this._money(beforePay.balance_sure)}` : "", beforePay && beforePay.balance_likely < 0 ? "neg" : "", tr(`Was am Tag vor dem nächsten Gehalt (${salary.name}) übrig ist, wenn alles wie erwartet kommt. Dann sind alle Abbuchungen des Monats schon runter.`, `What is left the day before the next salary (${salary.name}) if everything comes as expected. By then all of the month's debits have gone out.`))
        : tile(tr("Erwartet zum Monatsende", "Expected at month end"), endDay ? this._money(endDay.balance_likely) : "—", endDay ? `${tr("vorsichtig", "cautious")}: ${this._money(endDay.balance_sure)}` : "", endDay && endDay.balance_likely < 0 ? "neg" : "", tr("Kontostand am letzten Tag dieses Monats, wenn alles wie erwartet kommt. Kommt dein Gehalt am Monatsende, markiere es im Posten als „Mein Monat beginnt mit dieser Einnahme“, dann steht hier der Stand vor dem nächsten Gehalt.", "Balance on the last day of this month if everything comes as expected. If your salary arrives at the month end, mark it as “My month starts with this income” to see the balance before the next payday here."))}
      ${tile(tr("Einnahmen pro Monat", "Income per month"), this._money(monthlyIn), tr("regelmäßig, umgerechnet", "recurring, converted"), "pos", tr("Alle wiederkehrenden Einnahmen auf einen Monat umgerechnet. Einmalige wie ein Bonus zählen nicht.", "All recurring income converted to one month. One-offs such as a bonus are not included."))}
      ${tile(tr("Ausgaben pro Monat", "Expenses per month"), this._money(monthlyOut), tr("inklusive Budgets und Jahresposten", "incl. budgets and yearly entries"), "neg", tr("Alle wiederkehrenden Ausgaben auf einen Monat umgerechnet, auch jährliche (geteilt durch 12) und Budgets.", "All recurring expenses converted to one month, yearly ones divided by 12, budgets included."))}
      ${tile(tr("Bleibt pro Monat", "Left per month"), this._money(free, true), monthlyIn > 0 ? tr(`${Math.round((free / monthlyIn) * 100)} % der Einnahmen`, `${Math.round((free / monthlyIn) * 100)} % of income`) : "", free < 0 ? "neg" : "pos", tr("Einnahmen pro Monat minus Ausgaben pro Monat. So viel kannst du im Schnitt sparen.", "Income per month minus expenses per month: what you can save on average."))}
      ${tile(tr("Tiefster Stand (90 Tage)", "Lowest balance (90 days)"), lowest ? this._money(lowest.balance_likely) : "—", lowest ? fmtDate(lowest.date) : "", lowest && lowest.balance_likely < 0 ? "neg" : "", tr("Der niedrigste erwartete Kontostand in den nächsten 90 Tagen, meist kurz vor dem Gehalt.", "The lowest expected balance in the next 90 days, usually just before payday."))}
    </div></div>`;
    return kpis + this._renderBudgetCard() + this._renderCategoryPie(rows, monthlyIn) + this._renderSpendSplit(rows, itemsById) + this._renderCertaintySplit(rows) + this._renderFrequencySplit(active) + this._renderTopItems(active) + this._renderUpcomingSpecials(rows, itemsById);
  }

  _showHelp(el) {
    this._hideHelp();
    const tip = document.createElement("div");
    tip.className = "help-tip";
    tip.textContent = el.dataset.help;
    this.shadowRoot.appendChild(tip);
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    const below = r.bottom + 6 + tip.offsetHeight < window.innerHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? r.bottom + 6 : r.top - tip.offsetHeight - 6}px`;
    this._helpTip = tip;
    this._helpFor = el;
    this._helpShownAt = Date.now();
  }

  _hideHelp() {
    this._helpTip?.remove();
    this._helpTip = null;
    this._helpFor = null;
  }

  /** Small ⓘ that explains a figure on hover, focus or tap. */
  _help(text) {
    return `<span class="help" tabindex="0" role="note" aria-label="${esc(text)}" data-help="${esc(text)}">ⓘ</span>`;
  }

  /** Add one booking to a per-item breakdown. */
  _addDetail(map, e, value) {
    const d = (map[e.item_id] ||= { id: e.item_id, name: e.name, icon: e.icon, value: 0, count: 0 });
    d.value += value;
    d.count += 1;
  }

  /** The entries behind one part of a figure, largest first. */
  _renderDetails(details, { unit = "month", note = "" } = {}) {
    const list = Object.values(details || {}).sort((a, b) => b.value - a.value);
    if (!list.length) return `<div class="details"><div class="empty">${tr("Keine Posten.", "No entries.")}</div></div>`;
    return `<div class="details">
      ${note ? `<p class="hint">${note}</p>` : ""}
      ${list
        .map(
          (d) => `<div class="detail-row" data-action="edit-item" data-item="${esc(d.id)}">
            <span class="detail-icon">${this._icon(d.icon, 18)}</span>
            <div class="detail-name">${esc(d.name)}<small>${d.sub ?? (d.count === 1 ? tr("1 Buchung", "1 booking") : tr(`${d.count} Buchungen`, `${d.count} bookings`))}</small></div>
            <div class="detail-value">${this._money(d.value)}<small>${unit === "month" ? tr("pro Monat", "per month") : unit === "total" ? tr("zusammen", "in total") : ""}</small></div>
          </div>`
        )
        .join("")}
    </div>`;
  }

  /**
   * Thin segmented bar with a list of parts below (name, amount, share).
   * Tapping a part opens the entries behind it.
   */
  _splitBar(group, parts, total, opts = {}) {
    const shown = parts.filter((p) => p.value > 0);
    if (!shown.length || total <= 0) return `<div class="empty">${tr("Keine Daten.", "No data.")}</div>`;
    const open = (p) => this._dashOpen === `${group}:${p.key}`;
    return `<div class="split" role="img" aria-label="${esc(shown.map((p) => `${p.label} ${Math.round((p.value / total) * 100)} %`).join(", "))}">
        ${shown.map((p) => `<span class="${p.cls} ${open(p) ? "active" : ""}" style="flex:${p.value}" data-action="dash-toggle" data-key="${group}:${p.key}" title="${esc(p.label)}: ${Math.round((p.value / total) * 100)} %"></span>`).join("")}
      </div>
      <div class="split-list">
        ${shown
          .map(
            (p) => `<div class="split-row clickable ${open(p) ? "open" : ""}" data-action="dash-toggle" data-key="${group}:${p.key}" role="button" aria-expanded="${open(p)}" tabindex="0">
              <i class="swatch ${p.cls}"></i>
              <div class="split-name">${esc(p.label)}${p.help ? this._help(p.help) : ""}${p.hint ? `<small>${p.hint}</small>` : ""}</div>
              <div class="split-value">${this._money(p.value)}<small>${Math.round((p.value / total) * 100)} %</small></div>
              <span class="chevron">${open(p) ? "▾" : "▸"}</span>
            </div>${open(p) ? this._renderDetails(p.details, opts) : ""}`
          )
          .join("")}
      </div>`;
  }

  _renderCategoryPie(rows, monthlyIn = 0) {
    if (!rows.length) return "";
    const totals = {};
    const details = {};
    for (const r of rows) {
      for (const e of r.entries || []) {
        if (e.amount >= 0 || e.certainty === "unsicher" || e.status === "skipped") continue;
        const cat = e.category || tr("Sonstiges", "Other");
        totals[cat] = (totals[cat] || 0) - e.amount / rows.length;
        this._addDetail((details[cat] ||= {}), e, -e.amount / rows.length);
      }
    }
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return "";
    // Five named slices in a fixed colour order, everything else folds into "Other".
    const parts = sorted.slice(0, 5).map(([label, value], i) => ({ key: label, label, value, cls: `p${i + 1}`, details: details[label] }));
    const rest = sorted.slice(5);
    if (rest.length) {
      const restDetails = {};
      for (const [cat] of rest) Object.assign(restDetails, details[cat]);
      parts.push({ key: "__other", label: tr(`Weitere (${rest.length})`, `Others (${rest.length})`), value: rest.reduce((a, [, v]) => a + v, 0), cls: "p-other", details: restDetails });
    }
    const total = parts.reduce((a, p) => a + p.value, 0);
    const R0 = 70, R1 = 44, C = 80;
    let angle = -Math.PI / 2;
    const slices = parts.map((p) => {
      const sweep = (p.value / total) * Math.PI * 2;
      const a0 = angle, a1 = angle + sweep;
      angle = a1;
      const attrs = `class="${p.cls} ${this._dashOpen === `cat:${p.key}` ? "active" : ""}" data-action="dash-toggle" data-key="cat:${esc(p.key)}"`;
      if (sweep >= Math.PI * 2 - 1e-6) return `<circle ${attrs} cx="${C}" cy="${C}" r="${(R0 + R1) / 2}" fill="none" stroke-width="${R0 - R1}"><title>${esc(p.label)}</title></circle>`;
      const pt = (r, a) => `${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`;
      const large = sweep > Math.PI ? 1 : 0;
      return `<path ${attrs} d="M${pt(R0, a0)}A${R0},${R0} 0 ${large} 1 ${pt(R0, a1)}L${pt(R1, a1)}A${R1},${R1} 0 ${large} 0 ${pt(R1, a0)}Z"><title>${esc(p.label)}: ${Math.round((p.value / total) * 100)} %</title></path>`;
    });
    const open = (p) => this._dashOpen === `cat:${p.key}`;
    return `<div class="card">
      <h3>${tr("Wohin das meiste Geld fließt", "Where most of the money goes")}${this._help(tr("Alle Ausgaben der nächsten 12 Monate nach Kategorie, geteilt durch 12. So siehst du, was ein durchschnittlicher Monat pro Kategorie kostet. Unsichere und ausgefallene Buchungen zählen nicht.", "All expenses of the next 12 months by category, divided by 12: what an average month costs per category. Uncertain and skipped bookings are left out."))}</h3>
      <p class="hint">${tr("Durchschnitt pro Monat. Tippe auf eine Kategorie, um die Posten darin zu sehen.", "Average per month. Tap a category to see its entries.")}</p>
      <div class="pie-wrap">
        <div class="pie">
          <svg viewBox="0 0 160 160" width="180" height="180" role="img" aria-label="${esc(parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)} %`).join(", "))}">${slices.join("")}</svg>
          <div class="pie-center"><small>${tr("pro Monat", "per month")}</small>${this._money(total)}</div>
        </div>
        ${monthlyIn > 0 ? `<p class="hint income-share">${tr(
          `Zusammen <b>${this._money(total)}</b> pro Monat, das sind <b>${Math.round((total / monthlyIn) * 100)} % deines Einkommens</b> (${this._money(monthlyIn)}). Die Prozente in der Liste sind Anteile an den Ausgaben.`,
          `Together <b>${this._money(total)}</b> per month, that is <b>${Math.round((total / monthlyIn) * 100)} % of your income</b> (${this._money(monthlyIn)}). The percentages in the list are shares of spending.`
        )}</p>` : ""}
        <div class="split-list pie-list">
          ${parts
            .map(
              (p) => `<div class="split-row clickable ${open(p) ? "open" : ""}" data-action="dash-toggle" data-key="cat:${esc(p.key)}" role="button" aria-expanded="${open(p)}" tabindex="0">
                <i class="swatch ${p.cls}"></i><div class="split-name">${esc(p.label)}</div>
                <div class="split-value">${this._money(p.value)}<small>${Math.round((p.value / total) * 100)} %</small></div>
                <span class="chevron">${open(p) ? "▾" : "▸"}</span>
              </div>${open(p) ? this._renderDetails(p.details, { note: this._shareNote(p.value, total, monthlyIn) }) : ""}`
            )
            .join("")}
        </div>
      </div>
    </div>`;
  }

  // "47 % of your spending · 30 % of your income" for one opened part.
  _shareNote(value, total, monthlyIn) {
    const ofSpend = Math.round((value / total) * 100);
    if (!(monthlyIn > 0)) return tr(`${ofSpend} % deiner Ausgaben`, `${ofSpend} % of your spending`);
    const ofIncome = Math.round((value / monthlyIn) * 100);
    return tr(`<b>${ofSpend} % deiner Ausgaben</b> · <b>${ofIncome} % deines Einkommens</b>`, `<b>${ofSpend} % of your spending</b> · <b>${ofIncome} % of your income</b>`);
  }

  _renderSpendSplit(rows, itemsById) {
    if (!rows.length) return "";
    const sums = { regular: 0, budget: 0, special: 0 };
    const details = { regular: {}, budget: {}, special: {} };
    for (const r of rows) {
      for (const e of r.entries || []) {
        if (e.amount >= 0 || e.certainty === "unsicher" || e.status === "skipped") continue;
        const item = itemsById[e.item_id];
        const kind = e.budget || item?.schedule?.frequency === "budget" ? "budget" : this._isSpecial(item, e.amount) ? "special" : "regular";
        sums[kind] += -e.amount / rows.length;
        this._addDetail(details[kind], e, -e.amount / rows.length);
      }
    }
    const total = sums.regular + sums.budget + sums.special;
    return `<div class="card">
      <h3>${tr("Fixkosten, Sonderposten und Budgets", "Fixed costs, special entries and budgets")}</h3>
      <p class="hint">${tr("Was ein durchschnittlicher Monat kostet, aufgeteilt nach Art der Ausgabe. Tippe auf eine Zeile für die Posten dahinter.", "What an average month costs, split by kind of expense. Tap a row to see the entries behind it.")}</p>
      ${this._splitBar(
        "spend",
        [
          { key: "regular", label: tr("Laufende Fixkosten", "Regular fixed costs"), hint: tr("kommen jeden Monat", "due every month"), help: tr("Alles, was jeden Monat (oder öfter) abgebucht wird, z.B. Miete, Strom, Handy, Kredit.", "Everything debited every month (or more often), e.g. rent, electricity, phone, loan."), value: sums.regular, cls: "s1", details: details.regular },
          { key: "special", label: tr("Sonderposten, umgelegt", "Special entries, spread"), hint: tr("auf die Monate verteilt", "spread across the months"), help: tr("Posten, die nicht jeden Monat kommen (z.B. Versicherung jährlich, GEZ vierteljährlich). Ihre Summe über 12 Monate geteilt durch 12. So viel solltest du jeden Monat dafür zurücklegen.", "Entries that don't come every month (e.g. yearly insurance). Their 12-month sum divided by 12: what you should put aside each month."), value: sums.special, cls: "s2", details: details.special },
          { key: "budget", label: tr("Budgets", "Budgets"), hint: tr("variable Ausgaben", "variable spending"), help: tr("Monatsbudgets für Ausgaben ohne feste Termine, z.B. Lebensmittel oder Freizeit.", "Monthly budgets for spending without fixed dates, e.g. groceries or leisure."), value: sums.budget, cls: "s3", details: details.budget },
        ],
        total
      )}
    </div>`;
  }

  _renderCertaintySplit(rows) {
    if (!rows.length) return "";
    const sums = { sicher: 0, wahrscheinlich: 0, unsicher: 0 };
    const details = { sicher: {}, wahrscheinlich: {}, unsicher: {} };
    for (const r of rows) {
      for (const e of r.entries || []) {
        if (e.amount >= 0 || e.status === "skipped" || e.budget) continue;
        const key = e.certainty in sums ? e.certainty : "unsicher";
        sums[key] += -e.amount;
        this._addDetail(details[key], e, -e.amount);
      }
    }
    const total = sums.sicher + sums.wahrscheinlich + sums.unsicher;
    return `<div class="card">
      <h3>${tr("Wie sicher sind die Ausgaben?", "How certain are the expenses?")}${this._help(tr("Jede Buchung hat eine Sicherheitsstufe. Sie wird sicher, wenn du die letzten Buchungen pünktlich mit gleichem Betrag bestätigt hast. Unsicher heißt: schwankt stark, zuletzt ausgefallen oder läuft bald aus.", "Every booking has a certainty level. It becomes certain once the last bookings were confirmed on time with the same amount. Uncertain means it varies a lot, was skipped recently or ends soon."))}</h3>
      <p class="hint">${tr(`Alle einzelnen Ausgaben der nächsten ${rows.length} Monate zusammen (ohne Budgets). Tippe auf eine Stufe, um zu sehen, welche Posten dazugehören.`, `All single expenses of the next ${rows.length} months together (without budgets). Tap a level to see which entries belong to it.`)}</p>
      ${this._splitBar(
        "cert",
        [
          { key: "sicher", label: certaintyLabel("sicher"), hint: tr("pünktlich bestätigt", "confirmed on time"), value: sums.sicher, cls: "c-sure", details: details.sicher },
          { key: "wahrscheinlich", label: certaintyLabel("wahrscheinlich"), hint: tr("noch nicht oft genug bestätigt oder schwankend", "not confirmed often enough yet, or varying"), value: sums.wahrscheinlich, cls: "c-likely", details: details.wahrscheinlich },
          { key: "unsicher", label: certaintyLabel("unsicher"), hint: tr("zählt nicht im Kontostand", "not counted in the balance"), value: sums.unsicher, cls: "c-unsure", details: details.unsicher },
        ],
        total,
        { unit: "total", note: tr(`Summe der nächsten ${rows.length} Monate. Bestätige Buchungen in der Zeitleiste, damit sie sicher werden.`, `Sum of the next ${rows.length} months. Confirm bookings in the timeline to make them certain.`) }
      )}
    </div>`;
  }

  _renderFrequencySplit(items) {
    const groups = {};
    for (const i of items.filter((i) => i.direction === "expense")) {
      const v = monthlyEquivalent(i);
      if (!v) continue;
      const key = presetOf(i.schedule);
      const g = (groups[key] ||= { value: 0, items: {} });
      g.value += v;
      g.items[i.id] = { id: i.id, name: i.name, icon: i.icon, value: v, sub: `${this._moneyPlain(Number(i.current_amount ?? i.amount))} ${scheduleLabel(i)}` };
    }
    const list = Object.entries(groups).sort((a, b) => b[1].value - a[1].value);
    if (!list.length) return "";
    const max = list[0][1].value;
    const total = list.reduce((a, [, g]) => a + g.value, 0);
    return `<div class="card">
      <h3>${tr("Was jeder Turnus pro Monat kostet", "What each schedule costs per month")}${this._help(tr("Jeder Posten wird auf einen Monat umgerechnet: eine jährliche Versicherung von 120 € zählt mit 10 € pro Monat, eine vierteljährliche Rechnung von 60 € mit 20 €. So lassen sich monatliche, jährliche und gleitende Posten vergleichen.", "Every entry is converted to one month: a yearly insurance of 120 counts as 10 per month, a quarterly bill of 60 as 20. That makes monthly, yearly and rolling entries comparable."))}</h3>
      <p class="hint">${tr(`Deine Ausgaben gruppiert danach, wie oft sie kommen, umgerechnet auf einen Monat (zusammen ${this._moneyPlain(total)} pro Monat). Tippe auf eine Zeile für die Posten.`, `Your expenses grouped by how often they come, converted to one month (${this._moneyPlain(total)} per month in total). Tap a row for the entries.`)}</p>
      ${list
        .map(([key, g]) => {
          const open = this._dashOpen === `freq:${key}`;
          const count = Object.keys(g.items).length;
          return `<div class="cat-row clickable ${open ? "open" : ""}" data-action="dash-toggle" data-key="freq:${key}" role="button" aria-expanded="${open}" tabindex="0">
            <div class="cat-name">${esc(FREQUENCY_PRESETS.find((p) => p.key === key)[LANG].replace(/ \(.*\)$/, ""))}<small>${count} ${count === 1 ? tr("Posten", "entry") : tr("Posten", "entries")} · ${Math.round((g.value / total) * 100)} %</small></div>
            <div class="cat-bar"><span style="width:${(g.value / max) * 100}%"></span></div>
            <div class="cat-sum">${this._money(g.value)}<small>${tr("pro Monat", "per month")}</small></div>
          </div>${open ? this._renderDetails(g.items) : ""}`;
        })
        .join("")}
    </div>`;
  }

  _renderTopItems(items) {
    const list = items
      .filter((i) => i.direction === "expense")
      .map((i) => [i, monthlyEquivalent(i)])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (!list.length) return "";
    const max = list[0][1];
    return `<div class="card">
      <h3>${tr("Größte Ausgaben", "Largest expenses")}${this._help(tr("Die Posten mit dem höchsten Betrag pro Monat, umgerechnet wie oben. Antippen öffnet den Posten.", "The entries with the highest amount per month, converted as above. Tap to open the entry."))}</h3>
      <p class="hint">${tr("Die acht Posten, die pro Monat umgerechnet am meisten kosten.", "The eight entries that cost the most per month.")}</p>
      ${list
        .map(
          ([i, v]) => `<div class="cat-row clickable" data-action="edit-item" data-item="${esc(i.id)}">
            <div class="cat-name"><span class="cat-icon">${this._icon(i.icon, 18)}</span>${esc(i.name)}<small>${esc(scheduleLabel(i))}</small></div>
            <div class="cat-bar"><span style="width:${(v / max) * 100}%"></span></div>
            <div class="cat-sum">${this._money(v)}<small>${tr("pro Monat", "per month")}</small></div>
          </div>`
        )
        .join("")}
    </div>`;
  }

  _renderUpcomingSpecials(rows, itemsById) {
    const limit = iso(new Date(today().getFullYear(), today().getMonth() + 3, today().getDate()));
    const list = rows
      .flatMap((r) => r.entries || [])
      .filter((e) => e.date >= iso(today()) && e.date <= limit && e.status !== "skipped" && !e.budget && this._isSpecial(itemsById[e.item_id], e.amount))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return "";
    const sum = list.reduce((a, e) => a + e.amount, 0);
    return `<div class="card">
      <div class="row-between"><h3>${tr("Sonderposten der nächsten 3 Monate", "Special entries in the next 3 months")}${this._help(tr("Buchungen, die nicht jeden Monat kommen und deshalb auffallen, z.B. Jahresbeiträge oder ein Bonus. Was als Sonderposten zählt, stellst du im Tab Monate ein.", "Bookings that don't come every month and therefore stand out, e.g. yearly fees or a bonus. What counts as special is set in the Months tab."))}</h3><b class="${sum < 0 ? "neg" : "pos"}">${this._money(sum, true)}</b></div>
      ${list.map((e) => `<div class="pending-date">${this._dateLabel(e.date)}</div>${this._renderEntry({ owner_name: "", ...e }, { special: itemsById[e.item_id] })}`).join("")}
    </div>`;
  }

  _renderHouseholds() {
    const hs = this._state.households;
    return `<div class="card">
      <div class="row-between">
        <h3>${tr("Haushaltsbücher", "Households")}</h3>
        <button data-action="new-household">+ ${tr("Haushalt anlegen", "Add household")}</button>
      </div>
      <p class="hint">${tr("In einem Haushaltsbuch siehst du die Posten aller Mitglieder zusammen. Deine Posten bleiben privat, bis du sie beim Bearbeiten einem Haushalt zuordnest.", "A household shows the entries of all its members together. Your entries stay private until you assign them to a household while editing.")}</p>
    </div>
    ${hs.length ? hs
      .map(
        (h) => `<div class="card">
          <div class="row-between">
            <h3>${esc(h.name)}</h3>
            <div class="actions">
              ${h.is_creator ? `<button class="secondary" data-action="edit-household" data-id="${esc(h.id)}">${tr("Bearbeiten", "Edit")}</button>` : `<button class="secondary" data-action="leave-household" data-id="${esc(h.id)}">${tr("Verlassen", "Leave")}</button>`}
            </div>
          </div>
          <div class="entry-meta">${tr("Mitglieder", "Members")}: ${h.member_names.map(esc).join(", ")}</div>
          <label class="switch-row">
            <input type="checkbox" data-change="entities" data-id="${esc(h.id)}" ${h.entities ? "checked" : ""}>
            <span>${tr("Als Kalender und Sensoren in Home Assistant anlegen", "Create a calendar and sensors in Home Assistant")}<br><small>${tr("Diese Entitäten können alle Home-Assistant-Nutzer sehen.", "All Home Assistant users can see these entities.")}</small></span>
          </label>
        </div>`
      )
      .join("") : `<div class="card empty">${tr("Noch kein Haushaltsbuch.", "No household yet.")}</div>`}
    ${this._state.user.is_admin ? this._renderBackups() : ""}`;
  }

  _renderBackups() {
    const reasons = {
      manual: tr("von Hand", "manual"),
      csv_import: tr("vor CSV-Import", "before CSV import"),
      before_restore: tr("vor Wiederherstellen", "before restore"),
      upload: tr("hochgeladene Datei", "uploaded file"),
    };
    const list = this._backups?.backups || [];
    const when = (created) => {
      const d = new Date(created);
      return `${d.toLocaleDateString(DATE_LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" })}, ${d.toLocaleTimeString(DATE_LOCALE, { hour: "2-digit", minute: "2-digit" })}`;
    };
    return `<div class="card">
      <div class="row-between">
        <h3>${tr("Sicherungen", "Backups")}</h3>
        <button data-action="backup-create">${tr("Jetzt sichern", "Back up now")}</button>
      </div>
      <p class="hint">${tr(`Sichert alles: Posten, Haushalte, Kontostände und die Umsätze der Statistik, für alle Nutzer. Automatisch vor jedem CSV-Import und vor jedem Wiederherstellen. Die letzten 30 liegen in <code>${esc(this._backups?.folder || "/config/haushaltsbuch_backups")}</code> und sind auch in den normalen Home-Assistant-Backups enthalten.`, `Backs up everything: entries, households, balances and the statistics transactions, for all users. Automatically before every CSV import and every restore. The last 30 are kept in <code>${esc(this._backups?.folder || "/config/haushaltsbuch_backups")}</code> and are part of normal Home Assistant backups too.`)}</p>
      ${list.length ? `<div class="backup-list">${list
        .map((b) => `<div class="backup-row">
          <div class="entry-main">
            <div class="entry-name">${when(b.created)}</div>
            <div class="entry-meta">${esc(reasons[b.reason] || b.reason)} · ${tr(`${b.items} Posten`, `${b.items} entries`)}${b.households ? ` · ${tr(`${b.households} Haushalte`, `${b.households} households`)}` : ""}${b.rows ? ` · ${tr(`${b.rows} Umsätze`, `${b.rows} transactions`)}` : ""} · ${Math.max(1, Math.round(b.size / 1024))} KB</div>
          </div>
          <div class="backup-actions">
            <button class="secondary small" data-action="backup-download" data-id="${esc(b.id)}">${tr("Herunterladen", "Download")}</button>
            <button class="secondary small" data-action="backup-restore" data-id="${esc(b.id)}" data-created="${esc(when(b.created))}">${tr("Zurückspielen", "Restore")}</button>
          </div>
        </div>`)
        .join("")}</div>` : `<p class="hint">${tr("Noch keine Sicherung vorhanden.", "No backup yet.")}</p>`}
      <div class="row-actions">
        <button class="secondary small" data-action="backup-upload">${tr("Sicherungsdatei zurückspielen …", "Restore from file …")}</button>
        <input type="file" accept=".json,application/json" data-change="backup-file" hidden>
      </div>
    </div>`;
  }

  async _downloadJson(name, data) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  _restoreFinished(summary) {
    setTimeout(() => {
      this._dialog = {
        type: "notice",
        title: tr("Zurückgespielt", "Restored"),
        text: tr(`Der Stand vom ${new Date(summary.created).toLocaleString(DATE_LOCALE)} ist wieder da (${summary.items} Posten). Der Stand davor wurde vorher gesichert.`, `The state of ${new Date(summary.created).toLocaleString(DATE_LOCALE)} is back (${summary.items} entries). The state before was backed up first.`),
      };
      this._render();
    });
  }

  // ---------------------------------------------------------------- dialogs

  _renderDialog() {
    const d = this._dialog;
    let body = "";
    if (d.type === "item") body = this._renderItemForm(d);
    if (d.type === "balance") body = this._renderBalanceForm();
    if (d.type === "confirm") body = this._renderConfirmForm(d);
    if (d.type === "household") body = this._renderHouseholdForm(d);
    if (d.type === "import") body = this._renderImportForm(d);
    if (d.type === "csv") body = this._renderCsvForm(d);
    if (d.type === "notice") body = this._renderNotice(d);
    if (d.type === "spending") body = this._renderSpendingForm(d);
    if (d.type === "assign") body = this._renderAssignForm(d);
    if (d.type === "csv-map") body = this._renderColumnForm(d);
    return `<div class="overlay" data-action="close-overlay"><div class="dialog" role="dialog" aria-modal="true">${body}</div></div>`;
  }

  _renderItemForm(d) {
    const item = d.item;
    const preset = d.preset || presetOf(item.schedule);
    const readOnly = item.id && !item.editable;
    // iOS shows an empty date field as today and offers no way to clear it,
    // so the end date is only present while the checkbox is ticked.
    const hasEnd = d.hasEnd ?? Boolean(item.end_date);
    const dis = readOnly ? "disabled" : "";
    const templates = !item.id
      ? `<div class="templates">${this._templates()
          .map((t, idx) => `<button type="button" class="template" data-action="template" data-index="${idx}">${this._icon(t.icon, 18)}<span>${esc(t.name)}</span></button>`)
          .join("")}</div>`
      : "";
    const dates = (item.schedule?.dates || []).map((md) => {
      const [m, day] = md.split("-");
      return `${day}.${m}.`;
    });
    return `<form data-form="item">
      <h2>${readOnly ? esc(item.name) : item.id ? tr("Posten bearbeiten", "Edit entry") : tr("Neuer Posten", "New entry")}</h2>
      ${readOnly ? `<p class="hint">${tr(`Dieser Posten gehört ${esc(item.owner_name)} und kann nur von dort geändert werden.`, `This entry belongs to ${esc(item.owner_name)} and can only be changed by them.`)}</p>` : ""}
      ${templates}
      ${item.id && preset === "budget" && item.budget_status ? `<div class="budget-in-form">${this._renderBudgetBar(item, { list: false })}<button type="button" class="small" data-action="spending-new" data-item="${esc(item.id)}">+ ${tr("Ausgabe erfassen", "Add spending")}</button></div>` : ""}
      <div class="grid">
        <label class="full">${tr("Name", "Name")}<input name="name" required maxlength="100" value="${esc(item.name)}" ${dis}></label>
        <label>${tr("Art", "Type")}<select name="direction" data-change="direction" ${dis}>
          <option value="expense" ${item.direction !== "income" ? "selected" : ""}>${tr("Ausgabe", "Expense")}</option>
          <option value="income" ${item.direction === "income" ? "selected" : ""}>${tr("Einnahme", "Income")}</option>
        </select></label>
        <label>${preset === "budget" ? tr("Budget pro Monat", "Budget per month") : (item.price_changes || []).length ? tr("Betrag am Anfang", "Initial amount") : tr("Betrag", "Amount")} (${esc(this._state.currency)})<input name="amount" ${this._amountAttrs()} required value="${this._amountValue(item.amount)}" ${dis}></label>
        <label class="suggest-field">${tr("Kategorie", "Category")}<input name="category" autocomplete="off" required placeholder="${tr("Auswählen oder neue eingeben", "Pick one or type a new one")}" value="${esc(item.category || "")}" ${dis}><div class="suggest" hidden></div></label>
        <label class="suggest-field">${tr("Symbol", "Icon")} <span class="icon-preview">${this._icon(item.icon, 20)}</span><input name="icon" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${tr("Suchen, z.B. auto, haus, strom – oder Emoji", "Search, e.g. car, home, flash – or emoji")}" value="${esc(item.icon || "")}" ${dis}><div class="suggest" hidden></div></label>
        <label>${tr("Turnus", "Repeats")}<select name="preset" data-change="preset" ${dis}>
          ${FREQUENCY_PRESETS.map((p) => `<option value="${p.key}" ${p.key === preset ? "selected" : ""}>${p[LANG]}</option>`).join("")}
        </select></label>
        ${preset === "monthly_weekday" ? `<label>${tr("Welcher Tag?", "Which day?")}<span class="inline-fields"><select name="week" ${dis}>
          ${WEEK_ORDINALS.map(([w, de, en]) => `<option value="${w}" ${w === (item.schedule?.week ?? -1) ? "selected" : ""}>${tr(de.replace(/n$/, "r"), en)}</option>`).join("")}
        </select><select name="weekday" ${dis}>
          ${[0, 1, 2, 3, 4, 5, 6].map((w) => `<option value="${w}" ${w === (item.schedule?.weekday ?? 3) ? "selected" : ""}>${weekdayLong(w)}</option>`).join("")}
        </select></span></label>` : ""}
        ${preset === "every_n_months" ? `<label>${tr("Alle wie viele Monate?", "Every how many months?")}<input name="interval" type="number" min="1" max="120" value="${item.schedule?.interval || 2}" ${dis}></label>` : ""}
        ${preset === "rolling" ? `<label>${tr("Nächster Termin nach", "Next date after")}<span class="inline-fields"><input name="interval" type="number" min="1" max="120" value="${item.schedule?.interval || 1}" ${dis}><select name="unit" ${dis}>
          <option value="months" ${item.schedule?.unit !== "weeks" ? "selected" : ""}>${tr("Monat(en)", "month(s)")}</option>
          <option value="weeks" ${item.schedule?.unit === "weeks" ? "selected" : ""}>${tr("Woche(n)", "week(s)")}</option>
        </select></span></label>
        <label class="check full"><input type="checkbox" name="learn" ${item.schedule?.learn !== false ? "checked" : ""} ${dis}> ${tr("Abstand aus bestätigten Terminen lernen", "Learn the interval from confirmed dates")}${item.learned_days ? tr(` (zurzeit ~${item.learned_days} Tage)`, ` (currently ~${item.learned_days} days)`) : ""}</label>
        <p class="hint full">${tr("Der nächste Termin richtet sich nach dem letzten. Ab drei bestätigten Terminen rechnet die App mit deinem echten durchschnittlichen Abstand. Tippe in der Zeitleiste auf einen Eintrag, um einen festen Termin einzutragen. Alle weiteren rücken dann nach.", "The next date follows the last one. From three confirmed dates on, the app uses your real average interval. Tap an entry in the timeline to set a fixed date; all later ones move along.")}</p>` : ""}
        ${preset === "weekly" ? `<label>${tr("Alle wie viele Wochen?", "Every how many weeks?")}<input name="interval" type="number" min="1" max="52" value="${item.schedule?.interval || 1}" ${dis}></label>` : ""}
        ${preset === "budget" ? `<p class="hint full">${tr("Für Ausgaben ohne feste Termine, z.B. Lebensmittel oder Freizeit. Das Budget wird über die Tage des Monats verteilt vom erwarteten Kontostand abgezogen. Trägst du echte Ausgaben ein (unter „Budgets diesen Monat“ oder per Aktion haushaltsbuch.add_expense), wird der Rest kleiner. Was übrig bleibt, verfällt am Monatsende. Kein fester Betrag? Trag 0 ein, dann zählt nur, was du einträgst (z.B. für Ungeplantes).", "For spending without fixed dates, e.g. groceries or leisure. The budget is taken off the expected balance spread over the days of the month. When you enter real spendings (under “Budgets this month” or with the action haushaltsbuch.add_expense), the rest shrinks. Whatever is left expires at the end of the month. No fixed amount? Enter 0 and only what you enter counts (e.g. for unplanned purchases).")}</p>` : ""}
        ${preset === "fixed_dates" ? `<label class="full">${tr("Termine im Jahr (TT.MM., durch Komma getrennt)", "Dates each year (DD.MM., comma separated)")}<input name="dates" placeholder="01.04., 15.10." value="${esc(dates.join(", "))}" ${dis}></label>` : ""}
        <label>${preset === "once" ? tr("Datum", "Date") : preset === "fixed_dates" || preset === "budget" || preset === "monthly_weekday" ? tr("Gültig ab", "Valid from") : preset === "rolling" ? tr("Erster Termin", "First date") : tr("Erste Fälligkeit", "First due date")}<input name="start_date" type="date" required value="${esc(item.start_date || iso(today()))}" ${dis}></label>
        ${preset !== "once" ? `<div class="end-date">
          <label class="check"><input type="checkbox" name="has_end" data-change="has_end" ${hasEnd ? "checked" : ""} ${dis}> ${tr("Enddatum festlegen", "Set an end date")}</label>
          ${hasEnd ? `<input name="end_date" type="date" aria-label="${tr("Enddatum", "End date")}" required value="${esc(item.end_date || "")}" ${dis}>` : ""}
        </div>` : ""}
        ${(() => {
          const salaryOk = item.direction === "income" && preset !== "once" && preset !== "budget";
          const checked = salaryOk && (d.salaryCycle ?? (item.id && item.id === this._state.user.settings?.salary_item_id));
          return `<label class="check full ${salaryOk ? "" : "muted"}"><input type="checkbox" name="salary_cycle" ${dis || (salaryOk ? "" : "disabled")} ${checked ? "checked" : ""}> <span>${tr("Mein Monat beginnt mit dieser Einnahme (Gehalt)", "My month starts with this income (salary)")}${salaryOk ? "" : `<small>${tr("nur bei wiederkehrenden Einnahmen", "only for recurring income")}</small>`}</span>${this._help(tr("Dann laufen Monatsübersicht und Auswertungen von Gehalt zu Gehalt statt vom 1. bis zum Monatsende. Ein Gehalt nach dem 15. zählt zum Folgemonat, weil es dessen Abbuchungen bezahlt. Geht nur bei wiederkehrenden Einnahmen, nicht bei Ausgaben, einmaligen Posten oder Budgets.", "The monthly overview and the figures then run from payday to payday instead of the 1st to the month end. A salary paid after the 15th counts for the next month, because it pays that month's bills. Only for recurring income, not for expenses, one-off entries or budgets."))}</label>`;
        })()}
      </div>
      ${preset !== "once" ? this._renderPriceChanges(item, dis) : ""}
      ${preset !== "once" && preset !== "budget" ? this._renderContractFields(d, dis) : ""}
      <details ${item.amount_variance_pct || item.date_tolerance_days || item.certainty || item.weekend_shift ? "open" : ""}>
        <summary>${tr("Schwankung und Sicherheit", "Variation and certainty")}</summary>
        <div class="grid">
          <label>${tr("Betrag schwankt um ± %", "Amount varies by ± %")}<input name="amount_variance_pct" type="number" min="0" max="100" step="1" value="${item.amount_variance_pct || 0}" ${dis}></label>
          <label>${tr("Datum schwankt um ± Tage", "Date varies by ± days")}<input name="date_tolerance_days" type="number" min="0" max="60" value="${item.date_tolerance_days || 0}" ${dis}></label>
          <label>${tr("Sicherheit", "Certainty")}<select name="certainty" ${dis}>
            <option value="">${tr("automatisch", "automatic")}</option>
            ${Object.keys(CERTAINTY).map((c) => `<option value="${c}" ${item.certainty === c ? "selected" : ""}>${tr("immer", "always")} ${certaintyLabel(c)}</option>`).join("")}
          </select></label>
          <label>${tr("Wochenende/Feiertag", "Weekend/holiday")}<select name="weekend_shift" ${dis}>
            <option value="">${tr("automatisch (nächster Bankarbeitstag)", "automatic (next banking day)")}</option>
            <option value="next" ${item.weekend_shift === "next" ? "selected" : ""}>${tr("nächster Bankarbeitstag", "next banking day")}</option>
            <option value="previous" ${item.weekend_shift === "previous" ? "selected" : ""}>${tr("vorheriger Bankarbeitstag", "previous banking day")}</option>
            <option value="none" ${item.weekend_shift === "none" ? "selected" : ""}>${tr("nicht verschieben", "don't move")}</option>
          </select></label>
        </div>
      </details>
      <div class="grid">
        ${this._state.households.length ? `<label class="full">${tr("Sichtbar für", "Visible to")}<select name="household_id" ${dis}>
          <option value="">${tr("nur mich", "only me")}</option>
          ${this._state.households.map((h) => `<option value="${esc(h.id)}" ${item.household_id === h.id ? "selected" : ""}>${tr("Haushalt", "Household")} ${esc(h.name)}</option>`).join("")}
        </select></label>` : ""}
        <label class="full">${tr("Notiz", "Note")}<textarea name="note" rows="2" maxlength="1000" ${dis}>${esc(item.note || "")}</textarea></label>
      </div>
      ${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}
      <div class="dialog-actions">
        ${item.id && item.editable ? `<button type="button" class="danger" data-action="delete-item">${tr("Löschen", "Delete")}</button>` : "<span></span>"}
        <div>
          <button type="button" class="secondary" data-action="close">${readOnly ? tr("Schließen", "Close") : tr("Abbrechen", "Cancel")}</button>
          ${readOnly ? "" : `<button type="submit">${tr("Speichern", "Save")}</button>`}
        </div>
      </div>
    </form>`;
  }

  _renderPriceChanges(item, dis) {
    const changes = item.price_changes || [];
    return `<details ${changes.length ? "open" : ""}>
      <summary>${tr("Preisänderungen", "Price changes")}${changes.length ? ` (${changes.length})` : ""}</summary>
      <p class="hint">${tr("Wird es teurer oder günstiger, trag hier ein, ab wann der neue Betrag gilt. Frühere Buchungen behalten ihren alten Betrag.", "If the price goes up or down, enter when the new amount applies. Earlier bookings keep their old amount.")}</p>
      ${changes
        .map(
          (c, idx) => `<div class="price-row">
            <label>${tr("ab", "from")}<input name="pc_from" type="date" required value="${esc(c.from || "")}" ${dis}></label>
            <label>${tr("neuer Betrag", "new amount")}<input name="pc_amount" ${this._amountAttrs()} required value="${this._amountValue(c.amount)}" ${dis}></label>
            ${dis ? "" : `<button type="button" class="danger small" data-action="price-remove" data-index="${idx}" aria-label="${tr("Preisänderung entfernen", "Remove price change")}">✕</button>`}
          </div>`
        )
        .join("")}
      ${dis ? "" : `<button type="button" class="secondary small" data-action="price-add">+ ${tr("Preisänderung", "Price change")}</button>`}
    </details>`;
  }

  _renderContractFields(d, dis) {
    const item = d.item;
    const c = item.contract || {};
    const hasContract = d.hasContract ?? Boolean(c.end);
    const info = item.contract_info;
    return `<details ${hasContract ? "open" : ""}>
      <summary>${tr("Vertrag und Kündigung", "Contract and cancellation")}${info && !info.ended ? ` · ${tr("kündbar bis", "cancel by")} ${shortDate(info.cancel_by)}` : ""}</summary>
      <label class="check"><input type="checkbox" name="has_contract" data-change="has_contract" ${hasContract ? "checked" : ""} ${dis}> ${tr("Vertragslaufzeit erfassen", "Track contract term")}</label>
      ${hasContract ? `<div class="grid">
        <label>${tr("Vertrag läuft bis", "Contract runs until")}<input name="contract_end" type="date" required value="${esc(c.end || "")}" ${dis}></label>
        <label>${tr("Kündigungsfrist", "Notice period")}<span class="inline-fields"><input name="notice" type="number" min="0" max="365" value="${c.notice ?? 1}" ${dis}><select name="notice_unit" ${dis}>
          ${Object.entries(NOTICE_UNITS).map(([k, v]) => `<option value="${k}" ${(c.notice_unit || "months") === k ? "selected" : ""}>${tr(v[0], v[1])}</option>`).join("")}
        </select></span></label>
        <label>${tr("Verlängert sich danach um", "Then renews for")}<span class="inline-fields"><input name="renew" type="number" min="0" max="365" value="${c.renew ?? c.renew_months ?? 12}" ${dis}><select name="renew_unit" ${dis}>
          ${Object.entries(NOTICE_UNITS).map(([k, v]) => `<option value="${k}" ${(c.renew_unit || "months") === k ? "selected" : ""}>${tr(v[0], v[1])}</option>`).join("")}
        </select></span></label>
        <p class="hint full">${tr("0 heißt: Der Vertrag endet und verlängert sich nicht.", "0 means: the contract ends and does not renew.")} ${info ? (info.ended ? tr(`Der Vertrag ist am ${shortDate(info.end)} ausgelaufen.`, `The contract ended on ${shortDate(info.end)}.`) : tr(`Nächstes Vertragsende ${shortDate(info.end)}, kündigen spätestens am <b>${shortDate(info.cancel_by)}</b>.`, `Next contract end ${shortDate(info.end)}, cancel by <b>${shortDate(info.cancel_by)}</b> at the latest.`)) : ""}</p>
      </div>` : ""}
    </details>`;
  }

  _renderImportForm(d) {
    const own = this._state.items.filter((i) => i.owner === this._state.user.id).length;
    return `<form data-form="import">
      <h2>${tr("Posten importieren", "Import entries")}</h2>
      <p>${tr(`Die Datei „${esc(d.fileName)}“ enthält <b>${d.data.items.length} Posten</b>`, `The file “${esc(d.fileName)}” contains <b>${d.data.items.length} entries</b>`)}${d.data.exported_at ? `, ${tr("exportiert am", "exported on")} ${fmtDate(d.data.exported_at.slice(0, 10))}` : ""}.</p>
      <label class="check option"><input type="radio" name="mode" value="add" checked> ${tr("Hinzufügen: Posten, die es schon gibt (gleicher Name, Betrag und Startdatum), werden übersprungen.", "Add: entries that already exist (same name, amount and start date) are skipped.")}</label>
      <label class="check option"><input type="radio" name="mode" value="replace"> ${tr(`Ersetzen: deine ${own} eigenen Posten werden vorher gelöscht, auch der Kontostand wird übernommen.`, `Replace: your ${own} own entries are deleted first, and the balance is taken over too.`)}</label>
      <p class="hint">${tr("Importierte Posten sind zunächst privat. Bestätigte Buchungen und festgelegte Termine werden mit übernommen.", "Imported entries start out private. Confirmed bookings and fixed dates are carried over.")}</p>
      <div class="dialog-actions"><span></span><div>
        <button type="button" class="secondary" data-action="close">${tr("Abbrechen", "Cancel")}</button>
        <button type="submit">${tr("Importieren", "Import")}</button>
      </div></div>
    </form>`;
  }

  _renderCsvForm(d) {
    const check = (s, change = "csv-check") => `<input type="checkbox" data-change="${change}" data-key="${esc(s.key)}" ${s.checked ? "checked" : ""}>`;
    const nameField = (s) => `<input class="csv-name" type="text" data-change="csv-name" data-key="${esc(s.key)}" value="${esc(s.name)}" aria-label="${tr("Name", "Name")}">`;
    const amount = (value, direction) => `<div class="entry-amount ${direction === "expense" ? "neg" : "pos"}">${this._money(direction === "expense" ? -value : value, true)}</div>`;
    const count = (n, one, many) => (n === 1 ? one : many.replace("#", n));

    const matchRow = (m) => {
      const budget = Boolean(m.spendings);
      const list = [...(m.bookings || [])].sort((x, y) => y.date.localeCompare(x.date));
      const last = list[0];
      const here = budget ? m.spendings.filter((p) => p.target === (m.rest ? "skip" : m.item.id)) : [];
      const elsewhere = budget ? m.spendings.length - here.length : 0;
      const meta = m.rest
        ? tr(`${count(m.spendings.length, "1 Zahlung", "# Zahlungen")} · ${m.spendings.length - elsewhere} nicht eingetragen`, `${count(m.spendings.length, "1 payment", "# payments")} · ${m.spendings.length - elsewhere} not added`)
        : budget
        ? tr(`${count(here.length, "1 Zahlung", "# Zahlungen")} hier eintragen${elsewhere ? ` · ${elsewhere} anders zugeordnet` : ""}`, `add ${count(here.length, "1 payment", "# payments")} here${elsewhere ? ` · ${elsewhere} assigned elsewhere` : ""}`)
        : m.confirmations.length
          ? tr(`${count(m.confirmations.length, "1 Termin", "# Termine")} abhaken`, `confirm ${count(m.confirmations.length, "1 date", "# dates")}`)
          : tr("nichts Offenes abzuhaken, nur die Zuordnung wird gemerkt", "nothing open to confirm, only the assignment is remembered");
      const learn = m.remembered || (budget && !m.bankKeys.length) ? "" : `<span class="chip shared">${tr("neu erkannt, wird gemerkt", "newly recognised, will be remembered")}</span>`;
      const price = m.priceChange
        ? `<label class="check csv-price">${check({ key: m.key, checked: m.priceChange.checked }, "csv-price")} ${tr(`Neuer Preis ab ${shortDate(m.priceChange.from)}: ${this._moneyPlain(m.priceChange.amount)} statt ${this._moneyPlain(m.priceChange.before)}`, `New price from ${shortDate(m.priceChange.from)}: ${this._moneyPlain(m.priceChange.amount)} instead of ${this._moneyPlain(m.priceChange.before)}`)}</label>`
        : "";
      const itemAmount = Number(m.item.current_amount ?? m.item.amount) || 0;
      const yours = m.rest
        ? tr("Passen zu keinem Budget und zählen nur in der Statistik. Du kannst sie unten einem Budget oder einem einmaligen Posten zuordnen.", "Fit no budget and only count in the statistics. Below you can assign them to a budget or a one-off entry.")
        : budget
        ? tr(`Dein Budget: ${this._moneyPlain(itemAmount)} pro Monat`, `Your budget: ${this._moneyPlain(itemAmount)} per month`)
        : tr(`Dein Posten: ${this._moneyPlain(itemAmount)} · ${esc(scheduleLabel(m.item))}`, `Your entry: ${this._moneyPlain(itemAmount)} · ${esc(scheduleLabel(m.item))}`);
      const bank = last
        ? tr(`Bank: „${esc(tidyName(last.name))}“ · ${count(list.length, "1 Buchung", "# Buchungen")} · zuletzt ${shortDate(last.date)} ${this._moneyPlain(Math.abs(last.amount))}`, `Bank: “${esc(tidyName(last.name))}” · ${count(list.length, "1 booking", "# bookings")} · last ${shortDate(last.date)} ${this._moneyPlain(Math.abs(last.amount))}`)
        : "";
      const confirmedOn = new Map((m.confirmations || []).map((c) => [`${c.actual_date}|${c.actual_amount}`, c.due_date]));
      const budgetOptions = d.items.filter((i) => i.schedule?.frequency === "budget");
      const spendLine = (p, index) => `<li><div class="csv-detail-head"><span>${shortDate(p.date)}</span><b>${this._moneyPlain(-p.amount)}</b>
          <select class="csv-spend" data-change="csv-spend" data-key="${esc(m.key)}" data-index="${index}" aria-label="${tr("Zuordnen", "Assign")}">
            ${budgetOptions.map((i) => `<option value="${esc(i.id)}" ${p.target === i.id ? "selected" : ""}>${tr("Budget", "Budget")} ${esc(i.name)}</option>`).join("")}
            <option value="once" ${p.target === "once" ? "selected" : ""}>${tr("einmaliger Posten", "one-off entry")}</option>
            <option value="skip" ${p.target === "skip" ? "selected" : ""}>${tr("nicht eintragen", "don't add")}</option>
          </select></div>
          <div class="csv-detail-text">${esc(p.note)}${m.bookings[index]?.purpose ? ` · ${esc(m.bookings[index].purpose.slice(0, 80))}` : ""}</div></li>`;
      const line = (b) => {
        const due = confirmedOn.get(`${b.date}|${Math.abs(b.amount)}`);
        const what = budget
          ? ""
          : due
            ? tr(`hakt Termin ${shortDate(due)} ab`, `confirms ${shortDate(due)}`)
            : b.date < m.item.start_date
              ? tr("vor Beginn deines Postens", "before your entry starts")
              : tr("schon abgehakt", "already confirmed");
        return `<li><div class="csv-detail-head"><span>${shortDate(b.date)}</span><b>${this._moneyPlain(b.amount)}</b>${what ? `<span class="what">${what}</span>` : ""}</div>
          <div class="csv-detail-text">${esc(tidyName(b.name))}${b.purpose ? ` · ${esc(b.purpose.slice(0, 80))}` : ""}</div></li>`;
      };
      const shown = list.slice(0, 6);
      const details = budget
        ? `<details class="csv-detail" data-key="${esc(m.key)}" ${m.open ? "open" : ""}><summary>${tr("Zahlungen ansehen und zuordnen", "Show and assign payments")}</summary><ul>${m.spendings.map(spendLine).join("")}</ul></details>`
        : list.length
        ? `<details class="csv-detail"><summary>${tr("Buchungen ansehen", "Show bookings")}</summary><ul>${shown.map(line).join("")}</ul>${list.length > shown.length ? `<div class="csv-detail-more">${tr(`und ${list.length - shown.length} ältere`, `and ${list.length - shown.length} older`)}</div>` : ""}</details>`
        : "";
      return `<div class="csv-row-wrap"><label class="csv-row">
          ${check(m)}
          <div class="entry-icon">${this._icon(m.item.icon)}</div>
          <div class="entry-main">
            <div class="entry-name">${esc(m.item.name)}</div>
            <div class="entry-meta plain">${yours}</div>
            ${bank && !budget ? `<div class="entry-meta plain">${bank}</div>` : ""}
            <div class="entry-meta">${meta} ${learn}</div>
          </div>
          ${budget && !m.rest ? amount(here.reduce((a, x) => a + x.amount, 0), "expense") : ""}
        </label>${price}${details}</div>`;
    };

    const own = (direction) => d.items.filter((i) => i.direction === direction && i.schedule?.frequency !== "budget");
    const newRow = (s) => {
      const meta = s.kind === "settlement"
        ? tr(`jedes Jahr um den ${fmtDate(s.last, { day: "2-digit", month: "2-digit" })} · gesehen ${s.years.join(", ")}${s.mixed ? " · mal Nachzahlung, mal Erstattung" : ""}`, `every year around ${fmtDate(s.last, { day: "2-digit", month: "2-digit" })} · seen ${s.years.join(", ")}${s.mixed ? " · sometimes back payment, sometimes refund" : ""}`)
        : s.kind === "rare"
        ? tr(`einmal gesehen am ${shortDate(s.last)} · jährlich? nächste etwa ${shortDate(s.next)}`, `seen once on ${shortDate(s.last)} · yearly? next around ${shortDate(s.next)}`)
        : s.kind === "rolling"
          ? tr(`gleitend, etwa alle ${s.learnedDays} Tage · ${s.count}× gebucht`, `rolling, about every ${s.learnedDays} days · booked ${s.count}×`)
          : `${esc(scheduleLabel(s))} · ${tr("nächste am", "next on")} ${shortDate(s.next)} · ${s.count}× ${s.debit ? tr("Lastschrift", "direct debit") : tr("gebucht", "booked")}${s.variance ? tr(` · schwankt bis ${s.variance} %`, ` · varies up to ${s.variance} %`) : ""}`;
      const step = s.priceStep ? `<span class="chip contract">${tr(`seit ${shortDate(s.priceStep.since)} ${this._moneyPlain(s.amount)} statt ${this._moneyPlain(s.priceStep.before)}`, `since ${shortDate(s.priceStep.since)} ${this._moneyPlain(s.amount)} instead of ${this._moneyPlain(s.priceStep.before)}`)}</span>` : "";
      const targets = own(s.direction);
      const target = targets.length
        ? `<select class="csv-target" data-change="csv-target" data-key="${esc(s.key)}" aria-label="${tr("Zuordnen", "Assign")}">
            <option value="new" ${s.target === "new" ? "selected" : ""}>${tr("als neuer Posten", "as a new entry")}</option>
            ${targets.map((i) => `<option value="${esc(i.id)}" ${s.target === i.id ? "selected" : ""}>${tr("gehört zu", "belongs to")}: ${esc(i.name)}</option>`).join("")}
          </select>`
        : "";
      return `<div class="csv-row-wrap"><label class="csv-row">
          ${check(s)}
          <div class="entry-icon">${this._icon(s.icon)}</div>
          <div class="entry-main">
            ${s.target === "new" ? nameField(s) : `<div class="entry-name">${esc(s.name)}</div>`}
            <div class="entry-meta">${meta} ${s.target === "new" ? this._chip(s.certainty) : ""} ${step}</div>
          </div>
          ${amount(s.amount, s.direction)}
        </label>${target}</div>`;
    };

    const budgetRow = (b) => `<div class="csv-row-wrap"><label class="csv-row">
        ${check(b)}
        <div class="entry-icon">${this._icon(b.icon)}</div>
        <div class="entry-main">
          ${nameField(b)}
          <div class="entry-meta">${tr(`Budget pro Monat · Durchschnitt aus ${b.count} Kartenzahlungen`, `monthly budget · average of ${b.count} card payments`)}</div>
        </div>
        ${amount(b.amount, "expense")}
      </label></div>`;

    const section = (title, hint, rows) => (rows ? `<h3 class="csv-sub">${title}</h3>${hint ? `<p class="hint">${hint}</p>` : ""}<div class="csv-list">${rows}</div>` : "");
    const picked = this._csvCounts(d);
    const nothing = !d.matches.length && !d.suggestions.length && !d.others.length && !d.budgets.length;
    return `<form data-form="csv">
      <h2>${tr("Umsätze abgleichen", "Compare transactions")}</h2>
      <p>${tr(`„${esc(d.fileName)}“: ${d.count} Umsätze vom ${shortDate(d.from)} bis ${shortDate(d.to)}`, `“${esc(d.fileName)}”: ${d.count} transactions from ${shortDate(d.from)} to ${shortDate(d.to)}`)}${d.accounts > 1 ? tr(` auf ${d.accounts} Konten`, ` in ${d.accounts} accounts`) : ""}.
        ${d.transfers ? tr(`${d.transfers} Umbuchungen zwischen deinen Konten zählen nicht mit.`, `${d.transfers} transfers between your accounts are left out.`) : ""}
        ${d.reread?.remap.length ? `<button type="button" class="link" data-action="csv-remap">${tr("Stimmt etwas nicht? Spalten selbst zuordnen", "Something wrong? Assign the columns yourself")}</button>` : ""}
        ${daysBetween(d.from, d.to) > 760 ? tr("Vorschläge kommen aus den letzten zwei Jahren, die ältere Historie hilft nur bei Jährlichem.", "Suggestions come from the last two years; older history only helps with yearly payments.") : ""}</p>
      <label class="check csv-ledger"><input type="checkbox" data-change="csv-ledger" ${d.saveLedger ? "checked" : ""}> ${tr(`Alle ${d.count} Umsätze für die Statistik speichern (nur in deinem Home Assistant, schon vorhandene werden übersprungen)`, `Save all ${d.count} transactions for statistics (only in your Home Assistant; existing ones are skipped)`)}</label>
      ${nothing ? `<p class="hint">${tr("Nichts Neues gefunden. Für gute Vorschläge sollte die Datei mindestens 6 bis 12 Monate abdecken.", "Nothing new found. For good suggestions the file should cover at least 6 to 12 months.")}</p>` : ""}
      ${section(tr("Passt zu deinen Posten", "Matches your entries"), tr("Gekommene Buchungen werden mit echtem Datum und Betrag abgehakt, Kartenzahlungen landen im passenden Budget.", "Bookings that arrived are confirmed with their real date and amount; card payments go into the matching budget."), d.matches.filter((m) => !m.rest).map(matchRow).join(""))}
      ${section(tr("Ohne Budget", "Without a budget"), "", d.matches.filter((m) => m.rest).map(matchRow).join(""))}
      ${section(tr("Neue regelmäßige Buchungen", "New regular payments"), "", d.suggestions.map(newRow).join(""))}
      ${section(tr("Selten oder unregelmäßig", "Rare or irregular"), tr("Nur einmal gesehen oder ohne festen Abstand. Gleitende Posten lernen den Abstand weiter, sobald du Termine bestätigst.", "Seen only once or without a fixed gap. Rolling entries keep learning the gap as you confirm dates."), d.others.map(newRow).join(""))}
      ${section(tr("Als Budget anlegen?", "Create as a budget?"), tr("Viele unregelmäßige Ausgaben derselben Kategorie. Die Kartenzahlungen dieses Monats werden gleich eingetragen.", "Many irregular expenses of the same category. This month's card payments are added right away."), d.budgets.map(budgetRow).join(""))}
      <p class="hint">${tr("Die Datei wird nur hier im Browser gelesen. Gespeichert wird nur, was angehakt ist. Das Haushaltsbuch merkt sich, welche Lastschrift zu welchem Posten gehört, und ordnet sie beim nächsten Import von selbst zu. Vorher wird automatisch eine Sicherung angelegt.", "The file is only read here in the browser. Only what is ticked is saved. The Household Budget remembers which direct debit belongs to which entry and assigns it by itself next time.")}</p>
      <div class="dialog-actions"><span></span><div>
        <button type="button" class="secondary" data-action="close">${tr("Abbrechen", "Cancel")}</button>
        <button type="submit" class="csv-submit" ${picked || d.saveLedger ? "" : "disabled"}>${this._csvSubmitLabel(picked, d.saveLedger)}</button>
      </div></div>
    </form>`;
  }

  _csvAll(d) {
    return [...d.matches, ...d.suggestions, ...d.others, ...d.budgets];
  }

  _csvCounts(d) {
    return this._csvAll(d).filter((s) => s.checked && !(s.rest && s.spendings.every((p) => p.target === "skip"))).length;
  }

  _csvSubmitLabel(n, ledger = false) {
    if (!n && ledger) return tr("Umsätze speichern", "Save transactions");
    return n === 1 ? tr("1 Vorschlag übernehmen", "Apply 1 suggestion") : tr(`${n} Vorschläge übernehmen`, `Apply ${n} suggestions`);
  }

  /** Save what is ticked: new entries first, then one sync with confirmations, spendings, keys and prices. */
  async _csvApply(d) {
    const monthStart = iso(new Date(today().getFullYear(), today().getMonth(), 1));
    const note = tr(`Aus Bank-CSV übernommen (${d.fileName})`, `Taken from bank CSV (${d.fileName})`);
    const fresh = [...d.suggestions, ...d.others].filter((s) => s.checked && s.target === "new");
    const budgets = d.budgets.filter((b) => b.checked);
    const items = [
      ...fresh.map((s) => ({
        name: s.name,
        direction: s.direction,
        amount: s.amount,
        amount_variance_pct: s.variance,
        date_tolerance_days: s.tolerance || 0,
        category: s.category,
        icon: s.icon,
        start_date: s.due,
        schedule: s.schedule,
        weekend_shift: s.category === "Gehalt" ? "previous" : null,
        note,
        bank_keys: [s.bankKey],
        confirmations: [{ due_date: s.due, status: "booked", actual_date: s.last, actual_amount: s.amount }],
      })),
      // Single card payments taken out of a budget as a one-off entry (e.g. car service).
      ...d.matches.filter((m) => m.checked && m.spendings).flatMap((m) => m.spendings.filter((p) => p.target === "once")).map((p) => ({
        name: p.note,
        direction: "expense",
        amount: p.amount,
        category: p.category,
        icon: "mdi:receipt-text",
        start_date: p.date,
        schedule: { frequency: "once", interval: 1 },
        note,
        confirmations: [{ due_date: p.date, status: "booked", actual_date: p.date, actual_amount: p.amount }],
      })),
      ...budgets.map((b) => ({ name: b.name, direction: "expense", amount: b.amount, category: b.category, icon: b.icon, start_date: monthStart, schedule: { frequency: "budget", interval: 1 }, note, bank_keys: [b.bankKey] })),
    ];
    // Safety net: everything can be put back under Household → Backups.
    await this._ws("backup/create", { reason: "csv_import" });
    const result = { added: 0, confirmed: 0, spendings: 0, price_changes: 0, ledger: 0 };
    if (d.saveLedger) {
      const rows = d.bookings.map((b) => ({ date: b.date, amount: b.amount, name: tidyName(b.name), main_category: b.main, category: b.category, account: b.account, purpose: b.purpose }));
      for (let i = 0; i < rows.length; i += 2000) result.ledger += (await this._ws("ledger/add", { rows: rows.slice(i, i + 2000) })).added;
    }
    if (items.length) result.added = (await this._ws("import", { data: { format: "haushaltsbuch", items }, replace: false })).added;

    const sync = { confirmations: [], spendings: [], keys: [], price_changes: [] };
    for (const m of d.matches.filter((x) => x.checked)) {
      if (m.spendings) {
        for (const p of m.spendings) if (p.target !== "skip" && p.target !== "once") sync.spendings.push({ item_id: p.target, date: p.date, amount: p.amount, note: p.note });
        for (const key of m.bankKeys) sync.keys.push({ item_id: m.item.id, key });
        continue;
      }
      sync.confirmations.push(...m.confirmations);
      if (!m.remembered) sync.keys.push({ item_id: m.item.id, key: m.bankKey });
    }
    for (const m of d.matches) if (m.priceChange?.checked) sync.price_changes.push({ item_id: m.item.id, from: m.priceChange.from, amount: m.priceChange.amount });
    // Assigned to an existing entry: remember the key and confirm its bookings.
    for (const s of [...d.suggestions, ...d.others].filter((x) => x.checked && x.target !== "new")) {
      const item = d.items.find((i) => i.id === s.target);
      sync.keys.push({ item_id: item.id, key: s.bankKey });
      sync.confirmations.push(...matchItem(item, d.bookingsByKey[s.key] || [], d.entries, d.history[item.id]).confirmations);
    }
    if (budgets.length) {
      const state = await this._ws("state");
      for (const b of budgets) {
        const item = state.items.find((i) => i.editable && i.name === b.name && i.schedule?.frequency === "budget");
        if (item) sync.spendings.push(...b.cardPayments.filter((p) => p.date >= item.start_date).map((p) => ({ item_id: item.id, date: p.date, amount: Math.abs(p.amount), note: tidyName(p.name) })));
      }
    }
    if (sync.confirmations.length || sync.spendings.length || sync.keys.length || sync.price_changes.length) {
      Object.assign(result, await this._ws("bank/sync", sync));
    }
    return result;
  }

  _renderNotice(d) {
    return `<div>
      <h2>${esc(d.title)}</h2>
      <p>${esc(d.text)}</p>
      <div class="dialog-actions"><span></span><div><button type="button" data-action="close">OK</button></div></div>
    </div>`;
  }

  async _export() {
    try {
      const data = await this._ws("export");
      const name = `haushaltsbuch-${iso(today())}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const file = new File([blob], name, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name });
          return;
        } catch (err) {
          if (err.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      this._error = this._errorText(err);
      this._render();
    }
  }

  /**
   * Read every file; a file whose columns are unclear opens the column dialog
   * first. `forced` holds profiles chosen in that dialog, by file index.
   */
  async _openBankSources(sources, forced = {}) {
    const profiles = this._state.user.settings?.csv_profiles || {};
    const parsed = [];
    for (const [index, source] of sources.entries()) {
      try {
        parsed.push(parseBankSource(source, profiles, forced[index] || null));
      } catch (err) {
        if (!err.needsMapping) throw err;
        this._openColumnDialog(sources, forced, index, err.info);
        return;
      }
    }
    // Banks without categories: what the user assigned before tells the category.
    const history = await this._ws("bank/history");
    const categoryOfKey = new Map();
    for (const item of this._state.items) for (const k of history[item.id]?.bank_keys || []) if (item.schedule?.frequency !== "budget") categoryOfKey.set(k, item.category);
    for (const p of parsed) {
      if (p.kind === "outbank") continue;
      for (const b of p.bookings) {
        const known = categoryOfKey.get(bankKeyOf(b)) || categoryOfKey.get(`n:${nameKey(b.name)}|${b.amount < 0 ? "expense" : "income"}`);
        if (known && !b.category) b.category = b.main = known;
        // Files without an account of their own count as one account each.
        if (!b.account && sources.length > 1) b.account = sources[parsed.indexOf(p)].name.replace(/\.[a-z]+$/i, "").slice(0, 40);
      }
    }
    const remap = parsed.map((p, i) => (p.kind === "csv" ? i : -1)).filter((i) => i >= 0);
    await this._openCsv(sources.map((x) => x.name), parsed.map((p) => p.bookings), { sources, forced, remap });
  }

  _openColumnDialog(sources, forced, index, info, manual = false) {
    const preview = info.rows.slice(0, 60);
    if (info.headerRow < 0 || !manual && !Object.keys(info.columns).length) info.headerRow = guessHeaderRow(info.rows);
    info.headerRow = Math.max(0, info.headerRow);
    const sample = info.rows.slice(info.headerRow + 1, info.headerRow + 41);
    if (!manual) {
      const dates = sample.map((r) => r[info.columns.date]);
      info.date = info.columns.date !== undefined ? detectDateFormat(dates) : detectDateFormat(sample.flat());
      info.decimal = detectDecimal(sample.flat().filter((v) => MONEY_RE.test(String(v).trim())));
    }
    const s = manual ? { columns: info.columns, suggested: new Set() } : suggestColumns(info.rows, info.headerRow, info.columns, info.date, info.decimal);
    info.columns = s.columns;
    if (!manual && s.suggested.has("date")) info.date = detectDateFormat(sample.map((r) => r[info.columns.date]));
    this._error = null;
    this._dialog = {
      type: "csv-map", sources, forced, index, rows: preview, headerRow: info.headerRow, columns: { ...info.columns },
      date: info.date, decimal: info.decimal, name: sources[index].name, total: info.rows.length, manual, suggested: [...s.suggested],
    };
    this._render();
  }

  _renderColumnForm(d) {
    const header = d.rows[d.headerRow] || [];
    const width = Math.max(...d.rows.slice(d.headerRow, d.headerRow + 6).map((r) => r.length), 1);
    const colName = (i) => `${tr("Spalte", "Column")} ${i + 1}${String(header[i] ?? "").trim() ? `: ${String(header[i]).trim().slice(0, 30)}` : ""}`;
    // [field, label, need, example]; need: "must", "one" (amount or debit/credit), "good" or "".
    const fields = [
      ["date", tr("Datum", "Date"), "must", tr("z. B. 04.11.2026 oder 2026-11-04, meist „Buchungstag“", "e.g. 04.11.2026 or 2026-11-04, often “booking date”")],
      ["amount", tr("Betrag", "Amount"), "one", tr("z. B. -74,00 für eine Abbuchung, 2.700,00 für Gehalt", "e.g. -74.00 for a debit, 2,700.00 for salary")],
      ["debit", tr("Ausgaben (Soll)", "Money out (debit)"), "pair", tr("nur wenn die Bank Ausgaben und Einnahmen in zwei Spalten trennt, z. B. 74,00", "only if the bank splits money out and in into two columns, e.g. 74.00")],
      ["credit", tr("Einnahmen (Haben)", "Money in (credit)"), "pair", tr("die zweite dieser Spalten, z. B. 2.700,00", "the second of these columns, e.g. 2,700.00")],
      ["sign", tr("Soll/Haben-Kennzeichen", "Debit/credit flag"), "", tr("nur bei Beträgen ohne Minus: S oder H, Soll oder Haben", "only for amounts without minus: S or H, debit or credit")],
      ["name", tr("Empfänger", "Payee"), "good", tr("wer das Geld bekommt, z. B. Stadtwerke Musterstadt", "who gets the money, e.g. Stadtwerke Musterstadt")],
      ["payer", tr("Zahler bei Einnahmen", "Payer of incoming money"), "", tr("nur wenn die Bank dafür eine eigene Spalte hat, z. B. dein Arbeitgeber", "only if the bank has a column of its own for it, e.g. your employer")],
      ["purpose", tr("Verwendungszweck", "Purpose"), "good", tr("z. B. Abschlag Strom Vertragskonto 998877", "e.g. electricity instalment contract 998877")],
      ["category", tr("Kategorie", "Category"), "", tr("falls die Bank Kategorien liefert, z. B. Lebensmittel", "if the bank provides categories, e.g. groceries")],
      ["account", tr("Eigenes Konto", "Own account"), "", tr("deine IBAN, wichtig bei mehreren Konten in einer Datei", "your IBAN, matters with several accounts in one file")],
      ["mandate", tr("Mandatsreferenz", "Mandate reference"), "", tr("bei Lastschriften, z. B. SW-998877", "for direct debits, e.g. SW-998877")],
      ["creditor", tr("Gläubiger-ID", "Creditor ID"), "", tr("bei Lastschriften, z. B. DE33ZZZ00000000003", "for direct debits, e.g. DE33ZZZ00000000003")],
    ];
    const needLabel = { must: tr("Pflicht", "required"), one: tr("Pflicht, oder Soll + Haben", "required, or debit + credit"), pair: tr("statt Betrag", "instead of amount"), good: tr("empfohlen", "recommended"), "": tr("optional", "optional") };
    const firstRow = d.rows[d.headerRow + 1] || [];
    const select = ([field, label, need, example]) => {
      const col = d.columns[field];
      const value = col !== undefined && col >= 0 ? String(firstRow[col] ?? "").trim() : "";
      let check = "";
      if (col !== undefined && col >= 0) {
        const f = columnFit(d.rows, d.headerRow, col, field, d.date, d.decimal);
        const good = f.of && f.fit / f.of >= 0.8;
        const what = { date: tr("wie ein Datum", "like a date"), amount: tr("wie ein Betrag", "like an amount"), debit: tr("wie ein Betrag", "like an amount"), credit: tr("wie ein Betrag", "like an amount"), account: tr("wie eine IBAN", "like an IBAN"), counter: tr("wie eine IBAN", "like an IBAN"), creditor: tr("wie eine Gläubiger-ID", "like a creditor ID"), sign: tr("wie S/H", "like S/H") }[field] || tr("wie Text", "like text");
        check = `<span class="csv-check ${good ? "ok" : "warn"}">${good ? "✓" : "⚠"} ${tr(`${f.fit} von ${f.of} Zeilen sehen ${what} aus`, `${f.fit} of ${f.of} rows look ${what}`)}</span>`;
      }
      const hint = (d.suggested || []).includes(field) ? `<span class="csv-need good">${tr("Vorschlag", "suggested")}</span>` : "";
      return `<label class="csv-map-field ${col !== undefined ? "set" : ""}"><span class="csv-map-label">${label} <span class="csv-need ${need || "opt"}">${needLabel[need]}</span>${hint}</span>
        <select data-change="csv-map" data-field="${field}">
          <option value="-1">—</option>
          ${Array.from({ length: width }, (_, i) => `<option value="${i}" ${col === i ? "selected" : ""}>${esc(colName(i))}</option>`).join("")}
        </select>
        <span class="csv-map-example">${esc(example)}</span>
        ${value ? `<span class="csv-map-value">${tr("in deiner Datei", "in your file")}: ${esc(value.slice(0, 60))}</span>` : ""}${check}</label>`;
    };
    const sample = d.rows.slice(d.headerRow + 1, d.headerRow + 6);
    let test = null;
    try {
      const profile = { columns: d.columns, header_row: d.headerRow, date: d.date, decimal: d.decimal };
      test = parseGenericCsv(d.sources[d.index].text, {}, profile).slice(0, 3);
    } catch (err) {
      test = null;
    }
    return `<form data-form="csv-map">
      <h2>${tr("Welche Spalte ist was?", "Which column is what?")}</h2>
      <p class="hint">${d.manual ? tr(`Prüfe für „${esc(d.name)}“, welche Spalte was enthält. Die Zuordnung wird für diese Bank gemerkt.`, `Check which column of “${esc(d.name)}” holds what. The assignment is remembered for this bank.`) : tr(`„${esc(d.name)}“ kenne ich noch nicht sicher. Sag einmal, welche Spalte was enthält. Das wird für diese Bank gemerkt, der nächste Import läuft dann ohne Nachfrage.`, `I don't know “${esc(d.name)}” reliably yet. Tell me once which column holds what. It is remembered for this bank, so the next import runs without asking.`)}</p>
      <label>${tr("Die Überschriften stehen in", "The headings are in")}<select data-change="csv-map" data-field="header_row">
        ${d.rows.slice(0, 30).map((r, i) => `<option value="${i}" ${i === d.headerRow ? "selected" : ""}>${tr("Zeile", "line")} ${i + 1}: ${esc(r.filter((c) => String(c).trim()).slice(0, 4).join(" · ").slice(0, 60))}</option>`).join("")}
      </select></label>
      <div class="csv-map-table"><table><thead>
        <tr>${Array.from({ length: width }, (_, i) => { const f = fields.find(([k]) => d.columns[k] === i); return `<th class="${f ? "on" : ""}">${f ? `<span class="csv-col-tag">${esc(f[1])}</span>` : `<span class="csv-col-tag off">${tr("nicht genutzt", "unused")}</span>`}</th>`; }).join("")}</tr>
        <tr>${Array.from({ length: width }, (_, i) => `<th>${esc(colName(i))}</th>`).join("")}</tr></thead>
        <tbody>${sample.map((r) => `<tr>${Array.from({ length: width }, (_, i) => `<td class="${fields.some(([k]) => d.columns[k] === i) ? "on" : ""}">${esc(String(r[i] ?? "").slice(0, 40))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="grid csv-map-fields">${fields.map(select).join("")}
        <label>${tr("Datumsformat", "Date format")}<select data-change="csv-map" data-field="date_format">
          <option value="dmy" ${d.date === "dmy" ? "selected" : ""}>${tr("Tag.Monat.Jahr", "day.month.year")}</option>
          <option value="mdy" ${d.date === "mdy" ? "selected" : ""}>${tr("Monat/Tag/Jahr", "month/day/year")}</option>
          <option value="ymd" ${d.date === "ymd" ? "selected" : ""}>${tr("Jahr-Monat-Tag", "year-month-day")}</option></select></label>
        <label>${tr("Dezimalzeichen", "Decimal mark")}<select data-change="csv-map" data-field="decimal_mark">
          <option value="," ${d.decimal === "," ? "selected" : ""}>${tr("Komma (1.234,56)", "comma (1.234,56)")}</option>
          <option value="." ${d.decimal === "." ? "selected" : ""}>${tr("Punkt (1,234.56)", "dot (1,234.56)")}</option></select></label>
      </div>
      <h3 class="csv-sub">${tr("So wird es gelesen", "This is how it reads")}</h3>
      ${test && test.length ? `<ul class="csv-map-test">${test.map((b) => `<li><span>${shortDate(b.date)}</span><span>${esc(b.name)}</span><b class="${b.amount < 0 ? "neg" : "pos"}">${this._moneyPlain(b.amount)}</b></li>`).join("")}</ul>`
        : `<p class="hint">${tr("Noch keine Umsätze lesbar. Wähle mindestens Datum und Betrag (oder Soll und Haben).", "No transactions readable yet. Choose at least date and amount (or debit and credit).")}</p>`}
      ${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}
      <div class="dialog-actions"><span></span><div>
        <button type="button" class="secondary" data-action="close">${tr("Abbrechen", "Cancel")}</button>
        <button type="submit" ${test && test.length ? "" : "disabled"}>${tr("Übernehmen und weiter", "Apply and continue")}</button>
      </div></div>
    </form>`;
  }

  async _openCsv(fileNames, bookingLists, reread = null) {
    const fileName = fileNames.join(", ");
    // Several accounts: one CSV each, or one CSV with several accounts.
    const parsed = dropOwnTransfers(bookingLists.flat());
    const bookings = parsed.bookings;
    const items = this._state.items.filter((i) => i.owner === this._state.user.id);
    const from = bookings.reduce((m, b) => (b.date < m ? b.date : m), bookings[0].date);
    const to = bookings.reduce((m, b) => (b.date > m ? b.date : m), bookings[0].date);
    // Open dates of the own entries over the file's period, in steps the server allows.
    const entries = [];
    const since = [parseIso(from), addDays(parseIso(to), -744)].sort((a, b) => b - a)[0];
    for (let start = addDays(since, -14); start <= addDays(parseIso(to), 7); start = addDays(start, 366)) {
      const end = [addDays(start, 365), addDays(parseIso(to), 7)].sort((a, b) => a - b)[0];
      const f = await this._ws("forecast", { scope: "me", start: iso(start), end: iso(end) });
      entries.push(...f.days.flatMap((day) => day.entries));
    }
    const history = await this._ws("bank/history");
    const analysis = analyzeBank(bookings, items, history, entries);
    const bookingsByKey = {};
    for (const b of bookings) {
      (bookingsByKey[bankKeyOf(b)] ||= []).push(b);
    }
    // A look-alike entry is pre-selected as target, so its bookings are confirmed instead of a duplicate.
    for (const s of analysis.suggestions) {
      const twin = s.existing && items.find((i) => i.name === s.existing);
      if (twin) Object.assign(s, { target: twin.id, checked: true });
    }
    this._error = null;
    const accounts = new Set(bookings.map((b) => b.account).filter(Boolean)).size;
    this._dialog = { type: "csv", fileName, items, entries, history, bookingsByKey, accounts, transfers: parsed.transfers, bookings, saveLedger: true, reread, ...analysis };
    this._render();
  }

  async _readImportFile(input) {
    const files = [...(input.files || [])];
    input.value = "";
    const file = files[0];
    if (!file) return;
    try {
      const sources = await readBankSources(files);
      if (files.length > 1 || !/\.json$/i.test(file.name) || !sources[0]?.text.trim().startsWith("{")) {
        await this._openBankSources(sources);
        return;
      }
      const text = sources[0].text;
      const data = JSON.parse(text);
      if (data?.format !== "haushaltsbuch" || !Array.isArray(data.items)) throw new Error(tr("Das ist keine Export-Datei des Haushaltsbuchs.", "This is not a Household Budget export file."));
      this._error = null;
      this._dialog = { type: "import", data, fileName: file.name };
    } catch (err) {
      this._error = err instanceof SyntaxError ? tr("Die Datei ist kein gültiges JSON.", "The file is not valid JSON.") : err.message;
    }
    this._render();
  }

  _renderBalanceForm() {
    const b = this._scopeBalance();
    return `<form data-form="balance">
      <h2>${this._isHousehold() ? tr("Haushaltskonto setzen", "Set household balance") : tr("Kontostand setzen", "Set balance")}</h2>
      <p class="hint">${tr("Trage den Stand aus deiner Banking-App ein. Alle Buchungen bis einschließlich zu diesem Datum gelten als enthalten.", "Enter the balance from your banking app. All bookings up to and including this date count as included.")}</p>
      <div class="grid">
        <label>${tr("Kontostand", "Balance")} (${esc(this._state.currency)})<input name="balance" ${this._amountAttrs(true)} required value="${this._amountValue(b.balance)}"></label>
        <label>${tr("Stand vom", "As of")}<input name="balance_date" type="date" required value="${iso(today())}"></label>
      </div>
      <div class="dialog-actions"><span></span><div>
        <button type="button" class="secondary" data-action="close">${tr("Abbrechen", "Cancel")}</button>
        <button type="submit">${tr("Speichern", "Save")}</button>
      </div></div>
    </form>`;
  }

  _renderConfirmForm(d) {
    const item = this._state.items.find((i) => i.id === d.item_id);
    const rolling = item?.schedule?.frequency === "rolling";
    const future = d.date > iso(today());
    const booked = d.status === "booked";
    const hint = booked
      ? tr("Diese Buchung ist als gebucht bestätigt.", "This booking is confirmed as booked.")
      : future
        ? tr(
            `Geplant für ${fmtDate(d.date)}. Hast du schon einen festen Termin? Dann Datum und Betrag anpassen und als Termin festlegen.${rolling ? " Alle weiteren Termine rücken danach automatisch nach." : " Das verschiebt nur diese eine Buchung."}`,
            `Planned for ${fmtDate(d.date)}. Already have a fixed date? Adjust date and amount and set it as scheduled.${rolling ? " All later dates move along automatically." : " This only moves this one booking."}`
          )
        : tr(`Fällig am ${fmtDate(d.date)}. Ist die Buchung so auf dem Konto angekommen?`, `Due on ${fmtDate(d.date)}. Did the booking reach the account like this?`);
    return `<form data-form="confirm">
      <h2>${esc(item?.name || tr("Buchung", "Booking"))}</h2>
      <p class="hint">${hint}</p>
      <div class="grid">
        <label>${tr("Datum", "Date")}<input name="actual_date" type="date" required value="${esc(d.date)}"></label>
        <label>${tr("Betrag", "Amount")}<input name="actual_amount" ${this._amountAttrs()} value="${this._amountValue(d.amount)}"></label>
      </div>
      <div class="dialog-actions">
        <div>
          ${item ? `<button type="button" class="secondary" data-action="edit-item" data-item="${esc(item.id)}">${tr("Posten öffnen", "Open entry")}</button>` : ""}
          ${d.status ? `<button type="button" class="secondary" data-action="reset-confirm">${tr("Bestätigung zurücksetzen", "Reset confirmation")}</button>` : ""}
          ${d.planned && !booked ? `<button type="button" class="secondary" data-action="plan-clear">${tr("Termin entfernen", "Remove date")}</button>` : ""}
        </div>
        <div>
          ${booked ? "" : `<button type="button" class="${future ? "" : "secondary"}" data-action="plan-save">${d.planned ? tr("Termin ändern", "Change date") : tr("Als Termin festlegen", "Set as scheduled")}</button>`}
          <button type="button" class="secondary" data-action="confirm-skip">${tr("Ausgefallen", "Skipped")}</button>
          <button type="submit" class="${future && !booked ? "secondary" : ""}">${tr("Gebucht", "Booked")}</button>
        </div>
      </div>
    </form>`;
  }

  _renderHouseholdForm(d) {
    const h = d.household || { name: "", members: [this._state.user.id] };
    return `<form data-form="household">
      <h2>${h.id ? tr("Haushalt bearbeiten", "Edit household") : tr("Haushalt anlegen", "Add household")}</h2>
      <div class="grid">
        <label class="full">${tr("Name", "Name")}<input name="name" required maxlength="60" value="${esc(h.name)}" placeholder="${tr("z.B. Familie", "e.g. Family")}"></label>
      </div>
      <div class="members">
        <div class="label">${tr("Mitglieder", "Members")}</div>
        ${this._state.users
          .map(
            (u) => `<label class="check"><input type="checkbox" name="members" value="${esc(u.id)}" ${h.members.includes(u.id) ? "checked" : ""} ${u.id === this._state.user.id ? "disabled checked" : ""}> ${esc(u.name)}</label>`
          )
          .join("")}
      </div>
      <div class="dialog-actions">
        ${h.id ? `<button type="button" class="danger" data-action="delete-household">${tr("Löschen", "Delete")}</button>` : "<span></span>"}
        <div>
          <button type="button" class="secondary" data-action="close">${tr("Abbrechen", "Cancel")}</button>
          <button type="submit">${tr("Speichern", "Save")}</button>
        </div>
      </div>
    </form>`;
  }

  // ---------------------------------------------------------------- events

  _readItemForm(form) {
    const f = new FormData(form);
    const salaryBox = form.querySelector('[name="salary_cycle"]');
    if (salaryBox && !salaryBox.disabled) this._dialog.salaryCycle = salaryBox.checked;
    const preset = FREQUENCY_PRESETS.find((p) => p.key === f.get("preset"));
    const schedule = { frequency: preset.frequency, interval: preset.interval || Number(f.get("interval")) || 1, dates: [] };
    if (preset.key === "monthly_weekday") {
      schedule.weekday = Number(f.get("weekday") ?? 3);
      schedule.week = Number(f.get("week") ?? -1);
    }
    if (preset.key === "rolling") {
      schedule.unit = f.get("unit") || "months";
      schedule.learn = f.get("learn") === "on";
    }
    const froms = f.getAll("pc_from");
    const amounts = f.getAll("pc_amount");
    const price_changes = froms.map((from, i) => ({ from, amount: this._parsedAmount(amounts[i]) }));
    const contract = f.get("has_contract")
      ? { end: f.get("contract_end") || "", notice: Number(f.get("notice") || 0), notice_unit: f.get("notice_unit") || "months", renew: Number(f.get("renew") || 0), renew_unit: f.get("renew_unit") || "months" }
      : null;
    if (preset.key === "fixed_dates") {
      schedule.dates = String(f.get("dates") || "")
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map((part) => {
          const [day, month] = part.split(".").filter(Boolean);
          return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        });
    }
    return {
      ...this._dialog.item,
      name: f.get("name"),
      direction: f.get("direction"),
      amount: this._parsedAmount(f.get("amount")),
      category: f.get("category"),
      icon: f.get("icon"),
      start_date: f.get("start_date"),
      end_date: f.get("has_end") ? f.get("end_date") || null : null,
      schedule,
      amount_variance_pct: Number(f.get("amount_variance_pct") || 0),
      date_tolerance_days: Number(f.get("date_tolerance_days") || 0),
      certainty: f.get("certainty") || null,
      weekend_shift: f.get("weekend_shift") || null,
      household_id: f.get("household_id") || null,
      note: f.get("note"),
      price_changes,
      contract,
    };
  }

  _onSubmit(ev) {
    ev.preventDefault();
    const form = ev.target;
    const kind = form.dataset.form;
    if (kind === "item") {
      const item = this._readItemForm(form);
      const salaryBox = form.querySelector('[name="salary_cycle"]');
      const { editable, owner_name, owner, current_amount, contract_info, learned_days, budget_status, ...payload } = item;
      this._run(async () => {
        const saved = editable === false ? { id: item.id } : await this._ws("item/save", { item: payload });
        const st = this._state.user.settings || {};
        const isSalary = st.salary_item_id && st.salary_item_id === saved.id;
        const wantSalary = salaryBox?.checked && item.direction === "income";
        if (wantSalary && !isSalary) await this._ws("settings", { settings: { special_min_months: 2, special_min_amount: 0, ...st, salary_item_id: saved.id } });
        if (!wantSalary && isSalary) await this._ws("settings", { settings: { special_min_months: 2, special_min_amount: 0, ...st, salary_item_id: null } });
      });
    } else if (kind === "balance") {
      const f = new FormData(form);
      this._run(() => this._ws("balance", { scope: this._scope, balance: this._parsedAmount(f.get("balance"), NaN), balance_date: f.get("balance_date") }));
    } else if (kind === "confirm") {
      const f = new FormData(form);
      const d = this._dialog;
      this._run(() =>
        this._ws("confirm", { item_id: d.item_id, due_date: d.due, status: "booked", actual_date: f.get("actual_date") || null, actual_amount: this._parsedAmount(f.get("actual_amount"), null) })
      );
    } else if (kind === "csv-map") {
      const d = this._dialog;
      const profile = { columns: { ...d.columns }, header_row: d.headerRow, date: d.date, decimal: d.decimal };
      const signature = bankSignature(d.rows, d.headerRow);
      const settings = this._state.user.settings || {};
      if (signature) this._saveSpecialSettings({ csv_profiles: { ...(settings.csv_profiles || {}), [signature]: profile } });
      const forced = { ...d.forced, [d.index]: profile };
      this._openBankSources(d.sources, forced).catch((err) => {
        this._error = this._errorText(err);
        this._render();
      });
    } else if (kind === "assign") {
      const f = new FormData(form);
      const r = this._dialog.row;
      const direction = r[1] < 0 ? "expense" : "income";
      const amount = Math.abs(r[1]);
      const target = f.get("target");
      this._run(async () => {
        if (target === "once") {
          const item = { name: String(f.get("name") || r[2] || tr("Umsatz", "Transaction")).trim(), direction, amount, category: r[4] || r[3] || tr("Sonstiges", "Other"), icon: "mdi:receipt-text", start_date: r[0], schedule: { frequency: "once", interval: 1 }, confirmations: [{ due_date: r[0], status: "booked", actual_date: r[0], actual_amount: amount }] };
          await this._ws("import", { data: { format: "haushaltsbuch", items: [item] }, replace: false });
          return;
        }
        const item = this._state.items.find((i) => i.id === target);
        const sync = { confirmations: [], spendings: [], keys: [], price_changes: [] };
        if (item.schedule?.frequency === "budget") {
          sync.spendings.push({ item_id: item.id, date: r[0], amount, note: r[2] || "" });
        } else {
          const day = parseIso(r[0]);
          const scope = item.editable === false && item.household_id ? item.household_id : "me";
          const around = await this._ws("forecast", { scope, start: iso(addDays(day, -45)), end: iso(addDays(day, 45)) });
          const open = around.days.flatMap((x) => x.entries).filter((e) => e.item_id === item.id && e.status === null)
            .sort((a, b) => Math.abs(daysBetween(a.date, r[0])) - Math.abs(daysBetween(b.date, r[0])))[0];
          if (open) sync.confirmations.push({ item_id: item.id, due_date: open.due_date, actual_date: r[0], actual_amount: amount });
          else if (!(f.get("remember") && item.editable !== false) && !(item.confirmations || []).some((c) => c.actual_date === r[0] && Math.abs((c.actual_amount ?? -1) - amount) < 0.01)) {
            // No open date nearby (e.g. before the entry started, or that month is already
            // booked): keep the payment as a booking on its own date so it counts as assigned.
            if ((item.confirmations || []).some((c) => c.due_date === r[0])) throw new Error(tr(`„${item.name}“ hat am ${shortDate(r[0])} schon eine andere Buchung.`, `“${item.name}” already has another booking on ${shortDate(r[0])}.`));
            sync.confirmations.push({ item_id: item.id, due_date: r[0], actual_date: r[0], actual_amount: amount });
          }
        }
        if (f.get("remember") && item.editable !== false) sync.keys.push({ item_id: item.id, key: `n:${nameKey(r[2] || "")}|${direction}` });
        await this._ws("bank/sync", sync);
      });
    } else if (kind === "csv") {
      const d = this._dialog;
      this._run(async () => {
        const r = await this._csvApply(d);
        const parts = [
          r.added && tr(`${r.added} neue Posten`, `${r.added} new entries`),
          r.confirmed && tr(`${r.confirmed} Buchungen abgehakt`, `${r.confirmed} bookings confirmed`),
          r.spendings && tr(`${r.spendings} Budget-Ausgaben eingetragen`, `${r.spendings} budget expenses added`),
          r.price_changes && tr(`${r.price_changes} Preisänderungen`, `${r.price_changes} price changes`),
          r.ledger && tr(`${r.ledger} Umsätze für die Statistik gespeichert`, `${r.ledger} transactions saved for statistics`),
        ].filter(Boolean);
        setTimeout(() => {
          this._dialog = { type: "notice", title: tr("Abgleich fertig", "Done"), text: parts.length ? `${parts.join(", ")}.` : tr("Es war schon alles da.", "Everything was there already.") };
          this._render();
        });
      });
    } else if (kind === "import") {
      const replace = new FormData(form).get("mode") === "replace";
      if (replace && !confirm(tr("Alle deine eigenen Posten werden durch den Import ersetzt. Fortfahren?", "All your own entries will be replaced by the import. Continue?"))) return;
      const data = this._dialog.data;
      this._run(async () => {
        const r = await this._ws("import", { data, replace });
        setTimeout(() => {
          this._dialog = {
            type: "notice",
            title: tr("Import abgeschlossen", "Import finished"),
            text: tr(`${r.added} Posten importiert${r.skipped ? `, ${r.skipped} schon vorhanden und übersprungen` : ""}.`, `${r.added} entries imported${r.skipped ? `, ${r.skipped} already existed and were skipped` : ""}.`),
          };
          this._render();
        });
      });
    } else if (kind === "spending") {
      const f = new FormData(form);
      const d = this._dialog;
      const values = { date: f.get("date"), amount: this._parsedAmount(f.get("amount")), note: f.get("note") || null };
      const target = f.get("item_id");
      this._run(async () => {
        if (!d.spending) await this._ws("spending/add", { item_id: target, ...values });
        else if (target === d.item_id) await this._ws("spending/update", { item_id: target, spending_id: d.spending.id, ...values });
        else {
          // Moved to another budget: record it there, then remove the old one.
          await this._ws("spending/add", { item_id: target, ...values });
          await this._ws("spending/delete", { item_id: d.item_id, spending_id: d.spending.id });
        }
      });
    } else if (kind === "household") {
      const f = new FormData(form);
      const members = f.getAll("members");
      const h = this._dialog.household;
      if (h?.id) this._run(() => this._ws("household/update", { household_id: h.id, name: f.get("name"), members }));
      else this._run(() => this._ws("household/create", { name: f.get("name"), members }));
    }
  }

  _onChange(ev) {
    const el = ev.target;
    const kind = el.dataset.change;
    if (kind === "scope") {
      this._scope = el.value;
      this._selectedDay = null;
      this._reload();
    } else if (kind === "has_contract") {
      const form = el.closest("form");
      this._dialog.item = this._readItemForm(form);
      this._dialog.hasContract = el.checked;
      this._render();
    } else if (kind === "has_end") {
      const form = el.closest("form");
      this._dialog.item = this._readItemForm(form);
      this._dialog.hasEnd = el.checked;
      this._render();
    } else if (kind === "direction") {
      const form = el.closest("form");
      this._dialog.item = this._readItemForm(form);
      this._render();
    } else if (kind === "preset") {
      const form = el.closest("form");
      this._dialog.item = this._readItemForm(form);
      this._dialog.preset = el.value;
      this._render();
    } else if (kind === "special-months") {
      this._saveSpecialSettings({ special_min_months: Number(el.value) });
    } else if (kind === "special-amount") {
      this._saveSpecialSettings({ special_min_amount: Number(el.value) || 0 });
    } else if (kind === "backup-file") {
      const file = el.files?.[0];
      el.value = "";
      if (!file) return;
      file.text().then((text) => {
        let doc;
        try {
          doc = JSON.parse(text);
        } catch {
          doc = null;
        }
        if (doc?.format !== "haushaltsbuch-backup") {
          this._error = tr("Das ist keine Sicherungsdatei des Haushaltsbuchs. Eine Export-Datei spielst du unter „Posten“ → „Importieren“ ein.", "This is not a Household Budget backup file. Import an export file under “Entries” → “Import”.");
          this._render();
          return;
        }
        if (!confirm(tr(`Alles auf den Stand der Datei vom ${new Date(doc.created).toLocaleString(DATE_LOCALE)} zurücksetzen? Das gilt für alle Nutzer. Der jetzige Stand wird vorher gesichert.`, `Reset everything to the file from ${new Date(doc.created).toLocaleString(DATE_LOCALE)}? This applies to all users. The current state is backed up first.`))) return;
        this._run(async () => this._restoreFinished(await this._ws("backup/restore", { document: doc })));
      });
    } else if (kind === "stats-year") {
      this._statsYear = el.value;
      this._statsOpen = null;
      this._statsPick = null;
      this._render();
    } else if (kind === "stats-account") {
      this._statsAccount = el.value;
      this._render();
    } else if (kind === "import-file") {
      this._readImportFile(el);
    } else if (kind === "csv-map") {
      const d = this._dialog;
      const field = el.dataset.field;
      if (field === "header_row") {
        d.headerRow = Number(el.value);
        const s = suggestColumns(d.rows, d.headerRow, bankColumns(d.rows[d.headerRow] || []), d.date, d.decimal);
        d.columns = s.columns;
        d.suggested = [...s.suggested];
      } else if (field === "date_format") d.date = el.value;
      else if (field === "decimal_mark") d.decimal = el.value;
      else {
        if (Number(el.value) < 0) delete d.columns[field];
        else {
          // One column, one meaning: a column chosen here leaves the field it had.
          for (const [f, i] of Object.entries(d.columns)) if (i === Number(el.value) && f !== field) delete d.columns[f];
          d.columns[field] = Number(el.value);
        }
        d.suggested = (d.suggested || []).filter((f) => f !== field);
        if (field === "date" && d.columns.date !== undefined) d.date = detectDateFormat(d.rows.slice(d.headerRow + 1, d.headerRow + 41).map((r) => r[d.columns.date]));
      }
      const scroll = this.shadowRoot.querySelector(".dialog")?.scrollTop || 0;
      this._render();
      const dialog = this.shadowRoot.querySelector(".dialog");
      if (dialog) dialog.scrollTop = scroll;
    } else if (kind === "csv-spend") {
      const d = this._dialog;
      const m = d.matches.find((x) => x.key === el.dataset.key);
      m.spendings[Number(el.dataset.index)].target = el.value;
      m.checked = true;
      m.open = true;
      const scroll = this.shadowRoot.querySelector(".dialog")?.scrollTop || 0;
      this._render();
      const dialog = this.shadowRoot.querySelector(".dialog");
      if (dialog) dialog.scrollTop = scroll;
    } else if (kind === "csv-check" || kind === "csv-name" || kind === "csv-price" || kind === "csv-target" || kind === "csv-ledger") {
      const d = this._dialog;
      const s = this._csvAll(d).find((x) => x.key === el.dataset.key);
      if (kind === "csv-ledger") d.saveLedger = el.checked;
      else if (kind === "csv-check") s.checked = el.checked;
      else if (kind === "csv-price") s.priceChange.checked = el.checked;
      else if (kind === "csv-name") s.name = el.value.trim() || s.name;
      else {
        s.target = el.value;
        s.checked = true;
        const scroll = this.shadowRoot.querySelector(".dialog")?.scrollTop || 0;
        this._render();
        const dialog = this.shadowRoot.querySelector(".dialog");
        if (dialog) dialog.scrollTop = scroll;
        return;
      }
      const button = this.shadowRoot.querySelector(".csv-submit");
      const n = this._csvCounts(d);
      button.textContent = this._csvSubmitLabel(n, d.saveLedger);
      button.disabled = !n && !d.saveLedger;
    } else if (kind === "entities") {
      this._run(() => this._ws("household/update", { household_id: el.dataset.id, entities: el.checked }));
    }
  }

  async _suggest(input) {
    const box = input.closest(".suggest-field")?.querySelector(".suggest");
    if (!box) return;
    const query = input.value;
    let matches;
    if (input.name === "icon") {
      // Emoji or other non-MDI text: no suggestions.
      if (!/^[a-z0-9:\- ]+$/i.test(query.trim())) {
        box.hidden = true;
        return;
      }
      const list = await loadIconList();
      if (input.value !== query || this.shadowRoot.activeElement !== input) return;
      matches = searchIcons(list, query).map((icon) => [icon, icon, icon.slice(4)]);
    } else {
      const q = query.trim().toLowerCase();
      const iconOf = {};
      for (const item of this._state?.items || []) {
        if (item.category && item.icon && !iconOf[item.category]) iconOf[item.category] = item.icon;
      }
      matches = ((LANG === "de" ? this._state?.categories : this._state?.categories_en) || this._state?.categories || [])
        .filter((c) => c.toLowerCase().includes(q))
        .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)) || a.localeCompare(b, LANG))
        .map((c) => [c, iconOf[c] || "mdi:tag-outline", c]);
    }
    if (!matches.length || (matches.length === 1 && matches[0][0] === query.trim())) {
      box.hidden = true;
      return;
    }
    box.innerHTML = matches
      .map(([value, icon, label]) => `<button type="button" data-action="pick-suggest" data-value="${esc(value)}" title="${esc(value)}">${this._icon(icon, 22)}<span>${esc(label)}</span></button>`)
      .join("");
    box.hidden = false;
  }

  _pickSuggestion(input, value) {
    input.value = value;
    const field = input.closest(".suggest-field");
    const preview = field?.querySelector(".icon-preview");
    if (preview) preview.innerHTML = this._icon(value, 20);
    const box = field?.querySelector(".suggest");
    if (box) box.hidden = true;
  }

  _toggleIncognito() {
    this._incognito = !this._incognito;
    try {
      localStorage.setItem(INCOGNITO_KEY, this._incognito ? "1" : "0");
    } catch (err) {
      // Storage blocked: the mode still works until the page is reloaded.
    }
    this._render();
  }

  _onClick(ev) {
    const help = ev.target.closest?.(".help");
    if (help) {
      // The ⓘ only explains; a tap shows (or hides) its text, nothing else opens.
      ev.stopPropagation();
      // A tap also fires mouseover first, which already opened the text.
      if (this._helpFor === help && Date.now() - this._helpShownAt > 500) this._hideHelp();
      else if (this._helpFor !== help) this._showHelp(help);
      if (this._helpFor) this._helpByHover = false;
      return;
    }
    this._hideHelp();
    const target = ev.target.closest("[data-action]");
    if (!target) return;
    const a = target.dataset.action;
    if (a === "pick-suggest") {
      ev.preventDefault();
      const input = target.closest(".suggest-field")?.querySelector("input");
      if (input) this._pickSuggestion(input, target.dataset.value);
      return;
    }
    if (a === "incognito") {
      ev.preventDefault();
      this._toggleIncognito();
      return;
    }
    if (a === "close-overlay") {
      if (ev.target === target) {
        this._dialog = null;
        this._error = null;
        this._render();
      }
      return;
    }
    ev.stopPropagation();
    switch (a) {
      case "backup-create":
        this._run(() => this._ws("backup/create", { reason: "manual" }));
        break;
      case "backup-download":
        this._ws("backup/get", { backup_id: target.dataset.id })
          .then((doc) => this._downloadJson(`haushaltsbuch-sicherung-${target.dataset.id}`, doc))
          .catch((err) => {
            this._error = this._errorText(err);
            this._render();
          });
        break;
      case "backup-restore":
        if (confirm(tr(`Alles auf den Stand vom ${target.dataset.created} zurücksetzen? Das gilt für alle Nutzer. Der jetzige Stand wird vorher gesichert.`, `Reset everything to ${target.dataset.created}? This applies to all users. The current state is backed up first.`))) {
          this._run(async () => this._restoreFinished(await this._ws("backup/restore", { backup_id: target.dataset.id })));
        }
        break;
      case "backup-upload":
        this.shadowRoot.querySelector('input[data-change="backup-file"]').click();
        break;
      case "stats-year":
        this._statsYear = target.dataset.year;
        this._render();
        break;
      case "stats-tab":
        this._statsTab = target.dataset.tab;
        this._render();
        break;
      case "csv-remap": {
        const { sources, forced, remap } = this._dialog.reread;
        const index = remap[0];
        const info = guessBankLayout(sources[index].text);
        const profile = forced[index] || (this._state.user.settings?.csv_profiles || {})[bankSignature(info.rows, info.headerRow)];
        if (profile) Object.assign(info, { headerRow: profile.header_row, columns: { ...profile.columns }, date: profile.date || info.date, decimal: profile.decimal || info.decimal });
        info.headerRow = Math.max(0, info.headerRow);
        this._openColumnDialog(sources, forced, index, info, true);
        break;
      }
      case "stats-period": {
        const p = target.dataset.period;
        const rows = this._ledger?.rows || [];
        const latest = rows.length ? rows[rows.length - 1][0] : iso(new Date());
        const curYear = this._statsYear && this._statsYear !== "all" ? this._statsYear : latest.slice(0, 4);
        if (p === "all") {
          this._statsYear = "all";
          this._statsMonth = null;
        } else if (p === "year") {
          this._statsYear = this._statsMonth ? this._statsMonth.slice(0, 4) : curYear;
          this._statsMonth = null;
        } else if (!this._statsMonth) {
          const inYear = rows.filter((r) => r[0].startsWith(curYear));
          this._statsYear = curYear;
          this._statsMonth = (inYear.length ? inYear[inYear.length - 1][0] : latest).slice(0, 7);
        }
        this._statsOpen = null;
        this._statsPick = null;
        this._render();
        break;
      }
      case "stats-step": {
        const to = target.dataset.to;
        this._statsYear = to.slice(0, 4);
        this._statsMonth = to.includes("-") ? to : null;
        this._statsOpen = null;
        this._statsPick = null;
        this._render();
        break;
      }
      case "budget-hit-remove": {
        const st = this._state.user.settings || {};
        this._openHits = target.dataset.budget;
        this._saveSpecialSettings({ stats_ignored: [...(st.stats_ignored || []), target.dataset.key] });
        break;
      }
      case "budget-hit-restore": {
        const st = this._state.user.settings || {};
        this._openHits = target.dataset.budget;
        this._saveSpecialSettings({ stats_ignored: (st.stats_ignored || []).filter((k) => !k.startsWith(`x:${target.dataset.budget}|`)) });
        break;
      }
      case "insight-show-ignored":
        this._showIgnored = !this._showIgnored;
        this._render();
        break;
      case "insight-unignore": {
        const st = this._state.user.settings || {};
        this._saveSpecialSettings({ stats_ignored: (st.stats_ignored || []).filter((k) => k !== target.dataset.key) });
        break;
      }
      case "insight-ignore": {
        const st = this._state.user.settings || {};
        this._saveSpecialSettings({ stats_ignored: [...(st.stats_ignored || []), target.dataset.key] });
        break;
      }
      case "insight-create": {
        const s = this._insightSuggestions?.[target.dataset.key];
        if (!s) break;
        const item = {
          name: s.name, direction: s.direction, amount: s.amount, amount_variance_pct: s.variance, date_tolerance_days: s.tolerance || 0,
          category: s.category, icon: s.icon, start_date: s.due, schedule: s.schedule, weekend_shift: s.category === "Gehalt" ? "previous" : null,
          note: tr("Aus der Statistik angelegt", "Created from statistics"), bank_keys: [s.bankKey],
          confirmations: [{ due_date: s.due, status: "booked", actual_date: s.last, actual_amount: s.amount }],
        };
        this._run(() => this._ws("import", { data: { format: "haushaltsbuch", items: [item] }, replace: false }));
        break;
      }
      case "insight-budget": {
        const item = this._state.items.find((i) => i.id === target.dataset.id);
        if (!item) break;
        const { editable, owner_name, owner, current_amount, contract_info, learned_days, budget_status, ...payload } = item;
        this._run(() => this._ws("item/save", { item: { ...payload, amount: Number(target.dataset.amount) } }));
        break;
      }
      case "ledger-assign":
        this._error = null;
        this._dialog = this._assignDialog(this._ledger.rows[Number(target.dataset.row)], target.dataset.current || "");
        this._render();
        break;
      case "stats-month":
        this._statsMonth = this._statsMonth === target.dataset.month ? null : target.dataset.month;
        this._statsOpen = null;
        this._statsPick = null;
        this._render();
        break;
      case "stats-mode":
        this._statsMode = target.dataset.mode;
        this._render();
        break;
      case "stats-cat":
        this._statsOpen = this._statsOpen === target.dataset.cat ? null : target.dataset.cat;
        this._statsPick = null;
        this._render();
        break;
      case "stats-pick": {
        const same = this._statsPick?.kind === target.dataset.kind && this._statsPick?.name === target.dataset.name;
        this._statsPick = same ? null : { kind: target.dataset.kind, name: target.dataset.name };
        this._statsMore = false;
        this._render();
        break;
      }
      case "stats-more":
        this._statsMore = true;
        this._render();
        break;
      case "stats-clear":
        if (confirm(tr("Alle gespeicherten Umsätze löschen? Deine Posten bleiben.", "Delete all saved transactions? Your entries stay."))) this._run(() => this._ws("ledger/clear"));
        break;
      case "view":
        this._view = target.dataset.view;
        this._reload();
        break;
      case "range":
        this._range = Number(target.dataset.range);
        this._reload();
        break;
      case "month":
        this._month = new Date(this._month.getFullYear(), this._month.getMonth() + Number(target.dataset.delta), 1);
        this._selectedDay = null;
        this._reload();
        break;
      case "dash-toggle":
        this._dashOpen = this._dashOpen === target.dataset.key ? null : target.dataset.key;
        this._render();
        break;
      case "toggle-month":
        this._openMonth = this._openMonth === target.dataset.month ? null : target.dataset.month;
        this._render();
        break;
      case "select-day":
        this._selectedDay = target.dataset.day;
        this._render();
        break;
      case "close":
        this._dialog = null;
        this._error = null;
        this._render();
        break;
      case "edit-balance":
        this._dialog = { type: "balance" };
        this._render();
        break;
      case "export":
        this._export();
        break;
      case "price-add": {
        const item = this._readItemForm(target.closest("form"));
        item.price_changes = [...item.price_changes, { from: iso(today()), amount: item.amount }];
        this._dialog.item = item;
        this._render();
        break;
      }
      case "price-remove": {
        const item = this._readItemForm(target.closest("form"));
        item.price_changes = item.price_changes.filter((_, i) => i !== Number(target.dataset.index));
        this._dialog.item = item;
        this._render();
        break;
      }
      case "confirm-all":
        this._run(async () => {
          for (const e of this._pending) await this._ws("confirm", { item_id: e.item_id, due_date: e.due_date, status: "booked" });
        });
        break;
      case "import":
        this.shadowRoot.querySelector('input[data-change="import-file"]').click();
        break;
      case "new-item":
        this._dialog = {
          type: "item",
          item: { direction: "expense", schedule: { frequency: "monthly", interval: 1 }, start_date: iso(today()), household_id: this._isHousehold() ? this._scope : null, editable: true },
        };
        this._render();
        break;
      case "template": {
        const t = this._templates()[Number(target.dataset.index)];
        const form = target.closest("form");
        const current = this._readItemForm(form);
        this._dialog.item = {
          ...current,
          name: t.name,
          direction: t.direction,
          category: t.category,
          icon: t.icon,
          amount: t.amount ?? current.amount,
          certainty: t.certainty || null,
          date_tolerance_days: t.date_tolerance_days || 0,
          weekend_shift: t.weekend_shift || null,
          amount_variance_pct: t.amount_variance_pct || 0,
          schedule: { frequency: t.frequency, interval: t.interval || 1, dates: t.dates || [], ...(t.unit ? { unit: t.unit } : {}) },
        };
        this._dialog.preset = presetOf(this._dialog.item.schedule);
        this._render();
        break;
      }
      case "edit-item": {
        const item = this._state.items.find((i) => i.id === target.dataset.item);
        if (item) {
          this._dialog = { type: "item", item: { ...item } };
          this._render();
        }
        break;
      }
      case "delete-item":
        if (confirm(tr(`„${this._dialog.item.name}“ wirklich löschen?`, `Really delete “${this._dialog.item.name}”?`))) this._run(() => this._ws("item/delete", { item_id: this._dialog.item.id }));
        break;
      case "open-entry":
        this._dialog = { type: "confirm", item_id: target.dataset.item, due: target.dataset.due, date: target.dataset.date, amount: target.dataset.amount, status: target.dataset.status, planned: Boolean(target.dataset.planned) };
        this._render();
        break;
      case "quick-confirm":
        this._run(() => this._ws("confirm", { item_id: target.dataset.item, due_date: target.dataset.due, status: target.dataset.status }));
        break;
      case "plan-save": {
        const form = target.closest("form");
        if (!form.reportValidity()) break;
        const f = new FormData(form);
        const amount = this._parsedAmount(f.get("actual_amount"), null);
        this._run(() => this._ws("plan", { item_id: this._dialog.item_id, due_date: this._dialog.due, date: f.get("actual_date"), amount }));
        break;
      }
      case "plan-clear":
        this._run(() => this._ws("plan", { item_id: this._dialog.item_id, due_date: this._dialog.due, date: null }));
        break;
      case "confirm-skip":
        this._run(() => this._ws("confirm", { item_id: this._dialog.item_id, due_date: this._dialog.due, status: "skipped" }));
        break;
      case "reset-confirm":
        this._run(() => this._ws("confirm", { item_id: this._dialog.item_id, due_date: this._dialog.due, status: null }));
        break;
      case "budget-toggle":
        this._budgetOpen = this._budgetOpen === target.dataset.item ? null : target.dataset.item;
        this._render();
        break;
      case "spending-new":
        this._error = null;
        this._dialog = { type: "spending", item_id: target.dataset.item || null };
        this._render();
        break;
      case "spending-edit": {
        const item = this._state.items.find((i) => i.id === target.dataset.item);
        const spending = item?.budget_status?.spendings.find((x) => x.id === target.dataset.id);
        if (spending) {
          this._error = null;
          this._dialog = { type: "spending", item_id: item.id, spending: { ...spending } };
          this._render();
        }
        break;
      }
      case "spending-delete":
        if (confirm(tr("Diese Ausgabe löschen?", "Delete this spending?"))) this._run(() => this._ws("spending/delete", { item_id: target.dataset.item, spending_id: target.dataset.id }));
        break;
      case "new-household":
        this._dialog = { type: "household", household: null };
        this._render();
        break;
      case "edit-household":
        this._dialog = { type: "household", household: this._state.households.find((h) => h.id === target.dataset.id) };
        this._render();
        break;
      case "delete-household":
        if (confirm(tr("Haushalt löschen? Die Posten bleiben bei ihren Besitzern erhalten und werden wieder privat.", "Delete household? The entries stay with their owners and become private again."))) this._run(() => this._ws("household/delete", { household_id: this._dialog.household.id }));
        break;
      case "leave-household":
        if (confirm(tr("Haushalt verlassen? Deine Posten darin werden wieder privat.", "Leave household? Your entries in it become private again."))) this._run(() => this._ws("household/leave", { household_id: target.dataset.id }));
        break;
      default:
        break;
    }
  }
}

const STYLES = `
  :host { --viz-1: #2a78d6; --viz-2: #eb6834; --viz-3: #1baf7a; --viz-4: #eda100; --viz-5: #e87ba4; --viz-6: #6250d6; --viz-other: #9e9d98; }
  :host(.dark) { --viz-1: #3987e5; --viz-2: #d95926; --viz-3: #199e70; --viz-4: #c98500; --viz-5: #d55181; --viz-6: #9085e9; --viz-other: #6e6d68; }
  :host { display: block; min-height: 100vh; background: var(--primary-background-color); color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  * { box-sizing: border-box; }
  .toolbar { display: flex; align-items: center; gap: 8px; height: var(--header-height, 56px); padding: 0 12px; background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff); }
  .title { flex: 1; font-size: 20px; white-space: nowrap; }
  .title-short { display: none; }
  @media (max-width: 520px) { .title-long { display: none; } .title-short { display: inline; } }
  .scope { max-width: 50vw; background: rgba(255,255,255,0.15); color: inherit; border: 1px solid rgba(255,255,255,0.4); border-radius: 6px; padding: 6px 8px; font-size: 14px; }
  .scope option { color: var(--primary-text-color); background: var(--card-background-color); }
  .tabs { display: flex; gap: 4px; overflow-x: auto; padding: 0 8px; background: var(--app-header-background-color, var(--primary-color)); }
  .tab { display: flex; align-items: center; gap: 6px; background: none; border: none; border-bottom: 3px solid transparent; color: var(--app-header-text-color, #fff); opacity: 0.75; padding: 10px 12px; font-size: 14px; cursor: pointer; white-space: nowrap; border-radius: 0; }
  .tab.active { opacity: 1; border-bottom-color: var(--app-header-text-color, #fff); }
  .content { max-width: 900px; margin: 0 auto; padding: 16px; }
  .card { background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px); box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,0.12)); border: var(--ha-card-border-width, 1px) solid var(--divider-color, transparent); padding: 16px; margin-bottom: 16px; }
  h2 { margin: 0 0 12px; font-size: 20px; font-weight: 500; }
  h3 { margin: 0; font-size: 16px; font-weight: 500; }
  .hint { color: var(--secondary-text-color); font-size: 13px; margin: 8px 0; }
  .label { color: var(--secondary-text-color); font-size: 12px; }
  .big { font-size: 22px; font-weight: 500; }
  .sub { color: var(--secondary-text-color); font-size: 12px; }
  .neg { color: var(--error-color, #db4437); }
  .pos { color: var(--success-color, #43a047); }
  .kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 20px; }
  @media (min-width: 700px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .kpi-value { font-size: 22px; font-weight: 500; margin: 2px 0; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  .split { display: flex; gap: 2px; height: 8px; margin: 12px 0 8px; }
  .split span { border-radius: 4px; min-width: 2px; }
  .split-list { display: flex; flex-direction: column; }
  .split-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--divider-color); }
  .split-row:last-child { border-bottom: none; }
  .split-name { flex: 1; font-size: 14px; }
  .split-name small, .split-value small { display: block; color: var(--secondary-text-color); font-size: 12px; }
  .split-value { text-align: right; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .split-value small { font-weight: 400; }
  .s1 { background: var(--viz-1); } .s2 { background: var(--viz-2); } .s3 { background: var(--viz-3); }
  .c-sure { background: var(--success-color, #43a047); } .c-likely { background: var(--warning-color, #ffa000); } .c-unsure { background: var(--secondary-text-color, #888); opacity: 0.6; }
  .help { position: relative; display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; width: 18px; height: 18px; font-size: 13px; font-weight: 400; color: var(--secondary-text-color); cursor: help; border-radius: 50%; vertical-align: 1px; }
  .help:hover, .help:focus { color: var(--primary-color); outline: none; }
  .help-tip { position: fixed; z-index: 20; max-width: min(300px, calc(100vw - 16px)); background: var(--card-background-color, #fff); color: var(--primary-text-color); border: 1px solid var(--divider-color); border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.2); padding: 8px 10px; font-size: 12px; line-height: 1.45; pointer-events: none; }
  .split-row.clickable, .cat-row.clickable { cursor: pointer; border-radius: 6px; }
  .split-row.clickable:hover, .cat-row.clickable:hover { background: var(--secondary-background-color, rgba(0,0,0,.04)); }
  .split-row.open, .cat-row.open { background: var(--secondary-background-color, rgba(0,0,0,.04)); }
  .split-row { padding-left: 4px; padding-right: 4px; }
  .chevron { color: var(--secondary-text-color); width: 12px; text-align: center; }
  .split span[data-action], .pie svg [data-action] { cursor: pointer; }
  .split span.active { outline: 2px solid var(--primary-text-color); outline-offset: 1px; }
  .pie svg .active { stroke: var(--primary-text-color); stroke-width: 3; }
  .details { margin: 4px 0 8px 22px; padding-left: 10px; border-left: 2px solid var(--divider-color); }
  .details .hint { margin: 4px 0; }
  .detail-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; }
  .detail-row:hover .detail-name { color: var(--primary-color); }
  .detail-icon { display: inline-flex; color: var(--primary-color); }
  .detail-name { flex: 1; font-size: 13px; }
  .detail-name small, .detail-value small { display: block; color: var(--secondary-text-color); font-size: 11px; }
  .detail-value { text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; }
  .pie-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 28px; margin-top: 8px; }
  .pie-wrap .income-share { flex-basis: 100%; margin: 0; text-align: center; }
  .pie { position: relative; width: 180px; height: 180px; margin: 0 auto; flex-shrink: 0; }
  .pie svg path, .pie svg circle { stroke: var(--card-background-color, #fff); stroke-width: 2; stroke-linejoin: round; }
  .pie svg circle { stroke: currentColor; }
  .pie-center { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 15px; font-weight: 500; text-align: center; }
  .pie-center small { font-size: 11px; font-weight: 400; color: var(--secondary-text-color); }
  .pie-list { flex: 1; min-width: 220px; }
  path.p1 { fill: var(--viz-1); } path.p2 { fill: var(--viz-2); } path.p3 { fill: var(--viz-3); } path.p4 { fill: var(--viz-4); } path.p5 { fill: var(--viz-5); } path.p-other { fill: var(--viz-other); }
  circle.p1 { color: var(--viz-1); } circle.p2 { color: var(--viz-2); } circle.p3 { color: var(--viz-3); } circle.p4 { color: var(--viz-4); } circle.p5 { color: var(--viz-5); } circle.p-other { color: var(--viz-other); }
  .swatch.p1 { background: var(--viz-1); } .swatch.p2 { background: var(--viz-2); } .swatch.p3 { background: var(--viz-3); } .swatch.p4 { background: var(--viz-4); } .swatch.p5 { background: var(--viz-5); } .swatch.p-other { background: var(--viz-other); }
  .cat-icon { display: inline-flex; vertical-align: -3px; margin-right: 6px; color: var(--primary-color); }
  .balance { display: flex; flex-wrap: wrap; align-items: center; gap: 24px; }
  .balance > button { margin-left: auto; }
  .totals { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 12px; }
  .row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .day { margin-top: 12px; }
  .day-head { display: flex; justify-content: space-between; font-size: 13px; font-weight: 500; color: var(--secondary-text-color); padding: 6px 0; border-bottom: 1px solid var(--divider-color); }
  .day-balance { font-variant-numeric: tabular-nums; }
  .pending-date { font-size: 12px; color: var(--secondary-text-color); margin-top: 8px; }
  .entry { display: flex; align-items: center; gap: 12px; padding: 10px 4px; cursor: pointer; border-radius: 8px; flex-wrap: wrap; }
  .entry:hover { background: var(--secondary-background-color); }
  .entry.budget-row { opacity: 0.8; }
  .budgets h3 .period, .budgets h3 small { font-size: 12px; color: var(--secondary-text-color); font-weight: 400; margin-left: 4px; }
  .budget-block { border-top: 1px solid var(--divider-color); padding: 10px 0 4px; }
  .budgets .row-between + .budget-block { border-top: none; }
  .budget-sub { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
  .budget-sub.neg { color: var(--error-color, #db4437); }
  .budget-sub .chev { font-size: 10px; }
  .budget-line { display: flex; gap: 12px; align-items: flex-start; }
  .budget-line[data-action] { cursor: pointer; }
  .budget-main { flex: 1; min-width: 0; }
  .budget-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .budget-figures { font-size: 14px; white-space: nowrap; }
  .budget-bar { position: relative; height: 10px; margin: 6px 0 4px; background: var(--secondary-background-color); border-radius: 5px; overflow: hidden; }
  .budget-bar span { display: block; height: 100%; background: var(--success-color, #43a047); border-radius: 5px; }
  .budget-bar.ahead span { background: var(--warning-color, #ffa600); }
  .budget-bar.over span { background: var(--error-color, #db4437); }
  .budget-bar i { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--primary-text-color); opacity: 0.45; }
  .spendings { margin: 6px 0 6px 48px; }
  .spending { cursor: pointer; display: flex; gap: 10px; align-items: center; padding: 4px 0; font-size: 14px; border-bottom: 1px dashed var(--divider-color); }
  .spending-date { color: var(--secondary-text-color); min-width: 44px; }
  .spending-note { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .spending-amount { white-space: nowrap; }
  .spendings > button { margin-top: 8px; }
  .icon-button.small-x { width: 28px; height: 28px; font-size: 13px; padding: 0; }
  .budget-in-form { background: var(--secondary-background-color); border-radius: 8px; padding: 8px 12px 10px; margin-bottom: 12px; }
  .budget-in-form .budget-block { border: none; padding-top: 0; }
  .entry.budget-row:not([data-action]) { cursor: default; }
  .entry.budget-row .entry-name { font-style: italic; }
  .entry-icon { width: 40px; height: 40px; border-radius: 50%; background: var(--secondary-background-color); display: flex; align-items: center; justify-content: center; color: var(--primary-color); flex-shrink: 0; }
  .entry-main { flex: 1; min-width: 0; }
  .entry-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry-meta { font-size: 12px; color: var(--secondary-text-color); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 2px; }
  .entry-amount { font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .entry-actions { display: flex; gap: 6px; width: 100%; justify-content: flex-end; }
  .skipped-row { opacity: 0.5; text-decoration: line-through; }
  .owner { background: var(--secondary-background-color); border-radius: 10px; padding: 1px 8px; }
  .chip { border: 1px solid var(--chip); color: var(--chip); border-radius: 10px; padding: 0 8px; font-size: 11px; line-height: 18px; }
  .chip.booked { --chip: var(--success-color, #43a047); }
  .chip.skipped { --chip: var(--secondary-text-color); }
  .chip.shared { --chip: var(--primary-color); }
  .day.past { opacity: 0.6; }
  .special-settings { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 4px 0 12px; font-size: 13px; }
  .special-settings select { width: auto; flex: 1 1 180px; padding: 4px 8px; font-size: 13px; }
  .inline-amount { flex-direction: row; align-items: center; gap: 6px; color: var(--primary-text-color); }
  .inline-amount input { width: 80px; padding: 4px 8px; font-size: 13px; }
  .chip.budget { --chip: var(--info-color, #039be5); }
  .chip.contract { --chip: var(--primary-color); }
  .chip.contract.urgent { --chip: var(--error-color, #db4437); }
  .price-note { display: block; font-size: 11px; font-weight: 400; color: var(--secondary-text-color); }
  .price-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; margin-bottom: 8px; }
  .unit { align-self: center; font-size: 14px; color: var(--primary-text-color); }
  .deadline { text-align: right; font-size: 13px; font-weight: 500; color: var(--primary-color); white-space: nowrap; }
  .deadline small { display: block; font-weight: 400; color: var(--secondary-text-color); }
  .deadline.urgent { color: var(--error-color, #db4437); }
  .search { margin-top: 12px; }
  [hidden] { display: none !important; }
  .cat-row { display: grid; grid-template-columns: minmax(0, 40%) 1fr 92px; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--divider-color); }
  .cat-name { font-size: 14px; overflow: hidden; }
  .cat-name small, .cat-sum small { display: block; font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cat-bar { height: 10px; background: var(--secondary-background-color); border-radius: 5px; overflow: hidden; }
  .cat-bar span { display: block; height: 100%; background: var(--error-color, #db4437); opacity: 0.75; border-radius: 5px; }
  .cat-sum { text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .chip.special { --chip: var(--warning-color, #ffa600); background: var(--chip); color: #000; border: none; }
  .month-specials { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px; padding-left: 64px; }
  .special-pill { display: inline-flex; align-items: center; gap: 4px; background: rgba(255, 166, 0, 0.18); border-left: 3px solid var(--warning-color, #ffa600); color: var(--primary-text-color); border-radius: 6px; padding: 1px 8px 1px 6px; font-size: 12px; line-height: 20px; }
  .special-pill b { font-weight: 500; color: var(--error-color, #db4437); font-variant-numeric: tabular-nums; }
  .special-pill.income b { color: var(--success-color, #43a047); }
  .special-pill ha-icon { color: var(--warning-color, #ffa600); }
  .special-pill.inline { padding: 0 6px; }
  .month-section { display: flex; justify-content: space-between; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color); padding: 12px 4px 0; }
  .month-section.special { color: var(--warning-color, #c77c00); }
  .chip.planned { --chip: var(--success-color, #43a047); background: var(--chip); color: var(--text-primary-color, #fff); }
  .inline-fields { display: flex; gap: 8px; }
  .inline-fields input { width: 80px; flex: none; }
  .icon-fallback { display: inline-block; width: calc(var(--size) * 0.5); height: calc(var(--size) * 0.5); border-radius: 50%; background: var(--primary-color); opacity: 0.5; }
  .empty { color: var(--secondary-text-color); text-align: center; padding: 24px 8px; }
  .error { background: var(--error-color, #db4437); color: #fff; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
  button { font: inherit; font-size: 14px; border: none; border-radius: 8px; padding: 8px 14px; background: var(--primary-color); color: var(--text-primary-color, #fff); cursor: pointer; }
  button.secondary { background: var(--secondary-background-color); color: var(--primary-text-color); }
  button.danger { background: none; color: var(--error-color, #db4437); }
  button.small { padding: 4px 10px; font-size: 12px; }
  .icon-button { background: none; color: var(--primary-text-color); font-size: 22px; padding: 4px 12px; }
  .segmented { display: flex; background: var(--secondary-background-color); border-radius: 8px; padding: 2px; }
  .segmented button { background: none; color: var(--primary-text-color); padding: 4px 10px; font-size: 13px; }
  .segmented button.active { background: var(--card-background-color); box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
  .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-top: 12px; }
  .cal-head { text-align: center; font-size: 12px; color: var(--secondary-text-color); padding: 4px 0; }
  .cal-cell { min-height: 72px; background: var(--secondary-background-color); color: var(--primary-text-color); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; align-items: stretch; gap: 2px; text-align: left; border: 2px solid transparent; }
  .cal-cell.blank { background: none; }
  .cal-cell.today { border-color: var(--primary-color); }
  .cal-cell.selected { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .cal-cell.selected .neg, .cal-cell.selected .pos { color: inherit; }
  .cal-day { font-size: 12px; font-weight: 500; }
  .cal-icons { display: flex; flex-wrap: wrap; gap: 1px; color: var(--primary-color); }
  .cal-cell.selected .cal-icons { color: inherit; }
  .more { font-size: 10px; }
  .cal-sum { font-size: 10px; margin-top: auto; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .months { margin-top: 12px; }
  .month-block { border-bottom: 1px solid var(--divider-color); }
  .month-row { display: grid; grid-template-columns: 56px 1fr 96px; gap: 8px; align-items: center; padding: 8px 0; width: 100%; background: none; color: var(--primary-text-color); border-radius: 0; text-align: left; }
  .month-row:hover, .month-row.open { background: var(--secondary-background-color); }
  .month-entries { padding: 0 4px 8px; }
  .month-name { font-size: 13px; }
  .month-name small { display: block; font-size: 10px; color: var(--secondary-text-color); white-space: nowrap; }
  .bar-line { display: flex; align-items: center; height: 16px; gap: 0; }
  .bar { height: 10px; display: inline-block; }
  .bar:first-child { border-radius: 4px 0 0 4px; }
  .pos-bg { background: var(--success-color, #43a047); }
  .neg-bg { background: var(--error-color, #db4437); }
  .light { opacity: 0.35; }
  .bar-value { font-size: 11px; color: var(--secondary-text-color); margin-left: 6px; white-space: nowrap; }
  .month-net { text-align: right; font-weight: 500; font-size: 13px; font-variant-numeric: tabular-nums; }
  .switch-row { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; font-size: 14px; }
  .switch-row small { color: var(--secondary-text-color); }
  .actions { display: flex; gap: 6px; }
  .row-actions { display: flex; gap: 8px; margin-top: 8px; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 10; padding: 16px; }
  .dialog { background: var(--card-background-color); color: var(--primary-text-color); border-radius: 16px; padding: 20px; width: 100%; max-width: 560px; max-height: calc(100vh - 32px); overflow-y: auto; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
  .grid .full { grid-column: 1 / -1; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
  label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--primary-text-color); font-size: 14px; padding: 4px 0; }
  input, select, textarea { font: inherit; font-size: 15px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--divider-color, #ccc); background: var(--input-fill-color, var(--secondary-background-color)); color: var(--primary-text-color); width: 100%; }
  input[type=checkbox], input[type=radio] { width: auto; flex-shrink: 0; }
  label.check.option { align-items: flex-start; }
  .csv-list { display: flex; flex-direction: column; gap: 2px; margin: 8px 0 12px; }
  .csv-row { display: flex; flex-direction: row; text-align: left; align-items: center; gap: 10px; padding: 8px 4px; border-radius: 8px; cursor: pointer; }
  .csv-row:hover { background: var(--secondary-background-color); }
  .csv-row > input[type="checkbox"] { width: 18px; height: 18px; flex-shrink: 0; margin: 0; }
  .csv-row .entry-main { flex: 1; min-width: 0; }
  .csv-row .entry-meta { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; }
  .csv-row.is-existing .entry-main, .csv-row.is-existing .entry-amount { opacity: 0.6; }
  input.csv-name { border: 1px solid transparent; background: transparent; padding: 2px 4px; margin-left: -5px; font: inherit; font-weight: 500; color: var(--primary-text-color); width: 100%; border-radius: 6px; box-sizing: border-box; }
  input.csv-name:hover, input.csv-name:focus { border-color: var(--divider-color); background: var(--card-background-color); }
  .csv-sub { margin: 16px 0 0; }
  .stats-head { flex-wrap: wrap; gap: 8px; }
  .backup-list { display: flex; flex-direction: column; margin: 8px 0; }
  .backup-row { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-top: 1px solid var(--divider-color); flex-wrap: wrap; }
  .backup-row .entry-main { flex: 1; min-width: 180px; }
  .backup-actions { display: flex; gap: 6px; }
  .stats-filters { display: flex; gap: 8px; }
  .stats-filters select { width: auto; padding: 4px 8px; font-size: 14px; }
  .delta { font-size: 12px; font-weight: 500; color: var(--secondary-text-color); }
  .delta.pos { color: var(--success-color, #43a047); }
  .delta.neg { color: var(--error-color, #db4437); }
  .stats-columns { display: flex; gap: 6px; align-items: flex-end; height: 170px; margin-top: 8px; }
  .stats-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; background: none; border: none; padding: 0; cursor: pointer; color: var(--secondary-text-color); font: inherit; }
  .stats-col[disabled] { cursor: default; }
  .stats-col.dim { opacity: 0.4; }
  .stats-col.active .stats-col-label { color: var(--primary-color); font-weight: 600; }
  .insight .insight-list { display: flex; flex-direction: column; }
  .insight-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--divider-color); }
  .insight-row .entry-main { flex: 1; min-width: 0; }
  .insight-row .entry-meta.plain { display: block; }
  .insight-price summary .entry-name { color: var(--primary-text-color); }
  .insight-change { color: var(--primary-text-color); }
  .insight-actions { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
  .insight-badge { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; }
  .insight-badge.neg { color: var(--error-color, #db4437); }
  .insight-badge.pos { color: var(--success-color, #43a047); }
  .insight-price { border-top: 1px solid var(--divider-color); padding: 8px 0; }
  .insight-price summary { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; cursor: pointer; list-style: none; }
  .insight-price summary::-webkit-details-marker { display: none; }
  .insight-price .entry-name { flex: 1 1 140px; }
  .insight-change { font-size: 13px; white-space: nowrap; }
  .insight-steps { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--secondary-text-color); padding-top: 4px; }
  .stats-columns.season { height: 120px; }
  .bar-out.hot { opacity: 1; }
  .insight-tip { background: var(--secondary-background-color); border-radius: 8px; padding: 8px 12px; }
  .stats-sub.static { cursor: default; margin: 0; width: auto; padding: 4px 0; border-top: 1px solid var(--divider-color); }
  .stats-sub.static.total { font-weight: 600; border-top: none; }
  .stats-sub.static:hover { background: none; }
  .assign-line { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
  .assign-line > span { min-width: 0; }
  .assign-chip { flex-shrink: 0; background: none; border: 1px dashed var(--divider-color); border-radius: 10px; padding: 1px 8px; font: inherit; font-size: 11px; color: var(--secondary-text-color); cursor: pointer; }
  .assign-chip.set { border-style: solid; border-color: var(--primary-color); color: var(--primary-color); }
  .assign-row { margin: 0 0 12px; }
  .stats-month { list-style: none; margin: 0; padding: 0; font-size: 13px; color: var(--secondary-text-color); }
  .stats-month li { padding: 6px 0; border-top: 1px solid var(--divider-color); }
  .stats-month .csv-detail-head .entry-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .stats-month b.pos { color: var(--success-color, #43a047); }
  .stats-bars { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 2px; }
  .stats-bars span { width: 40%; max-width: 22px; border-radius: 3px 3px 0 0; min-height: 1px; }
  .bar-in, .legend.in { background: var(--success-color, #43a047); }
  .bar-out, .legend.out { background: var(--error-color, #db4437); opacity: 0.8; }
  .stats-col-label { font-size: 11px; }
  .legend { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 8px; vertical-align: middle; }
  .legend.in { margin-left: 0; }
  .stats-cat { border-top: 1px solid var(--divider-color); }
  .stats-cat-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; cursor: pointer; }
  .stats-cat-main { flex: 1; min-width: 0; }
  .stats-cat-main .bar-line { margin-top: 4px; }
  .neg-bar { background: var(--error-color, #db4437); opacity: 0.7; border-radius: 3px; }
  .stats-cat-side { width: 200px; text-align: right; font-size: 12px; color: var(--secondary-text-color); }
  .stats-trend { display: block; }
  .stats-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0 4px 12px; }
  .stats-detail h4 { margin: 0 0 4px; font-size: 13px; color: var(--secondary-text-color); font-weight: 500; }
  .stats-sub { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; padding: 3px 4px; margin: 0 -4px; width: calc(100% + 8px); background: none; border: none; border-radius: 4px; color: inherit; font-family: inherit; text-align: left; cursor: pointer; }
  .stats-sub:hover { background: var(--secondary-background-color); }
  .stats-sub.active { background: var(--secondary-background-color); color: var(--primary-color); }
  .stats-bookings { padding: 0 4px 12px; font-size: 12px; color: var(--secondary-text-color); }
  .stats-bookings h4 { margin: 0; font-size: 13px; color: var(--primary-text-color); font-weight: 500; }
  .stats-bookings ul { list-style: none; margin: 4px 0 0; padding: 0; }
  .stats-bookings li { padding: 4px 0; border-top: 1px solid var(--divider-color); }
  .stats-bookings .csv-detail-head .what { margin-left: auto; color: var(--secondary-text-color); }
  button.link { background: none; border: none; padding: 4px 0; color: var(--primary-color); cursor: pointer; font: inherit; }
  .csv-map-table { overflow-x: auto; margin: 8px 0 12px; border: 1px solid var(--divider-color); border-radius: 8px; }
  .csv-map-table table { border-collapse: collapse; font-size: 12px; white-space: nowrap; }
  .csv-map-table th, .csv-map-table td { padding: 4px 8px; text-align: left; border-bottom: 1px solid var(--divider-color); }
  .csv-map-table th { background: var(--secondary-background-color); font-weight: 600; }
  .csv-map-fields label { font-size: 13px; }
  .csv-map-table th.on, .csv-map-table td.on { background: color-mix(in srgb, var(--primary-color) 10%, transparent); }
  .csv-col-tag { display: inline-block; font-size: 11px; font-weight: 600; color: var(--primary-color); }
  .csv-col-tag.off { color: var(--secondary-text-color); font-weight: 400; }
  .csv-check { font-size: 12px; }
  .csv-check.ok { color: var(--success-color, #43a047); }
  .csv-check.warn { color: var(--warning-color, #e68a00); }
  .csv-map-field { display: flex; flex-direction: column; gap: 2px; }
  .csv-map-label { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
  .csv-need { font-size: 11px; border-radius: 6px; padding: 0 6px; background: var(--secondary-background-color); color: var(--secondary-text-color); }
  .csv-need.must, .csv-need.one { background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); color: var(--error-color, #db4437); }
  .csv-need.good { background: color-mix(in srgb, var(--primary-color) 14%, transparent); color: var(--primary-color); }
  .csv-map-example { font-size: 12px; color: var(--secondary-text-color); }
  .csv-map-value { font-size: 12px; color: var(--primary-text-color); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .csv-map-test { list-style: none; padding: 0; margin: 0; font-size: 13px; }
  .csv-map-test li { display: grid; grid-template-columns: 80px minmax(0, 1fr) auto; gap: 8px; padding: 4px 0; border-top: 1px solid var(--divider-color); }
  .csv-map-test li span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Statistics */
  .st-top { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 10px; }
  .st-pills { display: inline-flex; background: var(--secondary-background-color); border-radius: 999px; padding: 3px; }
  .st-pills button { font: inherit; font-size: 13px; font-weight: 500; padding: 6px 14px; border: none; border-radius: 999px; background: none; color: var(--secondary-text-color); cursor: pointer; }
  .st-pills button.on { background: var(--card-background-color); color: var(--primary-text-color); box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
  .st-nav { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; }
  .st-arrow { width: 32px; height: 32px; border-radius: 50%; border: none; display: grid; place-items: center; background: var(--secondary-background-color); color: var(--primary-text-color); font-size: 18px; line-height: 1; cursor: pointer; padding: 0; }
  .st-arrow:disabled { opacity: 0.35; cursor: default; }
  .st-chip { border: 1px solid var(--divider-color); border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 13px; color: var(--primary-text-color); background: var(--card-background-color); width: auto; }
  .st-tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--divider-color); margin: 0 0 14px; }
  .st-tabs button { font: inherit; font-weight: 500; background: none; border: none; color: var(--secondary-text-color); padding: 8px 0; cursor: pointer; }
  .st-tabs button.on { color: var(--primary-text-color); box-shadow: inset 0 -2px var(--primary-color); }
  .st-grid { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); margin-bottom: 14px; }
  @media (min-width: 900px) { .st-grid:not(.single) { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); } .st-span { grid-column: span 2; } }
  .st-grid .card { margin: 0; border-radius: 18px; padding: 18px; }
  .st-grid.single .card { margin: 0; }
  .st-label { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--secondary-text-color); font-weight: 600; }
  .st-hero { display: flex; flex-direction: column; gap: 14px; }
  .st-hero .hint { margin: 4px 0 0; }
  .st-big-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
  .st-big { font-size: 40px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; }
  .st-big.neg { color: var(--error-color, #db4437); }
  .badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 600; background: var(--secondary-background-color); color: var(--secondary-text-color); white-space: nowrap; }
  .badge.good { background: color-mix(in srgb, var(--success-color, #1a8f5a) 16%, transparent); color: var(--success-color, #1a8f5a); }
  .badge.bad { background: color-mix(in srgb, var(--error-color, #d03b3b) 16%, transparent); color: var(--error-color, #d03b3b); }
  .st-rate { display: flex; align-items: center; gap: 12px; }
  .st-rate .hint { margin: 0; white-space: nowrap; }
  .st-rate-bar { flex: 1; height: 8px; border-radius: 99px; background: var(--secondary-background-color); overflow: hidden; }
  .st-rate-bar span { display: block; height: 100%; background: var(--success-color, #1baf7a); border-radius: 99px; }
  .st-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .st-kpi { background: var(--secondary-background-color); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
  .st-kpi-v { font-size: 20px; font-weight: 650; }
  .st-spark { width: 100%; height: 30px; }
  .st-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .st-head h3 { margin: 0; font-size: 16px; font-weight: 600; }
  .st-head .hint { margin: 0; }
  .st-legend { display: flex; gap: 14px; font-size: 12px; color: var(--secondary-text-color); }
  .st-legend span::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; background: var(--c); }
  .st-chart { width: 100%; height: auto; display: block; overflow: visible; }
  .st-grid-line { stroke: var(--divider-color); stroke-width: 1; }
  .st-axis { font-size: 10px; fill: var(--secondary-text-color); }
  .st-xl.on { fill: var(--primary-text-color); font-weight: 700; }
  .st-col[data-action] { cursor: pointer; }
  .st-col.dim .st-in, .st-col.dim .st-out { opacity: 0.35; }
  .st-col-hl { fill: var(--secondary-background-color); }
  .st-hit { fill: transparent; }
  .st-col[data-action]:hover .st-in, .st-col[data-action]:hover .st-out { opacity: 1; filter: brightness(1.1); }
  .st-in { fill: var(--success-color, #1baf7a); }
  .st-out { fill: var(--error-color, #e34948); }
  .st-sel { display: flex; gap: 4px 14px; flex-wrap: wrap; align-items: baseline; margin-top: 6px; background: var(--secondary-background-color); border-radius: 10px; padding: 8px 12px; font-size: 13px; }
  .st-sel .pos { color: var(--success-color, #43a047); }
  .st-sel .neg { color: var(--error-color, #db4437); }
  .st-donut { display: flex; gap: 18px; align-items: flex-start; }
  .st-donut > svg { flex: 0 0 132px; width: 132px; height: 132px; }
  .st-ring-l { font-size: 9px; letter-spacing: 0.06em; fill: var(--secondary-text-color); font-weight: 600; }
  .st-ring-v { font-size: 15px; font-weight: 700; fill: var(--primary-text-color); }
  .st-cats { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .st-cat { border-top: 1px solid var(--divider-color); }
  .st-cat:first-child { border-top: none; }
  .st-cat-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 8px 0; width: 100%; background: none; border: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
  .st-cat.open .st-cat-n { color: var(--primary-color); }
  .st-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
  .st-cat-n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .st-cat-a { font-weight: 600; font-variant-numeric: tabular-nums; }
  .st-cat-d { text-align: right; }
  .st-cat-d .badge { padding: 1px 6px; font-size: 11px; }
  .st-cat .stats-detail { grid-template-columns: 1fr; gap: 8px; padding: 0 0 10px 20px; }
  .st-cat .stats-sub { margin: 0; width: 100%; padding: 3px 0; min-width: 0; }
  .st-cat .stats-sub span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st-cat .stats-sub span:last-child { flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .st-cat .stats-detail > div { min-width: 0; }
  .st-cat .stats-bookings { padding: 0 0 12px 20px; }
  @media (max-width: 600px) { .st-donut { flex-direction: column; align-items: stretch; } .st-donut > svg { align-self: center; width: 150px; height: 150px; flex: none; } .st-big { font-size: 34px; } }
  .st-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .st-tile { background: var(--secondary-background-color); border: none; border-radius: 14px; padding: 12px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-height: 104px; font: inherit; color: inherit; text-align: left; cursor: pointer; min-width: 0; }
  .st-tile-ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); }
  .st-tile-t { font-size: 12px; color: var(--secondary-text-color); }
  .st-tile-v { font-size: 15px; font-weight: 650; line-height: 1.25; overflow-wrap: break-word; hyphens: auto; }
  .st-day { font-size: 12px; color: var(--secondary-text-color); font-weight: 600; padding: 12px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  .st-tx { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 8px 0; }
  .st-av { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; font-weight: 700; font-size: 14px; color: #fff; background: var(--c); }
  .st-tx-n { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st-tx-m { font-size: 12px; color: var(--secondary-text-color); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .st-tx-p { font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st-tx-a { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .st-tx-a.pos { color: var(--success-color, #43a047); }
  .st-grid .insight h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  .insight-hidden { border-top: 1px solid var(--divider-color); padding-top: 6px; margin-top: 4px; }
  .insight-hidden ul, .insight-hits ul { list-style: none; margin: 4px 0 0; padding: 0; }
  .insight-hidden li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--divider-color); font-size: 13px; }
  .insight-hits { margin-top: 6px; font-size: 12px; color: var(--secondary-text-color); }
  .insight-hits summary { cursor: pointer; color: var(--primary-color); }
  .insight-hits li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; padding: 6px 0; border-top: 1px solid var(--divider-color); }
  .hit-main { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--primary-text-color); }
  .hit-main span { color: var(--secondary-text-color); margin-right: 4px; }
  .hit-actions { grid-column: 1 / -1; display: flex; gap: 6px; justify-content: flex-end; margin: 0; }
  .insight-hits li b { font-weight: 500; color: var(--primary-text-color); }
  @media (max-width: 600px) {
    .stats-cat-side { width: auto; max-width: 40%; }
    .stats-detail { grid-template-columns: 1fr; }
  }
  .csv-row-wrap { border-radius: 8px; }
  .csv-row-wrap > label.csv-price { margin: 0 0 6px 38px; width: calc(100% - 38px); box-sizing: border-box; }
  select.csv-target { width: auto; field-sizing: content; max-width: calc(100% - 92px); margin: -6px 0 6px 92px; padding: 2px 4px; border: none; background: transparent; color: var(--primary-color); font-size: 12px; cursor: pointer; }
  label.csv-price { font-size: 13px; }
  .csv-row .entry-meta.plain { display: block; }
  .csv-detail { margin: -4px 0 8px 38px; font-size: 12px; color: var(--secondary-text-color); }
  .csv-detail summary { cursor: pointer; color: var(--primary-color); }
  .csv-detail ul { list-style: none; margin: 4px 0 0; padding: 0; }
  .csv-detail li { padding: 4px 0; border-top: 1px solid var(--divider-color); }
  .csv-detail-head { display: flex; gap: 8px; align-items: baseline; color: var(--primary-text-color); }
  .csv-detail-head .what { margin-left: auto; color: var(--secondary-text-color); }
  .csv-detail-text { overflow-wrap: anywhere; }
  select.csv-spend { margin-left: auto; width: auto; field-sizing: content; max-width: 55%; padding: 0 2px; border: none; background: transparent; color: var(--primary-color); font-size: 12px; cursor: pointer; }
  .csv-detail-more { padding-top: 4px; }
  label.check.muted { color: var(--secondary-text-color); }
  label.check small { display: block; font-size: 12px; color: var(--secondary-text-color); }
  label.check.option input { margin-top: 3px; }
  details { margin: 8px 0; }
  summary { cursor: pointer; font-size: 14px; color: var(--primary-color); }
  .templates { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; }
  .template { display: flex; align-items: center; gap: 4px; background: var(--secondary-background-color); color: var(--primary-text-color); white-space: nowrap; font-size: 13px; padding: 6px 10px; border-radius: 16px; }
  .icon-preview { display: inline-flex; vertical-align: middle; color: var(--primary-color); }
  .suggest-field { position: relative; }
  .incognito-toggle { background: none; color: inherit; padding: 6px; border-radius: 50%; display: inline-flex; line-height: 0; }
  .incognito-toggle.on { background: rgba(255,255,255,0.25); }
  :host(.incognito) .money { filter: blur(7px); user-select: none; }
  :host(.incognito) input[data-amount] { color: transparent; text-shadow: 0 0 10px var(--primary-text-color); }
  :host(.incognito) .money { display: inline-block; }
  .suggest { position: absolute; top: 100%; left: 0; right: 0; z-index: 5; max-height: 240px; overflow-y: auto; background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); padding: 4px; }
  .suggest[hidden] { display: none; }
  .suggest button { display: flex; align-items: center; gap: 10px; width: 100%; background: none; color: var(--primary-text-color); text-align: left; padding: 6px 8px; border-radius: 6px; font-size: 14px; font-weight: normal; }
  .suggest button:hover, .suggest button:focus { background: var(--secondary-background-color); }
  .suggest ha-icon { color: var(--primary-color); flex-shrink: 0; }
  .members { margin: 12px 0; }
  .end-date { display: flex; flex-direction: column; gap: 4px; justify-content: flex-end; }
  .dialog-actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
  .dialog-actions > div { display: flex; gap: 8px; flex-wrap: wrap; }
  @media (max-width: 600px) {
    .content { padding: 8px; }
    .grid { grid-template-columns: 1fr; }
    .cal-cell { min-height: 56px; }
    .cal-sum { display: none; }
    .cal-dot ha-icon { display: none; }
    .cal-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--chip); margin: 1px; }
    .tab ha-icon { display: none; }
    .tab { padding: 10px 8px; font-size: 13px; }
    .month-row { grid-template-columns: 48px 1fr 80px; }
    .month-specials { padding-left: 0; }
  }
`;

customElements.define("haushaltsbuch-panel", HaushaltsbuchPanel);
