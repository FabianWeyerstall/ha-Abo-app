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

const CERTAINTY = {
  sicher: { label: "sicher", color: "var(--success-color, #43a047)" },
  wahrscheinlich: { label: "wahrscheinlich", color: "var(--warning-color, #ffa000)" },
  unsicher: { label: "unsicher", color: "var(--secondary-text-color, #888)" },
};

const FREQUENCY_PRESETS = [
  { key: "once", label: "einmalig", frequency: "once", interval: 1 },
  { key: "weekly", label: "wöchentlich", frequency: "weekly", interval: 1 },
  { key: "monthly", label: "monatlich", frequency: "monthly", interval: 1 },
  { key: "quarterly", label: "vierteljährlich", frequency: "monthly", interval: 3 },
  { key: "halfyearly", label: "halbjährlich", frequency: "monthly", interval: 6 },
  { key: "yearly", label: "jährlich", frequency: "yearly", interval: 1 },
  { key: "every_n_months", label: "alle X Monate", frequency: "monthly", interval: null },
  { key: "fixed_dates", label: "feste Termine im Jahr", frequency: "fixed_dates", interval: 1 },
  { key: "rolling", label: "gleitend (ab letztem Termin)", frequency: "rolling", interval: null },
  { key: "budget", label: "Budget pro Monat (variable Ausgaben)", frequency: "budget", interval: 1 },
];

const NOTICE_UNITS = { days: "Tage", weeks: "Wochen", months: "Monate" };
const shortDate = (isoDate) => parseIso(isoDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

const unitLabel = (n, unit) => (unit === "weeks" ? (n === 1 ? "Woche" : "Wochen") : n === 1 ? "Monat" : "Monate");

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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
  return preset === "monthly" || preset === "weekly" || preset === "rolling" || preset === "budget";
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
  [2, "alles, was nicht jeden Monat kommt"],
  [3, "ab vierteljährlich"],
  [6, "ab halbjährlich"],
  [12, "nur jährlich und einmalig"],
  [999, "nur einmalige Posten"],
];

