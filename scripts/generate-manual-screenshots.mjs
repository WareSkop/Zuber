import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const ROOT_DIR = process.cwd();
const OUT_DIR = path.join(ROOT_DIR, 'docs', 'wiki', 'images');
const DEMO_VAULT_DIR = path.join(os.tmpdir(), 'zuber-manual-demo-vault');
const DEMO_CONFIG_PATH = path.join(os.tmpdir(), 'zuber-manual-demo-config.json');
const PORT = 3499;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(relPath, content) {
  const fullPath = path.join(DEMO_VAULT_DIR, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function git(cmd) {
  execSync(`git ${cmd}`, { cwd: DEMO_VAULT_DIR, stdio: 'pipe' });
}

function setupDemoVault() {
  console.log(`[DemoVault] Creating temporary demo vault at ${DEMO_VAULT_DIR}`);
  ensureCleanDir(DEMO_VAULT_DIR);
  fs.rmSync(DEMO_CONFIG_PATH, { force: true });

  // Initialize Git repository
  git('init -b main');
  git('config user.name "Ingo"');
  git('config user.email "ingo@local"');

  // Commit 1: Initial Welcome.md & Project-Alpha.md
  writeFile(
    'Welcome.md',
    `---
status: active
tags:
  - dashboard
  - pkm
prio: Prio 1
---

# Welcome to Zuber

Your self-hosted, offline-first Markdown knowledge base and visual workspace.

> [!TIP] Inspired by Obsidian — Built for Everywhere
> All notes stay as 100% plain Markdown files on your disk, synced seamlessly across Desktop, Chromebook, and Android/iOS via PWA + Git.

## Quick Overview

| Area | Primary File | Purpose |
| :--- | :--- | :--- |
| Infrastructure | [[Server-Setup]] | Docker Compose + NPM TLS setup |
| Kanban Tracking | [[Project-Board.base]] | 1D & 2D task workflows |
| Diagrams | [[System-Architecture.canvas]] | JSON Canvas 1.0 network topology |

## Architecture Flow

\`\`\`mermaid
flowchart LR
  A[Mobile PWA / Chromebook] -->|HTTPS + WSS| B[Nginx Proxy Manager]
  B -->|Port 3443| C[Zuber Server]
  C -->|In-Memory Index| D[Markdown Vault]
  C -->|Auto-Commit| E[Git Remote Backup]
\`\`\`

## Live Embedded Project Board

![[Project-Board.base]]

## Live System Architecture

![[System-Architecture.canvas|360]]
`
  );

  writeFile(
    'Project-Alpha.md',
    `---
status: In Progress
prio: Prio 1
sendtarget: true
tags:
  - project
  - architecture
created: 2026-11-10
---

# Project Alpha

Core rollout of the self-hosted Zuber knowledge hub across desktop, Chromebook, and Android.

> [!INFO] Target Note Enabled
> Because \`sendtarget: true\` is set in Properties, you can route paragraphs from [[Phone-Call-Notes]] directly here.

## Milestones

- [x] Deploy Docker container behind Nginx Proxy Manager
- [x] Verify WebSocket live updates (\`/ws\`)
- [ ] Complete mobile Kanban single-column rollout
`
  );

  git('add -A');
  git('commit -m "feat: initial Welcome and Project-Alpha notes"');

  // Commit 2: Update Project-Alpha.md with architecture details
  writeFile(
    'Project-Alpha.md',
    `---
status: In Progress
prio: Prio 1
sendtarget: true
tags:
  - project
  - architecture
  - sync
created: 2026-11-10
---

# Project Alpha

Core rollout of the self-hosted Zuber knowledge hub across desktop, Chromebook, and Android.

> [!INFO] Target Note Enabled
> Because \`sendtarget: true\` is set in Properties, you can route paragraphs from [[Phone-Call-Notes]] directly here.

## Milestones

- [x] Deploy Docker container behind Nginx Proxy Manager
- [x] Verify WebSocket live updates (\`/ws\`)
- [x] Enable IndexedDB offline outbox and conflict detection
- [ ] Complete mobile Kanban single-column rollout

## Linked Infrastructure

- Hosting details: [[Server-Setup]]
- Network diagram: [[System-Architecture.canvas]]
- Backup policy: [[Backup-Strategy]]
`
  );
  git('add Project-Alpha.md');
  git('commit -m "docs: add offline sync milestone and infrastructure links"');

  // Commit 3: Append section from Phone-Call-Notes
  writeFile(
    'Project-Alpha.md',
    `---
status: Review
prio: Prio 1
sendtarget: true
tags:
  - project
  - architecture
  - sync
created: 2026-11-10
---

# Project Alpha

Core rollout of the self-hosted Zuber knowledge hub across desktop, Chromebook, and Android.

> [!INFO] Target Note Enabled
> Because \`sendtarget: true\` is set in Properties, you can route paragraphs from [[Phone-Call-Notes]] directly here.

## Milestones

- [x] Deploy Docker container behind Nginx Proxy Manager
- [x] Verify WebSocket live updates (\`/ws\`)
- [x] Enable IndexedDB offline outbox and conflict detection
- [x] Complete mobile Kanban single-column rollout

## Linked Infrastructure

- Hosting details: [[Server-Setup]]
- Network diagram: [[System-Architecture.canvas]]
- Backup policy: [[Backup-Strategy]]

### 2026-11-14 10:30 – From [[Phone-Call-Notes]]

- Confirm Let's Encrypt auto-renewal on Nginx Proxy Manager
- Schedule weekly Git remote push check for [[Backup-Strategy]]
`
  );
  git('add Project-Alpha.md');
  git('commit -m "feat: route phone call action items into Project-Alpha"');

  // Phone-Call-Notes.md
  writeFile(
    'Phone-Call-Notes.md',
    `---
status: Open
prio: Prio 2
tags:
  - inbox
  - calls
created: 2026-11-14
---

# Phone Call Notes

Quick capture pad for incoming calls. Highlight any paragraph below and use **Send to Target Note** to move it cleanly into a project note.

## Call with Operations (10:15)

→ Moved to [[Project-Alpha]]

## Call with Design Team (14:20)

Action items for the mobile sprint:
- Verify 44px touch targets on the mobile Column Switcher Bar.
- Test swipe-left-to-right gesture from anywhere on the Kanban board.
- Keep Desktop multi-column grid 100% unchanged.
`
  );

  // Additional interconnected project & infra notes
  writeFile(
    'Server-Setup.md',
    `---
status: Done
prio: Prio 1
sendtarget: true
tags:
  - infra
  - docker
created: 2026-11-08
---

# Server Setup (Docker & NPM)

Production deployment runs \`ghcr.io/wareskop/zuber:latest\` behind **Nginx Proxy Manager**.

> [!NOTE] Reverse Proxy Settings
> Ensure **Websockets Support** is enabled in NPM so \`/ws\` live updates work across all connected browsers.

## Related
- [[Network-Topology]]
- [[Backup-Strategy]]
- [[Security-Checklist]]
`
  );

  writeFile(
    'Chromebook-Workflow.md',
    `---
status: In Progress
prio: Prio 2
tags:
  - mobile
  - pwa
created: 2026-11-11
---

# Chromebook Workflow

Installing Zuber as a Chrome PWA gives instant startup without Linux container overhead.
Links: [[Mobile-Sync-Plan]], [[Welcome]].
`
  );

  writeFile(
    'Network-Topology.md',
    `---
status: Open
prio: Prio 2
tags:
  - infra
  - network
created: 2026-11-09
---

# Network Topology

Reverse proxy routes HTTPS traffic over port 443 to internal container port 3443.
See [[System-Architecture.canvas]] and [[Server-Setup]].
`
  );

  writeFile(
    'Backup-Strategy.md',
    `---
status: Review
prio: Prio 1
tags:
  - infra
  - git
created: 2026-11-07
---

# Backup Strategy

Automated Git commits on note leave and session close, paired with HTTPS remote push to Codeberg/GitHub.
See [[Server-Setup]] and [[Security-Checklist]].
`
  );

  writeFile(
    'Mobile-Sync-Plan.md',
    `---
status: Open
prio: Prio 3
tags:
  - mobile
  - sync
created: 2026-11-12
---

# Mobile Sync Plan

Offline IndexedDB outbox queues edits when traveling and flushes automatically on reconnect.
See [[Chromebook-Workflow]] and [[Project-Alpha]].
`
  );

  writeFile(
    'Security-Checklist.md',
    `---
status: Done
prio: Prio 2
tags:
  - infra
  - security
created: 2026-11-06
---

# Security Checklist

- \`FORCE_AUTH=true\` enabled in Docker Compose
- \`scrypt\` password hashing + \`HMAC-SHA256\` session tokens
- DOMPurify sanitization on all rendered HTML
- Masked Git PATs via \`maskCredentials\`
`
  );

  // Templates
  writeFile(
    'Templates/Meeting-Template.md',
    `---
isTemplate: true
status: Open
prio: Prio 2
tags:
  - meeting
created: "{{date}}"
---

# {{title}}

**Date:** {{date}} {{time}}

## Agenda
- 

## Action Items
- [ ] 
`
  );

  writeFile(
    'Templates/Project-Brief-Template.md',
    `---
isTemplate: true
status: Open
prio: Prio 1
tags:
  - project
created: "{{date}}"
---

# {{title}}

Created on {{date}} at {{time}}.

## Goals
- 

## Architecture Links
- [[System-Architecture.canvas]]
`
  );

  // Demo Bases
  writeFile(
    'Project-Board.base',
    `filters:
  file.ext == "md"
properties:
  prio:
    displayName: Priority
  status:
    displayName: Status
views:
  - type: board
    name: Project Board
    groupBy:
      property: status
      columns:
        - Open
        - In Progress
        - Review
        - Done
    columnLimit: 10
    order:
      - file.name
      - tags
      - prio
`
  );

  writeFile(
    'Priority-Matrix-2D.base',
    `filters:
  file.ext == "md"
properties:
  prio:
    displayName: Prio
  status:
    displayName: Status
views:
  - type: board
    name: Priority Matrix
    groupBy:
      property: status
      columns:
        - Open
        - In Progress
        - Review
        - Done
    swimlanes:
      property: prio
      lanes:
        - Prio 1
        - Prio 2
        - Prio 3
    columnLimit: 10
    order:
      - file.name
      - tags
`
  );

  writeFile(
    'Infrastructure-Table.base',
    `filters:
  and:
    - file.ext == "md"
    - status != ""
properties:
  prio:
    displayName: Priority
  status:
    displayName: Status
  created:
    displayName: Created
views:
  - type: table
    name: All Project Notes
    order:
      - file.name
      - status
      - prio
      - tags
      - created
    sort:
      - property: prio
        direction: asc
`
  );

  // Demo Canvas
  const canvasDoc = {
    nodes: [
      {
        id: 'grp-prod',
        type: 'group',
        x: 260,
        y: 20,
        width: 560,
        height: 410,
        label: 'Self-Hosted Docker Stack',
        color: '5',
      },
      {
        id: 'n-client',
        type: 'text',
        shape: 'workstation',
        x: 20,
        y: 120,
        width: 170,
        height: 90,
        text: '**Desktop / Chromebook**\nPWA Client',
        color: '4',
      },
      {
        id: 'n-cloud',
        type: 'text',
        shape: 'cloud',
        x: 20,
        y: 260,
        width: 170,
        height: 90,
        text: '**Android PWA**\nWeb Share Target',
        color: '6',
      },
      {
        id: 'n-router',
        type: 'text',
        shape: 'router',
        x: 290,
        y: 165,
        width: 180,
        height: 95,
        text: '**Nginx Proxy Manager**\nTLS + WSS :443',
        color: '2',
      },
      {
        id: 'n-server',
        type: 'text',
        shape: 'server',
        x: 530,
        y: 70,
        width: 200,
        height: 95,
        text: '**Zuber Backend**\n[[Server-Setup]] :3443',
        color: '3',
      },
      {
        id: 'n-decision',
        type: 'text',
        shape: 'diamond',
        x: 545,
        y: 210,
        width: 170,
        height: 95,
        text: 'Auth & Sync\nCheck',
        color: '1',
      },
      {
        id: 'n-db',
        type: 'text',
        shape: 'cylinder',
        x: 310,
        y: 315,
        width: 160,
        height: 90,
        text: '**Vault Disk + Git**\n/data/vault',
        color: '4',
      },
      {
        id: 'n-hex',
        type: 'text',
        shape: 'hexagon',
        x: 540,
        y: 330,
        width: 185,
        height: 80,
        text: 'Git Remote Push\n(HTTPS PAT)',
        color: '5',
      },
      {
        id: 'n-file',
        type: 'file',
        file: 'Server-Setup.md',
        x: 860,
        y: 70,
        width: 260,
        height: 220,
      },
    ],
    edges: [
      {
        id: 'e1',
        fromNode: 'n-client',
        fromSide: 'right',
        toNode: 'n-router',
        toSide: 'left',
        toEnd: 'arrow',
        label: 'HTTPS',
      },
      {
        id: 'e2',
        fromNode: 'n-cloud',
        fromSide: 'right',
        toNode: 'n-router',
        toSide: 'bottom',
        toEnd: 'arrow',
        label: 'Share / Sync',
      },
      {
        id: 'e3',
        fromNode: 'n-router',
        fromSide: 'right',
        toNode: 'n-server',
        toSide: 'left',
        toEnd: 'arrow',
        label: ':3443',
      },
      {
        id: 'e4',
        fromNode: 'n-server',
        fromSide: 'bottom',
        toNode: 'n-decision',
        toSide: 'top',
        toEnd: 'arrow',
      },
      {
        id: 'e5',
        fromNode: 'n-decision',
        fromSide: 'left',
        toNode: 'n-db',
        toSide: 'right',
        toEnd: 'arrow',
        label: 'Index',
      },
      {
        id: 'e6',
        fromNode: 'n-db',
        fromSide: 'right',
        toNode: 'n-hex',
        toSide: 'left',
        toEnd: 'arrow',
        label: 'Commit',
      },
      {
        id: 'e7',
        fromNode: 'n-server',
        fromSide: 'right',
        toNode: 'n-file',
        toSide: 'left',
        toEnd: 'arrow',
      },
    ],
  };

  writeFile('System-Architecture.canvas', JSON.stringify(canvasDoc, null, 2));

  git('add -A');
  git('commit -m "feat: add demo bases, templates, canvas, and interconnected notes"');
  console.log('[DemoVault] Ready with Git history.');
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/auth/status`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

async function openFileFromTree(page, name) {
  const treeItem = page.locator('.tree-item', { hasText: name }).first();
  await treeItem.waitFor({ state: 'visible', timeout: 8000 });
  await treeItem.click();
  await page.waitForTimeout(600);
}

async function capture(page, filename) {
  const target = path.join(OUT_DIR, filename);
  await page.screenshot({ path: target });
  console.log(`[Screenshot] Saved ${filename}`);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  setupDemoVault();

  console.log(`[Server] Starting temporary Zuber server on port ${PORT}...`);
  const serverProc = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      VAULT_DIR: DEMO_VAULT_DIR,
      CONFIG_PATH: DEMO_CONFIG_PATH,
      AUTH_ENABLED: 'false',
      FORCE_AUTH: 'false',
      ENABLE_HTTPS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.on('data', (d) => {
    const s = d.toString();
    if (s.includes('Error') || s.includes('Lokal:')) process.stdout.write(`[Server] ${s}`);
  });
  serverProc.stderr.on('data', (d) => {
    process.stderr.write(`[Server ERR] ${d.toString()}`);
  });

  let browser;
  try {
    await waitForServer(BASE_URL);
    console.log('[Playwright] Launching headless Chromium...');

    browser = await chromium.launch({
      executablePath: '/usr/bin/chromium',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    // =========================================================================
    // DESKTOP SCREENSHOTS (1440 x 900)
    // =========================================================================
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await context.addInitScript(() => {
      localStorage.setItem('zuber_language', 'en');
      Object.defineProperty(navigator, 'onLine', { get: () => true });
    });

    const page = await context.newPage();
    page.on('pageerror', (err) => console.error('[PageError]', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[ConsoleError]', msg.text());
    });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    try {
      await page.waitForSelector('.left-sidebar', { timeout: 10000 });
    } catch (e) {
      const html = await page.evaluate(() => document.body.innerHTML.slice(0, 1000));
      console.error('[Debug DOM]', html);
      throw e;
    }
    await page.waitForTimeout(800);

    // 1. 01-editor-live-preview.png (Server-Setup.md with Properties, Callout & Markdown)
    await openFileFromTree(page, 'Server-Setup');
    await page.waitForSelector('.properties-panel', { timeout: 6000 });
    await page.waitForTimeout(400);
    await capture(page, '01-editor-live-preview.png');

    // 2. 02-editor-mermaid-and-embeds.png (Welcome.md with Mermaid & live .base embed)
    await openFileFromTree(page, 'Welcome');
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      if (scroller) scroller.scrollTop = 260;
    });
    await page.waitForTimeout(800);
    await capture(page, '02-editor-mermaid-and-embeds.png');

    // 3. 03-send-to-target-modal.png (Phone-Call-Notes.md -> select text -> Send to Target modal)
    await openFileFromTree(page, 'Phone-Call-Notes');
    await page.waitForSelector('.cm-content', { timeout: 6000 });
    const targetLine = page.locator('.cm-line', { hasText: 'Verify 44px touch targets' }).first();
    await targetLine.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.waitForTimeout(300);
    const sendTargetBtn = page.locator('.toolbar-btn-target').first();
    await sendTargetBtn.click();
    await page.waitForSelector('.send-to-target-modal-box', { timeout: 5000 });
    await page.waitForTimeout(400);
    await capture(page, '03-send-to-target-modal.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 4. 04-template-selection.png (Expand Templates folder + open New from Template modal)
    const templatesFolder = page.locator('.tree-item', { hasText: 'Templates' }).first();
    if (await templatesFolder.isVisible()) {
      await templatesFolder.click();
      await page.waitForTimeout(300);
    }
    const newFromTplBtn = page.locator('.sidebar-action-bar .sidebar-action-left button').nth(1);
    await newFromTplBtn.click();
    await page.waitForTimeout(500);
    await capture(page, '04-template-selection.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    // 5. 05-research-split-view.png (Project-Alpha on left, Server-Setup on right, right sidebar open)
    await openFileFromTree(page, 'Project-Alpha');
    await page.waitForTimeout(400);
    // Open Research Split via Ribbon button
    const researchRibbonBtn = page.locator('.ribbon-btn[title*="Research"], .ribbon-btn[title*="Recherche"]').first();
    await researchRibbonBtn.click();
    await page.waitForSelector('.research-pane-container', { timeout: 5000 });
    await page.waitForTimeout(400);
    // Click Server-Setup in tree -> routes into right Research Pane
    await openFileFromTree(page, 'Server-Setup');
    await page.waitForTimeout(700);
    await capture(page, '05-research-split-view.png');

    // 6. 06-zen-split-mode.png (Alt+z while Research Split-View is active)
    await page.keyboard.press('Alt+z');
    await page.waitForTimeout(500);
    await capture(page, '06-zen-split-mode.png');
    await page.keyboard.press('Alt+z');
    await page.waitForTimeout(300);
    // Close Research Pane before Kanban screenshots
    await researchRibbonBtn.click();
    await page.waitForTimeout(300);

    // 7. 07-kanban-1d.png (Project-Board.base)
    await openFileFromTree(page, 'Project-Board');
    await page.waitForSelector('.base-board-column', { timeout: 6000 });
    await page.waitForTimeout(500);
    await capture(page, '07-kanban-1d.png');

    // 8. 08-kanban-2d-swimlanes.png (Priority-Matrix-2D.base)
    await openFileFromTree(page, 'Priority-Matrix-2D');
    await page.waitForSelector('.base-board-swimlane-band', { timeout: 6000 });
    await page.waitForTimeout(500);
    await capture(page, '08-kanban-2d-swimlanes.png');

    // 9. 09-kanban-configure-modal.png (Open Configure Board modal)
    const boardCfgBtn = page.locator('.board-config-btn').first();
    await boardCfgBtn.click();
    await page.waitForSelector('.base-board-config-modal', { timeout: 5000 });
    await page.waitForTimeout(400);
    await capture(page, '09-kanban-configure-modal.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    // 10. 10-base-table-filters.png (Infrastructure-Table.base + Filter Popover)
    await openFileFromTree(page, 'Infrastructure-Table');
    await page.waitForSelector('.base-table-container, .base-table', { timeout: 6000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const btn = document.querySelector('.filter-toggle-btn');
      if (btn) btn.click();
    });
    await page.waitForSelector('.base-filter-popover', { timeout: 5000 });
    await page.waitForTimeout(400);
    await capture(page, '10-base-table-filters.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 11. 11-canvas-workflow.png (System-Architecture.canvas)
    await openFileFromTree(page, 'System-Architecture');
    await page.waitForSelector('.react-flow__node', { timeout: 6000 });
    await page.waitForTimeout(800);
    await capture(page, '11-canvas-workflow.png');

    // 12. 12-knowledge-graph.png (Global Graph)
    const graphBtn = page.locator('.ribbon-btn[title*="graph"], .ribbon-btn[title*="Graph"]').first();
    await graphBtn.click();
    await page.waitForSelector('.graph-view-container', { timeout: 6000 });
    await page.waitForTimeout(1800); // Let force layout settle nicely
    await capture(page, '12-knowledge-graph.png');

    // 13. 13-git-version-history.png (Project-Alpha.md -> Version History modal)
    await openFileFromTree(page, 'Project-Alpha');
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+p');
    await page.waitForTimeout(250);
    await page.keyboard.type('Versionsverlauf');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.version-history-modal-container', { timeout: 6000 });
    await page.waitForTimeout(700);
    await capture(page, '13-git-version-history.png');
    await page.keyboard.press('Escape');

    await context.close();

    // =========================================================================
    // MOBILE SCREENSHOTS (390 x 844)
    // =========================================================================
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await mobileContext.addInitScript(() => {
      localStorage.setItem('zuber_language', 'en');
      Object.defineProperty(navigator, 'onLine', { get: () => true });
    });

    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle' });
    await mobilePage.waitForSelector('.mobile-bottom-nav', { timeout: 10000 });
    await mobilePage.waitForTimeout(600);

    // Open Project-Alpha via Files button on mobile
    await mobilePage.locator('.mobile-bottom-nav-btn').first().click();
    await mobilePage.waitForTimeout(400);
    await mobilePage.locator('.tree-item', { hasText: 'Project-Alpha' }).first().click();
    await mobilePage.waitForTimeout(800);

    // 14. 14-mobile-reading-bottom-nav.png
    await capture(mobilePage, '14-mobile-reading-bottom-nav.png');

    // 15. 15-mobile-edit-bar-sheet.png (Tap Edit -> tap + More button to open Hybrid Formatting BottomSheet)
    await mobilePage.locator('.mobile-bottom-nav-edit-btn').click();
    await mobilePage.waitForSelector('.mobile-edit-bar', { timeout: 5000 });
    await mobilePage.waitForTimeout(300);
    const editBtns = mobilePage.locator('.mobile-edit-bar-btn');
    const count = await editBtns.count();
    if (count >= 2) {
      await editBtns.nth(count - 2).click(); // "+ More" button right before "Done ✓"
    }
    await mobilePage.waitForSelector('.bottom-sheet-container', { timeout: 5000 });
    await mobilePage.waitForTimeout(400);
    await capture(mobilePage, '15-mobile-edit-bar-sheet.png');
    // Close BottomSheet
    await mobilePage.locator('.bottom-sheet-backdrop').click({ position: { x: 20, y: 20 } }).catch(() => {});
    await mobilePage.waitForTimeout(300);

    // 16. 16-mobile-kanban-bottomsheet.png (Open Priority-Matrix-2D.base on mobile + tap card Move ⋮)
    const doneBtn = mobilePage.locator('.mobile-edit-done-btn');
    if (await doneBtn.isVisible()) {
      await doneBtn.click();
      await mobilePage.waitForTimeout(300);
    }
    await mobilePage.locator('.mobile-bottom-nav-btn').first().click();
    await mobilePage.waitForTimeout(400);
    await mobilePage.locator('.tree-item', { hasText: 'Priority-Matrix-2D' }).first().click();
    await mobilePage.waitForSelector('.base-board-mobile-switcher', { timeout: 6000 });
    await mobilePage.waitForTimeout(500);
    const moveBtn = mobilePage.locator('.base-card-mobile-move-btn').first();
    await moveBtn.click();
    await mobilePage.waitForSelector('.bottom-sheet-container', { timeout: 5000 });
    await mobilePage.waitForTimeout(400);
    await capture(mobilePage, '16-mobile-kanban-bottomsheet.png');

    await mobileContext.close();
    console.log('[Done] All 16 screenshots captured successfully.');
  } finally {
    if (browser) await browser.close();
    serverProc.kill('SIGTERM');
    fs.rmSync(DEMO_VAULT_DIR, { recursive: true, force: true });
    fs.rmSync(DEMO_CONFIG_PATH, { force: true });
    console.log('[Cleanup] Stopped server and removed temporary demo vault.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
