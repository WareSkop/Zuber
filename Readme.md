# Knowmesh

Knowmesh is a self-hosted, lightweight, and **offline-first knowledge management system** that serves pure Markdown notes via a modern web interface and Progressive Web App (PWA).

The project started as a personal hobby project built with the assistance of **Google Antigravity**. It is not intended to be a full-blown replacement for Obsidian, but rather a tailored solution meeting specific personal requirements: storing all data centrally on a self-hosted server, running seamless background synchronization across devices without external tools, and delivering fluid performance on Chromebooks and mobile devices.

---

## Why Knowmesh? (The Motivation)

Existing note-taking tools and knowledge management systems often involve trade-offs:
- **Obsidian** is an industry benchmark for longevity and data ownership through pure Markdown, but it can feel sluggish on **Chromebooks** (especially when run via the Linux container) and lower-powered devices.
- Many cloud-based solutions lock notes into proprietary databases or third-party servers.
- Setting up Obsidian sync with external tools (such as Syncthing, Git plugins, or third-party sync apps) works, but adds overhead and requires maintaining separate synchronization background services on each device.

**Knowmesh combines the best of both worlds:**
1. **Central Server:** All Markdown notes and attachments reside directly on your own server or NAS.
2. **True Offline-First PWA:** The client runs in the browser, can be installed as a standalone app (WebAPK / PWA) on Android, ChromeOS, and Desktop, and automatically synchronizes notes to a local IndexedDB. You can read, edit, or create notes offline—as soon as a connection is restored, changes sync seamlessly in the background.
3. **Smooth on Chromebooks & Mobile Devices:** No heavy runtime containers or desktop frameworks are required; the app boots instantly and maintains minimal resource usage.

---

## Data Ownership, Markdown & Synergy with AI / OKF

Knowmesh is built on the philosophy that personal knowledge should never be trapped in proprietary silos:

* **Plain Markdown & File System Storage:** All notes remain plain, human-readable `.md` files with optional YAML frontmatter on your disk. Even without Knowmesh running, your data can always be accessed and edited with any standard text editor, Git, or command-line utility.
* **Ready for Local AI & LLMs:** Because files are stored as plain text rather than binary database records, local AI tools, agent frameworks, and Large Language Models (e.g., Ollama, Antigravity) can directly parse, search, and semantically process your notes on the file system.
* **Open Knowledge Frameworks (OKF) & Semantic Links:** Following open knowledge paradigms, Knowmesh emphasizes structured, machine-readable, and interoperable metadata. Using standardized frontmatter, explicit wiki-link connections (`[[Note]]`), and visual properties, Knowmesh builds an open knowledge graph ready for semantic queries and modern AI pipelines.

---

## Key Features

* **Live-Preview Markdown Editor:**
  * Obsidian-like editing with three view modes: `Live-Preview` (powered by CodeMirror 6), fully rendered `Reading` mode, and raw `Source` mode.
  * Visual properties editor (frontmatter) above the note body without exposing raw YAML syntax[cite: 1].
  * Mobile formatting toolbar for touch devices (headings, formatting, lists, tables, checkboxes, camera/image attachments).
  * Distraction-free **Zen Mode** (`Alt + Z`) for focused writing.
* **Interactive Knowledge Graph:**
  * HTML5 2D canvas with physics simulation, screen-space semantic zoom, anti-overlap label culling, and dandelion-style note clustering[cite: 1].
  * Filter and color groups (e.g., by folder `path:` or `#tags`).
* **Offline Synchronization & Outbox:**
  * Full note and metadata synchronization to local IndexedDB.
  * Robust mutation outbox handling offline edits with interactive conflict resolution on reconnect.
* **File Management:**
  * Context menu in the file tree for Copy, Move, Paste, Rename, and Delete operations.
* **Themes & Localization:**
  * 5 built-in color themes (Basalt/Dark-Gold, Dark Cold, Dark Warm, Light Cold, Light Warm).
  * Bilingual interface supporting English (default) and German.
* **Security & Network Architecture:**
  * In-memory rate limiting against brute-force attacks, DOMPurify sanitization preventing stored XSS, token-based session management, and reverse-proxy compatibility (Nginx Proxy Manager)[cite: 1].

---

## Installation & Deployment

### Option A: Docker Compose (Recommended)

Knowmesh is packaged for containerized deployment (e.g., via Dockge, Portainer, or CLI) behind a reverse proxy such as **Nginx Proxy Manager**[cite: 1].

1. Create a `docker-compose.yml` file:

```yaml
services:
  knowmesh:
    image: codeberg.org/waring/knowmesh:latest
    container_name: knowmesh
    restart: unless-stopped
    ports:
      - "3443:3443"
    environment:
      - NODE_ENV=production
      - PORT=3443
      - ENABLE_HTTPS=false          # Keep false when Nginx / reverse proxy handles SSL termination
      - TRUST_PROXY=true           # Enables client IP forwarding for rate limiting
      - FORCE_AUTH=true            # Enforces password protection in production
      - VAULT_DIR=/data/vault
      - CONFIG_PATH=/data/config/server-config.json
      - SESSION_SECRET=please_generate_a_long_random_string_here
      - KNOWMESH_PASSWORD=your_initial_password
      - ALLOWED_ORIGINS=[https://knowmesh.yourdomain.com](https://knowmesh.yourdomain.com)
    volumes:
      - ./vault:/data/vault
      - ./config:/data/config