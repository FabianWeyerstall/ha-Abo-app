# Household Budget (Haushaltsbuch) for Home Assistant

[![HACS Default](https://img.shields.io/badge/HACS-Default-41BDF5.svg?logo=homeassistantcommunitystore&logoColor=white)](https://hacs.xyz)
[![Release](https://img.shields.io/github/v/release/FabianWeyerstall/ha-haushaltsbuch?label=Version)](https://github.com/FabianWeyerstall/ha-haushaltsbuch/releases)
[![Checks](https://img.shields.io/github/actions/workflow/status/FabianWeyerstall/ha-haushaltsbuch/validate.yml?branch=main&label=Checks)](https://github.com/FabianWeyerstall/ha-haushaltsbuch/actions/workflows/validate.yml)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2025.1%2B-18BCF2.svg?logo=homeassistant&logoColor=white)](https://www.home-assistant.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

🇩🇪 **Deutsche Version:** [README.md](README.md)

Shows you in Home Assistant when each debit or income is due and how certain it is: subscriptions, contracts, taxes, salary, bonus, solar feed-in or the tyre change twice a year. From that it calculates what your account balance will probably be on every day.

All items are entered by hand. There is no bank connection, and the data stays in your Home Assistant (it is included in your HA backups automatically).

> **Language:** The interface follows the language of your Home Assistant profile: German for German, English for every other language. Dates and amounts follow your HA profile too, so `39.99` or `39,99` both work.

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/01-timeline.png" alt="Timeline" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/06-calendar.png" alt="Calendar" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/10-months.png" alt="Monthly overview" width="240">
</p>

**Contents:** [Features](#features) · [Installation](#installation-via-hacs) · [How it works](#how-it-works) · [Guide](#guide) · [Booking buttons](#the-buttons-of-a-booking) · [Shared household](#shared-household-book) · [Good to know](#good-to-know)

## Features

- **Timeline** for the next 7, 30 or 90 days with the expected balance for each day
- **Calendar** month view with every due date
- **Entries** with name, amount, category, icon and schedule: once, weekly, monthly, **monthly on a weekday** (e.g. last Thursday), quarterly, half-yearly, yearly, every X months, fixed dates per year, or **rolling** (the next date follows the last one, e.g. hairdresser)
- **Certainty level** per booking: *certain*, *likely* or *uncertain*. It is derived from how much amount and date vary and whether recent bookings were confirmed on time. Can also be fixed per entry.
- **Price changes**: a new amount from a given date; earlier bookings keep the old amount
- **Contracts**: term, notice period and automatic renewal. The timeline tells you in time by when you have to cancel.
- **Budgets** for variable spending such as groceries: a monthly amount that is spread across the month. Enter **real spendings** one by one (also afterwards or with an iPhone shortcut) to see how much is left or whether you are over. The timeline shows on each day, as its own row, how much budget was taken off since the previous day, so every daily balance adds up
- **Rolling entries learn** the real average interval after three confirmed bookings
- **Fix a date** for a single booking. For rolling entries, all later dates move along; otherwise only this one booking moves.
- **Confirm** due bookings as *booked* (optionally with the real date and amount) or *skipped*
- **Weekends and bank holidays**: bookings move to the next business day, salary to the previous one (configurable per entry)
- **Salary month**: if your salary arrives at the end of the month (e.g. on the last Thursday), months and figures run from payday to payday and the overview shows the balance **before the next payday**
- **Monthly overview** with income, expenses and balance for 12 months. **Special entries** (anything that does not occur every month, e.g. insurance, bonus) are highlighted. Below that, **spending per category**.
- **Overview** dashboard with key figures and a pie chart by category
- **Search** in entries and **confirm all open bookings at once**
- **Templates** for typical entries (salary, rent, electricity, internet, mobile, insurance, vehicle tax, savings plan, streaming, fuel, tyre change …)
- **Export and import** your own entries as a JSON file, e.g. as a backup or to move to another HA instance
- **Incognito mode** that blurs all amounts, e.g. when showing the app to friends
- **Contract notice reminders** as an HA event plus ready-made blueprints (English and German) for phone notifications

## Installation via HACS

Haushaltsbuch is in the HACS default store, so you can find it directly in HACS:

[![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=FabianWeyerstall&repository=ha-haushaltsbuch&category=integration)

1. In Home Assistant, open **HACS** and search for **Haushaltsbuch** (or use the button above)
2. **Download** it and restart Home Assistant
3. **Settings → Devices & services → Add integration → Haushaltsbuch**
4. **Haushaltsbuch** appears in the sidebar (the sidebar title is the same for all users), also in the Home Assistant companion app

<details>
<summary>If it does not show up in HACS: add it as a custom repository</summary>

1. Open HACS → ⋮ (top right) → **Custom repositories**
2. Add `https://github.com/FabianWeyerstall/ha-haushaltsbuch` with type **Integration**
3. Continue with step 2 above

</details>

## How it works

### Entries and bookings

An **entry** is the rule, e.g. "Internet, 39.99, monthly from the 5th". From every entry the integration calculates the individual **bookings**, i.e. every single debit or income on its day. You only maintain the entries. Bookings are created automatically, and you confirm them once they have hit your account.

What you change on the **entry** (amount, schedule, category) applies to all bookings. What you change on a **booking** (booked, skipped, fixed date) applies to that one only.

### Balance and forecast

Every now and then you enter your real **balance**. From that day on the integration adds or subtracts all upcoming bookings and shows the **expected balance** next to every day. At the top of the timeline there are two values:

- **On …** (large number): with certain and likely bookings and budgets. This is the realistic expectation.
- **cautious**: counts only *certain* income, but every certain and likely expense and budget. This is the cautious lower bound and never lies above the expected value.

Uncertain bookings are shown but not included.

### The three certainty levels

| Level | Meaning | Automatically when |
|---|---|---|
| **certain** (green) | arrives on time with exactly this amount | Recent confirmed bookings were on time (± 3 days) with exactly the amount, and the amount does not vary. |
| **likely** (yellow) | very likely, date or amount may differ | New entries without confirmations, entries with small variance, rolling and one-off entries, budgets. |
| **uncertain** (grey) | may or may not happen | Amount varies by more than 20 % or date by more than 7 days, one of the last two bookings was skipped, or the entry ends within 30 days. |

A new entry therefore starts as *likely* and becomes *certain* with on-time confirmations. Under **Variation and certainty** you can fix the level per entry, e.g. a bonus always *uncertain*.

### Confirming makes the app learn

Everything that was due in the last three weeks and is not yet confirmed is listed at the top of the timeline under **To confirm**. Confirming takes seconds and does three things:

1. The certainty level becomes accurate: punctual entries become *certain*, unreliable ones *uncertain*.
2. For **rolling** entries (hairdresser, fuel) the next date follows the real date. After three confirmed bookings the app learns the real interval.
3. You see at a glance if something expected did not arrive.

### Weekends and holidays

If a booking falls on a weekend or a bank holiday (New Year, Good Friday, Easter Monday, 1 May, 25 and 26 December), it moves to the **next** business day, as banks do with direct debits. The **Salary** template uses the **previous** business day instead. You can change this per entry under **Variation and certainty → Weekend/holiday**.

## Guide

### 1. Set your balance

Tab **Timeline** → **Set balance**. Enter the current balance from your banking app. From there the timeline calculates the expected balance day by day. Update it from time to time, e.g. once a month after payday, to keep the forecast accurate.

### 2. Create entries

Tab **Entries** → **+ New entry**.

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/08-new-entry.png" alt="New entry from a template" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/09-entry-details.png" alt="Contract and variance" width="240">
</p>

1. Tap a **template** at the top. It fills in name, category, icon and schedule.
2. Enter **Amount** and **First due date** (i.e. the next debit).
3. Check **Repeats**:
   - *monthly, quarterly, every six months, yearly, every X months*: fixed day of the month
   - *monthly on a weekday*: e.g. "last Thursday" or "first Monday", for a salary that always comes on a certain weekday
   - *fixed dates each year*: several dates per year, e.g. tyre change in April and October
   - *rolling*: the next date follows the last one, e.g. hairdresser or fuel
   - *once*: e.g. a bonus or an invoice
   - *monthly budget*: for spending without fixed dates, e.g. groceries. No fixed bookings; the budget is spread over the month. Enter what you really spend one by one (see [Budgets and real spendings](#budgets-and-real-spendings)).
4. Optionally **set an end date**, e.g. when a loan ends.
5. For income such as your salary: tick **"My month starts with this income"** if the salary arrives at the end of the month and pays the next month's debits. Months then run from payday to payday (see [Salary at the end of the month](#salary-at-the-end-of-the-month-salary-month)).
6. Under **Variation and certainty**: amount variance in %, date tolerance, fixed certainty level and weekend behaviour.

The **Category** field opens a list of existing categories; typing filters it. To create a new category, just type it.

For the **Icon**, just start typing: a list suggests matching MDI icons (English names such as `router`, `car`, `home`). Tap a suggestion or press Enter for the first one. An emoji works too.

- **Amount**: always positive. Whether it is an expense or income is set by **Type**.
- **Visible to**: *only me* or a shared household (see below).
- **Note**: free text, e.g. customer number.

### Price change

Open the entry → **Price changes** → **+ Price change**, enter date and new amount. From that day the new amount is used, everything before keeps the old one. Please don't simply overwrite the amount of the entry, otherwise already confirmed bookings no longer match.

### Contract and notice period

Open the entry → **Contract and cancellation** → tick **Track contract term**. Enter the end of the term, the notice period and the renewal period in days, weeks or months (0 = simply ends). The app calculates the next end of term itself.

If the contract has to be cancelled within the next 60 days, it appears in the timeline under **Cancellation deadlines** with the date by which the cancellation must arrive.

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/02-timeline-deadlines.png" alt="Cancellation deadlines in the timeline" width="260">

### Phone notification for notice deadlines

Every morning at 9:00 the integration checks all contracts. If one has to be cancelled in **30, 7 or 1 day(s)**, it fires the Home Assistant event `haushaltsbuch_kuendigungsfrist`. A ready-made blueprint turns it into a push notification in English:

1. [Import the blueprint](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FFabianWeyerstall%2Fha-haushaltsbuch%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fhaushaltsbuch%2Fcontract_reminder.yaml) (or **Settings → Automations & scenes → Blueprints → Import blueprint** with `https://github.com/FabianWeyerstall/ha-haushaltsbuch/blob/main/blueprints/automation/haushaltsbuch/contract_reminder.yaml`)
2. Open the blueprint, select your phone, save
3. Test: **Developer tools → Actions → "Haushaltsbuch: Send contract reminders"** with **All upcoming** enabled. You immediately get a notification for every contract cancellable within the next 60 days.

The event contains `name`, `cancel_by`, `contract_end`, `days_left`, `renews`, `amount`, `owner_name` and `household` if you prefer your own automation.

### Salary at the end of the month (salary month)

Many people are not paid on the 1st but at the end of the month, e.g. **always on the last Thursday**. That salary pays the debits that follow (rent, electricity, insurance). If the app counted in calendar months, the end of the month would look like a lot of money is left, although it is meant for the next month. To switch:

1. Open your salary entry (or create one, e.g. with the **Salary** template).
2. **Repeats:** *monthly on a weekday*, then **Which day?** → *last* and *Thursday*. *First* to *fourth* and any other weekday work too.
3. **Valid from:** roughly from when this applies. The app works out the dates itself.
4. Tick **"My month starts with this income (salary)"** and save.

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/14-salary.png" alt="Salary on the last Thursday with salary month" width="260">

What changes:

- **Months:** each month runs from payday to payday. Below the month name you see from when it counts, e.g. "Nov 26, from 10/29". A salary paid after the 15th belongs to the next month, so a salary at the end of October counts for November, together with the debits it pays.
- **Overview:** instead of "Expected at month end" it shows **"Before next payday"**: what is left the day before the next salary, when all of the month's debits have gone out. That is the honest figure for what is really left.
- The overview's breakdowns (categories, certainty, special entries) use these salary months too.
- **Timeline and calendar** stay as they are. The calendar keeps normal calendar months.

Only one income can carry the tick, and it applies to you personally. Untick it and the app goes back to calendar months.

### Budgets and real spendings

A budget such as “Groceries 600 € per month” starts as a placeholder: the app takes it off the expected balance evenly across the month. Enter what you really spend and it becomes a real overview.

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/15-budget.png" alt="Budgets this month with spendings" width="260">

- At the top of the **Timeline** and the **Overview** is the card **Budgets this month**. For each budget: how much is gone, how much is left and what that means per day until the month ends.
- **Green bar:** on track. **Orange:** spent faster than planned. The line in the bar shows how much would be due by today if spread evenly. **Red:** over budget, e.g. “68 € over”.
- **+ Spending** opens a small form: budget, amount, date and a note such as “weekly shop”. The **date** defaults to today; if you forgot something, just set it back. The spending counts in the month its date falls in.
- Tap a budget to see all spendings of the month. Tap a spending to change its amount, date, note or budget. ✕ deletes it.
- For the balance, past days count the real amounts and what is left of the budget is spread over the remaining days. At the end of the month the rest **expires**; the next month starts with the full budget again. If you are over, nothing more is taken off.
- **Pot for unplanned purchases:** for things that cost 5 € one month and 50 € the next (e.g. something for the house), create a budget of **0**, easiest with the template **Unplanned**. Nothing is taken off in advance; only what you enter comes off the balance and counts in the figures. The card then shows “€45 spent” instead of a bar.
- With the [salary month](#salary-at-the-end-of-the-month-salary-month) the budget month also runs from payday to payday.
- For a budget in a shared household, every member can enter spendings.

#### Add a spending with a shortcut

For quick entry at the checkout there is the action **“Haushaltsbuch: Add expense”** (`haushaltsbuch.add_expense`):

| Field | Meaning |
|---|---|
| `budget` | Name of the budget, e.g. `Groceries` (case doesn't matter). Can be left out if you only have one budget. |
| `amount` | Amount, e.g. `34.90` |
| `date` | optional, e.g. `2026-11-02`. Default: today. |
| `note` | optional, e.g. `weekly shop` |

The action responds with the new state (`budget`, `spent`, `rest`, `days_left`). On the iPhone in the **Shortcuts** app:

1. New shortcut → **Ask for Input** (number, “Amount?”)
2. Action **Home Assistant → Perform Action**, action `haushaltsbuch.add_expense`, data e.g. `{"budget": "Groceries", "amount": <input>}`
3. Optionally **Show Notification** with the result to see right away how much is left.

You can test the action under **Developer tools → Actions**. The spending is assigned to the user who runs the action.

### 3. Reading the timeline

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/01-timeline.png" alt="Timeline top" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/03-timeline-days.png" alt="Timeline days" width="240">
</p>

- Top: your last balance and the expected balance at the end of the period.
- **To confirm**: due, still open bookings of the last three weeks. Tick them off with **booked** or **skipped**, or all at once with **All … booked** (shown from two open bookings).
- **Cancellation deadlines**: contracts you would have to cancel soon.
- Below: every day with its bookings. Next to the date is the expected balance at the end of that day. Choose 7, 30 or 90 days at the top.
- The coloured label shows the certainty level. Highlighted in yellow with ★ are **special entries**, i.e. bookings that do not occur every month.

### The buttons of a booking

Tapping a booking in the timeline or calendar opens this dialog. It always affects **only this one booking**. At the top you can adjust **Date** and **Amount** before pressing a button.

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/04-confirm-booking.png" alt="Confirm a due booking" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/05-set-date.png" alt="Set the date of an upcoming booking" width="240">
</p>

| Button | Use it when | What happens |
|---|---|---|
| **Booked** | The booking has arrived on your account. | Saved as booked with the entered date and amount. Punctual bookings make the entry *certain* over time. For rolling entries the next interval starts from this date and the app learns the real interval. |
| **Skipped** | The booking does not happen this time, e.g. skipped haircut, cancelled bonus. | It stays crossed out in the timeline and is hidden in the calendar. It no longer counts towards the balance or monthly totals. The entry stays, and the **next booking comes as usual**. The skipped one is not carried over. The next one or two bookings of this entry count as *uncertain*. |
| **Set as scheduled** | For upcoming bookings when you already know the exact day or amount. | The booking is fixed to that date and amount and gets the label *scheduled*. For **rolling** entries all later dates move along; otherwise only this booking moves. Afterwards the button reads **Change date**, plus **Remove date**. |
| **Open entry** | Edit the whole entry. | Opens the entry form. Changes there apply to **all** bookings. |
| **Reset confirmation** | You pressed booked or skipped by mistake. | Only shown on confirmed bookings; makes the booking open again. |

**Booking just arrives later?** Don't press *Skipped*. Leave it open and press *Booked* once it arrives, with the real date in the date field. If you already know the new date, use **Set as scheduled**.

### Example: fuel

Fuel is irregular, so use **rolling** and **one entry per car**: choose the **Fuel** template (rolling, every 2 weeks, amount varies 20 %), rename it, enter a typical amount, adjust the interval, and confirm every refuel with the real date and amount. After three confirmations the app learns your real interval. If you don't want to track it individually, use a **monthly budget** instead.

### 4. Calendar

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/06-calendar.png" alt="Calendar" width="260">

The month view shows the icons of the bookings and the daily total. Without a selection, all bookings of the month are listed below. Tap a day to see only that day; **whole month** returns to the month list. Skipped bookings are not shown.

### 5. Entries

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/07-entries.png" alt="Entry list" width="260">

All entries grouped by category, with monthly income and expenses and yearly expenses at the top. Recurring entries are converted to a monthly amount (a yearly 120 counts as 10 per month); one-off entries are not included. The search field finds entries by name, category or note.

### 6. Months

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/10-months.png" alt="Monthly overview" width="260">

For the next 12 months, income (green) and expenses (red) are shown as bars. Full bars are certain and likely bookings, the light extension is uncertain. The month's balance is on the right.

**Special entries** are highlighted in yellow and listed as labels under the month. At the top you choose what counts as special: by default everything that does not occur every month, or e.g. only quarterly and less frequent, optionally above a minimum amount. The setting applies to months, timeline and calendar.

**Salary month:** If you ticked "My month starts with this income" on your salary, each month runs from payday to payday and below the month name you see from when it counts (see [Salary at the end of the month](#salary-at-the-end-of-the-month-salary-month)).

Tap a month to expand its bookings. At the bottom, **spending per category**: large is the average per month, small the sum of the next 12 months.

### 7. Overview

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/13-overview.png" alt="Overview" width="260">

The dashboard at a glance: balance, expected balance at month end (with a salary month: **before the next payday**, when all debits have gone out), income and expenses per month, what is left per month and the lowest balance of the next 90 days. Below:

- **Where most of the money goes:** a pie chart of expenses by category (the five largest, the rest under "Others"). Below it you see what share of your income that is in total. Open a category to see its share of spending and of income, e.g. "47 % of your spending · 30 % of your income".
- **Fixed costs, special entries and budgets** as shares of an average month.
- **How certain are the expenses?** Share of certain, likely and uncertain expenses.
- **What each schedule costs per month** and the **largest expenses**, each converted to one month. Tap to open the entry.
- **Special entries in the next 3 months.**

Tap a share (e.g. "likely", "Special entries, spread", a category or a schedule) to see the entries behind it. The ⓘ next to a heading briefly explains how the figure is calculated.

## Shared household book

Every Home Assistant user has their own private entries and balance. If you like, create a **household** and invite other HA users. When editing an entry you choose whether it is visible to you only or to the household. The household shows the combined income and expenses of all members and has its own balance, e.g. for a joint account.

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/11-household.png" alt="Household" width="260">

- Only the owner can change an entry; members can confirm shared bookings.
- HA admins cannot see other users' private entries either.
- Optional per household: a **calendar** entity and **sensors** (next expense, next income, balance at month end) for dashboards and automations. These entities are visible to all HA users and therefore off by default.

Tab **Household** → **+ Add household**, give it a name and select members. Then pick the household under **Visible to** when editing an entry. Switch between *My entries* and the household at the top right.

## Backup and move

Tab **Entries** → **Export** saves your own entries as a JSON file. **Import** reads such a file, either in addition to existing entries (duplicates are skipped) or as a replacement. Imported entries are private at first.

## Incognito mode

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/en/12-incognito.png" alt="Incognito mode" width="260">

The eye icon in the top bar blurs all amounts and balances, including in forms. Tap again to show them. The setting is remembered per device.

## Good to know

- **Update your balance regularly.** The forecast is only as good as the last real balance.
- **Confirming pays off.** Without confirmations everything stays *likely* and rolling items cannot learn.
- **Use price changes** instead of overwriting the amount.
- **"Skipped" means it does not happen at all.** For "arrives later", leave it open or fix a date.
- **Irregular spending** such as groceries works best as a **monthly budget**, with the real spendings entered in it.
- **Privacy:** private entries are only visible to their owner. Household calendar and sensors are visible to all HA users and therefore off by default.
- **Updates:** if an update only changes the user interface, reloading the page is enough (the companion app may need its frontend cache cleared). If the background logic changes, Home Assistant needs a restart; HACS will tell you.

## Development

```bash
pip install -r requirements_test.txt
pytest
```

The calculation (`engine.py`) and access rules (`store.py`) have no dependency on Home Assistant. The panel is a single JavaScript file without a build step (`frontend/haushaltsbuch-panel.js`).

## Releasing

Bump the version in `custom_components/haushaltsbuch/manifest.json` and `const.py` and merge into `main`. The *Release* workflow then creates the GitHub release `vX.Y.Z` automatically and HACS offers the update.
