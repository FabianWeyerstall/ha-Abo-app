# Haushaltsbuch für Home Assistant

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?logo=homeassistantcommunitystore&logoColor=white)](https://hacs.xyz)
[![Release](https://img.shields.io/github/v/release/FabianWeyerstall/ha-haushaltsbuch?label=Version)](https://github.com/FabianWeyerstall/ha-haushaltsbuch/releases)
[![Prüfungen](https://img.shields.io/github/actions/workflow/status/FabianWeyerstall/ha-haushaltsbuch/validate.yml?branch=main&label=Pr%C3%BCfungen)](https://github.com/FabianWeyerstall/ha-haushaltsbuch/actions/workflows/validate.yml)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2025.1%2B-18BCF2.svg?logo=homeassistant&logoColor=white)](https://www.home-assistant.io)
[![Lizenz](https://img.shields.io/badge/Lizenz-MIT-green.svg)](LICENSE)
[![Sprache](https://img.shields.io/badge/Sprache-Deutsch-black.svg)](#)

🇬🇧 **English version:** [README.en.md](README.en.md)

Zeigt dir in Home Assistant, wann welche Abbuchung oder Einnahme ansteht und wie sicher sie ist: Abos, Verträge, Steuern, Gehalt, Bonus, Photovoltaik oder auch der Räderwechsel zweimal im Jahr. Daraus rechnet es aus, wie viel voraussichtlich an jedem Tag auf deinem Konto ist.

Alle Posten werden von Hand erfasst. Es gibt keine Bankanbindung, und die Daten bleiben in deinem Home Assistant (sie landen automatisch in den HA-Backups).

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/01-zeitleiste.png" alt="Zeitleiste" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/06-kalender.png" alt="Kalender" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/10-monate.png" alt="Monatsübersicht" width="240">
</p>

**Inhalt:** [Funktionen](#funktionen) · [Installation](#installation-über-hacs) · [So funktioniert es](#so-funktioniert-das-haushaltsbuch) · [Anleitung](#anleitung) · [Die Knöpfe einer Buchung](#die-knöpfe-einer-buchung) · [Haushalt](#gemeinsames-haushaltsbuch) · [Gut zu wissen](#gut-zu-wissen)

## Funktionen

- **Zeitleiste** der nächsten 7, 30 oder 90 Tage mit erwartetem Kontostand pro Tag
- **Kalender** als Monatsansicht mit allen Fälligkeiten
- **Posten** mit Name, Betrag, Kategorie, Symbol und Turnus: einmalig, wöchentlich, monatlich, vierteljährlich, halbjährlich, jährlich, alle X Monate, feste Termine im Jahr oder **gleitend** (der nächste Termin richtet sich nach dem letzten, z.B. Friseur)
- **Sicherheitsstufe** pro Buchung: *sicher*, *wahrscheinlich* oder *unsicher*. Sie ergibt sich aus Schwankung von Betrag und Datum und daraus, ob die letzten Buchungen pünktlich bestätigt wurden. Pro Posten auch fest einstellbar.
- **Preisänderungen**: neuer Betrag ab einem Datum, frühere Buchungen behalten den alten Betrag
- **Verträge**: Laufzeit, Kündigungsfrist und automatische Verlängerung. Die Zeitleiste zeigt rechtzeitig, bis wann du kündigen musst.
- **Budgets** für variable Ausgaben wie Lebensmittel oder Freizeit: ein Monatsbetrag, der gleichmäßig über den Monat vom erwarteten Kontostand abgeht
- **Gleitende Posten lernen** ab drei bestätigten Terminen den echten durchschnittlichen Abstand
- **Termin festlegen**: Datum und Betrag einer einzelnen Buchung festlegen. Bei gleitenden Posten rücken alle weiteren Termine nach, sonst wird nur diese eine Buchung verschoben.
- **Bestätigen**: Fällige Buchungen als „gebucht“ (optional mit echtem Datum und Betrag) oder „ausgefallen“ markieren
- **Wochenenden und Bankfeiertage**: Buchungen rutschen auf den nächsten Bankarbeitstag, das Gehalt auf den vorherigen (pro Posten einstellbar)
- **Monatsübersicht** mit Einnahmen, Ausgaben und Saldo für 12 Monate. **Sonderposten** (alles, was nicht jeden Monat kommt, z.B. GEZ, Versicherungen, Bonus) sind pro Monat und in Zeitleiste und Kalender gelb markiert. Darunter die **Ausgaben nach Kategorie** für die nächsten 12 Monate.
- **Suche** in den Posten und **alle offenen Buchungen auf einmal bestätigen**
- **Vorlagen** für typische Posten (GEZ, Strom, Internet, Handy, Versicherungen, Kfz-Steuer, Streaming-Abos, Gehalt, Tanken, Räderwechsel …)
- **Export und Import** der eigenen Posten als JSON-Datei, z.B. als Sicherung oder zum Umzug auf eine andere HA-Instanz. Beim Import wählbar: hinzufügen (Doppelte werden übersprungen) oder ersetzen

## Installation über HACS

1. HACS öffnen → oben rechts ⋮ → **Benutzerdefinierte Repositories**
2. `https://github.com/FabianWeyerstall/ha-haushaltsbuch` als Typ **Integration** hinzufügen
3. **Haushaltsbuch** installieren und Home Assistant neu starten
4. **Einstellungen → Geräte & Dienste → Integration hinzufügen → Haushaltsbuch**
5. In der Seitenleiste erscheint **Haushaltsbuch**, auch in der Home-Assistant-App auf dem iPhone

## So funktioniert das Haushaltsbuch

### Posten und Buchungen

Ein **Posten** ist die Regel, z.B. „Internet, 39,99 €, monatlich ab dem 5.“. Aus jedem Posten rechnet das Haushaltsbuch die einzelnen **Buchungen** aus, also jede einzelne Abbuchung oder Einnahme an ihrem Tag. Du pflegst nur die Posten. Die Buchungen entstehen von selbst, und du bestätigst sie, wenn sie auf dem Konto angekommen sind.

Was du am **Posten** änderst (Betrag, Turnus, Kategorie), gilt für alle Buchungen. Was du an einer **Buchung** änderst (gebucht, ausgefallen, fester Termin), gilt nur für diese eine.

### Kontostand und Vorschau

Du trägst ab und zu deinen echten **Kontostand** ein. Von diesem Tag an zählt das Haushaltsbuch alle kommenden Buchungen dazu oder zieht sie ab und zeigt rechts neben jedem Tag den **erwarteten Kontostand**. Oben in der Zeitleiste stehen zwei Werte:

- **Am …** (große Zahl): mit sicheren und wahrscheinlichen Buchungen und Budgets. Das ist die realistische Erwartung.
- **nur sichere Posten**: zählt nur, was ganz sicher kommt. Das ist die vorsichtige Untergrenze.

Unsichere Buchungen werden angezeigt, aber nicht eingerechnet.

### Die drei Sicherheitsstufen

| Stufe | Bedeutung | Wann automatisch |
|---|---|---|
| **sicher** (grün) | kommt pünktlich und mit genau diesem Betrag | Die letzten bestätigten Buchungen waren pünktlich (± 3 Tage) und hatten genau den Betrag, und der Betrag schwankt nicht. |
| **wahrscheinlich** (gelb) | kommt sehr wahrscheinlich, Datum oder Betrag können abweichen | Neue Posten ohne Bestätigungen, Posten mit kleiner Schwankung, gleitende und einmalige Posten, Budgets. |
| **unsicher** (grau) | kann kommen, muss aber nicht | Betrag schwankt um mehr als 20 % oder Datum um mehr als 7 Tage, eine der letzten beiden Buchungen ist ausgefallen, oder der Posten endet in den nächsten 30 Tagen. |

Ein neuer Posten startet also als *wahrscheinlich* und wird mit pünktlichen Bestätigungen *sicher*. Unter **Schwankung und Sicherheit** kannst du die Stufe pro Posten auch fest einstellen, z.B. einen Bonus immer als *unsicher*.

### Bestätigen, damit die App dazulernt

Alles, was in den letzten drei Wochen fällig war und noch nicht bestätigt ist, steht in der Zeitleiste oben unter **Zu bestätigen**. Das Bestätigen dauert ein paar Sekunden und bringt drei Dinge:

1. Die Sicherheitsstufe stimmt, denn pünktliche Posten werden *sicher*, unzuverlässige *unsicher*.
2. Bei **gleitenden** Posten (Friseur, Tanken) richtet sich der nächste Termin nach dem echten Datum. Ab drei bestätigten Terminen lernt die App den echten Abstand.
3. Du siehst auf einen Blick, ob etwas Erwartetes nicht gekommen ist.

### Wochenenden und Feiertage

Fällt eine Buchung auf ein Wochenende oder einen Bankfeiertag (Neujahr, Karfreitag, Ostermontag, 1. Mai, 25. und 26. Dezember), rutscht sie auf den **nächsten** Bankarbeitstag, so wie es Banken bei Lastschriften machen. Bei der Vorlage **Gehalt** ist stattdessen der **vorherige** Bankarbeitstag eingestellt, weil das Gehalt meist früher kommt. Das lässt sich pro Posten unter **Schwankung und Sicherheit → Wochenende/Feiertag** ändern.

## Anleitung

### 1. Kontostand setzen

Tab **Zeitleiste** → **Kontostand setzen**. Trag den aktuellen Stand aus deiner Banking-App ein. Ab diesem Stand rechnet die Zeitleiste den erwarteten Kontostand Tag für Tag weiter. Setz ihn ab und zu neu, z.B. einmal im Monat nach dem Gehalt, dann bleibt die Vorschau genau.

### 2. Posten anlegen

Tab **Posten** → **+ Neuer Posten**.

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/08-neuer-posten.png" alt="Neuer Posten mit Vorlage" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/09-posten-details.png" alt="Vertrag und Schwankung" width="240">
</p>

1. Oben eine **Vorlage** antippen (z.B. GEZ, Gehalt, Internet). Sie füllt Name, Kategorie, Symbol und Turnus aus.
2. **Betrag** und **Erste Fälligkeit** (die nächste Abbuchung) eintragen.
3. Den **Turnus** prüfen:
   - *monatlich, vierteljährlich, halbjährlich, jährlich, alle X Monate*: fester Kalendertag, z.B. GEZ am 15. jedes dritten Monats
   - *feste Termine im Jahr*: mehrere Daten pro Jahr, z.B. Räderwechsel im April und Oktober
   - *gleitend*: der nächste Termin richtet sich nach dem letzten, z.B. Friseur oder Tanken
   - *einmalig*: z.B. Bonus oder eine Rechnung
   - *Budget pro Monat*: für Ausgaben ohne feste Termine, z.B. Lebensmittel. Keine einzelnen Buchungen, das Budget wird gleichmäßig über den Monat verteilt.
4. Optional ein **Enddatum** setzen (Häkchen „Enddatum festlegen“), z.B. wenn ein Kredit ausläuft.
5. Unter **Schwankung und Sicherheit**: Schwankung des Betrags in %, Toleranz beim Datum, feste Sicherheitsstufe und das Verhalten am Wochenende.

Bei der **Kategorie** öffnet sich beim Antippen eine Liste der vorhandenen Kategorien, Tippen filtert sie. Eine neue Kategorie gibst du einfach ein.

Beim **Symbol** einfach lostippen: Eine Liste schlägt passende MDI-Symbole vor (englische Namen wie `router`, `car`, `home`, aber auch gängige deutsche Wörter wie „Auto“, „Strom“, „Geld“ oder „Versicherung“). Antippen oder Enter übernimmt den ersten Vorschlag. Alternativ geht ein Emoji. Die Vorschau neben dem Feld zeigt sofort, wie es aussieht.

**Was in welches Feld gehört:**

- **Erste Fälligkeit**: der Tag der nächsten (oder ersten) Abbuchung. Bei monatlichen Posten ergibt sich daraus der Tag im Monat.
- **Betrag**: immer positiv eintragen. Ob es abgeht oder dazukommt, legt **Art** (Ausgabe oder Einnahme) fest.
- **Sichtbar für**: *nur mich* oder ein gemeinsamer Haushalt (siehe unten).
- **Notiz**: frei, z.B. Kundennummer oder Vertragsdetails.

### Preisänderung eintragen

Posten öffnen → **Preisänderungen** → **+ Preisänderung**, Datum und neuen Betrag eintragen. Ab diesem Tag rechnet die App mit dem neuen Betrag, alles davor bleibt beim alten. In der Postenliste steht eine kommende Änderung klein unter dem Betrag. Bitte nicht einfach den Betrag im Posten überschreiben, sonst stimmen bereits bestätigte Buchungen nicht mehr.

### Vertrag und Kündigungsfrist

Posten öffnen → **Vertrag und Kündigung** → Häkchen **Vertragslaufzeit erfassen**. Eintragen, bis wann der Vertrag läuft, die Kündigungsfrist und um wie lange er sich danach verlängert, in Tagen, Wochen oder Monaten (0 = endet einfach). Die App rechnet das nächste Vertragsende selbst weiter.

Muss in den nächsten 60 Tagen gekündigt werden, erscheint der Vertrag in der Zeitleiste unter **Kündigungsfristen** mit dem Datum, bis wann die Kündigung da sein muss. In der Postenliste steht „kündbar bis …“.

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/02-zeitleiste-kuendigung.png" alt="Kündigungsfristen in der Zeitleiste" width="260">

### Push-Nachricht bei Kündigungsfristen

Das Haushaltsbuch prüft jeden Morgen um 9 Uhr alle Verträge. Muss einer in **30, 7 oder 1 Tag(en)** gekündigt sein, löst es in Home Assistant das Ereignis `haushaltsbuch_kuendigungsfrist` aus. Eine fertige Automationsvorlage (Blueprint) macht daraus eine Push-Nachricht:

1. [Blueprint importieren](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2FFabianWeyerstall%2Fha-haushaltsbuch%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fhaushaltsbuch%2Fkuendigungsfrist.yaml) (oder unter **Einstellungen → Automationen & Szenen → Blueprints → Blueprint importieren** diese Adresse eintragen: `https://github.com/FabianWeyerstall/ha-haushaltsbuch/blob/main/blueprints/automation/haushaltsbuch/kuendigungsfrist.yaml`)
2. Auf den Blueprint tippen, dein Handy auswählen, speichern
3. Testen: **Entwicklerwerkzeuge → Aktionen → „Haushaltsbuch: Kündigungsfristen melden“** mit **Alle kommenden** ausführen. Dann kommt sofort für jeden Vertrag, der in den nächsten 60 Tagen kündbar ist, eine Nachricht.

Das Ereignis enthält `name`, `cancel_by`, `contract_end`, `days_left`, `renews`, `amount`, `owner_name` und `household`, falls du lieber eine eigene Automation baust. Es kommt auch für private Posten, sichtbar ist es aber nur für Admins in den Automationen.

### 3. Die Zeitleiste lesen

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/01-zeitleiste.png" alt="Zeitleiste oben" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/03-zeitleiste-tage.png" alt="Zeitleiste Tage" width="240">
</p>

- Oben: dein letzter Kontostand und der erwartete Stand am Ende des Zeitraums.
- **Zu bestätigen**: fällige, noch offene Buchungen der letzten drei Wochen. Direkt mit **gebucht** oder **ausgefallen** abhaken, oder mit **Alle … gebucht** alles auf einmal (erscheint ab zwei offenen Buchungen).
- **Kündigungsfristen**: Verträge, die du bald kündigen müsstest.
- Darunter jeder Tag mit seinen Buchungen. Rechts neben dem Datum steht der erwartete Kontostand am Ende dieses Tages. Oben wählst du 7, 30 oder 90 Tage.
- Das farbige Etikett zeigt die Sicherheitsstufe. Gelb hinterlegt mit ★ sind **Sonderposten**, also Buchungen, die nicht jeden Monat kommen (z.B. GEZ vierteljährlich, Räderwechsel).

### Die Knöpfe einer Buchung

Tippst du in der Zeitleiste oder im Kalender auf eine Buchung, öffnet sich dieses Fenster. Es betrifft immer **nur diese eine Buchung**. Oben kannst du **Datum** und **Betrag** anpassen, bevor du einen Knopf drückst.

<p>
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/04-buchung-bestaetigen.png" alt="Fällige Buchung bestätigen" width="240">
<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/05-termin-festlegen.png" alt="Termin für eine kommende Buchung festlegen" width="240">
</p>

| Knopf | Wofür | Was passiert |
|---|---|---|
| **Gebucht** | Die Buchung ist auf dem Konto angekommen. | Sie wird mit dem eingetragenen Datum und Betrag als gebucht gespeichert. Pünktliche Buchungen machen den Posten mit der Zeit *sicher*. Bei gleitenden Posten startet der nächste Abstand ab diesem Datum, und die App lernt den echten Abstand. |
| **Ausgefallen** | Die Buchung kommt diesmal nicht, z.B. Friseur ausgelassen, Bonus gestrichen. | Sie bleibt durchgestrichen in der Zeitleiste stehen, im Kalender wird sie ausgeblendet. Sie zählt nicht mehr zum Kontostand und nicht zu den Monatssummen. Der Posten bleibt, die **nächste Buchung kommt ganz normal** zum nächsten Termin. Die ausgefallene wird nicht nachgeholt. Die nächsten ein bis zwei Buchungen dieses Postens gelten danach als *unsicher*. |
| **Als Termin festlegen** | Für kommende Buchungen, wenn du den Tag oder Betrag schon genau kennst, z.B. Friseur am 14. für 30 €. | Die Buchung wird auf Datum und Betrag festgelegt und bekommt das Etikett „Termin“. Bei **gleitenden** Posten rücken alle späteren Termine mit, bei allen anderen verschiebt sich nur diese eine Buchung. Danach heißt der Knopf **Termin ändern**, dazu kommt **Termin entfernen**. |
| **Posten öffnen** | Den ganzen Posten bearbeiten. | Öffnet das Formular des Postens. Änderungen dort gelten für **alle** Buchungen. |
| **Bestätigung zurücksetzen** | Versehentlich „gebucht“ oder „ausgefallen“ gedrückt. | Erscheint nur bei bestätigten Buchungen und macht die Bestätigung rückgängig. Die Buchung ist wieder offen. |

**Kommt eine Buchung nur später?** Dann bitte nicht „ausgefallen“ drücken. Lass sie offen und drück „gebucht“, sobald sie da ist. Trag vorher im Datumsfeld den echten Tag ein. Kennst du den neuen Tag schon vorher, nimm **Als Termin festlegen** mit dem neuen Datum.

**Beispiel gleitender Posten:** Friseur monatlich ab dem 10., du hast aber erst am 19. einen Termin bekommen. Buchung antippen, Datum auf den 19. stellen, **Als Termin festlegen**. Die nächsten Besuche rücken dann auch um diese neun Tage nach hinten.

### Beispiel: Tanken

Tanken ist unregelmäßig, deshalb am besten **gleitend** und **pro Auto ein Posten**:

1. Vorlage **Tanken** wählen (gleitend, alle 2 Wochen, Betrag schwankt um 20 %)
2. Namen anpassen, z.B. „Tanken Golf“, und einen typischen Betrag pro Tankfüllung eintragen
3. Tankst du ungefähr einmal im Monat, den Abstand auf 4 Wochen oder 1 Monat stellen
4. Nach dem Tanken die Buchung als **gebucht** bestätigen, gern mit echtem Datum und Betrag. Die nächste Tankfüllung wird dann ab diesem Tag neu berechnet.
5. Ab drei bestätigten Tankfüllungen lernt die App deinen echten Abstand (abschaltbar im Posten: „Abstand aus bestätigten Terminen lernen“).

Wer das Tanken nicht einzeln pflegen will, legt stattdessen ein **Budget pro Monat** „Tanken“ mit dem durchschnittlichen Monatsbetrag an.

### 4. Kalender

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/06-kalender.png" alt="Kalender" width="260">

Die Monatsansicht zeigt an jedem Tag die Symbole der Buchungen und die Tagessumme. Ohne Auswahl stehen darunter alle Buchungen des Monats. Tippst du auf einen Tag, siehst du nur diesen Tag. Mit **ganzer Monat** kommst du zurück zur Monatsliste. Ausgefallene Buchungen werden im Kalender nicht gezeigt.

### 5. Posten

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/07-posten.png" alt="Postenliste" width="260">

Alle Posten nach Kategorie. Oben siehst du Einnahmen und Ausgaben pro Monat und die Ausgaben pro Jahr. Dafür werden alle wiederkehrenden Posten auf einen Monat umgerechnet, ein jährlicher Posten mit 120 € zählt also mit 10 € pro Monat. Einmalige Posten zählen hier nicht mit. Über das Suchfeld findest du Posten nach Name, Kategorie oder Notiz.

### 6. Monate

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/10-monate.png" alt="Monatsübersicht" width="260">

Für die nächsten 12 Monate stehen hier Einnahmen (grün) und Ausgaben (rot) als Balken. Volle Balken sind sichere und wahrscheinliche Buchungen, der helle Zusatz sind unsichere. Rechts steht der Saldo des Monats. So siehst du sofort, in welchem Monat z.B. Versicherungen und GEZ zusammenkommen.

**Sonderposten** sind gelb markiert und stehen als Etiketten unter dem Monat. Oben stellst du ein, was als Sonderposten zählt: standardmäßig alles, was nicht jeden Monat kommt. Du kannst aber auch z.B. „erst ab vierteljährlich“ wählen und einen Mindestbetrag setzen. Die Einstellung gilt für Monate, Zeitleiste und Kalender.

Einen Monat antippen klappt die einzelnen Buchungen auf. Ganz unten steht, welche **Kategorien** am meisten kosten: groß der Durchschnitt pro Monat, klein darunter die Summe der nächsten 12 Monate. Ein Budget von 500 € pro Monat steht dort also als 500 € und klein als rund 6.000 €.

## Gemeinsames Haushaltsbuch

Jeder Home-Assistant-Nutzer hat seine eigenen, privaten Posten und seinen eigenen Kontostand. Wer möchte, legt ein **Haushaltsbuch** an und lädt andere HA-Nutzer ein. Beim Bearbeiten eines Postens wählst du, ob er nur für dich oder für den Haushalt sichtbar ist. Das Haushaltsbuch zeigt die gemeinsamen Einnahmen und Ausgaben aller Mitglieder und hat ein eigenes Haushaltskonto.

- Nur der Besitzer kann einen Posten ändern, Mitglieder dürfen gemeinsame Buchungen bestätigen.
- Auch HA-Admins sehen keine privaten Posten anderer Nutzer.
- Optional pro Haushalt: ein **Kalender** und **Sensoren** (nächste Ausgabe, nächste Einnahme, Kontostand zum Monatsende) für Dashboards und Automationen. Diese Entitäten sind für alle HA-Nutzer sichtbar, daher standardmäßig aus.

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/11-haushalt.png" alt="Haushalt" width="260">

Tab **Haushalt** → **+ Haushalt anlegen**, Namen vergeben und andere HA-Nutzer auswählen. Danach beim Bearbeiten eines Postens unter **Sichtbar für** den Haushalt wählen. Oben rechts wechselst du zwischen „Meine Posten“ und dem Haushalt. Der Haushalt hat einen eigenen Kontostand, z.B. für ein Gemeinschaftskonto. Ein Posten gehört immer zu genau einem Haushalt oder ist privat.

## Sichern und umziehen

Tab **Posten** → **Exportieren** speichert deine eigenen Posten als JSON-Datei (auf dem iPhone über das Teilen-Menü, „In Dateien sichern“). **Importieren** liest so eine Datei wieder ein, wahlweise zusätzlich zu den vorhandenen Posten (Doppelte werden übersprungen) oder als Ersatz. Importierte Posten sind zunächst privat.

## Inkognito-Modus

<img src="https://raw.githubusercontent.com/FabianWeyerstall/ha-haushaltsbuch/main/docs/images/12-inkognito.png" alt="Inkognito-Modus" width="260">

Das Auge oben in der Leiste macht alle Beträge und Kontostände unscharf, auch in den Formularen. Praktisch, wenn du die App jemandem zeigen willst. Ein weiterer Tipp macht sie wieder sichtbar. Das Gerät merkt sich die Einstellung, bis du sie wieder ausschaltest.

## Gut zu wissen

- **Kontostand regelmäßig setzen.** Die Vorschau ist nur so gut wie der letzte echte Kontostand. Einmal im Monat reicht meist.
- **Bestätigen lohnt sich.** Ohne Bestätigungen bleibt alles *wahrscheinlich*, und gleitende Posten können nichts lernen.
- **Preisänderung statt Betrag überschreiben**, damit alte Buchungen ihren alten Betrag behalten.
- **„Ausgefallen“ heißt: kommt diesmal gar nicht.** Für „kommt später“ die Buchung offen lassen oder einen Termin festlegen.
- **Unregelmäßige Ausgaben** wie Lebensmittel oder Freizeit am besten als **Budget pro Monat** erfassen statt als viele einzelne Posten.
- **Privatsphäre:** Private Posten sieht nur ihr Besitzer, auch HA-Admins nicht. Kalender und Sensoren eines Haushalts sind dagegen für alle HA-Nutzer sichtbar und deshalb standardmäßig aus.
- **Updates:** Betrifft ein Update nur die Oberfläche, reicht es, die Seite neu zu laden (in der iPhone-App eventuell den Frontend-Cache leeren). Ändert sich die Berechnung im Hintergrund, braucht Home Assistant einen Neustart. HACS weist dann darauf hin.

## Entwicklung

```bash
pip install -r requirements_test.txt
pytest
```

Die Berechnung (`engine.py`) und die Zugriffsregeln (`store.py`) haben keine Abhängigkeit zu Home Assistant. Das Panel ist eine einzelne JavaScript-Datei ohne Build-Schritt (`frontend/haushaltsbuch-panel.js`).

## Neue Version veröffentlichen

Version in `custom_components/haushaltsbuch/manifest.json` und `const.py` erhöhen und nach `main` mergen. Der Workflow „Release“ legt dann automatisch das GitHub-Release `vX.Y.Z` an, und HACS bietet das Update an.
