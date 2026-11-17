# Zuber

Zuber is a self-hosted, lightweight, and **offline-first knowledge management system** that serves pure Markdown notes and visual canvases via a modern web interface and Progressive Web App (PWA).

The project originated as a personal hobby project developed with the assistance of **Google Antigravity**. It is not designed to be a complete replacement for Obsidian, but rather a tailored solution built to address specific personal requirements: storing all notes and files centrally on a personal server or NAS, providing seamless automatic background synchronization across devices without external sync tools, and delivering fluid, responsive performance on Chromebooks and mobile devices.

---

## Why Zuber? (The Motivation)

Existing note-taking tools and Personal Knowledge Management (PKM) systems often require compromises:
- **Obsidian** is an industry benchmark for longevity and data sovereignty through plain Markdown, but it can feel sluggish on **Chromebooks** (especially when run inside a Linux container) and lower-powered mobile devices.
- Many cloud-based note platforms lock thoughts into proprietary databases or third-party servers.
- Synchronizing Obsidian across devices with external tools (such as Syncthing, Git plugins, or separate background services) functions, but introduces maintenance overhead and complexity on every device.

**Zuber combines the best of these approaches:**
1. **Central Server Storage:** All Markdown notes, attachments, and canvases reside directly on your own server or NAS.
2. **True Offline-First PWA:** The client runs in the browser, installs as a standalone app (WebAPK / PWA) on Android, ChromeOS, and Desktop, and synchronizes the entire vault index into a local IndexedDB. You can read, edit, or create notes and folders completely offline—as soon as connectivity is restored, all mutations sync seamlessly with the server.
3. **Optimized for Chromebooks & Mobile Devices:** Minimal resource footprint, rapid boot times, and responsive touch controls without needing heavy desktop container wrappers.

---

## Data Ownership, Markdown & Synergy with AI / OKF

Zuber is built on the conviction that personal knowledge should never be trapped in proprietary silos:

- **Plain Markdown & File System Storage:** All notes remain plain, human-readable `.md` files with standard YAML frontmatter on your disk. Even if Zuber is stopped, every document remains 100% accessible via any standard text editor, Git client, or terminal tool.
- **Ready for Local AI & LLMs:** Because files are stored directly on the file system rather than inside binary database blobs, local AI agents and Large Language Models (such as Ollama, Antigravity, or local embedding pipelines) can directly search, parse, summarize, and cross-reference your knowledge base.
- **Open Knowledge Frameworks (OKF) & Semantic Links:** Following open knowledge principles, Zuber emphasizes structured, machine-readable, and interoperable metadata. Through standardized frontmatter properties, bidirectional wiki-links (`[[Note]]`), and visual relation graphs, Zuber creates an open knowledge graph ready for semantic queries and modern AI workflows.

---

## Key Features

### 1. Markdown Editor & Writing Experience
- **Live-Preview Mode (CodeMirror 6):** Obsidian-like rich editing that visually renders headings, bold/italic formatting, highlights, task checkboxes, tables, callouts, and internal links while the cursor is outside the element.
- **Reading & Source Modes:** Instant switching between fully rendered HTML reading view and raw Markdown source view.
- **Visual In-Place Markdown Tables:** Interactive `TableWidget` editing right inside Live-Preview with `Tab`/`Enter` cell navigation, column-width drag-resizing (`_tableWidths`), and physical sorting.
- **PDF Export & Email Integration (SMTP / IMAP):** Client-side note printing/PDF export (`Export as PDF…` with `<!-- pagebreak -->` support and canvas/base capture), outbound email export as `.md` or `.pdf`, and an optional IMAP Mail-to-Inbox watcher (`Inbox/YYYY-MM-DD <Subject>.md`).
- **Visual Properties Editor:** Interactive form above the note body to manage frontmatter properties (`text`, `number`, `checkbox`, `date`, `list`, `tags`) without exposing raw YAML syntax.
- **Mobile Touch Toolbar:** Sticky, touch-friendly formatting bar with quick actions for headings (`H1`–`H6`), formatting, lists, tables, callouts, and photo/camera uploads.
- **Smart URL Pasting & Links:** Pasting an HTTP/HTTPS link automatically formats it into a Markdown link (or wraps the selected word), alongside a dedicated external link insertion tool.
- **Distraction-Free Zen Mode (`Alt + Z`):** Hides all sidebars, toolbars, and tabs, leaving a cleanly centered, distraction-free writing canvas with window-edge scrolling.

