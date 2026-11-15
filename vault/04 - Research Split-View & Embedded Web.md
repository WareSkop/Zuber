---
tags:
  - research
  - split-view
  - browser
---

# 04 - Research Split-View & Embedded Web

The **Research Split-View** gives you an asymmetric **70% / 30%** workspace with a resizable divider (`localStorage`-persisted) and an integrated web browser.

## Link Routing Rules

- **When Research Split-View is OPEN:**
  - **Normal Left-Click** on an internal `[[Wiki-Link]]` or external `https://...` link opens it in the **right Research Pane** (keeping your main note untouched on the left).
  - **`Alt + Click`** on an internal note link opens it in the **main editor**.
  - **`Ctrl + Click`** / **`Cmd + Click`** / **Middle-Click** on an external link opens it in a **new external browser tab**.
- **Integrated Web Browser:**
  - Includes an editable address bar, reload/copy buttons, and history back-navigation (`←`) alongside your notes.
  - Sites that block iframe embedding (`X-Frame-Options` / CSP `frame-ancestors`) automatically display a clean **Embed-Blocked Fallback Card** with a one-click **Open in Browser ↗** button.

## Send to Target Note (`sendtarget: true`)

Any note with `sendtarget: true` in its Properties (like [[Inbox/Collected-Ideas]]) acts as a quick collection target. You can select any paragraph or block in your active note and route it straight into that target note.

Try clicking an external link while Research Split-View is open:
- [Zuber on GitHub](https://github.com/WareSkop/Zuber)
- [Markdown Guide](https://www.markdownguide.org/basic-syntax/)
