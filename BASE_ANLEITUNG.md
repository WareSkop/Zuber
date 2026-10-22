# Obsidian Bases in Zuber – Das vollständige Handbuch & Referenz

**Zuber** bietet eine native, performante und offline-fähige Implementierung von **Obsidian Bases** (kompatibel mit `.base`-Dateien und ```` ```base ````-Codeblöcken in Markdown). 

Dieses Handbuch erklärt alle YAML-Strukturen, Abfragemöglichkeiten, mathematische Formeln, String-Operationen, Filterformate und Tabellengestaltungen im Detail anhand konkreter Praxisbeispiele.

---

## Inhaltsverzeichnis
1. [Was sind Bases in Zuber?](#1-was-sind-bases-in-zuber)
2. [Einsatzmöglichkeiten: Standalone `.base` vs. Eingebetteter Block](#2-einsatzmöglichkeiten-standalone-base-vs-eingebetteter-block)
3. [Grundlegender Aufbau der YAML-Definition](#3-grundlegender-aufbau-der-yaml-definition)
4. [Verfügbare Attribute und Datenquellen](#4-verfügbare-attribute-und-datenquellen)
   - [Integrierte Datei-Attribute (`file.*`)](#integrierte-datei-attribute-file)
   - [Notiz-Frontmatter-Attribute](#notiz-frontmatter-attribute)
   - [Tags und Verlinkungen](#tags-und-verlinkungen)
5. [Filter-Syntax & Operatoren](#5-filter-syntax--operatoren)
   - [String-Ausdrücke](#string-ausdrücke)
   - [Spezielle Dateifilter](#spezielle-dateifilter)
   - [Logische Operatoren (`and`, `or`, `not`)](#logische-operatoren-and-or-not)
   - [Strukturierte Filter (YAML-Objekte)](#strukturierte-filter-yaml-objekte)
6. [Formeln, Rechnen & String-Verknüpfung (`formulas`)](#6-formeln-rechnen--string-verknüpfung-formulas)
   - [Mathematische Berechnungen & Runden](#mathematische-berechnungen--runden)
   - [Datumsberechnung & Dauer-Literale](#datumsberechnung--dauer-literale)
   - [Strings verknüpfen (Konkatenation) & manipulieren](#strings-verknüpfen-konkatenation--manipulieren)
   - [Bedingungen & Verzweigungen (`if` / Ternärer Operator)](#bedingungen--verzweigungen-if--ternärer-operator)
7. [Formatierung & Tabellenanpassung](#7-formatierung--tabellenanpassung)
   - [Spaltenauswahl & Reihenfolge (`order`)](#spaltenauswahl--reihenfolge-order)
   - [Eigene Spaltentitel (`displayName`)](#eigene-spaltentitel-displayname)
   - [Spaltenbreiten festlegen (`columnSize`)](#spaltenbreiten-festlegen-columnsize)
   - [Sortierung (`sort`) & Interaktiver Klick](#sortierung-sort--interaktiver-klick)
   - [Gruppierung (`groupBy`) mit Abschnitten](#gruppierung-groupby-mit-abschnitten)
   - [Limitierung (`limit`)](#limitierung-limit)
8. [Verlinkung und interaktive Navigation](#8-verlinkung-und-interaktive-navigation)
9. [Interaktive Inline-Bearbeitung in der Tabelle](#9-interaktive-inline-bearbeitung-in-der-tabelle)
10. [Mehrere Ansichten (Tabs: Table, Cards, etc.)](#10-mehrere-ansichten-tabs-table-cards-etc)
11. [Vollständiges Praxisbeispiel (Projekt- & Aufgaben-Dashboard)](#11-vollständiges-praxisbeispiel-projekt--aufgaben-dashboard)

---

## 1. Was sind Bases in Zuber?

Bases verwandeln deinen Markdown-Vault in eine strukturierte, relationale Wissensdatenbank:
- **Keine separaten Datenbankdateien nötig:** Datenquellen sind deine ganz normalen Markdown-Notizen und deren Frontmatter-Eigenschaften (YAML-Header).
- **Synchrones Rendering ohne Flackern:** Alle Daten werden direkt aus dem lokalen Frontend-Speicher und IndexedDB-Cache bezogen – Tabellen und Karten laden sofort ohne Ladezeiten oder Platzhalter-Striche (`—`).
- **Bidirektionale Bearbeitung:** Wenn du in einer Base-Tabelle einen Wert änderst oder eine Checkbox anklickst, wird das Frontmatter der entsprechenden Notiz sofort aktualisiert.
- **Sandboxed Expression Engine:** Formeln und Filter werden durch einen deterministischen, sicheren Parser ohne `eval` oder `new Function` ausgeführt.

---

## 2. Einsatzmöglichkeiten: Standalone `.base` vs. Eingebetteter Block

### A. Standalone-Datenbank (`.base`-Datei)
Erstelle über den Button **„Neue Base“** (Datenbank-Icon) in der Sidebar oder über die Befehlspalette (`Strg+P` / `Cmd+P` → *„Vault: Neue Base erstellen“*) eine eigenständige `.base`-Datei, z. B. `Projekte.base`.

In Zuber öffnet sich der visuelle Base-Editor mit zwei Modi:
- **Visuelle Ansicht:** Die gerenderte Tabelle oder Kartenansicht.
- **YAML-Quelltext:** Über den Schalter `[ Visuelle Ansicht | YAML-Quelltext ]` oben rechts kannst du die YAML-Konfiguration direkt anpassen.

### B. Eingebetteter Codeblock in jeder Markdown-Notiz
Du kannst eine Base direkt in eine beliebige Notiz einbetten, indem du einen Codeblock mit der Sprachkennung `base` erstellst:

````markdown
# Meine Notiz

Hier ist eine Live-Übersicht aller offenen Aufgaben:

```base
filters:
  and:
    - "file.inFolder('Aufgaben')"
    - "erledigt == false"
views:
  - type: table
    name: "Offen"
    order:
      - file.name
      - prioritaet
      - faellig
```
````

Über den Umschalter `[ Ansicht | Code ]` kannst du den Block jederzeit zwischen interaktiver Vorschau und YAML-Quelltext umschalten.

---

## 3. Grundlegender Aufbau der YAML-Definition

Eine Base-Definition besteht aus vier optionalen Hauptbereichen:

```yaml
# 1. Globale Filter (gelten für alle Ansichten)
filters:
  and:
    - "file.inFolder('Projekte')"

# 2. Berechnete Formeln (virtuelle Spalten)
formulas:
  tageUebrig: "round((date(deadline) - today()) / '1 day')"
  gesamtkosten: "round(stunden * stundensatz, 2)"

# 3. Spalten-Metadaten & Beschriftungen
properties:
  file.name:
    displayName: "Projekt"
  tageUebrig:
    displayName: "Tage verbleibend"

# 4. Eine oder mehrere Ansichten (Tabs)
views:
  - type: table
    name: "Alle Projekte"
    order:
      - file.name
      - status
      - tageUebrig
    columnSize:
      file.name: 240
      status: 120
      tageUebrig: 140
    sort:
      - property: tageUebrig
        direction: ASC
```

---

## 4. Verfügbare Attribute und Datenquellen

### Integrierte Datei-Attribute (`file.*`)
Jede Notiz im Vault stellt automatisch folgende Attribute zur Verfügung:

| Attribut | Typ | Beschreibung | Beispiel |
| :--- | :--- | :--- | :--- |
| `file.name` | `string` | Dateiname der Notiz (wird in Tabellen als Link gerendert) | `Relaunch.md` |
| `file.folder` | `string` | Übergeordneter Ordnerpfad | `Projekte/Webseite` |
| `file.path` | `string` | Vollständiger Pfad im Vault | `Projekte/Webseite/Relaunch.md` |
| `file.ext` | `string` | Dateiendung (ohne Punkt) | `md` |
| `file.mtime` | `number` | Letzter Änderungszeitpunkt in Millisekunden (Unix Timestamp) | `1729639200000` |

### Notiz-Frontmatter-Attribute
Alle Schlüssel, die im YAML-Header einer Notiz stehen, können direkt als Spaltenname oder in Filtern/Formeln verwendet werden:

*Beispiel-Notiz (`Projekte/Webseite.md`):*
```yaml
---
status: in_progress
prioritaet: 1
kunde: Acme Corp
budget: 5000
stundensatz: 95
stunden: 32.5
deadline: 2026-12-15
abgeschlossen: false
tags:
  - frontend
  - relaunches
---
```

In der Base kannst du nun direkt auf `status`, `prioritaet`, `kunde`, `budget`, `stunden`, `deadline` und `abgeschlossen` zugreifen (oder explizit mit Präfix `note.status`).

### Tags und Verlinkungen
- `tags`: Liste aller Tags der Notiz (aus Frontmatter und Inline-`#tags`).
- `links`: Liste aller ausgehenden Wikilinks (`[[...]]`) der Notiz.

---

## 5. Filter-Syntax & Operatoren

Filter bestimmen, welche Notizen in der Base angezeigt werden. Sie können global unter `filters:` oder pro Ansicht unter `views[].filters:` definiert werden.

### String-Ausdrücke
Ein Filter kann ein einfacher Vergleichsausdruck sein:
```yaml
filters: "status == 'aktiv'"
```

Unterstützte Vergleichsoperatoren:
- `==` oder `=` : Gleichheit (`status == 'done'`)
- `!=` : Ungleichheit (`status != 'archiviert'`)
- `<`, `<=`, `>`, `>=` : Numerische Vergleiche (`prioritaet >= 2`, `budget > 1000`)

### Spezielle Dateifilter
Für Ordner, Tags und Verlinkungen existieren praktische Hilfsfunktionen:

1. **`file.inFolder("Ordnername")`**
   Prüft, ob die Notiz im angegebenen Ordner oder einem seiner Unterordner liegt:
   ```yaml
   filters: "file.inFolder('Projekte')"
   ```
2. **`file.hasTag("tagname")`**
   Prüft, ob die Notiz einen bestimmten Tag besitzt (ohne führendes `#`):
   ```yaml
   filters: "file.hasTag('urgent')"
   ```
3. **`file.hasLink("Zielnotiz.md")`**
   Prüft, ob die Notiz einen Wikilink auf die angegebene Notiz enthält:
   ```yaml
   filters: "file.hasLink('Kunde Acme Corp.md')"
   ```

### Logische Operatoren (`and`, `or`, `not`)
Du kannst Ausdrücke mit `and`, `or`, `not` (oder `&&`, `||`, `!`) kombinieren:

```yaml
filters: "file.inFolder('Projekte') and status == 'in_progress' and not abgeschlossen"
```

### Strukturierte Filter (YAML-Objekte)
Für komplexe Filter empfehlen sich strukturierte YAML-Listen. Das ist übersichtlicher und verhindert Klammerungsfehler:

```yaml
filters:
  and:
    - "file.inFolder('Projekte')"
    - or:
        - "prioritaet == 1"
        - "file.hasTag('urgent')"
    - not:
        - "status == 'abgebrochen'"
```

**Direkter Key-Value-Filter:**
Für einfache Exakt-Treffer genügt ein Objekt:
```yaml
filters:
  status: "aktiv"
  abgeschlossen: false
```

---

## 6. Formeln, Rechnen & String-Verknüpfung (`formulas`)

Unter `formulas:` kannst du beliebige berechnete Eigenschaften definieren. Jede Formel erzeugt eine neue virtuelle Spalte `formula.<name>`, die du in `order`, `sort` und der Tabelle anzeigen kannst.

### Mathematische Berechnungen & Runden
Du kannst alle Grundrechenarten (`+`, `-`, `*`, `/`, `%`) sowie mathematische Funktionen verwenden:

```yaml
formulas:
  # Netto + MwSt berechnen
  bruttobetrag: "budget * 1.19"

  # Runden auf 2 Nachkommastellen: round(zahl, dezimalstellen)
  honorarNetto: "round(stunden * stundensatz, 2)"

  # Mathematische Hilfsfunktionen
  abgerundet: "floor(stunden)"
  aufgerundet: "ceil(stunden)"
  absolut: "abs(differenz)"
  maximum: "max(wertA, wertB)"
```

### Datumsberechnung & Dauer-Literale
Zuber bietet native Datums- und Zeitberechnungen:

- `date(string)`: Wandelt ein ISO-Datum (z. B. `deadline: 2026-12-31`) in Millisekunden um.
- `today()`: Start des heutigen Tages (00:00:00 Uhr) in Millisekunden.
- `now()`: Aktueller sekundengenauer Zeitstempel.
- **Dauer-Literale:** Zeichenketten wie `'1 day'`, `'7 days'`, `'2 hours'`, `'30 min'` werden automatisch in Millisekunden umgerechnet!

**Beispiel: Verbleibende Tage bis zur Deadline:**
```yaml
formulas:
  tageUebrig: "round((date(deadline) - today()) / '1 day')"
```

### Strings verknüpfen (Konkatenation) & manipulieren
**Strings mit `+` verknüpfen:**
Du kannst Text-Literale und Eigenschaften einfach mit `+` aneinanderhängen:

```yaml
formulas:
  # Vollständigen Titel erzeugen
  pfadTitel: "file.folder + ' » ' + file.name"

  # Status mit Priorität kombinieren
  statusLabel: "'[' + status + '] Priorität ' + prioritaet"
```

**Erlaubte String-Methoden:**
Auf String-Werten stehen sichere Methoden zur Verfügung:
- `.toLowerCase()`
- `.toUpperCase()`
- `.trim()`
- `.includes('suchtext')`
- `.startsWith('präfix')`
- `.endsWith('suffix')`
- `.length`

*Beispiel:*
```yaml
formulas:
  bereinigterKunde: "kunde.trim().toUpperCase()"
```

### Bedingungen & Verzweigungen (`if` / Ternärer Operator)
Du kannst bedingte Formeln entweder mit `if(Bedingung, WennWahr, WennFalsch)` oder dem ternären Operator `Bedingung ? WennWahr : WennFalsch` formulieren:

```yaml
formulas:
  tageUebrig: "round((date(deadline) - today()) / '1 day')"

  # Warnung bei überfälligen Projekten anzeigen
  ampel: "if(tageUebrig < 0, '⚠️ Überfällig!', tageUebrig <= 3 ? '⚡ Dringend' : 'Normal')"

  # Budget-Status
  kostenStatus: "if(stunden * stundensatz > budget, 'Budget überschritten!', 'Im Budget ✓')"
```

---

## 7. Formatierung & Tabellenanpassung

### Spaltenauswahl & Reihenfolge (`order`)
Mit `order` legst du fest, welche Spalten in welcher Reihenfolge in der Tabelle oder auf den Karten erscheinen:

```yaml
views:
  - type: table
    name: "Projektliste"
    order:
      - file.name
      - status
      - kunde
      - formula.tageUebrig
      - formula.ampel
```

> **Hinweis:** Wenn `order` weggelassen wird, zeigt Zuber automatisch `file.name` gefolgt von allen in den Notizen gefundenen Frontmatter-Eigenschaften an.

### Eigene Spaltentitel (`displayName`)
Standardmäßig entspricht der Spaltenkopf dem Variablennamen. Unter `properties:` kannst du menschenlesbare Titel vergeben:

```yaml
properties:
  file.name:
    displayName: "Projektname"
  status:
    displayName: "Bearbeitungsstand"
  formula.tageUebrig:
    displayName: "Restzeit (Tage)"
  formula.ampel:
    displayName: "Priorität / Dringlichkeit"
```

### Spaltenbreiten festlegen (`columnSize`)
Du kannst die Breite jeder einzelnen Tabellenspalte in Pixeln exakt einstellen. Nutze dazu das Attribut `columnSize` in der jeweiligen View-Konfiguration:

```yaml
views:
  - type: table
    name: "Tabelle mit festen Breiten"
    order:
      - file.name
      - status
      - budget
      - formula.ampel
    columnSize:
      file.name: 260
      status: 130
      budget: 100
      formula.ampel: 160
```

### Sortierung (`sort`) & Interaktiver Klick
**Deklarative Sortierung im YAML:**
```yaml
views:
  - type: table
    sort:
      - property: formula.tageUebrig
        direction: ASC
      - property: prioritaet
        direction: DESC
```
*(Mögliche Werte für `direction`: `ASC` für aufsteigend, `DESC` für absteigend).*

**Interaktive Sortierung in der UI:**
Du kannst in der gerenderten Tabelle jederzeit auf einen beliebigen Spaltenkopf klicken. Die Tabelle schaltet sofort zwischen aufsteigender (`▲`), absteigender (`▼`) und Standard-Sortierung um.

### Gruppierung (`groupBy`) mit Abschnitten
Mit `groupBy` unterteilst du die Tabelle oder die Kartenansicht in übersichtliche Abschnitte mit Zwischenüberschriften und Trefferzählern:

```yaml
views:
  - type: table
    name: "Nach Status"
    groupBy:
      property: status
      direction: ASC
```

### Limitierung (`limit`)
Begrenzt die Anzahl der angezeigten Notizen (z. B. für Top-5-Dashboards):

```yaml
views:
  - type: table
    name: "Top 5 Dringendste"
    limit: 5
    sort:
      - property: formula.tageUebrig
        direction: ASC
```

---

## 8. Verlinkung und interaktive Navigation

### Wie verlinkt eine Base auf Notizen?
- **Klickbare Notiznamen (`file.name`):** Die Spalte `file.name` wird in Tabellen automatisch als klickbarer Notiz-Link mit Dokumenten-Icon dargestellt. Ein Klick öffnet die Notiz sofort im Zuber-Editor.
- **Kartenansicht (`type: cards`):** In der Kartenansicht ist die gesamte Kopfzeile der Karte (Titel und Ordnerpfad) klickbar und führt zur Notiz.
- **Tags als Badges:** Tags in der Spalte `tags` oder in Frontmatter-Listen werden als `#tag`-Pillen gerendert.

### Kann ein Attribut als Link ausgegeben werden?
1. **Notizen-Verlinkung:** Über `file.name` ist die Primärverlinkung immer aktiv.
2. **URLs in Eigenschaften:** Wenn du in einem Attribut eine URL hinterlegst (z. B. `link: https://example.com`), kannst du sie in der Tabelle anzeigen lassen.
3. **Wikilinks in Notizen:** Wenn Notizen Wikilinks enthalten, kannst du mit dem Filter `file.hasLink("Zielnotiz.md")` gezielt alle Notizen auflisten, die auf ein bestimmtes Dokument verweisen (z. B. ein Backlink-Verzeichnis).

---

## 9. Interaktive Inline-Bearbeitung in der Tabelle

Zuber-Bases sind nicht nur Auswertungen, sondern vollwertige Eingabemasken:

1. **Text- und Zahlenfelder:**
   - Klicke einfach auf eine Tabellenzelle.
   - Die Zelle verwandelt sich in ein Eingabefeld.
   - Tippe den neuen Wert ein und drücke `Enter` (oder klicke daneben).
   - Der geänderte Wert wird sofort im Frontmatter der entsprechenden Notiz gespeichert.
2. **Checkboxen (Ja/Nein / Boolean):**
   - Attribute mit `true` oder `false` (z. B. `erledigt: false`) werden automatisch als anklickbare Checkbox gerendert.
   - Ein einfacher Klick wechselt den Status (`true` ↔ `false`) und aktualisiert die Notiz atomar auf der Festplatte.
3. **Formel-Spalten:**
   - Formel-Spalten (`formula.*`) sind schreibgeschützt und passen sich bei Änderungen abhängiger Werte automatisch an.

---

## 10. Mehrere Ansichten (Tabs: Table, Cards, etc.)

Du kannst in einer Base mehrere Ansichten definieren. Zuber erzeugt dafür eine obere Tableiste, mit der du blitzschnell zwischen den Ansichten wechseln kannst:

```yaml
views:
  # Ansicht 1: Tabelle für detaillierte Planung
  - type: table
    name: "Tabelle"
    order:
      - file.name
      - status
      - budget
      - deadline
    columnSize:
      file.name: 220
      status: 120

  # Ansicht 2: Karten-Board gruppiert nach Status
  - type: cards
    name: "Kanban Board"
    groupBy:
      property: status
      direction: ASC

  # Ansicht 3: Nur überfällige Projekte
  - type: table
    name: "⚠️ Überfällig"
    filters: "formula.tageUebrig < 0"
    order:
      - file.name
      - deadline
      - formula.tageUebrig
```

---

## 11. Vollständiges Praxisbeispiel (Projekt- & Aufgaben-Dashboard)

Kopiere dieses Beispiel in eine neue Datei namens `Projekt-Dashboard.base` oder in einen ```` ```base ````-Block:

```yaml
# 1. Nur Notizen aus dem Projekte-Ordner einbeziehen
filters:
  and:
    - "file.inFolder('Projekte')"
    - "status != 'archiviert'"

# 2. Rechnen, Datumsabstände und Statustexte berechnen
formulas:
  tageUebrig: "round((date(deadline) - today()) / '1 day')"
  gesamthonorar: "round(stunden * stundensatz, 2)"
  warnung: "if(tageUebrig < 0, '⚠️ Überfällig', tageUebrig <= 5 ? '⚡ Dringend' : 'Im Plan')"
  projektPfad: "file.folder + ' / ' + file.name"

# 3. Spaltenbeschriftungen anpassen
properties:
  file.name:
    displayName: "Projekt"
  status:
    displayName: "Status"
  kunde:
    displayName: "Auftraggeber"
  erledigt:
    displayName: "Fertig?"
  formula.tageUebrig:
    displayName: "Restzeit (Tage)"
  formula.gesamthonorar:
    displayName: "Honorar (€)"
  formula.warnung:
    displayName: "Ampel"

# 4. Drei verschiedene Ansichten definieren
views:
  # Tab 1: Haupttabelle mit festen Spaltenbreiten
  - type: table
    name: "Projektübersicht"
    order:
      - file.name
      - status
      - kunde
      - erledigt
      - formula.gesamthonorar
      - formula.tageUebrig
      - formula.warnung
    columnSize:
      file.name: 240
      status: 130
      kunde: 150
      erledigt: 70
      formula.gesamthonorar: 110
      formula.tageUebrig: 110
      formula.warnung: 130
    sort:
      - property: formula.tageUebrig
        direction: ASC

  # Tab 2: Visuelle Kartenansicht, gruppiert nach Status
  - type: cards
    name: "Karten nach Status"
    groupBy:
      property: status
      direction: ASC

  # Tab 3: Nur offene und dringende Projekte (Filterung auf Formel)
  - type: table
    name: "Dringend"
    filters:
      and:
        - "erledigt == false"
        - "formula.tageUebrig <= 7"
    order:
      - file.name
      - deadline
      - formula.tageUebrig
      - formula.warnung
    sort:
      - property: formula.tageUebrig
        direction: ASC
```

Mit dieser Struktur hast du die volle Kontrolle über deine Daten im Vault – performant, elegant gestaltet und vollständig offline im Zuber-Editor verfügbar.