### 2. Graphical Canvas & Workflow Editor (`.canvas`)
- **Obsidian JSON Canvas 1.0 Compatible:** Native visual canvas editor powered by `@xyflow/react` that reads and writes standard `.canvas` files.
- **Extended Workflow & Network Shapes:** Includes 11 shape primitives for workflow modeling and network diagrams (`rectangle`, `rounded`, `circle`, `diamond`, `parallelogram`, `hexagon`, `cylinder`, `cloud`, `server`, `router`, `workstation`) with graceful degradation in standard Obsidian, plus a compact 4-column icon shape picker with hover tooltips.
- **Images, Custom Shapes & Clickable Links:** Insert images via the toolbar **Image** picker (upload from device or pick existing vault images), **Drag & Drop** from the File Tree or desktop, or **Paste (`Ctrl+V`)**. Any image node can be masked into any of the 11 shapes, attached with clickable links (`link`) to vault notes or external web URLs, and connected via enlarged desktop/touch edge handles.
- **Canvas Presentation Mode:** Turn any canvas into a resolution-independent presentation with world-space slides, smooth camera zoom arcs, per-slide element visibility/ghosting (`hiddenNodeIds`), progressive reveals, and a distraction-free fullscreen player HUD.
- **Vault Integration & Cycle Guard:** Embed Markdown notes (`CanvasFileNode`) with full image, callout, `.zenc`, and nested non-circular `.canvas` rendering while automatically preventing infinite circular canvas recursion.

### 3. Bases (`.base`), Kanban Boards & Zero-Knowledge Folder Encryption
- **Obsidian Bases & 1D/2D Kanban Boards:** Structured YAML `.base` views (`Table`, `Cards`, and `Board`) with visual filter chips, formulas, collapsible 2D swimlanes, and single-column mobile Kanban with `<BottomSheet>` controls.
- **Zero-Knowledge Folder Encryption (`.zenc`):** Optional client-side `PBKDF2` + `AES-256-GCM` per-folder encryption with auto-lock, IndexedDB purge on lock, transparent unlocked editing/attachment decryption, and optional WebAuthn biometric unlock.

### 3. In-Container Git Versioning & Remote Backup
- **Server-Side Git Engine:** Git runs directly inside the Docker container on the vault directory (`/data/vault`) without requiring Git installed on the host.
- **Automated Commits:** Automatically commits changes when leaving an edited note or upon session disconnect (WebSocket close).
- **Per-File Version History & Diff Viewer:** Open the version history of any note via the context menu to inspect a line-by-line colored diff (+/-) across previous commits and restore any earlier version with one click.
- **Remote HTTPS Backup:** Configurable automated push to remote Git platforms (GitHub, Codeberg, GitLab) using a Personal Access Token / app password with a built-in "Test Connection" tool.

### 4. Android Web Share Target (`Inbox/` Integration)
- **Native Android "Share with..." Support:** When installed on Android, Zuber registers as a system share destination.
- **Multi-Format Ingestion:** Sharing links, highlighted text, photos, PDFs, or Markdown files from any Android app automatically creates organized entries inside your `Inbox/` folder.
- **Offline Share Safe:** Incoming shared files are buffered locally via the Service Worker and IndexedDB, ensuring shares succeed even while in airplane mode.

### 5. Interactive Knowledge Graph
- **High-Performance 2D Canvas:** Force-directed graph powered by spatial hashing ($O(N)$ repulsion) capable of smoothly rendering vaults with 1,800+ notes.
- **Screen-Space Semantic Zoom & Anti-Collision:** Node distances scale in world space while node radii and labels remain crisp in screen space. A 2D bounding-box algorithm prevents label overlapping.
- **Filter & Color Groups:** Custom color rules by folder `path:`, `#tags`, or search queries.

