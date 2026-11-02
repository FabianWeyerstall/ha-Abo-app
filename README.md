# Haushaltsbuch für Home Assistant

Zeigt dir in Home Assistant, wann welche Abbuchung oder Einnahme ansteht und wie sicher sie ist: Abos, Verträge, Steuern, Gehalt, Bonus, Photovoltaik oder auch der Räderwechsel zweimal im Jahr.

Alle Posten werden von Hand erfasst. Es gibt keine Bankanbindung, und die Daten bleiben in deinem Home Assistant (sie landen automatisch in den HA-Backups).

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
- **Monatsübersicht** mit Einnahmen, Ausgaben und Saldo für 12 Monate. **Sonderposten** (alles, was nicht jeden Monat kommt, z.B. GEZ, Versicherungen, Bonus) sind pro Monat hervorgehoben. Darunter die **Ausgaben nach Kategorie** für die nächsten 12 Monate.
- **Suche** in den Posten und **alle offenen Buchungen auf einmal bestätigen**
- **Vorlagen** für typische Posten (GEZ, Strom, Internet, Handy, Versicherungen, Kfz-Steuer, Netflix, Prime, Disney+, Gehalt, Tanken, Räderwechsel …)
- **Export und Import** der eigenen Posten als JSON-Datei, z.B. als Sicherung oder zum Umzug auf eine andere HA-Instanz. Beim Import wählbar: hinzufügen (Doppelte werden übersprungen) oder ersetzen

## Nutzer und Haushaltsbuch

Jeder Home-Assistant-Nutzer hat seine eigenen, privaten Posten und seinen eigenen Kontostand. Wer möchte, legt ein **Haushaltsbuch** an und lädt andere HA-Nutzer ein. Beim Bearbeiten eines Postens wählst du, ob er nur für dich oder für den Haushalt sichtbar ist. Das Haushaltsbuch zeigt die gemeinsamen Einnahmen und Ausgaben aller Mitglieder und hat ein eigenes Haushaltskonto.

- Nur der Besitzer kann einen Posten ändern, Mitglieder dürfen gemeinsame Buchungen bestätigen.
- Auch HA-Admins sehen keine privaten Posten anderer Nutzer.
- Optional pro Haushalt: ein **Kalender** und **Sensoren** (nächste Ausgabe, nächste Einnahme, Kontostand zum Monatsende) für Dashboards und Automationen. Diese Entitäten sind für alle HA-Nutzer sichtbar, daher standardmäßig aus.

## Anleitung

### 1. Kontostand setzen

Tab **Zeitleiste** → **Kontostand setzen**. Trag den aktuellen Stand aus deiner Banking-App ein. Ab diesem Stand rechnet die Zeitleiste den erwarteten Kontostand Tag für Tag weiter. Gelegentlich neu setzen, dann bleibt die Vorschau genau.

### 2. Posten anlegen

Tab **Posten** → **+ Neuer Posten**.

1. Oben eine **Vorlage** antippen (z.B. GEZ, Gehalt, Netflix). Sie füllt Name, Kategorie, Symbol und Turnus aus.
2. **Betrag** und **Erste Fälligkeit** (die nächste Abbuchung) eintragen.
3. Den **Turnus** prüfen:
   - *monatlich, vierteljährlich, halbjährlich, jährlich, alle X Monate*: fester Kalendertag, z.B. GEZ am 15. jedes dritten Monats
   - *feste Termine im Jahr*: mehrere Daten pro Jahr, z.B. Räderwechsel im April und Oktober
   - *gleitend*: der nächste Termin richtet sich nach dem letzten, z.B. Friseur oder Tanken
   - *einmalig*: z.B. Bonus oder eine Rechnung
   - *Budget pro Monat*: für Ausgaben ohne feste Termine, z.B. Lebensmittel. Keine einzelnen Buchungen, das Budget wird gleichmäßig über den Monat verteilt.
4. Optional ein **Enddatum** setzen (Häkchen „Enddatum festlegen“), z.B. wenn ein Kredit ausläuft.
5. Unter **Schwankung und Sicherheit**: Schwankung des Betrags in %, Toleranz beim Datum, feste Sicherheitsstufe und das Verhalten am Wochenende.

