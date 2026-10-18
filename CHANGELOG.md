# Changelog

All notable changes to Knowmesh will be documented in this file.

## [0.2.0] - 2026-10-18
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
- File & folder upload and download in file tree context menu:
  - Multi-file and recursive directory upload (`webkitdirectory`) with directory structure preservation and strict path traversal validation (`POST /api/vault/upload-entries`).
  - Single file download (attachment) and streaming folder/vault ZIP archive generation (`GET /api/vault/download`) using `archiver` with automatic dotfile and configuration folder (`.git`, `.obsidian`) exclusion.
  - Offline fallback generating browser Blobs from local IndexedDB cache for single `.md` and `.canvas` note downloads.
  - Interactive file tree context menu entries: "Dateien hochladen…", "Ordner hochladen…", "Datei herunterladen", "Ordner herunterladen (.zip)", and "Gesamten Vault herunterladen (.zip)".
  - Added visual upload status feedback in the sidebar (`.sidebar-upload-status-toast`).
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
- Fixed Canvas Context Inspector layout & popover orientation:
  - Transformed bottom floating node & edge context inspector into a horizontal pill bar (`bottom: 20px; left: 50%; transform: translateX(-50%); border-radius: 9999px;`).
  - Configured Shape picker, Color swatches, and Wiki-link popover menus to open upwards (`bottom: calc(100% + 10px)`), eliminating viewport clipping at the screen bottom.
  - Added global click-outside listener to cleanly dismiss open inspector popovers.
- Fixed `.canvas` editor display and interaction issues:
  - Repaired 0-height React Flow container chain (`.canvas-workspace-pane`, `.canvas-editor-wrapper`, `.canvas-reactflow-container`) so background grid and controls render properly across the entire workspace.
  - Rebuilt floating toolbar as a clean horizontal bar with flex-row buttons, divider, and dropdown menus (`Workflow ⌄`, `Netzwerk ⌄`, `Notiz einbetten ⌄`).
  - Fixed state-echo loop between `App.tsx` and `CanvasEditor.tsx` where saving state would overwrite and reset newly added nodes.
  - Fixed node spawn coordinates using robust viewport and container bounding box calculations to ensure new shapes appear centered on the screen.
  - Added `@xyflow/react/dist/style.css` imports to both `CanvasEditor.tsx` and `CanvasEmbedWidget.tsx`.
- Fixed `.canvas` file wipe on note leave or reopening:
  - Resolved missing `rawContent` property in `POST /api/vault/note` route destructuring in `server/index.ts`, preventing server fallback to `{}` when saving canvas files.
  - Added defensive `body: newJson` alongside `rawContent: newJson` in `src/App.tsx` canvas save scheduler.
  - Added immediate `flushSave` on unmount and note switch in `CanvasEditor.tsx` to flush debounced canvas edits before the editor unmounts.
  - Connected `CanvasShapeNode` text editing and `CanvasGroupNode` label editing to `CanvasContext` (`onUpdateNodeData`) to trigger auto-save and push to undo/redo history.
- Fixed Canvas Context Inspector buttons overflowing toolbox container:
  - Updated `.canvas-floating-inspector` border-radius to a modern 12px dock with `box-sizing: border-box`, `padding: 6px 14px`, and `height: 44px`, preventing button corners and hover outlines from sticking out beyond circular pill caps.
  - Refined `.inspector-tool-btn` with `border-radius: 8px` and dedicated `.icon-only` styling (`32px x 32px`, `padding: 0`).
  - Ensured Node and Edge inspectors are strictly mutually exclusive so both rows cannot render simultaneously.
- Fixed Wiki-Links inside Canvas objects not being clickable or visibly styled as links:
  - Rendered `[[Wiki-Links]]` as `<a href="#" class="cm-wikilink-widget canvas-wikilink nodrag" ...>` and added `handleDisplayMouseDown` to stop propagation on mouse down, preventing React Flow node dragging from intercepting link clicks.
  - Connected `onOpenNote` in `App.tsx` directly to `handleNavigateWikiLink(targetPath)` for instant local resolution, alias handling, and auto-creation of missing linked notes.
  - Styled `.canvas-wikilink` in `styles.css` with gold accent color, underline, pointer cursor, and hover background highlights.
  - Enabled Wiki-Link and anchor click navigation in embedded Markdown previews inside `CanvasFileNode`.
- Fixed new devices (e.g., Chromebook) showing an empty offline Vault after login and failing to sync newly created notes to the server because `SyncEngine` remained in `offline` state after authentication.
- Fixed offline mode file & folder creation where creating a second note or folder could collide with default names, get delayed by pending auto-save timers or network timeouts, or fail to reconcile into the local IndexedDB file tree.

## [0.1.0] - 2026-10-17
### Added
- Initial release of Knowmesh (formerly Obsidian Web Vault / Basalt).
- Offline-first PWA architecture with IndexedDB caching and robust outbox synchronization.
- Multi-server profile management and server-side password security settings.
- Responsive touch support, mobile swipe-to-open drawer, and Live-Preview Markdown editor.
- Internationalization (i18n) supporting English (default) and German in the appearance settings.
- Configurable startup behavior under "Editor & Files" (Last note, Daily note, or Specific note).
- File tree context menu supporting Copy, Move, Paste, Rename, and Delete actions.
- Docker setup and Codeberg CI/CD container registry integration.
