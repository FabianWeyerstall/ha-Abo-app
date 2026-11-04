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
      case "households":
        return this._renderHouseholds();
      default:
        return this._renderBalanceCard() + this._renderTimeline();
    }
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
      ${this._isHousehold() ? "" : `<div class="row-actions">
        <button class="secondary small" data-action="export">${tr("Exportieren", "Export")}</button>
        <button class="secondary small" data-action="import">${tr("Importieren", "Import")}</button>
        <input type="file" accept=".json,application/json" data-change="import-file" hidden>
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
      .join("") : `<div class="card empty">${tr("Noch kein Haushaltsbuch.", "No household yet.")}</div>`}`;
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
    if (d.type === "notice") body = this._renderNotice(d);
    if (d.type === "spending") body = this._renderSpendingForm(d);
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

  async _readImportFile(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
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
    } else if (kind === "import-file") {
      this._readImportFile(el);
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
  :host { --viz-1: #2a78d6; --viz-2: #eb6834; --viz-3: #1baf7a; --viz-4: #eda100; --viz-5: #e87ba4; --viz-other: #9e9d98; }
  :host(.dark) { --viz-1: #3987e5; --viz-2: #d95926; --viz-3: #199e70; --viz-4: #c98500; --viz-5: #d55181; --viz-other: #6e6d68; }
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
