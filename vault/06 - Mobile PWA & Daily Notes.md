---
tags:
  - mobile
  - pwa
  - daily-notes
---

# 06 - Mobile PWA & Daily Notes

Zuber is built as an **offline-first Progressive Web App (PWA)** for Android, ChromeOS, iOS, and Desktop.

## Mobile-First Highlights (`< 768px`)

- **4-in-1 Search Modal:** Tap **Search** in the bottom navigation bar to switch between:
  - **In Note** (default when a note is open, with a floating `▲` / `▼` match jump bar)
  - **Files** (instant filename & path filter)
  - **Full Text** (offline IndexedDB body search)
  - **Settings** (jump directly to any setting)
- **Touch Filetree Toolbar:** `42×42px` thumb-friendly buttons and a consolidated **`+ New ▾`** dropdown for creating notes, templates, canvases, bases, and folders.
- **Daily Notes & Templates:** Tap the calendar icon (`📅`) to open today's `YYYY-MM-DD.md` note, or create notes from [[Templates/Daily-Note-Template]] and [[Templates/Meeting-Notes-Template]].
- **Android Web Share Target:** Share links, text, photos, or PDFs from any Android app directly into Zuber — files are saved automatically with a `YYYY-MM-DD` prefix in `Inbox/` (see [[Inbox/2026-11-15 Example-Web-Share]]).
