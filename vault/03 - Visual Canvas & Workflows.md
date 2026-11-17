---
tags:
  - canvas
  - diagrams
  - architecture
---

# 03 - Visual Canvas & Workflows

Zuber's graphical **`.canvas` editor** is powered by `@xyflow/react` and stays 100% compatible with the **Obsidian JSON Canvas 1.0** specification.

## Extended Workflow & Network Shapes

Beyond standard rectangles and groups, Zuber provides 11 shape primitives with graceful degradation in standard Obsidian:
- `cloud`, `router`, `server`, `workstation` for infrastructure & homelab topologies
- `cylinder` (databases), `diamond` (decisions), `hexagon`, `parallelogram`, `circle`, `rounded`, `rectangle`

## Images, Custom Shapes & Clickable Links

- **Insert Images:** Click **Image ⌄** in the Canvas toolbar, drag images from the File Tree or desktop onto the canvas, or paste clipboard images (`Ctrl+V`).
- **11 Image Shapes:** Select any image card and choose a shape (such as **Circle** or **Diamond**) from the Inspector's compact icon grid.
- **Attach Links:** Assign an internal vault note or external URL via **Link** in the Inspector (`Ctrl/Cmd+Click` or double-click in Edit Mode; single-click in Presentation Mode).

## Presentation Mode

Open **Presentation** in the Canvas toolbar to capture resolution-independent slides, hide elements per slide, configure camera arcs, and play back in fullscreen.

## Interactive Demo Canvas

Open [[Architecture-Workflow.canvas]] directly or interact with the embedded preview below:

![[Architecture-Workflow.canvas|420]]