function scheduleLabel(item) {
  const s = item.schedule || {};
  const preset = presetOf(s);
  if (preset === "every_n_months") return `alle ${s.interval} Monate`;
  if (preset === "rolling") {
    if (item.learned_days) return `gleitend, gelernt alle ~${item.learned_days} Tage`;
    return `gleitend, alle ${s.interval || 1} ${unitLabel(s.interval || 1, s.unit)}`;
  }
  if (preset === "budget") return "Budget pro Monat";
  if (preset === "weekly" && s.interval > 1) return `alle ${s.interval} Wochen`;
  if (preset === "yearly" && s.interval > 1) return `alle ${s.interval} Jahre`;
  if (preset === "fixed_dates") return (s.dates || []).map((md) => md.split("-").reverse().join(".") + ".").join(" & ");
  return FREQUENCY_PRESETS.find((p) => p.key === preset).label;
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
    this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
    this.shadowRoot.addEventListener("change", (ev) => this._onChange(ev));
    this.shadowRoot.addEventListener("submit", (ev) => this._onSubmit(ev));
    this.shadowRoot.addEventListener("input", (ev) => {
      if (ev.target.name === "item-search") {
        this._search = ev.target.value;
        this._applySearch();
        return;
      }
      if (ev.target.name !== "icon") return;
      const preview = ev.target.closest("label")?.querySelector(".icon-preview");
      if (preview) preview.innerHTML = this._icon(ev.target.value.trim(), 20);
      this._suggestIcons(ev.target);
    });
    this.shadowRoot.addEventListener("focusin", (ev) => {
      if (ev.target.name === "icon") this._suggestIcons(ev.target);
    });
    this.shadowRoot.addEventListener("focusout", (ev) => {
      if (ev.target.name !== "icon") return;
      const box = ev.target.closest(".icon-field")?.querySelector(".icon-suggest");
      if (box && !box.contains(ev.relatedTarget)) setTimeout(() => (box.hidden = true), 250);
    });
    this.shadowRoot.addEventListener("keydown", (ev) => {
      if (ev.target.name !== "icon") return;
      const box = ev.target.closest(".icon-field")?.querySelector(".icon-suggest");
      if (!box || box.hidden) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        box.hidden = true;
      } else if (ev.key === "Enter") {
        const first = box.querySelector("[data-icon]");
        if (first) {
          ev.preventDefault();
          this._pickIcon(ev.target, first.dataset.icon);
        }
      }
    });
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
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
      this._error = err.message || String(err);
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
    }
  }

  async _run(action) {
    try {
      await action();
      this._dialog = null;
      await this._reload();
    } catch (err) {
      this._error = err.message || String(err);
      this._render();
    }
  }

  // -------------------------------------------------------------- formatting

  _money(value, signed = false) {
    const currency = this._state?.currency || "EUR";
    const text = new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Math.abs(value));
    if (!signed) return value < 0 ? `−${text}` : text;
    return value < 0 ? `−${text}` : `+${text}`;
  }

  _dateLabel(isoDate) {
    const d = parseIso(isoDate);
    const diff = Math.round((d - today()) / 86400000);
    const base = `${WEEKDAYS[(d.getDay() + 6) % 7]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
    if (diff === 0) return `Heute · ${base}`;
    if (diff === 1) return `Morgen · ${base}`;
    return base;
  }

  _icon(icon, size = 24) {
    if (!icon) return `<span class="icon-fallback" style="--size:${size}px"></span>`;
    if (icon.startsWith("mdi:") || icon.includes(":")) return `<ha-icon icon="${esc(icon)}" style="--mdc-icon-size:${size}px"></ha-icon>`;
    return `<span class="emoji" style="font-size:${size - 4}px">${esc(icon)}</span>`;
  }

  _chip(certainty) {
    const c = CERTAINTY[certainty] || CERTAINTY.unsicher;
    return `<span class="chip" style="--chip:${c.color}">${c.label}</span>`;
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
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="toolbar">
        <ha-menu-button></ha-menu-button>
        <div class="title">Haushaltsbuch</div>
        ${s ? this._renderScopeSelect() : ""}
      </div>
      ${s ? this._renderTabs() : ""}
      <div class="content">
        ${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}
        ${!this._loaded ? `<div class="empty">Lade …</div>` : s ? this._renderView() : ""}
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
    const options = [{ id: "me", name: "Meine Posten" }, ...this._state.households.map((h) => ({ id: h.id, name: `Haushalt: ${h.name}` }))];
    return `<select class="scope" data-change="scope" aria-label="Ansicht">
      ${options.map((o) => `<option value="${esc(o.id)}" ${o.id === this._scope ? "selected" : ""}>${esc(o.name)}</option>`).join("")}
    </select>`;
  }

  _renderTabs() {
    const tabs = [
      ["timeline", "Zeitleiste", "mdi:timeline-clock-outline"],
      ["calendar", "Kalender", "mdi:calendar-month"],
      ["items", "Posten", "mdi:format-list-bulleted"],
      ["months", "Monate", "mdi:chart-bar"],
      ["households", "Haushalt", "mdi:home-account"],
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
        <div class="label">${this._isHousehold() ? "Haushaltskonto" : "Mein Kontostand"}</div>
        <div class="big">${known ? this._money(b.balance) : "—"}</div>
        <div class="sub">${known ? `Stand ${parseIso(b.balance_date).toLocaleDateString("de-DE")}` : "Noch kein Kontostand hinterlegt"}</div>
      </div>
      ${known && last && last.balance_likely !== null ? `<div>
        <div class="label">Am ${parseIso(last.date).toLocaleDateString("de-DE")}</div>
        <div class="big ${last.balance_likely < 0 ? "neg" : ""}">${this._money(last.balance_likely)}</div>
        <div class="sub">nur sichere Posten: ${this._money(last.balance_sure)}</div>
      </div>` : ""}
      <button class="secondary" data-action="edit-balance">Kontostand setzen</button>
    </div>`;
  }

  _renderEntry(e, { showBalance = false, confirm = false, special = null } = {}) {
    const owner = this._isHousehold() ? `<span class="owner">${esc(e.owner_name)}</span>` : "";
    const status = e.budget ? `<span class="chip budget">Budget</span>` : e.status === "booked" ? `<span class="chip booked">gebucht</span>` : e.status === "skipped" ? `<span class="chip skipped">ausgefallen</span>` : e.planned ? `<span class="chip planned">Termin</span>` : this._chip(e.certainty);
    return `<div class="entry ${e.status === "skipped" ? "skipped-row" : ""}" data-action="${e.budget ? "edit-item" : "open-entry"}" data-item="${esc(e.item_id)}" data-due="${esc(e.due_date)}" data-amount="${Math.abs(e.amount)}" data-date="${esc(e.date)}" data-status="${esc(e.status ?? "")}" data-planned="${e.planned ? "1" : ""}">
      <div class="entry-icon">${this._icon(e.icon)}</div>
      <div class="entry-main">
        <div class="entry-name">${esc(e.name)}</div>
        <div class="entry-meta">${special ? `<span class="chip special">★ ${esc(scheduleLabel(special))}</span> ` : ""}${esc(e.category)} ${owner} ${status}</div>
      </div>
      <div class="entry-amount ${e.amount < 0 ? "neg" : "pos"}">${this._money(e.amount, true)}</div>
      ${confirm ? `<div class="entry-actions">
        <button class="small" data-action="quick-confirm" data-status="booked" data-item="${esc(e.item_id)}" data-due="${esc(e.due_date)}">gebucht</button>
        <button class="small secondary" data-action="quick-confirm" data-status="skipped" data-item="${esc(e.item_id)}" data-due="${esc(e.due_date)}">ausgefallen</button>
      </div>` : ""}
    </div>`;
  }

  _renderTimeline() {
    const days = (this._forecast?.days || []).filter((d) => d.entries.length);
    const ranges = [7, 30, 90];
    const pending = this._pending.length
      ? `<div class="card">
          <h3>Zu bestätigen</h3>
          <div class="row-between">
            <p class="hint">Diese Buchungen waren in den letzten drei Wochen fällig. Bestätigen hilft der App, die Sicherheit besser einzuschätzen.</p>
            ${this._pending.length > 1 ? `<button class="small" data-action="confirm-all">Alle ${this._pending.length} gebucht</button>` : ""}
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
            </div>`
          )
          .join("")
      : `<div class="empty">In diesem Zeitraum ist nichts fällig.${this._state.items.length ? "" : " Lege unter „Posten“ deine ersten Einträge an."}</div>`;
    const deadlines = this._scopeItems()
      .filter((i) => i.contract_info && !i.contract_info.ended && i.contract_info.days_left <= 60)
      .sort((a, b) => a.contract_info.cancel_by.localeCompare(b.contract_info.cancel_by));
    const deadlineCard = deadlines.length
      ? `<div class="card">
          <h3>Kündigungsfristen</h3>
          <p class="hint">Verträge, die du in den nächsten 60 Tagen kündigen müsstest, wenn du sie loswerden willst.</p>
          ${deadlines
            .map((i) => {
              const c = i.contract_info;
              return `<div class="entry" data-action="edit-item" data-item="${esc(i.id)}">
                <div class="entry-icon">${this._icon(i.icon)}</div>
                <div class="entry-main">
                  <div class="entry-name">${esc(i.name)}</div>
                  <div class="entry-meta">Vertragsende ${shortDate(c.end)}${c.renews ? ", verlängert sich sonst" : ""}</div>
                </div>
                <div class="deadline ${c.days_left <= 14 ? "urgent" : ""}">bis ${shortDate(c.cancel_by)}<small>${c.days_left === 0 ? "heute" : `noch ${c.days_left} Tage`}</small></div>
              </div>`;
            })
            .join("")}
        </div>`
      : "";
    const budgetMonthly = this._scopeItems()
      .filter((i) => i.schedule?.frequency === "budget" && i.direction === "expense" && (!i.end_date || i.end_date >= iso(today())))
      .reduce((a, i) => a + Number(i.current_amount ?? i.amount), 0);
    return `${pending}${deadlineCard}
      <div class="card">
        <div class="row-between">
          <h3>Die nächsten ${this._range} Tage</h3>
          <div class="segmented">${ranges.map((r) => `<button class="${r === this._range ? "active" : ""}" data-action="range" data-range="${r}">${r} Tage</button>`).join("")}</div>
        </div>
        <p class="hint">Rechts neben jedem Tag steht der erwartete Kontostand mit sicheren und wahrscheinlichen Posten. Unsichere Posten werden gezeigt, aber nicht eingerechnet.${budgetMonthly ? ` Budgets (${this._money(budgetMonthly)} pro Monat) sind gleichmäßig auf die Tage verteilt eingerechnet.` : ""}</p>
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
        <button class="icon-button" data-action="month" data-delta="-1" aria-label="Vorheriger Monat">‹</button>
        <h3>${MONTHS[month.getMonth()]} ${month.getFullYear()}</h3>
        <button class="icon-button" data-action="month" data-delta="1" aria-label="Nächster Monat">›</button>
      </div>
      <div class="cal-grid">${WEEKDAYS.map((w) => `<div class="cal-head">${w}</div>`).join("")}${cells.join("")}</div>
    </div>
    ${!selected ? this._renderMonthList() : ""}
    ${selected ? `<div class="card"><div class="row-between"><h3>${this._dateLabel(this._selectedDay)}</h3><button class="secondary small" data-action="select-day" data-day="">ganzer Monat</button></div>
      ${selected.entries.length ? selected.entries.map((e) => this._renderEntry(e, { special: this._specialOf(e) })).join("") : `<div class="empty">Nichts fällig.</div>`}
      ${selected.balance_likely !== null ? `<p class="hint">Erwarteter Kontostand am Ende des Tages: ${this._money(selected.balance_likely)} (nur sichere: ${this._money(selected.balance_sure)})</p>` : ""}
    </div>` : ""}`;
  }

  _renderMonthList() {
    const days = (this._calendar?.days || []).filter((d) => d.entries.some((e) => e.status !== "skipped"));
    const t = iso(today());
    return `<div class="card">
      <h3>Alle Buchungen im ${MONTHS[this._month.getMonth()]}</h3>
      <p class="hint">Tippe oben auf einen Tag, um nur diesen Tag zu sehen.</p>
      ${days.length
        ? days
            .map(
              (d) => `<div class="day ${d.date < t ? "past" : ""}">
                <div class="day-head"><span>${this._dateLabel(d.date)}</span>${d.balance_likely !== null && d.date >= t ? `<span class="day-balance ${d.balance_likely < 0 ? "neg" : ""}">${this._money(d.balance_likely)}</span>` : ""}</div>
                ${d.entries.map((e) => this._renderEntry(e, { special: this._specialOf(e) })).join("")}
              </div>`
            )
            .join("")
        : `<div class="empty">In diesem Monat ist nichts fällig.</div>`}
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
        <h3>${this._isHousehold() ? "Posten im Haushalt" : "Meine Posten"}</h3>
        <button data-action="new-item">+ Neuer Posten</button>
      </div>
      <div class="totals">
        <div><div class="label">Einnahmen pro Monat</div><div class="big pos">${this._money(monthlyIn)}</div></div>
        <div><div class="label">Ausgaben pro Monat</div><div class="big neg">${this._money(monthlyOut)}</div></div>
        <div><div class="label">Ausgaben pro Jahr</div><div class="big">${this._money(monthlyOut * 12)}</div></div>
      </div>
      <p class="hint">Wiederkehrende Posten auf einen Monat umgerechnet, einmalige Posten zählen hier nicht mit.</p>
      ${this._isHousehold() ? "" : `<div class="row-actions">
        <button class="secondary small" data-action="export">Exportieren</button>
        <button class="secondary small" data-action="import">Importieren</button>
        <input type="file" accept=".json,application/json" data-change="import-file" hidden>
      </div>`}
      ${items.length > 5 ? `<input class="search" type="search" name="item-search" placeholder="Posten suchen …" aria-label="Posten suchen" value="${esc(this._search || "")}">` : ""}
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
                <div class="entry-meta">${esc(scheduleLabel(i))} · ab ${parseIso(i.start_date).toLocaleDateString("de-DE")}${i.end_date ? ` bis ${parseIso(i.end_date).toLocaleDateString("de-DE")}` : ""}
                  ${i.household_id && !this._isHousehold() ? `<span class="chip shared">${esc(households[i.household_id] || "Haushalt")}</span>` : ""}
                  ${!i.editable ? `<span class="owner">${esc(i.owner_name)}</span>` : ""}
                  ${i.contract_info && !i.contract_info.ended ? `<span class="chip contract ${i.contract_info.days_left <= 30 ? "urgent" : ""}">kündbar bis ${shortDate(i.contract_info.cancel_by)}</span>` : ""}
                  ${i.contract_info?.ended ? `<span class="chip skipped">Vertrag beendet</span>` : ""}</div>
              </div>
              <div class="entry-amount ${i.direction === "expense" ? "neg" : "pos"}">${this._money(i.direction === "expense" ? -(i.current_amount ?? i.amount) : i.current_amount ?? i.amount, true)}${(i.price_changes || []).some((c) => c.from > iso(today())) ? `<small class="price-note">ab ${shortDate(i.price_changes.find((c) => c.from > iso(today())).from)}: ${this._money(i.price_changes.find((c) => c.from > iso(today())).amount)}</small>` : ""}</div>
            </div>`
          )
          .join("")}</div>`
      )
      .join("") : `<div class="card empty">Noch keine Posten. Tippe auf „Neuer Posten“ und wähle eine Vorlage wie GEZ, Gehalt oder Räderwechsel.</div>`}`;
  }

  _renderMonths() {
    const rows = this._summary || [];
    const itemsById = Object.fromEntries(this._state.items.map((i) => [i.id, i]));
    const max = Math.max(1, ...rows.map((r) => Math.max(r.income + r.uncertain_income, r.expense + r.uncertain_expense)));
    const barLine = (sure, unsure, cls) => {
      const label = [sure ? this._money(sure) : "", unsure ? `+ ${this._money(unsure)} unsicher` : ""].filter(Boolean).join(" ");
      return `<div class="bar-line"><span class="bar ${cls}" style="width:${(sure / max) * 100}%"></span><span class="bar ${cls} light" style="width:${(unsure / max) * 100}%"></span>${label ? `<span class="bar-value">${label}</span>` : ""}</div>`;
    };
    return `<div class="card">
      <h3>Monatsübersicht</h3>
      <p class="hint">Was in welchem Monat tatsächlich gebucht wird. Sichere und wahrscheinliche Posten als volle Balken, unsichere als heller Zusatz. Tippe auf einen Monat für die einzelnen Buchungen.</p>
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
                <div class="month-name">${MONTHS[m - 1].slice(0, 3)} ${String(y).slice(2)}</div>
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
                ${special.length ? `<div class="month-section special">★ Sonderposten diesen Monat <b>${this._money(specialSum, true)}</b></div>${special.map(entryRow).join("")}` : ""}
                ${regular.length ? `<div class="month-section">Laufende Posten (jeden Monat)</div>${regular.map(entryRow).join("")}` : ""}` : `<div class="empty">Keine Buchungen in diesem Monat.</div>`}</div>` : ""}
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
      <span class="special-pill inline">★ Sonderposten</span>
      <select data-change="special-months" aria-label="Sonderposten ab Turnus">
        ${SPECIAL_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === minMonths ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <label class="inline-amount">ab<input type="number" min="0" step="1" inputmode="decimal" data-change="special-amount" value="${st.special_min_amount || 0}" aria-label="Sonderposten ab Betrag"> ${esc(this._state.currency === "EUR" ? "€" : this._state.currency)}</label>
    </div>`;
  }

  _saveSpecialSettings(patch) {
    const st = { special_min_months: 2, special_min_amount: 0, ...(this._state.user.settings || {}), ...patch };
    this._state.user.settings = st;
    this._render();
    this._ws("settings", { settings: st }).catch((err) => {
      this._error = err.message || String(err);
      this._render();
    });
  }

  _renderCategoryTotals(rows) {
    const totals = {};
    for (const r of rows) {
      for (const e of r.entries || []) {
        if (e.amount >= 0 || e.certainty === "unsicher") continue;
        const t = (totals[e.category || "Sonstiges"] ||= { sum: 0, items: new Set() });
        t.sum += -e.amount;
        t.items.add(e.name);
      }
    }
    const list = Object.entries(totals).sort((a, b) => b[1].sum - a[1].sum);
    if (!list.length) return "";
    const total = list.reduce((a, [, t]) => a + t.sum, 0);
    const max = list[0][1].sum;
    return `<div class="card">
      <h3>Ausgaben nach Kategorie</h3>
      <p class="hint">Summe der nächsten ${rows.length} Monate (sichere und wahrscheinliche Ausgaben, inklusive Budgets): <b>${this._money(total)}</b>, im Schnitt ${this._money(total / rows.length)} pro Monat.</p>
      ${list
        .map(
          ([cat, t]) => `<div class="cat-row">
            <div class="cat-name">${esc(cat)}<small>${esc([...t.items].slice(0, 4).join(", "))}${t.items.size > 4 ? " …" : ""}</small></div>
            <div class="cat-bar"><span style="width:${(t.sum / max) * 100}%"></span></div>
            <div class="cat-sum">${this._money(t.sum)}<small>${Math.round((t.sum / total) * 100)} %</small></div>
          </div>`
        )
        .join("")}
    </div>`;
  }

  _renderHouseholds() {
    const hs = this._state.households;
    return `<div class="card">
      <div class="row-between">
        <h3>Haushaltsbücher</h3>
        <button data-action="new-household">+ Haushalt anlegen</button>
      </div>
      <p class="hint">In einem Haushaltsbuch siehst du die Posten aller Mitglieder zusammen. Deine Posten bleiben privat, bis du sie beim Bearbeiten einem Haushalt zuordnest.</p>
    </div>
    ${hs.length ? hs
      .map(
        (h) => `<div class="card">
          <div class="row-between">
            <h3>${esc(h.name)}</h3>
            <div class="actions">
              ${h.is_creator ? `<button class="secondary" data-action="edit-household" data-id="${esc(h.id)}">Bearbeiten</button>` : `<button class="secondary" data-action="leave-household" data-id="${esc(h.id)}">Verlassen</button>`}
            </div>
          </div>
          <div class="entry-meta">Mitglieder: ${h.member_names.map(esc).join(", ")}</div>
          <label class="switch-row">
            <input type="checkbox" data-change="entities" data-id="${esc(h.id)}" ${h.entities ? "checked" : ""}>
            <span>Als Kalender und Sensoren in Home Assistant anlegen<br><small>Diese Entitäten können alle Home-Assistant-Nutzer sehen.</small></span>
          </label>
        </div>`
      )
      .join("") : `<div class="card empty">Noch kein Haushaltsbuch.</div>`}`;
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
      ? `<div class="templates">${this._state.templates
          .map((t, idx) => `<button type="button" class="template" data-action="template" data-index="${idx}">${this._icon(t.icon, 18)}<span>${esc(t.name)}</span></button>`)
          .join("")}</div>`
      : "";
    const dates = (item.schedule?.dates || []).map((md) => {
      const [m, day] = md.split("-");
      return `${day}.${m}.`;
    });
    return `<form data-form="item">
      <h2>${readOnly ? esc(item.name) : item.id ? "Posten bearbeiten" : "Neuer Posten"}</h2>
      ${readOnly ? `<p class="hint">Dieser Posten gehört ${esc(item.owner_name)} und kann nur von dort geändert werden.</p>` : ""}
      ${templates}
      <div class="grid">
        <label class="full">Name<input name="name" required maxlength="100" value="${esc(item.name)}" ${dis}></label>
        <label>Art<select name="direction" ${dis}>
          <option value="expense" ${item.direction !== "income" ? "selected" : ""}>Ausgabe</option>
          <option value="income" ${item.direction === "income" ? "selected" : ""}>Einnahme</option>
        </select></label>
        <label>${preset === "budget" ? "Budget pro Monat" : (item.price_changes || []).length ? "Betrag am Anfang" : "Betrag"} (${esc(this._state.currency)})<input name="amount" type="number" step="0.01" min="0" required value="${item.amount ?? ""}" ${dis}></label>
        <label>Kategorie<input name="category" list="categories" required value="${esc(item.category || "")}" ${dis}>
          <datalist id="categories">${this._state.categories.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
        <label class="icon-field">Symbol <span class="icon-preview">${this._icon(item.icon, 20)}</span><input name="icon" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Suchen, z.B. netflix, auto, haus – oder Emoji" value="${esc(item.icon || "")}" ${dis}><div class="icon-suggest" hidden></div></label>
        <label>Turnus<select name="preset" data-change="preset" ${dis}>
          ${FREQUENCY_PRESETS.map((p) => `<option value="${p.key}" ${p.key === preset ? "selected" : ""}>${p.label}</option>`).join("")}
        </select></label>
        ${preset === "every_n_months" ? `<label>Alle wie viele Monate?<input name="interval" type="number" min="1" max="120" value="${item.schedule?.interval || 2}" ${dis}></label>` : ""}
        ${preset === "rolling" ? `<label>Nächster Termin nach<span class="inline-fields"><input name="interval" type="number" min="1" max="120" value="${item.schedule?.interval || 1}" ${dis}><select name="unit" ${dis}>
          <option value="months" ${item.schedule?.unit !== "weeks" ? "selected" : ""}>Monat(en)</option>
          <option value="weeks" ${item.schedule?.unit === "weeks" ? "selected" : ""}>Woche(n)</option>
        </select></span></label>
        <label class="check full"><input type="checkbox" name="learn" ${item.schedule?.learn !== false ? "checked" : ""} ${dis}> Abstand aus bestätigten Terminen lernen${item.learned_days ? ` (zurzeit ~${item.learned_days} Tage)` : ""}</label>
        <p class="hint full">Der nächste Termin richtet sich nach dem letzten. Ab drei bestätigten Terminen rechnet die App mit deinem echten durchschnittlichen Abstand. Tippe in der Zeitleiste auf einen Eintrag, um einen festen Termin einzutragen. Tippe in der Zeitleiste auf einen Eintrag, um einen festen Termin einzutragen. Alle weiteren rücken dann nach.</p>` : ""}
        ${preset === "weekly" ? `<label>Alle wie viele Wochen?<input name="interval" type="number" min="1" max="52" value="${item.schedule?.interval || 1}" ${dis}></label>` : ""}
        ${preset === "budget" ? `<p class="hint full">Für Ausgaben ohne feste Termine, z.B. Lebensmittel oder Freizeit. Das Budget wird gleichmäßig über die Tage des Monats vom erwarteten Kontostand abgezogen und erscheint in der Monatsübersicht, aber nicht als einzelne Buchung.</p>` : ""}
        ${preset === "fixed_dates" ? `<label class="full">Termine im Jahr (TT.MM., durch Komma getrennt)<input name="dates" placeholder="01.04., 15.10." value="${esc(dates.join(", "))}" ${dis}></label>` : ""}
        <label>${preset === "once" ? "Datum" : preset === "fixed_dates" || preset === "budget" ? "Gültig ab" : preset === "rolling" ? "Erster Termin" : "Erste Fälligkeit"}<input name="start_date" type="date" required value="${esc(item.start_date || iso(today()))}" ${dis}></label>
        ${preset !== "once" ? `<div class="end-date">
          <label class="check"><input type="checkbox" name="has_end" data-change="has_end" ${hasEnd ? "checked" : ""} ${dis}> Enddatum festlegen</label>
          ${hasEnd ? `<input name="end_date" type="date" aria-label="Enddatum" required value="${esc(item.end_date || "")}" ${dis}>` : ""}
        </div>` : ""}
      </div>
      ${preset !== "once" ? this._renderPriceChanges(item, dis) : ""}
      ${preset !== "once" && preset !== "budget" ? this._renderContractFields(d, dis) : ""}
      <details ${item.amount_variance_pct || item.date_tolerance_days || item.certainty || item.weekend_shift ? "open" : ""}>
        <summary>Schwankung und Sicherheit</summary>
        <div class="grid">
          <label>Betrag schwankt um ± %<input name="amount_variance_pct" type="number" min="0" max="100" step="1" value="${item.amount_variance_pct || 0}" ${dis}></label>
          <label>Datum schwankt um ± Tage<input name="date_tolerance_days" type="number" min="0" max="60" value="${item.date_tolerance_days || 0}" ${dis}></label>
          <label>Sicherheit<select name="certainty" ${dis}>
            <option value="">automatisch</option>
            ${Object.keys(CERTAINTY).map((c) => `<option value="${c}" ${item.certainty === c ? "selected" : ""}>immer ${c}</option>`).join("")}
          </select></label>
          <label>Wochenende/Feiertag<select name="weekend_shift" ${dis}>
            <option value="">automatisch (nächster Bankarbeitstag)</option>
            <option value="next" ${item.weekend_shift === "next" ? "selected" : ""}>nächster Bankarbeitstag</option>
            <option value="previous" ${item.weekend_shift === "previous" ? "selected" : ""}>vorheriger Bankarbeitstag</option>
            <option value="none" ${item.weekend_shift === "none" ? "selected" : ""}>nicht verschieben</option>
          </select></label>
        </div>
      </details>
      <div class="grid">
        ${this._state.households.length ? `<label class="full">Sichtbar für<select name="household_id" ${dis}>
          <option value="">nur mich</option>
          ${this._state.households.map((h) => `<option value="${esc(h.id)}" ${item.household_id === h.id ? "selected" : ""}>Haushalt ${esc(h.name)}</option>`).join("")}
        </select></label>` : ""}
        <label class="full">Notiz<textarea name="note" rows="2" maxlength="1000" ${dis}>${esc(item.note || "")}</textarea></label>
      </div>
      ${this._error ? `<div class="error">${esc(this._error)}</div>` : ""}
      <div class="dialog-actions">
        ${item.id && item.editable ? `<button type="button" class="danger" data-action="delete-item">Löschen</button>` : "<span></span>"}
        <div>
          <button type="button" class="secondary" data-action="close">${readOnly ? "Schließen" : "Abbrechen"}</button>
          ${readOnly ? "" : `<button type="submit">Speichern</button>`}
        </div>
      </div>
    </form>`;
  }

  _renderPriceChanges(item, dis) {
    const changes = item.price_changes || [];
    return `<details ${changes.length ? "open" : ""}>
      <summary>Preisänderungen${changes.length ? ` (${changes.length})` : ""}</summary>
      <p class="hint">Wird es teurer oder günstiger, trag hier ein, ab wann der neue Betrag gilt. Frühere Buchungen behalten ihren alten Betrag.</p>
      ${changes
        .map(
          (c, idx) => `<div class="price-row">
            <label>ab<input name="pc_from" type="date" required value="${esc(c.from || "")}" ${dis}></label>
            <label>neuer Betrag<input name="pc_amount" type="number" step="0.01" min="0" required value="${c.amount ?? ""}" ${dis}></label>
            ${dis ? "" : `<button type="button" class="danger small" data-action="price-remove" data-index="${idx}" aria-label="Preisänderung entfernen">✕</button>`}
          </div>`
        )
        .join("")}
      ${dis ? "" : `<button type="button" class="secondary small" data-action="price-add">+ Preisänderung</button>`}
    </details>`;
  }

  _renderContractFields(d, dis) {
    const item = d.item;
    const c = item.contract || {};
    const hasContract = d.hasContract ?? Boolean(c.end);
    const info = item.contract_info;
    return `<details ${hasContract ? "open" : ""}>
      <summary>Vertrag und Kündigung${info && !info.ended ? ` · kündbar bis ${shortDate(info.cancel_by)}` : ""}</summary>
      <label class="check"><input type="checkbox" name="has_contract" data-change="has_contract" ${hasContract ? "checked" : ""} ${dis}> Vertragslaufzeit erfassen</label>
      ${hasContract ? `<div class="grid">
        <label>Vertrag läuft bis<input name="contract_end" type="date" required value="${esc(c.end || "")}" ${dis}></label>
        <label>Kündigungsfrist<span class="inline-fields"><input name="notice" type="number" min="0" max="365" value="${c.notice ?? 1}" ${dis}><select name="notice_unit" ${dis}>
          ${Object.entries(NOTICE_UNITS).map(([k, v]) => `<option value="${k}" ${(c.notice_unit || "months") === k ? "selected" : ""}>${v}</option>`).join("")}
        </select></span></label>
        <label>Verlängert sich danach um<span class="inline-fields"><input name="renew" type="number" min="0" max="365" value="${c.renew ?? c.renew_months ?? 12}" ${dis}><select name="renew_unit" ${dis}>
          ${Object.entries(NOTICE_UNITS).map(([k, v]) => `<option value="${k}" ${(c.renew_unit || "months") === k ? "selected" : ""}>${v}</option>`).join("")}
        </select></span></label>
        <p class="hint full">0 heißt: Der Vertrag endet und verlängert sich nicht. ${info ? (info.ended ? `Der Vertrag ist am ${shortDate(info.end)} ausgelaufen.` : `Nächstes Vertragsende ${shortDate(info.end)}, kündigen spätestens am <b>${shortDate(info.cancel_by)}</b>.`) : ""}</p>
      </div>` : ""}
    </details>`;
  }

  _renderImportForm(d) {
    const own = this._state.items.filter((i) => i.owner === this._state.user.id).length;
    return `<form data-form="import">
      <h2>Posten importieren</h2>
      <p>Die Datei „${esc(d.fileName)}“ enthält <b>${d.data.items.length} Posten</b>${d.data.exported_at ? `, exportiert am ${parseIso(d.data.exported_at).toLocaleDateString("de-DE")}` : ""}.</p>
      <label class="check option"><input type="radio" name="mode" value="add" checked> Hinzufügen: Posten, die es schon gibt (gleicher Name, Betrag und Startdatum), werden übersprungen.</label>
      <label class="check option"><input type="radio" name="mode" value="replace"> Ersetzen: deine ${own} eigenen Posten werden vorher gelöscht, auch der Kontostand wird übernommen.</label>
      <p class="hint">Importierte Posten sind zunächst privat. Bestätigte Buchungen und festgelegte Termine werden mit übernommen.</p>
      <div class="dialog-actions"><span></span><div>
        <button type="button" class="secondary" data-action="close">Abbrechen</button>
        <button type="submit">Importieren</button>
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
      this._error = err.message || String(err);
      this._render();
    }
  }

  async _readImportFile(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== "haushaltsbuch" || !Array.isArray(data.items)) throw new Error("Das ist keine Export-Datei des Haushaltsbuchs.");
      this._error = null;
      this._dialog = { type: "import", data, fileName: file.name };
    } catch (err) {
      this._error = err instanceof SyntaxError ? "Die Datei ist kein gültiges JSON." : err.message;
    }
    this._render();
  }

  _renderBalanceForm() {
    const b = this._scopeBalance();
    return `<form data-form="balance">
      <h2>${this._isHousehold() ? "Haushaltskonto" : "Kontostand"} setzen</h2>
      <p class="hint">Trage den Stand aus deiner Banking-App ein. Alle Buchungen bis einschließlich zu diesem Datum gelten als enthalten.</p>
      <div class="grid">
        <label>Kontostand (${esc(this._state.currency)})<input name="balance" type="number" step="0.01" required value="${b.balance ?? ""}"></label>
        <label>Stand vom<input name="balance_date" type="date" required value="${iso(today())}"></label>
      </div>
      <div class="dialog-actions"><span></span><div>
        <button type="button" class="secondary" data-action="close">Abbrechen</button>
        <button type="submit">Speichern</button>
      </div></div>
    </form>`;
  }

  _renderConfirmForm(d) {
    const item = this._state.items.find((i) => i.id === d.item_id);
    const rolling = item?.schedule?.frequency === "rolling";
    const future = d.date > iso(today());
    const booked = d.status === "booked";
    const hint = booked
      ? "Diese Buchung ist als gebucht bestätigt."
      : future
        ? `Geplant für ${parseIso(d.date).toLocaleDateString("de-DE")}. Hast du schon einen festen Termin? Dann Datum und Betrag anpassen und als Termin festlegen.${rolling ? " Alle weiteren Termine rücken danach automatisch nach." : " Das verschiebt nur diese eine Buchung."}`
        : `Fällig am ${parseIso(d.date).toLocaleDateString("de-DE")}. Ist die Buchung so auf dem Konto angekommen?`;
    return `<form data-form="confirm">
      <h2>${esc(item?.name || "Buchung")}</h2>
      <p class="hint">${hint}</p>
      <div class="grid">
        <label>Datum<input name="actual_date" type="date" required value="${esc(d.date)}"></label>
        <label>Betrag<input name="actual_amount" type="number" step="0.01" min="0" value="${esc(d.amount)}"></label>
      </div>
      <div class="dialog-actions">
        <div>
          ${item ? `<button type="button" class="secondary" data-action="edit-item" data-item="${esc(item.id)}">Posten öffnen</button>` : ""}
          ${d.status ? `<button type="button" class="secondary" data-action="reset-confirm">Bestätigung zurücksetzen</button>` : ""}
          ${d.planned && !booked ? `<button type="button" class="secondary" data-action="plan-clear">Termin entfernen</button>` : ""}
        </div>
        <div>
          ${booked ? "" : `<button type="button" class="${future ? "" : "secondary"}" data-action="plan-save">${d.planned ? "Termin ändern" : "Als Termin festlegen"}</button>`}
          <button type="button" class="secondary" data-action="confirm-skip">Ausgefallen</button>
          <button type="submit" class="${future && !booked ? "secondary" : ""}">Gebucht</button>
        </div>
      </div>
    </form>`;
  }

  _renderHouseholdForm(d) {
    const h = d.household || { name: "", members: [this._state.user.id] };
    return `<form data-form="household">
      <h2>${h.id ? "Haushalt bearbeiten" : "Haushalt anlegen"}</h2>
      <div class="grid">
        <label class="full">Name<input name="name" required maxlength="60" value="${esc(h.name)}" placeholder="z.B. Familie"></label>
      </div>
      <div class="members">
        <div class="label">Mitglieder</div>
        ${this._state.users
          .map(
            (u) => `<label class="check"><input type="checkbox" name="members" value="${esc(u.id)}" ${h.members.includes(u.id) ? "checked" : ""} ${u.id === this._state.user.id ? "disabled checked" : ""}> ${esc(u.name)}</label>`
          )
          .join("")}
      </div>
      <div class="dialog-actions">
        ${h.id ? `<button type="button" class="danger" data-action="delete-household">Löschen</button>` : "<span></span>"}
        <div>
          <button type="button" class="secondary" data-action="close">Abbrechen</button>
          <button type="submit">Speichern</button>
        </div>
      </div>
    </form>`;
  }

  // ---------------------------------------------------------------- events

  _readItemForm(form) {
    const f = new FormData(form);
    const preset = FREQUENCY_PRESETS.find((p) => p.key === f.get("preset"));
    const schedule = { frequency: preset.frequency, interval: preset.interval || Number(f.get("interval")) || 1, dates: [] };
    if (preset.key === "rolling") {
      schedule.unit = f.get("unit") || "months";
      schedule.learn = f.get("learn") === "on";
    }
    const froms = f.getAll("pc_from");
    const amounts = f.getAll("pc_amount");
    const price_changes = froms.map((from, i) => ({ from, amount: amounts[i] }));
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
      amount: f.get("amount"),
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
      const { editable, owner_name, owner, current_amount, contract_info, learned_days, ...payload } = item;
      this._run(() => this._ws("item/save", { item: payload }));
    } else if (kind === "balance") {
      const f = new FormData(form);
      this._run(() => this._ws("balance", { scope: this._scope, balance: Number(f.get("balance")), balance_date: f.get("balance_date") }));
    } else if (kind === "confirm") {
      const f = new FormData(form);
      const d = this._dialog;
      this._run(() =>
        this._ws("confirm", { item_id: d.item_id, due_date: d.due, status: "booked", actual_date: f.get("actual_date") || null, actual_amount: f.get("actual_amount") === "" ? null : Number(f.get("actual_amount")) })
      );
    } else if (kind === "import") {
      const replace = new FormData(form).get("mode") === "replace";
      if (replace && !confirm("Alle deine eigenen Posten werden durch den Import ersetzt. Fortfahren?")) return;
      const data = this._dialog.data;
      this._run(async () => {
        const r = await this._ws("import", { data, replace });
        setTimeout(() => {
          this._dialog = { type: "notice", title: "Import abgeschlossen", text: `${r.added} Posten importiert${r.skipped ? `, ${r.skipped} schon vorhanden und übersprungen` : ""}.` };
          this._render();
        });
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

  async _suggestIcons(input) {
    const box = input.closest(".icon-field")?.querySelector(".icon-suggest");
    if (!box) return;
    const query = input.value;
    // Emoji or other non-MDI text: no suggestions.
    if (!/^[a-z0-9:\- ]+$/i.test(query.trim())) {
      box.hidden = true;
      return;
    }
    const list = await loadIconList();
    if (input.value !== query || this.shadowRoot.activeElement !== input) return;
    const matches = searchIcons(list, query);
    if (!matches.length || (matches.length === 1 && matches[0] === query.trim())) {
      box.hidden = true;
      return;
    }
    box.innerHTML = matches
      .map((icon) => `<button type="button" data-action="pick-icon" data-icon="${esc(icon)}" title="${esc(icon)}">${this._icon(icon, 22)}<span>${esc(icon.slice(4))}</span></button>`)
      .join("");
    box.hidden = false;
  }

  _pickIcon(input, icon) {
    input.value = icon;
    const field = input.closest(".icon-field");
    const preview = field?.querySelector(".icon-preview");
    if (preview) preview.innerHTML = this._icon(icon, 20);
    const box = field?.querySelector(".icon-suggest");
    if (box) box.hidden = true;
  }

  _onClick(ev) {
    const target = ev.target.closest("[data-action]");
    if (!target) return;
    const a = target.dataset.action;
    if (a === "pick-icon") {
      ev.preventDefault();
      const input = target.closest(".icon-field")?.querySelector('input[name="icon"]');
      if (input) this._pickIcon(input, target.dataset.icon);
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
        const t = this._state.templates[Number(target.dataset.index)];
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
        if (confirm(`„${this._dialog.item.name}“ wirklich löschen?`)) this._run(() => this._ws("item/delete", { item_id: this._dialog.item.id }));
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
        const amount = f.get("actual_amount");
        this._run(() => this._ws("plan", { item_id: this._dialog.item_id, due_date: this._dialog.due, date: f.get("actual_date"), amount: amount === "" ? null : Number(amount) }));
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
      case "new-household":
        this._dialog = { type: "household", household: null };
        this._render();
        break;
      case "edit-household":
        this._dialog = { type: "household", household: this._state.households.find((h) => h.id === target.dataset.id) };
        this._render();
        break;
      case "delete-household":
        if (confirm("Haushalt löschen? Die Posten bleiben bei ihren Besitzern erhalten und werden wieder privat.")) this._run(() => this._ws("household/delete", { household_id: this._dialog.household.id }));
        break;
      case "leave-household":
        if (confirm("Haushalt verlassen? Deine Posten darin werden wieder privat.")) this._run(() => this._ws("household/leave", { household_id: target.dataset.id }));
        break;
      default:
        break;
    }
  }
}

const STYLES = `
  :host { display: block; min-height: 100vh; background: var(--primary-background-color); color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  * { box-sizing: border-box; }
  .toolbar { display: flex; align-items: center; gap: 8px; height: var(--header-height, 56px); padding: 0 12px; background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff); }
  .title { flex: 1; font-size: 20px; }
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
  label.check.option input { margin-top: 3px; }
  details { margin: 8px 0; }
  summary { cursor: pointer; font-size: 14px; color: var(--primary-color); }
  .templates { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; }
  .template { display: flex; align-items: center; gap: 4px; background: var(--secondary-background-color); color: var(--primary-text-color); white-space: nowrap; font-size: 13px; padding: 6px 10px; border-radius: 16px; }
  .icon-preview { display: inline-flex; vertical-align: middle; color: var(--primary-color); }
  .icon-field { position: relative; }
  .icon-suggest { position: absolute; top: 100%; left: 0; right: 0; z-index: 5; max-height: 240px; overflow-y: auto; background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); padding: 4px; }
  .icon-suggest[hidden] { display: none; }
  .icon-suggest button { display: flex; align-items: center; gap: 10px; width: 100%; background: none; color: var(--primary-text-color); text-align: left; padding: 6px 8px; border-radius: 6px; font-size: 14px; font-weight: normal; }
  .icon-suggest button:hover, .icon-suggest button:focus { background: var(--secondary-background-color); }
  .icon-suggest ha-icon { color: var(--primary-color); flex-shrink: 0; }
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
