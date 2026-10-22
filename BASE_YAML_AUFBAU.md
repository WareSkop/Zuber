# Wie ist das Base-YAML in Zuber aufgebaut?

Dieses Dokument erklärt den exakten Aufbau der YAML-Definition für **Bases in Zuber** (sowohl für eigenständige `.base`-Dateien als auch für ```` ```base ````-Codeblöcke in Markdown-Notizen).

---

## 1. Die vier Hauptblöcke im Überblick

Eine Base-Definition in Zuber gliedert sich in bis zu vier optionale Hauptbereiche auf oberster Ebene:

```yaml
# 1. Globale Filter (gelten für alle Ansichten)
filters:
  # ... Filterregeln ...

# 2. Berechnete Formeln (erzeugen neue virtuelle Spalten)
formulas:
  # ... Formeln & Rechnungen ...

# 3. Eigenschaften-Konfiguration (z. B. Spaltenbeschriftungen)
properties:
  # ... Displaynamen & Typen ...

# 4. Ansichten (mindestens eine Ansicht: Table, Cards etc.)
views:
  # ... Liste von Ansichts-Konfigurationen ...
```

---

## 2. Der `filters:`-Block (Notizen filtern)

Hier legst du fest, welche Notizen überhaupt in die Auswertung aufgenommen werden.

### Variante A: Einfacher String-Filter
```yaml
filters: "status == 'aktiv'"
```

### Variante B: Strukturierter Filter mit logischen Operatoren (`and`, `or`, `not`)
```yaml
filters:
  and:
    # 1. Nur Notizen aus dem Ordner "Projekte"
    - "file.inFolder('Projekte')"
    
    # 2. Entweder Prio 1 oder mit Tag #urgent
    - or:
        - "prioritaet == 1"
        - "file.hasTag('urgent')"
        
    # 3. Keine archivierten Notizen
    - not:
        - "status == 'archiviert'"
```

### Variante C: Key-Value-Direktabgleich
```yaml
filters:
  status: "in_progress"
  erledigt: false
```

---

## 3. Der `formulas:`-Block (Rechnen & Strings verknüpfen)

Im Block `formulas:` erstellst du neue virtuelle Spalten. Jede Formel steht unter einem eigenen Namen:

```yaml
formulas:
  # Mathematische Berechnung & Runden
  honorarNetto: "round(stunden * stundensatz, 2)"
  honorarBrutto: "round(honorarNetto * 1.19, 2)"

  # Datumsrechnung mit Dauer-Literalen (z. B. '1 day', '7 days')
  tageUebrig: "round((date(deadline) - today()) / '1 day')"

  # Strings verknüpfen (Konkatenation mit +)
  vollerTitel: "file.folder + ' / ' + file.name"

  # Bedingungen / Verzweigungen (if oder Ternärer Operator ? :)
  ampel: "if(tageUebrig < 0, '⚠️ Überfällig', tageUebrig <= 3 ? '⚡ Dringend' : 'Normal')"
```

> **Verwendung in der Tabelle:**  
> Formeln können in `order` als `formula.<name>` (z. B. `formula.tageUebrig`) oder direkt mit `<name>` referenziert werden.

---

## 4. Der `properties:`-Block (Spaltenbeschriftung)

Standardmäßig nutzt die Tabelle den technischen Variablennamen als Spaltenkopf. Hier kannst du saubere Beschriftungen festlegen:

```yaml
properties:
  file.name:
    displayName: "Projektname"
  status:
    displayName: "Bearbeitungsstand"
  kunde:
    displayName: "Auftraggeber"
  formula.tageUebrig:
    displayName: "Restzeit (Tage)"
  formula.ampel:
    displayName: "Priorität"
```

---

## 5. Der `views:`-Block (Ansichten & Tabellen-Layout)

Unter `views:` definierst du eine Liste von Ansichten (Tabs). Jede Ansicht wird mit einem Bindestrich `-` eingeleitet:

```yaml
views:
  - type: table                         # Typ: 'table' oder 'cards'
    name: "Haupttabelle"                # Name des Reiters / Tabs
    limit: 50                           # Maximale Anzahl an Zeilen (optional)
    
    # Spaltenauswahl & Reihenfolge von links nach rechts
    order:
      - file.name
      - status
      - kunde
      - formula.tageUebrig
      - formula.ampel

    # Feste Spaltenbreiten in Pixeln
    columnSize:
      file.name: 260
      status: 130
      kunde: 160
      formula.tageUebrig: 120
      formula.ampel: 130

    # Sortierregeln (ASC = aufsteigend, DESC = absteigend)
    sort:
      - property: formula.tageUebrig
        direction: ASC
      - property: prioritaet
        direction: DESC

    # Gruppierung mit Zwischenüberschriften
    groupBy:
      property: status
      direction: ASC

    # Ansichtsspezifischer Zusatzfilter (optional)
    filters: "erledigt == false"
```

---

## 6. Vollständiges Beispiel zum Kopieren

```yaml
filters:
  and:
    - "file.inFolder('Projekte')"
    - "status != 'archiviert'"

formulas:
  tageUebrig: "round((date(deadline) - today()) / '1 day')"
  gesamtkosten: "round(stunden * stundensatz, 2)"
  statusHinweis: "if(tageUebrig < 0, '⚠️ Überfällig', 'Im Zeitplan')"

properties:
  file.name:
    displayName: "Projekt"
  status:
    displayName: "Status"
  formula.gesamtkosten:
    displayName: "Kosten (€)"
  formula.tageUebrig:
    displayName: "Tage übrig"
  formula.statusHinweis:
    displayName: "Hinweis"

views:
  - type: table
    name: "Projektübersicht"
    order:
      - file.name
      - status
      - formula.gesamtkosten
      - formula.tageUebrig
      - formula.statusHinweis
    columnSize:
      file.name: 250
      status: 120
      formula.gesamtkosten: 110
      formula.tageUebrig: 110
      formula.statusHinweis: 130
    sort:
      - property: formula.tageUebrig
        direction: ASC
    groupBy:
      property: status
      direction: ASC

  - type: cards
    name: "Kartenansicht"
    groupBy:
      property: status
      direction: ASC
```