Das **Symbol** ist eine MDI-Bezeichnung wie `mdi:netflix` (Übersicht auf [pictogrammers.com](https://pictogrammers.com/library/mdi/)) oder einfach ein Emoji. Die Vorschau neben dem Feld zeigt sofort, wie es aussieht.

### Preisänderung eintragen

Posten öffnen → **Preisänderungen** → **+ Preisänderung**, Datum und neuen Betrag eintragen. Ab diesem Tag rechnet die App mit dem neuen Betrag, alles davor bleibt beim alten. In der Postenliste steht eine kommende Änderung klein unter dem Betrag.

### Vertrag und Kündigungsfrist

Posten öffnen → **Vertrag und Kündigung** → Häkchen **Vertragslaufzeit erfassen**. Eintragen, bis wann der Vertrag läuft, die Kündigungsfrist und um wie viele Monate er sich danach verlängert (0 = endet einfach). Die App rechnet das nächste Vertragsende selbst weiter. Muss in den nächsten 60 Tagen gekündigt werden, erscheint der Vertrag in der Zeitleiste unter **Kündigungsfristen**, in der Postenliste steht „kündbar bis …“.

### 3. Buchungen bestätigen

Was in den letzten drei Wochen fällig war, steht in der Zeitleiste unter **Zu bestätigen**. Tippe auf **gebucht** oder **ausgefallen**, oder bestätige mit **Alle … gebucht** alles auf einmal. Wer eine Buchung antippt, kann auch das echte Datum und den echten Betrag eintragen. Pünktlich bestätigte Posten werden mit der Zeit *sicher*.

### 4. Termin festlegen

Eine einzelne Buchung antippen → Datum und Betrag ändern → **Als Termin festlegen**. Bei normalen Posten wird nur diese eine Buchung verschoben. Bei gleitenden Posten rücken alle folgenden Termine mit. Beispiel: Friseur monatlich ab dem 10., du hast aber erst am 19. einen Termin bekommen. Dann rutschen auch die nächsten Besuche auf den 19.

### Beispiel: Tanken

Tanken ist unregelmäßig, deshalb am besten **gleitend** und **pro Auto ein Posten**:

1. Vorlage **Tanken** wählen (gleitend, alle 2 Wochen, Betrag schwankt um 20 %)
2. Namen anpassen, z.B. „Tanken Golf“, und einen typischen Betrag pro Tankfüllung eintragen
3. Tankst du ungefähr einmal im Monat, den Abstand auf 4 Wochen oder 1 Monat stellen
4. Nach dem Tanken die Buchung als **gebucht** bestätigen, gern mit echtem Datum und Betrag. Die nächste Tankfüllung wird dann ab diesem Tag neu berechnet.
5. Ab drei bestätigten Tankfüllungen lernt die App deinen echten Abstand (abschaltbar im Posten: „Abstand aus bestätigten Terminen lernen“).

Wer das Tanken nicht einzeln pflegen will, legt stattdessen ein **Budget pro Monat** „Tanken“ mit dem durchschnittlichen Monatsbetrag an.

### 5. Ansichten

- **Zeitleiste**: alle Buchungen der nächsten 7, 30 oder 90 Tage mit erwartetem Kontostand. Zwei Linien: nur sichere Buchungen sowie sichere und wahrscheinliche zusammen.
- **Kalender**: Monatsansicht, ein Tag antippen zeigt seine Buchungen.
- **Posten**: alle Posten nach Kategorie, mit Summen pro Monat und Jahr (umgerechnet) und einer Suche.
- **Monate**: was in welchem Monat wirklich gebucht wird. Gelb markierte **Sonderposten** sind alles, was nicht jeden Monat kommt. Einen Monat antippen zeigt die einzelnen Buchungen. Darunter siehst du, welche Kategorien in den nächsten 12 Monaten am meisten kosten.

### 6. Gemeinsames Haushaltsbuch

Tab **Haushalt** → **+ Haushalt anlegen**, Namen vergeben und andere HA-Nutzer auswählen. Danach beim Bearbeiten eines Postens unter **Sichtbar für** den Haushalt wählen. Oben rechts wechselst du zwischen „Meine Posten“ und dem Haushalt. Der Haushalt hat einen eigenen Kontostand, z.B. für ein Gemeinschaftskonto.

### 7. Sichern und umziehen

Tab **Posten** → **Exportieren** speichert deine eigenen Posten als JSON-Datei (auf dem iPhone über das Teilen-Menü, „In Dateien sichern“). **Importieren** liest so eine Datei wieder ein, wahlweise zusätzlich zu den vorhandenen Posten oder als Ersatz. Importierte Posten sind zunächst privat.

## Installation über HACS

1. HACS öffnen → oben rechts ⋮ → **Benutzerdefinierte Repositories**
2. `https://github.com/FabianWeyerstall/ha-Abo-app` als Typ **Integration** hinzufügen
3. **Haushaltsbuch** installieren und Home Assistant neu starten
4. **Einstellungen → Geräte & Dienste → Integration hinzufügen → Haushaltsbuch**
5. In der Seitenleiste erscheint **Haushaltsbuch**, auch in der Home-Assistant-App auf dem iPhone

## Entwicklung

```bash
pip install -r requirements_test.txt
pytest
```

Die Berechnung (`engine.py`) und die Zugriffsregeln (`store.py`) haben keine Abhängigkeit zu Home Assistant. Das Panel ist eine einzelne JavaScript-Datei ohne Build-Schritt (`frontend/haushaltsbuch-panel.js`).

## Neue Version veröffentlichen

Version in `custom_components/haushaltsbuch/manifest.json` und `const.py` erhöhen und nach `main` mergen. Der Workflow „Release“ legt dann automatisch das GitHub-Release `vX.Y.Z` an, und HACS bietet das Update an.
