# Haushaltsbuch für Home Assistant

Zeigt dir in Home Assistant, wann welche Abbuchung oder Einnahme ansteht und wie sicher sie ist: Abos, Verträge, Steuern, Gehalt, Bonus, Photovoltaik oder auch der Räderwechsel zweimal im Jahr.

Alle Posten werden von Hand erfasst. Es gibt keine Bankanbindung, und die Daten bleiben in deinem Home Assistant (sie landen automatisch in den HA-Backups).

## Funktionen

- **Zeitleiste** der nächsten 7, 30 oder 90 Tage mit erwartetem Kontostand pro Tag
- **Kalender** als Monatsansicht mit allen Fälligkeiten
- **Posten** mit Name, Betrag, Kategorie, Symbol und Turnus: einmalig, wöchentlich, monatlich, vierteljährlich, halbjährlich, jährlich, alle X Monate, feste Termine im Jahr oder **gleitend** (der nächste Termin richtet sich nach dem letzten, z.B. Friseur)
- **Sicherheitsstufe** pro Buchung: *sicher*, *wahrscheinlich* oder *unsicher*. Sie ergibt sich aus Schwankung von Betrag und Datum und daraus, ob die letzten Buchungen pünktlich bestätigt wurden. Pro Posten auch fest einstellbar.
- **Termin festlegen**: Datum und Betrag einer einzelnen Buchung festlegen. Bei gleitenden Posten rücken alle weiteren Termine nach, sonst wird nur diese eine Buchung verschoben.
- **Bestätigen**: Fällige Buchungen als „gebucht“ (optional mit echtem Datum und Betrag) oder „ausgefallen“ markieren
- **Wochenenden und Bankfeiertage**: Buchungen rutschen auf den nächsten Bankarbeitstag, das Gehalt auf den vorherigen (pro Posten einstellbar)
- **Monatsübersicht** mit Einnahmen, Ausgaben und Saldo für 12 Monate
- **Vorlagen** für typische Posten (GEZ, Strom, Internet, Handy, Versicherungen, Kfz-Steuer, Netflix, Prime, Disney+, Gehalt, Räderwechsel …)
- **Export und Import** der eigenen Posten als JSON-Datei, z.B. als Sicherung oder zum Umzug auf eine andere HA-Instanz. Beim Import wählbar: hinzufügen (Doppelte werden übersprungen) oder ersetzen

## Nutzer und Haushaltsbuch

Jeder Home-Assistant-Nutzer hat seine eigenen, privaten Posten und seinen eigenen Kontostand. Wer möchte, legt ein **Haushaltsbuch** an und lädt andere HA-Nutzer ein. Beim Bearbeiten eines Postens wählst du, ob er nur für dich oder für den Haushalt sichtbar ist. Das Haushaltsbuch zeigt die gemeinsamen Einnahmen und Ausgaben aller Mitglieder und hat ein eigenes Haushaltskonto.

- Nur der Besitzer kann einen Posten ändern, Mitglieder dürfen gemeinsame Buchungen bestätigen.
- Auch HA-Admins sehen keine privaten Posten anderer Nutzer.
- Optional pro Haushalt: ein **Kalender** und **Sensoren** (nächste Ausgabe, nächste Einnahme, Kontostand zum Monatsende) für Dashboards und Automationen. Diese Entitäten sind für alle HA-Nutzer sichtbar, daher standardmäßig aus.

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
