# Zuber

> **Offline-First Wissensbasis, Live-Preview Markdown- & Canvas-Editor mit lokaler Synchronisation.**

Zuber (ehemals „Knowmesh“ / „Basalt“) ist eine selbstgehostete Web-Applikation und installierbare Progressive Web App (PWA) für persönliche Wissensnetze, Notizen und grafische Diagramme.

---

## Highlights

- **Live-Preview Markdown-Editor:** CodeMirror 6 mit WYSIWYG-Markdown, interaktiven Tabellen, Checklisten, Callouts und Wiki-Links (`[[...]]`).
- **Obsidian-kompatibler Canvas-Editor:** Volle Unterstützung für `.canvas`-Dateien (JSON Canvas 1.0) inklusive Formen, Notizeinbettungen, Kantenbeschriftungen und Gruppen.
- **Offline-First Architektur:** Robuste IndexedDB-Caching-Schicht, Web Share Target API und bidirektionale Synchronisation mit automatischer Konflikterkennung.
- **Graph-Ansicht & Backlinks:** Interaktiver Force-Directed Wissensgraph und Backlink-Explorer.
- **Integrierte Versionshistorie:** Git-basierte Versionsverfolgung mit visueller Diff-Ansicht und Wiederherstellung.

---

## Schnellstart mit Docker Compose

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
      - PASSWORD=dein_sicheres_passwort
    volumes:
      - ./vault:/data/vault
      - ./config:/data/config
```

Weitere Details zur Konfiguration und Entwickler-Dokumentation befinden sich im Verzeichnis [`doc/`](./doc/README.md).
