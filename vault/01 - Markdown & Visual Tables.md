---
tags:
  - markdown
  - tables
  - editor
_tableWidths:
  Feature | Shortcut / Action | Persistence:
    - 190
    - 250
    - 210
---

# 01 - Markdown & Visual Tables

Zuber's CodeMirror 6 **Live-Preview Editor** renders headings, bold/italic text, `==highlights==`, task lists, callouts, images, and interactive tables cleanly without hiding your plain-text Markdown roots.

> [!NOTE] Editor Modes
> Switch anytime between **Live-Preview**, **Reading**, and **Source Code** (`Quellcode`) in the topbar. YAML frontmatter is managed visually in the **Properties** panel above, while internal keys prefixed with `_` (such as `_tableWidths`) stay hidden from the Properties UI.

## Visual In-Place Markdown Table Editing

Click any cell in the table below — the table **stays visually rendered** instead of collapsing into raw pipe-delimited Markdown:

| Feature | Shortcut / Action | Persistence |
| :--- | :--- | :--- |
| Direct cell editing | Click any header or body cell | Saved as standard GFM pipes |
| Move down / add row | Press `Enter` (`Shift+Enter` for `<br>`) | Appends empty row at bottom |
| Next / previous cell | Press `Tab` / `Shift+Tab` | Wraps across rows |
| Resize columns | Drag header column border | Saved in YAML `_tableWidths` |
| Sort rows | Click `↑` / `↓` in header | Physical Markdown row reorder |

> [!TIP] Try It Yourself
> - Hover over the **right** or **bottom** edge of the table to reveal the `+ Column` and `+ Row` quick-add bars.
> - Right-click any cell for alignment (`Left`, `Center`, `Right`) and row/column insertion or deletion.

## Tasks & Embedded Media

- [x] Try editing a cell in the table above with `Enter` and `Tab`
- [x] Drag a column divider to test `_tableWidths` persistence
- [ ] Click a column sort button (`↑` / `↓`) to sort rows physically in Markdown
  - [ ] Switch to **Source Code Mode** to inspect the clean generated Markdown

![[zuber-architecture.svg]]

## Print & PDF Export

You can export any note cleanly to PDF via the **Export as PDF** toolbar button or the file tree context menu. Use `<!-- pagebreak -->` whenever you want to force a clean page break in printed output.
