# Household Budget (Haushaltsbuch) for Home Assistant

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?logo=homeassistantcommunitystore&logoColor=white)](https://hacs.xyz)
[![Release](https://img.shields.io/github/v/release/FabianWeyerstall/ha-haushaltsbuch?label=Version)](https://github.com/FabianWeyerstall/ha-haushaltsbuch/releases)
[![Checks](https://img.shields.io/github/actions/workflow/status/FabianWeyerstall/ha-haushaltsbuch/validate.yml?branch=main&label=Checks)](https://github.com/FabianWeyerstall/ha-haushaltsbuch/actions/workflows/validate.yml)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2025.1%2B-18BCF2.svg?logo=homeassistant&logoColor=white)](https://www.home-assistant.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

🇩🇪 **Deutsche Version:** [README.md](README.md)

Shows you in Home Assistant when each debit or income is due and how certain it is: subscriptions, contracts, taxes, salary, bonus, solar feed-in or the tyre change twice a year. From that it calculates what your account balance will probably be on every day.

All items are entered by hand. There is no bank connection, and the data stays in your Home Assistant (it is included in your HA backups automatically).

> **Note on language:** The user interface is currently **German only**. This guide names the German labels and explains them in English, e.g. **Posten** (item) or **Zeitleiste** (timeline). Amounts follow the number format from your HA profile, so `39.99` or `39,99` both work.

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/01-zeitleiste.png" alt="Timeline" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/06-kalender.png" alt="Calendar" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/10-monate.png" alt="Monthly overview" width="240">
</p>

**Contents:** [Features](#features) · [Installation](#installation-via-hacs) · [How it works](#how-it-works) · [Guide](#guide) · [Booking buttons](#the-buttons-of-a-booking) · [Shared household](#shared-household-book) · [Good to know](#good-to-know)

## Features

- **Timeline** (*Zeitleiste*) for the next 7, 30 or 90 days with the expected balance for each day
- **Calendar** (*Kalender*) month view with every due date
- **Items** (*Posten*) with name, amount, category, icon and schedule: once, weekly, monthly, quarterly, half-yearly, yearly, every X months, fixed dates per year, or **rolling** (the next date follows the last one, e.g. hairdresser)
- **Certainty level** per booking: *sicher* (certain), *wahrscheinlich* (likely) or *unsicher* (uncertain). It is derived from how much amount and date vary and whether recent bookings were confirmed on time. Can also be fixed per item.
- **Price changes**: a new amount from a given date; earlier bookings keep the old amount
- **Contracts**: term, notice period and automatic renewal. The timeline tells you in time by when you have to cancel.
- **Budgets** for variable spending such as groceries: a monthly amount that is spread evenly across the month
- **Rolling items learn** the real average interval after three confirmed bookings
- **Fix a date** for a single booking. For rolling items, all later dates move along; otherwise only this one booking moves.
- **Confirm** due bookings as *gebucht* (booked, optionally with the real date and amount) or *ausgefallen* (skipped)
- **Weekends and bank holidays**: bookings move to the next business day, salary to the previous one (configurable per item)
- **Monthly overview** with income, expenses and balance for 12 months. **Special items** (*Sonderposten*: anything that does not occur every month, e.g. TV licence, insurance, bonus) are highlighted. Below that, **spending per category**.
- **Search** in items and **confirm all open bookings at once**
- **Templates** for typical items (German defaults: TV licence, electricity, internet, mobile, insurance, car tax, streaming, salary, fuel, tyre change …)
- **Export and import** your own items as a JSON file, e.g. as a backup or to move to another HA instance
- **Incognito mode** that blurs all amounts, e.g. when showing the app to friends
- **Contract notice reminders** as an HA event plus a ready-made blueprint for phone notifications

## Installation via HACS

1. Open HACS → ⋮ (top right) → **Custom repositories**
2. Add `https://github.com/FabianWeyerstall/ha-haushaltsbuch` with type **Integration**
3. Install **Haushaltsbuch** and restart Home Assistant
4. **Settings → Devices & services → Add integration → Haushaltsbuch**
5. **Haushaltsbuch** appears in the sidebar, also in the Home Assistant companion app

## How it works

### Items and bookings

An **item** (*Posten*) is the rule, e.g. "Internet, 39.99, monthly from the 5th". From every item the integration calculates the individual **bookings** (*Buchungen*), i.e. every single debit or income on its day. You only maintain the items. Bookings are created automatically, and you confirm them once they have hit your account.

What you change on the **item** (amount, schedule, category) applies to all bookings. What you change on a **booking** (booked, skipped, fixed date) applies to that one only.

### Balance and forecast

Every now and then you enter your real **balance** (*Kontostand*). From that day on the integration adds or subtracts all upcoming bookings and shows the **expected balance** next to every day. At the top of the timeline there are two values:

- **Am …** (large number): with certain and likely bookings and budgets. This is the realistic expectation.
- **nur sichere Posten** (certain only): counts only what is sure to come. This is the cautious lower bound.

Uncertain bookings are shown but not included.

### The three certainty levels

| Level | Meaning | Automatically when |
|---|---|---|
| **sicher** (green, certain) | arrives on time with exactly this amount | Recent confirmed bookings were on time (± 3 days) with exactly the amount, and the amount does not vary. |
| **wahrscheinlich** (yellow, likely) | very likely, date or amount may differ | New items without confirmations, items with small variance, rolling and one-off items, budgets. |
| **unsicher** (grey, uncertain) | may or may not happen | Amount varies by more than 20 % or date by more than 7 days, one of the last two bookings was skipped, or the item ends within 30 days. |

A new item therefore starts as *likely* and becomes *certain* with on-time confirmations. Under **Schwankung und Sicherheit** (variance and certainty) you can fix the level per item, e.g. a bonus always *uncertain*.

### Confirming makes the app learn

Everything that was due in the last three weeks and is not yet confirmed is listed at the top of the timeline under **Zu bestätigen** (to confirm). Confirming takes seconds and does three things:

1. The certainty level becomes accurate: punctual items become *certain*, unreliable ones *uncertain*.
2. For **rolling** items (hairdresser, fuel) the next date follows the real date. After three confirmed bookings the app learns the real interval.
3. You see at a glance if something expected did not arrive.

### Weekends and holidays

If a booking falls on a weekend or a bank holiday (New Year, Good Friday, Easter Monday, 1 May, 25 and 26 December), it moves to the **next** business day, as banks do with direct debits. The **Gehalt** (salary) template uses the **previous** business day instead. You can change this per item under **Schwankung und Sicherheit → Wochenende/Feiertag**.

## Guide

### 1. Set your balance

Tab **Zeitleiste** → **Kontostand setzen**. Enter the current balance from your banking app. From there the timeline calculates the expected balance day by day. Update it from time to time, e.g. once a month after payday, to keep the forecast accurate.

### 2. Create items

Tab **Posten** → **+ Neuer Posten**.

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/08-neuer-posten.png" alt="New item from a template" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/09-posten-details.png" alt="Contract and variance" width="240">
</p>

1. Tap a **template** (*Vorlage*) at the top. It fills in name, category, icon and schedule.
2. Enter **Betrag** (amount) and **Erste Fälligkeit** (first due date, i.e. the next debit).
3. Check the **Turnus** (schedule):
   - *monatlich, vierteljährlich, halbjährlich, jährlich, alle X Monate* (monthly, quarterly, half-yearly, yearly, every X months): fixed day of the month
   - *feste Termine im Jahr* (fixed dates per year): several dates per year, e.g. tyre change in April and October
   - *gleitend* (rolling): the next date follows the last one, e.g. hairdresser or fuel
   - *einmalig* (once): e.g. a bonus or an invoice
   - *Budget pro Monat* (monthly budget): for spending without fixed dates, e.g. groceries. No single bookings; the budget is spread evenly over the month.
4. Optionally set an **end date** (*Enddatum festlegen*), e.g. when a loan ends.
5. Under **Schwankung und Sicherheit**: amount variance in %, date tolerance, fixed certainty level and weekend behaviour.

The **Kategorie** (category) field opens a list of existing categories; typing filters it. To create a new category, just type it.

For the **Symbol** (icon), just start typing: a list suggests matching MDI icons (English names such as `router`, `car`, `home`). Tap a suggestion or press Enter for the first one. An emoji works too.

- **Betrag** (amount): always positive. Whether it is an expense or income is set by **Art** (*Ausgabe* / *Einnahme*).
- **Sichtbar für** (visible to): *nur mich* (only me) or a shared household (see below).
- **Notiz** (note): free text, e.g. customer number.

### Price change

Open the item → **Preisänderungen** → **+ Preisänderung**, enter date and new amount. From that day the new amount is used, everything before keeps the old one. Please don't simply overwrite the amount of the item, otherwise already confirmed bookings no longer match.

### Contract and notice period

Open the item → **Vertrag und Kündigung** → tick **Vertragslaufzeit erfassen**. Enter the end of the term, the notice period and the renewal period in days, weeks or months (0 = simply ends). The app calculates the next end of term itself.

If the contract has to be cancelled within the next 60 days, it appears in the timeline under **Kündigungsfristen** (notice deadlines) with the date by which the cancellation must arrive.

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/02-zeitleiste-kuendigung.png" alt="Notice deadlines in the timeline" width="260">

### Phone notification for notice deadlines

Every morning at 9:00 the integration checks all contracts. If one has to be cancelled in **30, 7 or 1 day(s)**, it fires the Home Assistant event `haushaltsbuch_kuendigungsfrist`. A ready-made blueprint turns it into a push notification:

1. [Import the blueprint](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FFabianWeyerstall%2Fha-haushaltsbuch%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fhaushaltsbuch%2Fkuendigungsfrist.yaml) (or **Settings → Automations & scenes → Blueprints → Import blueprint** with `https://github.com/FabianWeyerstall/ha-haushaltsbuch/blob/main/blueprints/automation/haushaltsbuch/kuendigungsfrist.yaml`)
2. Open the blueprint, select your phone, save
3. Test: **Developer tools → Actions → "Haushaltsbuch: Kündigungsfristen melden"** with **Alle kommenden** (all upcoming) enabled. You immediately get a notification for every contract cancellable within the next 60 days.

The event contains `name`, `cancel_by`, `contract_end`, `days_left`, `renews`, `amount`, `owner_name` and `household` if you prefer your own automation.

### 3. Reading the timeline

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/01-zeitleiste.png" alt="Timeline top" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/03-zeitleiste-tage.png" alt="Timeline days" width="240">
</p>

- Top: your last balance and the expected balance at the end of the period.
- **Zu bestätigen**: due, still open bookings of the last three weeks. Tick them off with **gebucht** or **ausgefallen**, or all at once with **Alle … gebucht** (shown from two open bookings).
- **Kündigungsfristen**: contracts you would have to cancel soon.
- Below: every day with its bookings. Next to the date is the expected balance at the end of that day. Choose 7, 30 or 90 days at the top.
- The coloured label shows the certainty level. Highlighted in yellow with ★ are **special items**, i.e. bookings that do not occur every month.

### The buttons of a booking

Tapping a booking in the timeline or calendar opens this dialog. It always affects **only this one booking**. At the top you can adjust **Datum** (date) and **Betrag** (amount) before pressing a button.

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/04-buchung-bestaetigen.png" alt="Confirm a due booking" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/05-termin-festlegen.png" alt="Fix the date of an upcoming booking" width="240">
</p>

| Button | Use it when | What happens |
|---|---|---|
| **Gebucht** (booked) | The booking has arrived on your account. | Saved as booked with the entered date and amount. Punctual bookings make the item *certain* over time. For rolling items the next interval starts from this date and the app learns the real interval. |
| **Ausgefallen** (skipped) | The booking does not happen this time, e.g. skipped haircut, cancelled bonus. | It stays crossed out in the timeline and is hidden in the calendar. It no longer counts towards the balance or monthly totals. The item stays, and the **next booking comes as usual**. The skipped one is not carried over. The next one or two bookings of this item count as *uncertain*. |
| **Als Termin festlegen** (fix date) | For upcoming bookings when you already know the exact day or amount. | The booking is fixed to that date and amount and gets the label *Termin*. For **rolling** items all later dates move along; otherwise only this booking moves. Afterwards the button reads **Termin ändern** (change), plus **Termin entfernen** (remove). |
| **Posten öffnen** (open item) | Edit the whole item. | Opens the item form. Changes there apply to **all** bookings. |
| **Bestätigung zurücksetzen** (reset) | You pressed booked or skipped by mistake. | Only shown on confirmed bookings; makes the booking open again. |

**Booking just arrives later?** Don't press *Ausgefallen*. Leave it open and press *Gebucht* once it arrives, with the real date in the date field. If you already know the new date, use **Als Termin festlegen**.

### Example: fuel

Fuel is irregular, so use **rolling** and **one item per car**: choose the **Tanken** template (rolling, every 2 weeks, amount varies 20 %), rename it, enter a typical amount, adjust the interval, and confirm every refuel with the real date and amount. After three confirmations the app learns your real interval. If you don't want to track it individually, use a **monthly budget** instead.

### 4. Calendar

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/06-kalender.png" alt="Calendar" width="260">

The month view shows the icons of the bookings and the daily total. Without a selection, all bookings of the month are listed below. Tap a day to see only that day; **ganzer Monat** returns to the month list. Skipped bookings are not shown.

### 5. Items

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/07-posten.png" alt="Item list" width="260">

All items grouped by category, with monthly income and expenses and yearly expenses at the top. Recurring items are converted to a monthly amount (a yearly 120 counts as 10 per month); one-off items are not included. The search field finds items by name, category or note.

### 6. Months

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/10-monate.png" alt="Monthly overview" width="260">

For the next 12 months, income (green) and expenses (red) are shown as bars. Full bars are certain and likely bookings, the light extension is uncertain. The month's balance is on the right.

**Special items** are highlighted in yellow and listed as labels under the month. At the top you choose what counts as special: by default everything that does not occur every month, or e.g. only quarterly and less frequent, optionally above a minimum amount. The setting applies to months, timeline and calendar.

Tap a month to expand its bookings. At the bottom, **spending per category**: large is the average per month, small the sum of the next 12 months.

## Shared household book

Every Home Assistant user has their own private items and balance. If you like, create a **household** (*Haushalt*) and invite other HA users. When editing an item you choose whether it is visible to you only or to the household. The household shows the combined income and expenses of all members and has its own balance, e.g. for a joint account.

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/11-haushalt.png" alt="Household" width="260">

- Only the owner can change an item; members can confirm shared bookings.
- HA admins cannot see other users' private items either.
- Optional per household: a **calendar** entity and **sensors** (next expense, next income, balance at month end) for dashboards and automations. These entities are visible to all HA users and therefore off by default.

Tab **Haushalt** → **+ Haushalt anlegen**, give it a name and select members. Then pick the household under **Sichtbar für** when editing an item. Switch between *Meine Posten* and the household at the top right.

## Backup and move

Tab **Posten** → **Exportieren** saves your own items as a JSON file. **Importieren** reads such a file, either in addition to existing items (duplicates are skipped) or as a replacement. Imported items are private at first.

## Incognito mode

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/12-inkognito.png" alt="Incognito mode" width="260">

The eye icon in the top bar blurs all amounts and balances, including in forms. Tap again to show them. The setting is remembered per device.

## Good to know

- **Update your balance regularly.** The forecast is only as good as the last real balance.
- **Confirming pays off.** Without confirmations everything stays *likely* and rolling items cannot learn.
- **Use price changes** instead of overwriting the amount.
- **"Ausgefallen" means it does not happen at all.** For "arrives later", leave it open or fix a date.
- **Irregular spending** such as groceries works best as a **monthly budget**.
- **Privacy:** private items are only visible to their owner. Household calendar and sensors are visible to all HA users and therefore off by default.
- **Updates:** if an update only changes the user interface, reloading the page is enough (the companion app may need its frontend cache cleared). If the background logic changes, Home Assistant needs a restart; HACS will tell you.

## Development

```bash
pip install -r requirements_test.txt
pytest
```

The calculation (`engine.py`) and access rules (`store.py`) have no dependency on Home Assistant. The panel is a single JavaScript file without a build step (`frontend/haushaltsbuch-panel.js`).

## Releasing

Bump the version in `custom_components/haushaltsbuch/manifest.json` and `const.py` and merge into `main`. The *Release* workflow then creates the GitHub release `vX.Y.Z` automatically and HACS offers the update.
