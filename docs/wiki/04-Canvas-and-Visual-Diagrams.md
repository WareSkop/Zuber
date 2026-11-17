# 4. Canvas & Visual Diagrams

Zuber features a built-in visual **Canvas, Workflow & Network Diagram Editor** for `.canvas` files, built on `@xyflow/react` and **100% compatible with the official Obsidian JSON Canvas 1.0 specification**.

---

## 1. JSON Canvas 1.0 + Extended Shapes

Every `.canvas` file is saved as clean, standard JSON (without YAML frontmatter). Alongside standard Obsidian cards, groups, and web links, Zuber supports **11 geometric, workflow, and network shapes** with graceful degradation if opened in Obsidian Desktop:

| Category | Shapes |
| :--- | :--- |
| **General / Workflow** | `rectangle`, `rounded`, `circle`, `diamond` (Decision), `parallelogram` (I/O), `hexagon` (Filter/Prep) |
| **System / Network** | `cylinder` (Database), `cloud` (Internet/Cloud), `server` (Server/VM), `router` (Router/Firewall), `workstation` (Client) |

![Canvas Workflow and Network Diagram](images/11-canvas-workflow.png)

---

## 2. Creating Nodes, Groups & Connections

Use the top floating **Canvas Toolbar** to add elements:
- **+ Text:** Add a Markdown text/shape node. Double-click any shape (or select it and start typing directly — *Type-to-Edit*) to edit its Markdown content.
- **Embed Note:** Search and embed any `.md` note from your vault as a live preview card (`CanvasFileNode`) with an **Open ↗** button.
- **Group:** Create a labeled visual container. Dragging a group automatically moves all enclosed child nodes together.
- **Workflow ⌄ / Network ⌄:** Drop pre-styled workflow or infrastructure shapes onto the canvas.
- **Box Select (`Marquee`):** Toggle drag-box selection (or hold `Shift` + drag) to select, move, duplicate, or delete multiple nodes at once.
- **Grid & Snap:** Configure grid visibility (`Dots`, `Lines`, `Off`) and snap size (`10px`, `15px`, `20px`, `25px`).

### Smart Edge Drawing & Auto-Node Creation
- Hover over (or tap on touch devices) any node to reveal its 4 connection handles (`top`, `right`, `bottom`, `left`).
- Drag from a handle to another node to create a directed arrow edge.
- **Drop onto Empty Canvas:** Dragging a connection handle onto empty space automatically creates a new connected node at the drop location, docked to the nearest side!
- **Reconnect Edges:** Select any edge (highlighted in gold) and drag its endpoints to attach it to a different node.

---

## 3. Wiki-Links Inside Canvases & Vault Integration

Canvases are first-class citizens in Zuber's vault index:
- Typing `[[` inside any shape or edge label opens **Wiki-Link Autocomplete**.
- Embedded note cards (`type: file`) and `[[Wiki-Links]]` inside shapes or edge labels automatically appear in the **Knowledge Graph** and **Backlinks** panel.
- Renaming or moving a note in the File Tree automatically updates all references inside `.canvas` files.

---

## 4. Right-Click Context Inspector & Floating Toolbar

- **Left-clicking** a node or edge displays the floating **Canvas Inspector** at the bottom of the screen to change colors, shapes, edge routing (`Bezier`, `Straight`, `Step`), labels, or duplicate/delete items.
- **Right-clicking** any node or edge opens the Inspector directly at your cursor position for fast adjustments.

---

## 5. Embedding Canvases in Markdown Notes

Include live, interactive pan-and-zoom diagrams inside any Markdown note:

```markdown
![[System-Architecture.canvas]]
![[System-Architecture.canvas|420]]
```

Clicking the diagram title in the embed header opens the full `.canvas` file in the Canvas Editor.

---

## 6. Canvas Presentation Mode (Slides, Camera Path & Progressive Reveal)

Turn any `.canvas` diagram into a smooth, resolution-independent presentation stored directly inside the `.canvas` JSON (`"presentation"` key, 100% compatible with Obsidian JSON Canvas 1.0):

- **Resolution-Independent Slides:** Click **Presentation** in the Canvas Toolbar to open the Presentation Panel, then pan/zoom to any region and click **+ Capture Current View**. Slides store world-space `bounds` (`x`, `y`, `width`, `height`), guaranteeing identical framing on 1080p, 4K, ultrawide, and tablet screens.
- **Per-Slide Element Visibility & Ghosting:** When a slide is selected in the panel, you can hide nodes for that slide via the **Canvas Inspector** (`EyeOff`) or click the `EyeOff` badge on ghosted nodes (`opacity: 0.35`) to reveal them again. Deleted nodes are automatically pruned from `hiddenNodeIds`.
- **Configurable Camera & Reveal Timing:** Expand the **Settings (`⚙`)** section to adjust global **Camera Speed** (`200–2500 ms`), **Camera Arc** (`None`, `Subtle`, `Medium`, `Strong` parabolic zoom-out between distant slides), **Element Reveal Speed**, **Reveal Delay**, and **Stagger Delay**, or override timing per slide.
- **Fullscreen Playback & Controls:** Click **Start Presentation** or **Play from Current** to enter a distraction-free fullscreen stage.
  - `Space`, `ArrowRight`, `PageDown`, or `Enter`: Advance to the next slide (or fast-forward a running transition/reveal). Edges appear automatically once both connected nodes are visible.
  - `ArrowLeft` or `PageUp`: Step back cleanly to the previous slide.
  - `Escape`: Exit presentation mode.
  - A minimal bottom-center **Floating HUD** auto-fades when the mouse is idle.
