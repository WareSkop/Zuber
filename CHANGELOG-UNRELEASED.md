### Added
- Graphical Canvas, Workflow & Network Diagram Editor (`.canvas`):
  - 100% Obsidian JSON Canvas 1.0 specification compatible with graceful degradation for extended shapes.
  - Interactive diagramming powered by `@xyflow/react` with smooth zooming, panning, mini-map, background grid options (dots, lines, off), and touch/pinch support.
  - Extended shapes: `rectangle`, `rounded`, `circle`, `diamond`, `parallelogram`, `hexagon`, `cylinder`, `cloud`, `server`, `router`, `workstation`.
  - Rich custom nodes: Markdown shape nodes with inline `[[Wiki-Link]]` and `#tag` navigation, embedded note/image preview nodes (`type: "file"`), group container nodes (`type: "group"`), and external URL link cards (`type: "link"`).
  - Floating dock toolbar with shape drawers (Workflow & Network), quick note embedding picker, undo/redo history stack (Ctrl+Z / Ctrl+Y), fit-view, and grid snapping.
  - Contextual floating inspector for selecting shapes, 6 Obsidian color presets, connection routing (straight, smooth bezier, step/orthogonal), arrow heads, labels, and deletion.
  - Full backend indexing in `VaultService`: `.canvas` files appear in the file tree with `attachmentKind: 'canvas'` and `<Layout />` icon, integrate into the global knowledge graph with outgoing edges, backlink discovery, and sync manifest.
  - Embedded canvas preview (`![[Workflow.canvas]]` or `![Canvas](Workflow.canvas)`) directly rendered inside Markdown notes in both Live-Preview and Reading views with one-click editor opening.
  - Offline-first caching and outbox mutation persistence in IndexedDB (`localDb.ts`) and `SyncEngine`.
- Containerized Git versioning & automated HTTPS remote backup:
  - Added Git integration running directly inside the Knowmesh server container (`/data/vault`).
  - Added Git settings in UI (`SettingsModal.tsx`) with author identity (name, email), repo status (modified/untracked counts, last commit), manual commit, and remote backup configuration (Codeberg, GitHub, GitLab via HTTPS).
  - Added secure credential handling: credentials in remote URLs and tokens are masked across logs, error messages, and frontend status responses.
  - Added auto-commit triggers on note change/leave and upon ending web sessions (debounced WebSocket disconnect).
  - Added automated pre-push commits and remote connection testing (`git ls-remote`).
- Smartphone & mobile optimizations:
  - Added dual font size matrix (Desktop vs. Mobile & UI vs. Editor) with 4 reactive sliders in SettingsModal under "Editor & Files", persisted in `localStorage` (`knowmesh_font_settings`) and applied via CSS variables `--km-font-size-ui` and `--km-font-size-editor`.
  - Added full-screen sidebars on mobile (`100vw`, `inset: 0`, `z-index: 500`, `background: var(--bg-primary)`) with close buttons and smooth `slideInLeft` / `slideInRight` animations.
  - Added touch swipe gestures on mobile (`< 768px`) with strict vertical scroll protection (`absY >= absX` suppression, `1.4` dominance ratio, and `50px` threshold) to close the left sidebar on swipe-left, close the right sidebar on swipe-right, and open the left sidebar from the edge.

### Changed
- Minimal editor horizontal padding on smartphones (`< 768px`): zero horizontal padding on outer scroll containers, 8px on `.cm-content`, `.reading-view-container`, and `.properties-panel`, while keeping desktop (`>= 768px`) centered at `max-width: 820px; margin: 0 auto;`.
- Enhanced Docker publication script to automatically tag and push both `:latest` and `:v<version>` packages to Codeberg Container Registry.

### Fixed
- Fixed new devices (e.g., Chromebook) showing an empty offline Vault after login and failing to sync newly created notes to the server because `SyncEngine` remained in `offline` state after authentication.
- Fixed offline mode file & folder creation where creating a second note or folder could collide with default names, get delayed by pending auto-save timers or network timeouts, or fail to reconcile into the local IndexedDB file tree.