### 6. UI, Navigation & Diagnostics
- **Latching Favorites & Recent Notes:** Toggleable panels positioned above the file tree to quickly access starred files/folders and the last 10 visited notes.
- **Resizable Sidebars:** Smooth drag-resizing for left and right sidebars on desktop with persistent width storage.
- **Mobile Drawer & Touch Gestures:** Full-screen mobile sidebars (100vw) that open and dismiss via smooth horizontal swipe gestures.
- **Configurable Font Sizes:** Independent font size sliders for UI elements vs. editor content across desktop and mobile devices.
- **Configurable Startup Note:** Choose between resuming the last active note, opening a daily note (`YYYY-MM-DD.md`), or launching a specific predefined note.
- **Unified 4-Mode Search & In-Note Jump Bar:** Shared whole-word-by-default search engine with `*` wildcards, `+`/`-` boolean operators, `"..."` exact phrases, relevance ranking, and a floating desktop `Ctrl+F` In-Note Jump Bar.
- **Integrated Diagnostics, Debug Mode & Log Export:** Dedicated "Logs & Diagnostics" settings tab with selectable log levels (`DEBUG`, `INFO`, `WARN`, `ERROR`), persistent crash-resilient client/server logs, environment metadata, and `.txt` report export / Web Share / "Copy for Antigravity".
- **Themes & Localization:** 5 built-in color themes (Zuber Dark-Gold, Dark Cold, Dark Warm, Light Cold, Light Warm) and full English & German UI localization (100% key parity).

---

## Installation & Deployment

### Option A: Docker Compose with Reverse Proxy (Recommended)

Zuber is distributed via the **GitHub Container Registry (`ghcr.io`)** and pre-configured for containerized deployment behind reverse proxies such as **Nginx Proxy Manager (NPM)**, Traefik, or Caddy.

#### Container Image Tags
- `ghcr.io/wareskop/zuber:latest`: Official stable production release (built exclusively on release tags, e.g. `v0.3.1`).
- `ghcr.io/wareskop/zuber:<version>` (e.g. `:0.3.1`): Pinned semantic version for reproducible production deployments.
- `ghcr.io/wareskop/zuber:dev`: Bleeding-edge development build (automatically built on branch pushes to test unreleased changes).

1. Create a `docker-compose.yml` file:

```yaml
services:
  zuber:
    image: ghcr.io/wareskop/zuber:latest
    container_name: zuber
    restart: unless-stopped
    ports:
      - "3443:3443"
    environment:
      - NODE_ENV=production
      - PORT=3443
      - ENABLE_HTTPS=false          # Keep false when Nginx / reverse proxy terminates SSL
      - TRUST_PROXY=true           # Passes client IP through for rate limiting
      - FORCE_AUTH=true            # Enforces authentication in production
      - MAX_UPLOAD_MB=100          # Attachment upload limit in MB
      - VAULT_DIR=/data/vault
      - CONFIG_PATH=/data/config/server-config.json
      - SESSION_SECRET=please_generate_a_long_random_string_here
      - PASSWORD=your_secure_password
      - ALLOWED_ORIGINS=https://zuber.yourdomain.com
    volumes:
      - ./vault:/data/vault
      - ./config:/data/config
```


2. Launch the container:
   ```bash
   docker compose up -d
   ```

> [!NOTE]
> **First-Install Demo Vault Seeding:** If `/data/vault` is empty on first startup, Zuber automatically copies the bundled interactive Demo Vault (`Welcome to Zuber.md`, sample `.base` boards, `.canvas` diagrams, and feature guides) into `VAULT_DIR`. Existing non-empty vaults are never touched.

3. **Nginx Proxy Manager Configuration:**
   - **Scheme:** `http`
   - **Forward Host / IP:** Container name (`zuber`) or Docker host IP
   - **Forward Port:** `3443`
   - **Websockets Support:** **Enabled** (essential for real-time vault synchronization via `/ws`)
   - **Block Common Exploits:** Enabled
   - **SSL Tab:** Request a Let's Encrypt certificate and enable *Force SSL* and *HTTP/2 Support*.
   - **Advanced Tab (for uploads up to 100 MB):**
     ```nginx
     client_max_body_size 100M;
     ```

---

### Option B: Local Setup (Development)

**Prerequisites:** Node.js 20+ and npm.

1. Clone the repository:
   ```bash
   git clone https://github.com/WareSkop/Zuber.git
   cd Zuber
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment:
   Copy `.env.example` to `.env` and set your desired port, password, and vault path.

4. Start development mode:
   ```bash
   npm run dev
   ```
   Runs the Node.js/Express backend on port 3443 and the Vite dev server on port 5173.

5. Run test suite and production build:
   ```bash
   npm test        # Runs Vitest unit and integration test suite
   npm run build   # Type-checks and bundles the frontend into dist/
   npm start       # Starts the production server
   ```
  

---

## Contributing & Community

Zuber was built to solve personal knowledge-management requirements, but is released as open-source software. You are welcome to use, fork, adapt, submit issues, or contribute pull requests to enhance Zuber!
