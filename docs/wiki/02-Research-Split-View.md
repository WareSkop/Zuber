# 2. Research Split-View

When writing technical documentation, synthesizing meeting notes, or comparing diagrams, constantly switching tabs breaks your concentration. Zuber's **Research Split-View** lets you keep your active note locked on the left while browsing reference material on the right.

---

## 1. Asymmetric 70/30 Split Concept

- **Left — Primary Editor (70% default):** Full interactive editing focus (`LivePreviewEditor`, `CanvasEditor`, or `BaseEditor`). Your cursor position, scroll state, and active document remain undisturbed.
- **Right — Research Pane (30% default):** Strictly **Read-Only** reference viewer. You can inspect notes, diagrams, and PDFs without accidentally modifying them.
- **Draggable Resizer:** Drag the vertical splitter bar between the two panes to adjust the split ratio anywhere between **20% and 80%** (persisted in `localStorage` under `zuber_split_ratio`).

![Asymmetric 70/30 Research Split-View](images/05-research-split-view.png)

---

## 2. Smart Click-Routing & `Alt+Click` Override

When the Research Split-View is **open**:

| Action | Destination |
| :--- | :--- |
| **Normal Click** on a file in the File Tree, a `[[Wiki-Link]]`, or a Backlink | Opens in the **Right Research Pane** (Primary Editor stays untouched) |
| **`Alt + Click`** on a file in the File Tree, a `[[Wiki-Link]]`, or a Backlink | Opens in the **Left Primary Editor** |
| **Open in Main Editor** button (`←`) in the Research Pane header | Moves the currently viewed reference document into the Left Primary Editor |

> [!TIP]
> Right-clicking any file in the File Tree also offers explicit **Open in Research View** and **Open in Main Editor (Alt+Click)** menu actions.

---

## 3. Supported Reference Formats

The Research Pane renders all major vault formats natively:
1. **Markdown Notes (`.md`):** Full Reading Mode rendering (Callouts, Task lists, Tables, Mermaid diagrams, Inline Images, PDF embeds).
2. **Canvas Diagrams (`.canvas`):** Interactive read-only pan and zoom viewer powered by `@xyflow/react`.
3. **Bases (`.base`):** Interactive read-only database view.
4. **Images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`):** Centered viewer with Zoom In / Zoom Out / Fit controls.
5. **PDF Documents (`.pdf`):** Embedded PDF viewer.
6. **Knowledge Graph (`graph`):** Toggle directly to the interactive Knowledge Graph inside the Research Pane header.

---

## 4. Automatic Back-Button & Right-Sidebar Sync

Zuber keeps navigation and context coherent while Research Split-View is active:

- **Topbar Back-Button (`←` / `Alt+←`):** Maintains a dedicated `researchHistory` stack. Clicking Back (or pressing `Alt+ArrowLeft`) navigates backward through the documents you opened in the **Right Research Pane**. Holding **`Alt + Click`** on the Back button steps back in the **Left Primary Editor** instead.
- **Right-Sidebar Mentions & Local Graph Sync:** When the Research Pane is open, the Right Sidebar automatically tracks the **active reference document** (indicated by a target badge at the top of the Backlinks panel) so you can explore linked/unlinked mentions and local graph connections for what you are researching. Closing the Research Pane immediately switches the Right Sidebar back to your Primary Editor note.

---

## 5. Zen Split-View (`Alt+Z`) & Mobile Vertical Split

- **Zen Mode (`Alt+Z`):** Enabling Zen Mode while Research Split-View is open hides the topbar, sidebars, and toolbars while **preserving both split panes** and keeping the 1px center divider draggable.
- **Mobile Vertical Split (`< 768px`):** On smartphones, Research Split-View automatically switches from a horizontal side-by-side layout to a **vertical top/bottom split** (reference pane on top, editor on bottom) so the on-screen keyboard never obscures your reference material. You can also toggle Columns ⇄ Rows manually using the orientation button in the Research Pane header.

![Zen Mode Preserving 70/30 Split-View](images/06-zen-split-mode.png)
