# Sicherheits-, Bug- & Optimierungsbericht (Zuber)

**Datum:** 23.10.2026  
**Geprüfter Stand:** Commit `d62f885` (`main`)  
**Umfang:** Backend (`server/`), Shared Utilities (`shared/`), Frontend & Sync-Engine (`src/`), Service Worker (`public/sw.js`), Build- & Deployment-Konfiguration (`package.json`, `Dockerfile`, `docker-compose.yml`).

---

## Inhaltsverzeichnis
1. [Executive Summary](#1-executive-summary)
2. [Sicherheitsanalyse (Security Findings)](#2-sicherheitsanalyse-security-findings)
   - [SEC-01 (HOCH): Ungeschützter Logout-Endpunkt erlaubt globales Session-Wiping (DoS)](#sec-01-hoch-ungeschützter-logout-endpunkt-erlaubt-globales-session-wiping-dos)
   - [SEC-02 (HOCH): Unkontrollierte Code-Ausführung via `new Function` in der Base-Engine (XSS)](#sec-02-hoch-unkontrollierte-code-ausführung-via-new-function-in-der-base-engine-xss)
   - [SEC-03 (HOCH): Stored XSS im Lesemodus durch unzureichende `<iframe>`- und Attribut-Bereinigung](#sec-03-hoch-stored-xss-im-lesemodus-durch-unzureichende-iframe--und-attribut-bereinigung)
   - [SEC-04 (HOCH): Mermaid-Konfiguration `securityLevel: 'loose'` ohne SVG-Sanitisierung](#sec-04-hoch-mermaid-konfiguration-securitylevel-loose-ohne-svg-sanitisierung)
   - [SEC-05 (MITTEL): IP-Spoofing via `X-Forwarded-For` umgeht Brute-Force-Schutz & Rate-Limiter](#sec-05-mittel-ip-spoofing-via-x-forwarded-for-umgeht-brute-force-schutz--rate-limiter)
   - [SEC-06 (MITTEL): Statischer Fallback für `SESSION_SECRET` und schwaches Standardpasswort](#sec-06-mittel-statischer-fallback-für-session_secret-und-schwaches-standardpasswort)
   - [SEC-07 (MITTEL): Session-Token in URL-Query-Parametern und unbereinigter Service-Worker-Cache](#sec-07-mittel-session-token-in-url-query-parametern-und-unbereinigter-service-worker-cache)
   - [SEC-08 (MITTEL): Symlink-Traversal innerhalb des Vault-Verzeichnisses](#sec-08-mittel-symlink-traversal-innerhalb-des-vault-verzeichnisses)
   - [SEC-09 (NIEDRIG): Klartext-Speicherung des Git-Tokens, Dateirechte von `server-config.json` & `npm audit`](#sec-09-niedrig-klartext-speicherung-des-git-tokens-dateirechte-von-server-configjson--npm-audit)
3. [Potenzielle Bugs & Logikfehler](#3-potenzielle-bugs--logikfehler)
   - [BUG-01 (KRITISCH): Passwortänderung löscht Git- und LogLevel-Konfiguration (`ConfigService.updateSecurity`)](#bug-01-kritisch-passwortänderung-löscht-git--und-loglevel-konfiguration-configserviceupdatesecurity)
   - [BUG-02 (HOCH): `.base`-Dateien verlieren beim Umbenennen/Verschieben ihre Dateiendung](#bug-02-hoch-base-dateien-verlieren-beim-umbenennenverschieben-ihre-dateiendung)
   - [BUG-03 (MITTEL): Fehlerhafte Behandlung von `.base`-Dateien beim Offline-Speichern und Konfliktabgleich](#bug-03-mittel-fehlerhafte-behandlung-von-base-dateien-beim-offline-speichern-und-konfliktabgleich)
   - [BUG-04 (MITTEL): IndexedDB Read-Modify-Write Race-Condition bei `meta.allNotes` und `meta.files`](#bug-04-mittel-indexeddb-read-modify-write-race-condition-bei-metaallnotes-und-metafiles)
   - [BUG-05 (MITTEL): Hartcodiertes 6-Sekunden-Timeout in `apiFetch` bricht größere Datei-Uploads ab](#bug-05-mittel-hartcodiertes-6-sekunden-timeout-in-apifetch-bricht-größere-datei-uploads-ab)
   - [BUG-06 (NIEDRIG): Memory-Leak durch nicht freigegebene Blob-URLs (`URL.createObjectURL`)](#bug-06-niedrig-memory-leak-durch-nicht-freigegebene-blob-urls-urlcreateobjecturl)
4. [Performance- & Architektur-Optimierungen](#4-performance---architektur-optimierungen)
   - [OPT-01: Synchrone Dateioperationen (`fs.*Sync`) blockieren den Node.js Event-Loop](#opt-01-synchrone-dateioperationen-fssync-blockieren-den-nodejs-event-loop)
   - [OPT-02: Redundante Übertragung von `frontmatter` und `tags` in `GET /api/vault/tree`](#opt-02-redundante-übertragung-von-frontmatter-und-tags-in-get-apivaulttree)
   - [OPT-03: Vollständiger Vault-Scan bei jedem Aufruf von `getBacklinks()`](#opt-03-vollständiger-vault-scan-bei-jedem-aufruf-von-getbacklinks)
   - [OPT-04: Großes Haupt-Bundle (> 3,1 MB) durch fehlendes Code-Splitting](#opt-04-großes-haupt-bundle--31-mb-durch-fehlendes-code-splitting)
5. [Priorisierter Maßnahmenplan für die Behebung](#5-priorisierter-maßnahmenplan-für-die-behebung)

---

## 1. Executive Summary

Die Architektur von **Zuber** verfügt bereits über viele gute Sicherheits- und Stabilitätsgrundlagen (wie `scrypt`-Passwort-Hashing mit Timing-Safe-Vergleich, `helmet`-Security-Header, atomare Dateioperationen über `.zuber-tmp-*` und eine robuste Offline-Synchronisation via IndexedDB).

Dennoch wurden bei der tiefgehenden Code-Analyse **4 hochgradige Sicherheitslücken**, **4 mittlere Sicherheitsrisiken**, **6 funktionale Bugs** (darunter ein kritischer Datenverlust-Bug in der Server-Konfiguration sowie fehlende `.base`-Sonderbehandlungen) und **4 zentrale Performance-Engpässe** identifiziert. Dieser Bericht dokumentiert alle Fundstellen präzise mit Datei- und Zeilenreferenzen sowie konkreten Lösungsvorschlägen, sodass sie direkt automatisiert behoben werden können.

---

## 2. Sicherheitsanalyse (Security Findings)

### SEC-01 (HOCH): Ungeschützter Logout-Endpunkt erlaubt globales Session-Wiping (DoS)
- **Datei:** `server/index.ts` (Zeilen 159–166)
- **Problembeschreibung:**
  Der Endpunkt `POST /api/auth/logout` ist **vor** bzw. ohne die `requireAuth`-Middleware registriert:
  ```ts
  app.post('/api/auth/logout', (req, res) => {
    const revokeAll = Boolean(req.body?.revokeAll);
    if (revokeAll) {
      configService.revokeAllSessions();
    }
    res.json({ ok: true, sessionEpoch: configService.getSessionEpoch() });
  });
  ```
- **Auswirkung:**
  Jeder nicht authentifizierte Netzwerkteilnehmer kann einen Request an `/api/auth/logout` mit `revokeAll: true` senden. Dadurch wird `sessionEpoch` in `server-config.json` hochgezählt (Disk-Write) und **sämtliche aktiven Benutzersitzungen auf allen Geräten werden sofort invalidiert**.
- **Empfohlene Behebung:**
  `requireAuth` als Middleware in `app.post('/api/auth/logout', requireAuth, ...)` hinzufügen (oder `revokeAllSessions()` nur ausführen, wenn ein gültiges Token im Request vorliegt).

---

### SEC-02 (HOCH): Unkontrollierte Code-Ausführung via `new Function` in der Base-Engine (XSS)
- **Datei:** `src/base/baseEngine.ts` (Zeilen 250–266 und 318–335)
- **Problembeschreibung:**
  In `evaluateFormula()` (Zeile 259) und `evaluateStringExpression()` (Zeile 329) werden Formeln und Filterausdrücke aus `.base`-Dateien bzw. ```` ```base ````-Codeblöcken direkt über `new Function(...keys, "return (" + expr + ");")` ausgewertet.
- **Auswirkung:**
  Da `new Function` im globalen Browser-Kontext ausgeführt wird, hat jeder Ausdruck vollen Zugriff auf `window`, `document`, `fetch` und `localStorage` (wo das Sitzungs-Token `zuber_token` im Klartext liegt). Wenn ein Benutzer eine fremde Notiz oder ein geteiltes Git-Vault mit einer präparierten `.base`-Formel öffnet, führt dies unmittelbar zur Ausführung beliebigen JavaScript-Codes im Kontext der Anwendung.
- **Empfohlene Behebung:**
  `new Function` vollständig durch einen sicheren, deterministischen Expression-Parser (z. B. einen kleinen rekursiven Descent-Parser für Vergleichsoperatoren `==`, `!=`, `>`, `<`, `&&`, `||`, `!`, Arithmetik `+`, `-`, `*`, `/` und erlaubte String-/Array-Methoden wie `.includes()`, `.startsWith()`, `.toLowerCase()`) ersetzen, der keinen Zugriff auf `window`, `globalThis`, `Function` oder `constructor` zulässt.

---

### SEC-03 (HOCH): Stored XSS im Lesemodus durch unzureichende `<iframe>`- und Attribut-Bereinigung
- **Datei:** `src/components/LivePreviewEditor.tsx` (Zeilen 2745–2905)
- **Problembeschreibung:**
  1. **Permissive DOMPurify-Konfiguration (Zeilen 2888–2898):**
     Für die Darstellung von ```` ```html ````-Blöcken erlaubt der `DOMPurify.sanitize`-Aufruf im Lesemodus pauschal das Tag `iframe` sowie die Attribute `srcdoc` und `sandbox`. Ein direkt in Markdown eingebettetes `<iframe>`-Tag kann dadurch ohne `sandbox`-Attribut (oder mit `sandbox="allow-scripts allow-same-origin"`) gerendert werden, wodurch Skripte in `srcdoc` vollen Zugriff auf das Parent-Window erhalten.
  2. **Ungesicherte Attribut-Interpolation vor `marked.parse` (Zeilen 2745–2862):**
     Bei der Vorverarbeitung von Wikilinks (`[[...]]`), Embeds (`![[...]]`) und externen Links werden `target`, `alt` und `label` ohne HTML-Escaping direkt in HTML-Strings interpoliert (z. B. `data-wikilink="${target}"`, `alt="${alt}"`). Enthält ein Link-Text Anführungszeichen (`"`), können zusätzliche Attribute injiziert werden, die durch die erweiterte `ADD_ATTR`-Liste von DOMPurify gelangen.
- **Empfohlene Behebung:**
  1. Alle interpolierten Werte (`target`, `alt`, `label`, `href`) vor dem Einsetzen in HTML-Attribute strikt mit `escapeHtml()` escapen.
  2. Einen DOMPurify-Hook (`afterSanitizeAttributes`) registrieren, der für jedes `<iframe>`-Element erzwingt, dass `sandbox="allow-scripts"` (ohne `allow-same-origin`) gesetzt ist und `src`-Attribute außer `about:blank` entfernt werden.

---

### SEC-04 (HOCH): Mermaid-Konfiguration `securityLevel: 'loose'` ohne SVG-Sanitisierung
- **Datei:** `src/components/LivePreviewEditor.tsx` (Zeilen 45, 940, 2932)
- **Problembeschreibung:**
  Mermaid wird mit `securityLevel: 'loose'` initialisiert (`mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', ... })`). Das generierte SVG wird anschließend in Zeile 940 (`previewEl.innerHTML = svg`) und Zeile 2932 (`svgContainer.innerHTML = svg`) direkt in das DOM geschrieben.
- **Auswirkung:**
  `securityLevel: 'loose'` erlaubt rohes HTML und interaktive JavaScript-Callbacks innerhalb von Mermaid-Diagrammen.
- **Empfohlene Behebung:**
  `securityLevel: 'strict'` (oder `'antiscript'`) in `mermaid.initialize` setzen und das erzeugte SVG vor der Zuweisung an `innerHTML` durch `DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })` bereinigen.

---

### SEC-05 (MITTEL): IP-Spoofing via `X-Forwarded-For` umgeht Brute-Force-Schutz & Rate-Limiter
- **Datei:** `server/rateLimiter.ts` (Zeilen 31–39)
- **Problembeschreibung:**
  `getClientIp(req)` liest den Header `req.headers['x-forwarded-for']` bedingungslos aus und verwendet den ersten (vom Client frei wählbaren) Eintrag:
  ```ts
  function getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }
  ```
- **Auswirkung:**
  1. Selbst wenn `TRUST_PROXY=false` in `.env` gesetzt ist, vertraut der Rate-Limiter dem Header `X-Forwarded-For`.
  2. Ein Angreifer kann bei jedem Login-Versuch (`POST /api/auth/login`) einen zufälligen `X-Forwarded-For`-Wert senden und so die Sperre nach 5 Fehlversuchen (`MAX_LOGIN_ATTEMPTS = 5`) sowie das API-Rate-Limit (`600 req/min`) komplett umgehen.
  3. Gleichzeitig kann die In-Memory-Map `loginAttempts` bzw. `apiRequests` durch Millionen gefälschter IPs unbegrenzt aufgebläht werden (Memory Exhaustion).
- **Empfohlene Behebung:**
  In `getClientIp(req)` ausschließlich `req.ip || req.socket?.remoteAddress || 'unknown'` verwenden. Express wertet `X-Forwarded-For` über `req.ip` automatisch und nur dann sicher aus, wenn `app.set('trust proxy', 1)` (gesteuert über `TRUST_PROXY`) aktiv ist. Zusätzlich sollte eine maximale Größe (z. B. `MAX_TRACKED_IPS = 10000`) für die Maps in `rateLimiter.ts` definiert werden.

---

### SEC-06 (MITTEL): Statischer Fallback für `SESSION_SECRET` und schwaches Standardpasswort
- **Dateien:** `server/auth.ts` (Zeilen 7–9), `server/configService.ts` (Zeilen 86–91), `docker-compose.yml` (Zeilen 21–22)
- **Problembeschreibung:**
  - In `server/auth.ts` fällt `getSecret()` auf den fest codierten String `'zuber-offline-vault-secret-key-change-me-in-prod'` zurück, falls `process.env.SESSION_SECRET` nicht gesetzt ist.
  - In `server/configService.ts` wird beim ersten Start ohne gesetztes `ZUBER_PASSWORD` automatisch das Standardpasswort `'zuber'` vergeben.
- **Auswirkung:**
  Da der Token-Aufbau (`user: 'owner'`, `epoch: 1`) bekannt ist, können bei unverändertem `SESSION_SECRET` gültige HMAC-SHA256-Sitzungstokens offline berechnet werden, ohne das Passwort zu kennen oder den Login-Endpunkt zu nutzen.
- **Empfohlene Behebung:**
  Wenn `SESSION_SECRET` nicht als Umgebungsvariable gesetzt ist, sollte `ConfigService` beim ersten Start automatisch ein kryptografisch zufälliges 32-Byte-Secret (`crypto.randomBytes(32).toString('hex')`) generieren und in `server-config.json` persistieren.

---

### SEC-07 (MITTEL): Session-Token in URL-Query-Parametern und unbereinigter Service-Worker-Cache
- **Dateien:** `src/api.ts` (Zeilen 588, 719), `server/auth.ts` (Zeilen 73–75), `public/sw.js` (Zeilen 156–181)
- **Problembeschreibung:**
  1. Für Anhänge (`getAttachmentUrl`) und Datei-Downloads (`downloadEntry`) wird das langlebige Haupt-Session-Token als Query-Parameter `?token=...` an die URL gehängt. Solche URLs landen in Browser-Chroniken, Server-/Reverse-Proxy-Logs und im Service-Worker-Cache.
  2. Der Service Worker (`public/sw.js`) speichert Antworten von `/api/vault/attachment` im Cache `knowmesh-attachments-v1`. Beim Abmelden (`clearToken()` / `logoutSession()`) wird dieser Cache **nicht** geleert, sodass private Bilder/PDFs auf gemeinsam genutzten Geräten weiterhin im Browser-Cache verbleiben.
- **Empfohlene Behebung:**
  - Beim Logout (`logoutSession` in `src/api.ts`) explizit `caches.delete('knowmesh-attachments-v1')` und `caches.delete('knowmesh-shell-v3')` (oder eine `postMessage` an den Service Worker) ausführen.
  - Optional für Medien-/Download-Abrufe ein HttpOnly-Session-Cookie (`SameSite=Strict`) oder kurzlebige Download-Tokens unterstützen, damit das Haupt-Token nicht in der URL steht.

---

### SEC-08 (MITTEL): Symlink-Traversal innerhalb des Vault-Verzeichnisses
- **Datei:** `server/vaultService.ts` (Zeilen 566–573)
- **Problembeschreibung:**
  `resolveSafePath(relativePath)` prüft mittels `path.resolve(this.vaultDir, cleaned)` lediglich lexikalisch, ob der Zielpfad mit `this.vaultDir` beginnt, löst jedoch keine symbolischen Links (`fs.realpathSync`) auf. Auch `scanDirectory()` (Zeile 328) nutzt `fs.readdirSync(..., { withFileTypes: true })`, ohne `entry.isSymbolicLink()` auszufiltern.
- **Auswirkung:**
  Gelangt über ein geklontes/gepulltes Git-Repository oder lokalen Zugriff ein Symlink in den Vault, folgt der Server diesem Symlink beim Lesen, Indizieren oder Überschreiben von Dateien außerhalb des Vaults.
- **Empfohlene Behebung:**
  In `scanDirectory()` symbolische Links ignorieren (`if (entry.isSymbolicLink()) continue;`) und in `resolveSafePath()` bei existierenden Pfaden (bzw. deren Elternverzeichnis) `fs.realpathSync()` gegen `fs.realpathSync(this.vaultDir)` prüfen.

---

### SEC-09 (NIEDRIG): Klartext-Speicherung des Git-Tokens, Dateirechte von `server-config.json` & `npm audit`
- **Dateien:** `server/configService.ts` (Zeilen 106, 262), `package.json`
- **Problembeschreibung:**
  1. `server-config.json` enthält den Git Personal Access Token (`git.remote.token`) im Klartext und wird mit Standard-Dateirechten (`0644`, weltlesbar für lokale Systembenutzer) geschrieben.
  2. `npm audit` meldet eine Schwachstelle in `braces` (`< 3.0.3`, High Severity ReDoS), das als transitive Abhängigkeit über `chokidar@3.6.0` eingebunden ist.
- **Empfohlene Behebung:**
  - Beim Schreiben von `server-config.json` in `saveConfig()` den Modus `{ encoding: 'utf-8', mode: 0o600 }` übergeben.
  - `npm audit fix` ausführen bzw. `chokidar` aktualisieren.

---

## 3. Potenzielle Bugs & Logikfehler

### BUG-01 (KRITISCH): Passwortänderung löscht Git- und LogLevel-Konfiguration (`ConfigService.updateSecurity`)
- **Datei:** `server/configService.ts` (Zeilen 146–167)
- **Problembeschreibung:**
  In `updateSecurity()` wird `this.config` komplett neu zugewiesen, anstatt bestehende Felder (`git`, `logLevel`) per Spread-Operator zu übernehmen:
  ```ts
  this.config = {
    authEnabled,
    passwordHash,
    salt,
    sessionEpoch,
    updatedAt: Date.now(),
  };
  this.saveConfig(this.config);
  ```
- **Auswirkung:**
  Sobald der Benutzer in den Einstellungen das Passwort ändert oder die Authentifizierung aktiviert/deaktiviert, werden die gesamte gespeicherte Git-Konfiguration (`git.remote.url`, `token`, `branch`, `autoSync`) sowie das `logLevel` aus `server-config.json` unwiderruflich gelöscht!
- **Empfohlene Behebung:**
  `this.config = { ...this.config, authEnabled, passwordHash, salt, sessionEpoch, updatedAt: Date.now() };` verwenden.

---

### BUG-02 (HOCH): `.base`-Dateien verlieren beim Umbenennen/Verschieben ihre Dateiendung
- **Datei:** `server/vaultService.ts` (Zeilen 997–1003 und 1036–1042)
- **Problembeschreibung:**
  In `renameOrMove()` und `moveBatch()` wird beim Umbenennen einer Datei ohne Angabe der Endung geprüft, ob die Quelldatei auf `.canvas` oder `.md` endet, um die Endung automatisch wieder anzuhängen:
  ```ts
  if (isCanvasSource && !targetRelative.toLowerCase().endsWith('.canvas')) {
    targetRelative = `${targetRelative}.canvas`;
  } else if (isMarkdownSource && !targetRelative.toLowerCase().endsWith('.md')) {
    targetRelative = `${targetRelative}.md`;
  }
  ```
  Für `.base`-Dateien (`isBaseFile`) fehlt dieser Zweig komplett! Da der Umbenennen-Dialog im Frontend (`FileSidebar.tsx`) Dateiendungen im Eingabefeld standardmäßig ausblendet, führt das Umbenennen von `Projekte.base` in `Aufgaben` dazu, dass die Datei auf der Festplatte in `Aufgaben` (ohne `.base`-Endung) umbenannt wird.
- **Auswirkung:**
  Die umbenannte Base-Datei wird anschließend nicht mehr als `.base`-Datenbank erkannt und verschwindet aus dem Notiz-Index.
- **Empfohlene Behebung:**
  Sowohl in `renameOrMove()` als auch in `moveBatch()` analog `const isBaseSource = isBaseFile(sourceCleaned);` prüfen und `.base` automatisch anhängen, falls die Endung fehlt.

---

### BUG-03 (MITTEL): Fehlerhafte Behandlung von `.base`-Dateien beim Offline-Speichern und Konfliktabgleich
- **Dateien:** `src/sync/syncEngine.ts` (Zeilen 168–180, 543–589), `server/vaultService.ts` (Zeilen 888–896)
- **Problembeschreibung:**
  1. In `syncEngine.ts` (`saveNote`, Zeile 544) wird nur `const isCanvas = payload.path.endsWith('.canvas')` geprüft. Wird eine `.base`-Datei gespeichert, während der Client offline ist (oder als optimistisches Update), wird sie wie eine normale `.md`-Datei durch `parseMarkdownWithFrontmatter()` gejagt und `.replace(/\.md$/i, '')` lässt `.base` im Namen stehen.
  2. In `isContentIdentical()` (`syncEngine.ts:168` und `vaultService.ts:888`) wird nur `.canvas` als Rohinhalt verglichen, während `.base`-Dateien fälschlicherweise mit `serializeMarkdownWithFrontmatter()` verglichen werden.
- **Empfohlene Behebung:**
  In `syncEngine.ts` und `vaultService.ts` `.base`-Dateien bei `isContentIdentical()` und im Offline-Save-Pfad von `saveNote` exakt wie `.canvas` (bzw. mit eigenem `isBase`-Flag und `.replace(/\.(md|canvas|base)$/i, '')`) behandeln.

---

### BUG-04 (MITTEL): IndexedDB Read-Modify-Write Race-Condition bei `meta.allNotes` und `meta.files`
- **Datei:** `src/sync/localDb.ts` (Zeilen 241–276)
- **Problembeschreibung:**
  `putNote(note)` speichert zuerst die Notiz und führt danach `await this.getMeta('allNotes')` und `await this.setMeta('allNotes', ...)` in getrennten IndexedDB-Transaktionen aus.
- **Auswirkung:**
  Werden mehrere `putNote()`-Aufrufe kurz hintereinander oder parallel ausgelöst (z. B. beim schnellen Editieren, Batch-Operationen oder WebSocket-Events), lesen beide Aufrufe denselben alten `allNotes`-Stand und überschreiben sich gegenseitig.
- **Empfohlene Behebung:**
  Das Lesen und Aktualisieren von `notes`, `meta.files` und `meta.allNotes` innerhalb einer einzigen gemeinsamen `readwrite`-Transaktion über die Object-Stores `['notes', 'meta']` abwickeln.

---

### BUG-05 (MITTEL): Hartcodiertes 6-Sekunden-Timeout in `apiFetch` bricht größere Datei-Uploads ab
- **Datei:** `src/api.ts` (Zeilen 255–260, 592–600)
- **Problembeschreibung:**
  `apiFetch()` bricht jeden Request ohne eigenes `signal` nach exakt **6.000 ms** (`setTimeout(() => controller.abort(), 6000)`) ab, um bei schlechter Verbindung schnell in den Offline-Modus zu wechseln.
- **Auswirkung:**
  `uploadAttachment()` und `importArchive()` rufen `apiFetch()` ohne eigenes `AbortSignal` auf. Obwohl das Backend Uploads bis 100 MB (`MAX_UPLOAD_MB=100`) erlaubt, schlägt jeder Upload oder ZIP-Import, der länger als 6 Sekunden dauert, im Frontend mit einem Timeout-Fehler fehl.
- **Empfohlene Behebung:**
  In `apiFetch` ein konfigurierbares Timeout (oder ein längeres Timeout von z. B. 120.000 ms für `/api/vault/attachment`, `/api/vault/import-archive` und `/api/git/*`) unterstützen.

---

### BUG-06 (NIEDRIG): Memory-Leak durch nicht freigegebene Blob-URLs (`URL.createObjectURL`)
- **Datei:** `src/sync/syncEngine.ts` (Zeilen 62, 744–760)
- **Problembeschreibung:**
  `SyncEngine` erzeugt für lokal gecachte Anhänge `blob:`-URLs via `URL.createObjectURL(cached.blob)` und speichert diese in `this.blobUrls`. Es gibt jedoch keinen Aufruf von `URL.revokeObjectURL()`, wenn Anhänge aktualisiert oder gelöscht werden.
- **Empfohlene Behebung:**
  Beim Überschreiben/Löschen eines Anhangs oder beim Leeren des Caches `URL.revokeObjectURL(url)` aufrufen.

---

## 4. Performance- & Architektur-Optimierungen

### OPT-01: Synchrone Dateioperationen (`fs.*Sync`) blockieren den Node.js Event-Loop
- **Datei:** `server/vaultService.ts` (u. a. Zeilen 328, 369, 899, 1011, 1173, 1463)
- **Analyse:**
  Fast alle Dateioperationen im `VaultService` (`readFileSync`, `writeFileSync`, `cpSync`, `rmSync`) sind synchron. Insbesondere bei `refactorVaultLinks()` (wird beim Umbenennen einer Notiz ausgeführt und prüft/schreibt potenziell viele Dateien) oder beim Kopieren großer Ordner (`copyEntry`) blockiert der Node.js-Hauptthread vollständig, sodass parallele API-Requests und WebSocket-Pings verzögert werden.
- **Optimierung:**
  Schrittweise Migration der schreibintensiven Pfade (`saveNote`, `refactorVaultLinks`, `copyEntry`) auf `fs.promises` oder Auslagerung von Voll-Rebuilds in Worker-Threads bei sehr großen Vaults (> 5.000 Notizen).

---

### OPT-02: Redundante Übertragung von `frontmatter` und `tags` in `GET /api/vault/tree`
- **Dateien:** `server/index.ts` (Zeilen 232–238), `server/vaultService.ts` (Zeilen 626–685)
- **Analyse:**
  Der Endpunkt `GET /api/vault/tree` liefert sowohl `files` (alle Dateien inkl. `frontmatter` und `tags`) als auch `notes` (alle Notizen inkl. `frontmatter` und `tags`). Da Notizen den Großteil von `files` ausmachen, werden sämtliche Frontmatter-Objekte und Tags im selben JSON-Response **doppelt** serialisiert und über das Netzwerk übertragen.
- **Optimierung:**
  `files` im Tree-Response auf reine Dateibaum-Metadaten (`path`, `name`, `folder`, `type`, `mtime`, `size`, `sendTarget`, `isTemplate`) beschränken, da die vollständigen `frontmatter`- und `tags`-Daten bereits in `notes` (`allNotes`) enthalten sind. Das halbiert die Payload-Größe von `/api/vault/tree` bei großen Vaults nahezu.

---

### OPT-03: Vollständiger Vault-Scan bei jedem Aufruf von `getBacklinks()`
- **Datei:** `server/vaultService.ts` (Zeilen 1335–1388)
- **Analyse:**
  Jedes Mal, wenn im Frontend eine Notiz geöffnet wird, ruft der Client `GET /api/vault/backlinks?path=...` auf. `getBacklinks()` iteriert dabei über **alle** Notizen im Vault, löst für jeden Link `resolveWikiTarget()` auf und durchsucht bei Treffern alle Textzeilen der Quellnotiz per Regex.
- **Optimierung:**
  Einen inkrementellen Backlink-Index (`Map<string, Set<string>>` von Zielpfad zu Quellpfaden) im `VaultService` pflegen, der bei `indexFile()` aktualisiert wird. Dadurch sinkt die Komplexität von `getBacklinks()` von $O(N \cdot L)$ auf $O(k)$ (wobei $k$ nur die tatsächlich verlinkenden Notizen sind).

---

### OPT-04: Großes Haupt-Bundle (> 3,1 MB) durch fehlendes Code-Splitting
- **Dateien:** `src/App.tsx`, `src/components/LivePreviewEditor.tsx`, `vite.config.ts`
- **Analyse:**
  Der Produktions-Build erzeugt ein Haupt-JavaScript-Bundle (`dist/assets/index-*.js`) von **3.114 kB** (ca. 948 kB gzipped). Schwere Bibliotheken wie `mermaid`, `cytoscape` (`GraphView`), `@xyflow/react` (`CanvasEditor`) und `katex` werden direkt beim initialen App-Start geladen, auch wenn der Benutzer nur eine einfache Textnotiz öffnet.
- **Optimierung:**
  - `GraphView`, `CanvasEditor`, `BaseEditor` und `SettingsModal` in `src/App.tsx` per `React.lazy()` + `<Suspense>` einbinden.
  - `mermaid` in `LivePreviewEditor.tsx` erst bei Bedarf per dynamischem `import('mermaid')` laden, wenn eine Notiz tatsächlich einen ```` ```mermaid ````-Block enthält.

---

## 5. Priorisierter Maßnahmenplan für die Behebung

Um die gefundenen Punkte sauber und ohne Seiteneffekte durch Antigravity beheben zu lassen, empfiehlt sich folgende Reihenfolge:

### Phase 1: Kritische Bugs & Quick-Win Security-Fixes (Sofort) — ✅ UMGESETZT
1. **[x] BUG-01 beheben (`server/configService.ts`):** Spread `...this.config` in `updateSecurity()` ergänzen, damit Git-Config und LogLevel bei Passwortänderungen erhalten bleiben.
2. **[x] SEC-01 beheben (`server/index.ts`):** `requireAuth` zu `POST /api/auth/logout` hinzufügen.
3. **[x] BUG-02 & BUG-03 beheben (`server/vaultService.ts` & `src/sync/syncEngine.ts`):** `.base`-Dateien in `renameOrMove`, `moveBatch`, `isContentIdentical` und `syncEngine.saveNote` vollständig unterstützen.
4. **[x] SEC-05 beheben (`server/rateLimiter.ts`):** `getClientIp()` auf `req.ip` umstellen und Map-Größenlimit einführen.
5. **[x] SEC-06 & SEC-09 beheben (`server/configService.ts` & `server/auth.ts`):** Zufälliges `sessionSecret` beim Erststart in `server-config.json` generieren (falls Env-Variable fehlt) und Datei mit `mode: 0o600` speichern.

### Phase 2: XSS-Härtung im Frontend (Hoch) — ✅ UMGESETZT
1. **[x] SEC-02 beheben (`src/base/baseEngine.ts`):** `new Function` durch einen sicheren, sandboxed Expression-Evaluator ohne globalen Scope-Zugriff ersetzen.
2. **[x] SEC-03 & SEC-04 beheben (`src/components/LivePreviewEditor.tsx`):**
   - HTML-Escaping bei Wikilink-/Embed-Vorverarbeitung ergänzen.
   - DOMPurify-Hook zur erzwungenen `iframe`-Sandbox (`sandbox="allow-scripts"`) einbauen.
   - Mermaid auf `securityLevel: 'strict'` stellen und SVG-Output mit DOMPurify bereinigen.

### Phase 3: Stabilität, Sync & Performance (Mittel) — ✅ UMGESETZT
1. **[x] SEC-08 beheben (`server/vaultService.ts`):** Symlinks in `scanDirectory` überspringen und `realpathSync`-Check in `resolveSafePath` ergänzen.
2. **[x] BUG-04, BUG-05 & BUG-06 beheben (`src/sync/localDb.ts`, `src/api.ts`, `src/sync/syncEngine.ts`):** Atomare IndexedDB-Transaktion in `putNote`, längeres Upload-Timeout in `apiFetch` und `URL.revokeObjectURL`-Cleanup + Cache-Clear bei Logout (`SEC-07`).
3. **[x] OPT-02, OPT-03 & OPT-04 umsetzen:** Redundante Felder in `/api/vault/tree` reduzieren, Backlink-Index einführen und `React.lazy()` für Graph/Canvas/Mermaid nutzen.
