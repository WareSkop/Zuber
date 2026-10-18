import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import { WebSocketServer, WebSocket } from 'ws';
import {
  COOKIE_NAME,
  createSessionToken,
  extractTokenFromRequest,
  requireAuth,
  verifySessionToken,
} from './auth';
import { configService } from './configService';
import { rateLimiter } from './rateLimiter';
import { ensureTlsCredentials, getLocalIpAddresses } from './tls';
import { VaultService } from './vaultService';
import { GitService } from './gitService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 3443);
const ENABLE_HTTPS = (process.env.ENABLE_HTTPS ?? 'true').toLowerCase() !== 'false';
const TRUST_PROXY = (process.env.TRUST_PROXY ?? 'true').toLowerCase() !== 'false';
const VAULT_PATH = path.resolve(ROOT_DIR, process.env.VAULT_DIR || process.env.VAULT_PATH || './vault');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 100);

export function createApp(vaultService: VaultService, gitService?: GitService) {
  const actualGitService = gitService || new GitService(vaultService.getVaultDir(), configService);
  const app = express();

  if (TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  // --- HTTP Security Headers ---
  app.use((_req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
    next();
  });

  // --- Configurable CORS ---
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
    : null;

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || !allowedOrigins || allowedOrigins.length === 0) {
          return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Nicht erlaubter CORS-Origin'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  // --- General API Rate Limiting (600 requests/minute/IP) ---
  app.use('/api', rateLimiter.apiRateLimitMiddleware);

  // --- Public Static Files (PWA Manifest, Service Worker & Icons before Auth) ---
  const publicDir = path.join(ROOT_DIR, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }
  const distDir = path.join(ROOT_DIR, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
  }

  const isRequestSecure = (req: express.Request): boolean => {
    return ENABLE_HTTPS || req.secure || req.headers['x-forwarded-proto'] === 'https';
  };

  // --- Auth Endpoints ---
  app.get('/api/auth/status', (req, res) => {
    const authRequired = configService.isAuthRequired();
    const token = extractTokenFromRequest(req);
    const authenticated = !authRequired || verifySessionToken(token);
    res.json({
      authenticated,
      authRequired,
      https: isRequestSecure(req),
      vaultPath: vaultService.getVaultDir(),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = rateLimiter.getClientIp(req);
    const check = rateLimiter.checkLoginAllowed(ip);
    if (!check.allowed) {
      if (check.retryAfterSeconds) {
        res.setHeader('Retry-After', String(check.retryAfterSeconds));
      }
      res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' });
      return;
    }

    const { password } = req.body as { password?: string };

    if (!configService.verifyPassword(password || '')) {
      rateLimiter.recordLoginFailure(ip);
      res.status(401).json({ error: 'Ungültiges Passwort.' });
      return;
    }

    rateLimiter.recordLoginSuccess(ip);
    const token = createSessionToken();
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isRequestSecure(req),
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    res.json({
      authenticated: true,
      token,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const { revokeAll } = req.body as { revokeAll?: boolean };
    if (revokeAll) {
      configService.revokeAllSessions();
    }
    res.clearCookie(COOKIE_NAME);
    res.json({ authenticated: false, revokedAll: Boolean(revokeAll) });
  });

  // --- Security Settings Endpoints ---
  app.get('/api/settings/security', requireAuth, (_req, res) => {
    res.json({
      authEnabled: configService.isAuthRequired(),
      forceAuth: configService.isForceAuthActive(),
    });
  });

  app.post('/api/settings/security', requireAuth, (req, res) => {
    try {
      const { currentPassword, authEnabled, newPassword } = req.body as {
        currentPassword?: string;
        authEnabled: boolean;
        newPassword?: string;
      };

      if (configService.isAuthRequired()) {
        if (!currentPassword || !configService.verifyPassword(currentPassword)) {
          res.status(401).json({ error: 'Aktuelles Passwort ist ungültig.' });
          return;
        }
      }

      configService.updateSecurity(authEnabled, newPassword);
      const token = createSessionToken();
      if (configService.isAuthRequired()) {
        res.cookie(COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: isRequestSecure(req),
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });
      }
      res.json({ ok: true, authEnabled: configService.isAuthRequired(), token });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // --- Sync Endpoints ---
  app.get('/api/vault/sync-manifest', requireAuth, (_req, res) => {
    try {
      const manifest = vaultService.getSyncManifest();
      res.json(manifest);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vault/notes-batch', requireAuth, (req, res) => {
    try {
      const { paths } = req.body as { paths?: string[] };
      if (!Array.isArray(paths)) {
        res.status(400).json({ error: 'paths array erforderlich.' });
        return;
      }
      const notes = vaultService.getNotesBatch(paths);
      res.json({ notes });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Vault Endpoints ---
  app.get('/api/vault/tree', requireAuth, (_req, res) => {
    try {
      const tree = vaultService.getFileTree();
      const files = vaultService.getAllFiles();
      res.json({ tree, files });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/vault/note', requireAuth, (req, res) => {
    try {
      const notePath = String(req.query.path || '');
      if (!notePath) {
        res.status(400).json({ error: 'Pfad fehlt.' });
        return;
      }
      const note = vaultService.getNote(notePath);
      res.json(note);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vault/note', requireAuth, (req, res) => {
    try {
      const { path: notePath, content, properties, body, baseMtime, forceOverwrite } = req.body as {
        path?: string;
        content?: string;
        properties?: any[];
        body?: string;
        baseMtime?: number;
        forceOverwrite?: boolean;
      };
      if (!notePath) {
        res.status(400).json({ error: 'Pfad fehlt.' });
        return;
      }

      // Conflict detection for offline sync
      if (!forceOverwrite && typeof baseMtime === 'number') {
        const existing = vaultService.getNoteOrNull(notePath);
        if (existing && Math.abs(existing.updatedAt - baseMtime) > 50) {
          res.status(409).json({
            error: 'Conflict',
            message: 'Die Notiz wurde zwischenzeitlich auf dem Server geändert.',
            serverNote: existing,
          });
          return;
        }
      }

      const note = vaultService.saveNote(notePath, { content, properties, body });
      res.json(note);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const handleDeleteEntry = (req: any, res: any) => {
    try {
      const rawPath = String(req.query.path || '');
      if (!rawPath) {
        res.status(400).json({ error: 'Pfad fehlt.' });
        return;
      }
      let filePath = rawPath;
      try {
        filePath = decodeURIComponent(rawPath);
      } catch {
        // keep raw
      }
      vaultService.deleteEntry(filePath);
      res.json({ ok: true, path: filePath });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  };

  app.delete('/api/vault/entry', requireAuth, handleDeleteEntry);
  app.delete('/api/vault/file', requireAuth, handleDeleteEntry);

  app.post('/api/vault/copy', requireAuth, (req, res) => {
    try {
      const { sourcePath, targetPath } = req.body as { sourcePath?: string; targetPath?: string };
      if (!sourcePath) {
        res.status(400).json({ error: 'sourcePath ist erforderlich.' });
        return;
      }
      const result = vaultService.copyEntry(sourcePath, targetPath);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vault/rename', requireAuth, (req, res) => {
    try {
      const { oldPath, newPath } = req.body as { oldPath?: string; newPath?: string };
      if (!oldPath || !newPath) {
        res.status(400).json({ error: 'oldPath und newPath sind erforderlich.' });
        return;
      }
      const result = vaultService.renameFile(oldPath, newPath);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vault/folder', requireAuth, (req, res) => {
    try {
      const { path: folderPath } = req.body as { path?: string };
      if (!folderPath) {
        res.status(400).json({ error: 'Pfad fehlt.' });
        return;
      }
      vaultService.createFolder(folderPath);
      res.json({ ok: true, path: folderPath });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/vault/graph', requireAuth, (_req, res) => {
    try {
      const graph = vaultService.buildGraph();
      res.json(graph);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/vault/backlinks', requireAuth, (req, res) => {
    try {
      const targetPath = String(req.query.path || '');
      if (!targetPath) {
        res.status(400).json({ error: 'path Query-Parameter fehlt.' });
        return;
      }
      const backlinks = vaultService.getBacklinks(targetPath);
      res.json(backlinks);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/vault/search', requireAuth, (req, res) => {
    try {
      const q = String(req.query.q || '');
      const tag = req.query.tag ? String(req.query.tag) : undefined;
      const results = vaultService.searchVault(q, tag);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/vault/resolve-wiki', requireAuth, (req, res) => {
    try {
      const target = String(req.query.target || '');
      const from = req.query.from ? String(req.query.from) : undefined;
      if (!target) {
        res.status(400).json({ error: 'target fehlt.' });
        return;
      }
      const resolved = vaultService.resolveWikiTarget(target, from);
      res.json({ target, resolvedPath: resolved });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve embedded images/attachments from vault
  app.get('/api/vault/attachment', requireAuth, (req, res) => {
    try {
      const target = String(req.query.target || '');
      const from = req.query.from ? String(req.query.from) : undefined;
      if (!target) {
        res.status(400).send('Target fehlt');
        return;
      }
      const resolvedRel = vaultService.resolveWikiTarget(target, from) || target;
      const absPath = vaultService.resolveSafePath(resolvedRel);
      const ext = path.extname(absPath).toLowerCase();

      const safeInlineTypes = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
        '.pdf',
        '.mp3', '.ogg', '.wav', '.m4a',
        '.mp4', '.webm', '.ogv',
      ]);

      if (ext === '.svg') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      } else if (!safeInlineTypes.has(ext)) {
        res.setHeader('Content-Security-Policy', 'sandbox');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(absPath)}"`);
      }

      res.sendFile(
        absPath,
        {
          cacheControl: false,
          lastModified: true,
          etag: true,
          maxAge: 0,
        },
        (err) => {
          if (err && !res.headersSent) {
            res.status(404).send('Anhang nicht gefunden');
          }
        }
      );
    } catch {
      res.status(404).send('Anhang nicht gefunden');
    }
  });

  // Binary file uploads (e.g. pasted or dropped images)
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const folder = String(_req.query.folder || 'attachments');
        const absFolder = vaultService.resolveSafePath(folder);
        fs.mkdirSync(absFolder, { recursive: true });
        cb(null, absFolder);
      },
      filename: (_req, file, cb) => {
        let ext = path.extname(file.originalname || '');
        if (!ext && file.mimetype) {
          if (file.mimetype === 'image/png') ext = '.png';
          else if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') ext = '.jpg';
          else if (file.mimetype === 'image/gif') ext = '.gif';
          else if (file.mimetype === 'image/webp') ext = '.webp';
          else if (file.mimetype === 'image/svg+xml') ext = '.svg';
          else ext = '.png';
        }
        let base = path.basename(file.originalname || 'image', ext).replace(/[^\w.-]/g, '_');
        if (!base || base === 'blob') base = 'pasted-image';
        cb(null, `${base}-${Date.now()}${ext || '.png'}`);
      },
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  });

  app.post(
    '/api/vault/upload',
    requireAuth,
    upload.single('file'),
    (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Keine Datei hochgeladen.' });
        return;
      }
      const relPath = path.relative(vaultService.getVaultDir(), req.file.path).replace(/\\/g, '/');
      vaultService.indexFile(relPath);
      const wikiEmbed = `![[${relPath}]]`;
      res.json({
        ok: true,
        path: relPath,
        name: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        wikiEmbed,
      });
    }
  );

  // Multi-file and directory upload preserving relative structures
  const uploadMulti = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, os.tmpdir());
      },
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        cb(null, `upload-${unique}-${path.basename(file.originalname).replace(/[^\w.-]/g, '_')}`);
      },
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  });

  app.post(
    '/api/vault/upload-entries',
    requireAuth,
    uploadMulti.array('files'),
    async (req, res) => {
      const files = (req.files as Express.Multer.File[]) || [];
      try {
        if (!files || files.length === 0) {
          res.status(400).json({ error: 'Keine Dateien hochgeladen.' });
          return;
        }

        const targetFolder = String(req.body.targetFolder || '').trim().replace(/\\/g, '/');
        if (targetFolder.includes('..') || path.isAbsolute(targetFolder) || targetFolder.startsWith('/')) {
          for (const f of files) await fs.promises.unlink(f.path).catch(() => {});
          res.status(400).json({ error: 'Ungültiger Zielordner (Path Traversal nicht erlaubt).' });
          return;
        }

        let relativePaths: string[] = [];
        if (typeof req.body.paths === 'string') {
          try {
            const parsed = JSON.parse(req.body.paths);
            if (Array.isArray(parsed)) relativePaths = parsed;
            else relativePaths = [req.body.paths];
          } catch {
            relativePaths = [req.body.paths];
          }
        } else if (Array.isArray(req.body.paths)) {
          relativePaths = req.body.paths;
        }

        const uploadedPaths: string[] = [];
        const vaultDir = vaultService.getVaultDir();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const rawRel = (relativePaths[i] || file.originalname || '').replace(/\\/g, '/');

          if (rawRel.includes('..') || path.isAbsolute(rawRel) || rawRel.startsWith('/')) {
            for (const f of files) await fs.promises.unlink(f.path).catch(() => {});
            res.status(400).json({ error: `Ungültiger Dateipfad: "${rawRel}" enthält ungültige Segmente.` });
            return;
          }

          const combinedRel = targetFolder ? `${targetFolder}/${rawRel}`.replace(/\/+/g, '/') : rawRel;
          const destAbsPath = vaultService.resolveSafePath(combinedRel);

          if (!destAbsPath.startsWith(vaultDir + path.sep)) {
            for (const f of files) await fs.promises.unlink(f.path).catch(() => {});
            res.status(400).json({ error: 'Dateipfad liegt außerhalb des Vaults.' });
            return;
          }

          const destDir = path.dirname(destAbsPath);
          await fs.promises.mkdir(destDir, { recursive: true });
          await fs.promises.copyFile(file.path, destAbsPath);
          await fs.promises.unlink(file.path).catch(() => {});

          vaultService.indexFile(combinedRel);
          uploadedPaths.push(combinedRel);
        }

        vaultService.invalidateCaches(true);

        res.json({
          success: true,
          count: uploadedPaths.length,
          paths: uploadedPaths,
        });
      } catch (err: unknown) {
        for (const f of files) await fs.promises.unlink(f.path).catch(() => {});
        console.error('[Upload Entries] Error:', err);
        res.status(500).json({ error: (err as Error).message || 'Fehler beim Hochladen der Dateien.' });
      }
    }
  );

  // Single file and folder ZIP download
  app.get('/api/vault/download', requireAuth, async (req, res) => {
    try {
      const rawPath = String(req.query.path || '').trim();
      if (rawPath.includes('..')) {
        res.status(400).json({ error: 'Ungültiger Pfad (Path Traversal nicht erlaubt).' });
        return;
      }

      const absPath = vaultService.resolveSafePath(rawPath);
      if (!fs.existsSync(absPath)) {
        res.status(404).send('Datei oder Ordner nicht gefunden.');
        return;
      }

      const stat = await fs.promises.stat(absPath);
      if (stat.isFile()) {
        const filename = path.basename(absPath);
        res.download(absPath, filename);
        return;
      }

      if (stat.isDirectory()) {
        const folderName = path.basename(absPath) || 'vault';
        const zipFilename = `${folderName}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(zipFilename)}"; filename*=UTF-8''${encodeURIComponent(zipFilename)}`
        );

        const zip = new ZipArchive({ zlib: { level: 6 } });
        zip.on('error', (err: any) => {
          console.error('[Download ZIP] Archiver error:', err);
          if (!res.headersSent) {
            res.status(500).send('Fehler beim Erstellen der ZIP-Datei.');
          }
        });

        zip.pipe(res);
        zip.directory(absPath, false, (data) => {
          const entryName = (data.name || '').replace(/\\/g, '/');
          if (
            entryName.startsWith('.') ||
            entryName.includes('/.') ||
            entryName.startsWith('node_modules/') ||
            entryName.includes('/node_modules/')
          ) {
            return false;
          }
          return data;
        });

        await zip.finalize();
        return;
      }

      res.status(400).send('Ungültiger Pfadtyp.');
    } catch (err: unknown) {
      console.error('[Download] Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: (err as Error).message || 'Fehler beim Download.' });
      }
    }
  });

  // --- Git & Remote Backup Endpoints ---
  app.get('/api/vault/git/status', requireAuth, async (_req, res) => {
    try {
      const status = await actualGitService.getStatus();
      res.json(status);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message || 'Fehler beim Abrufen des Git-Status' });
    }
  });

  app.get('/api/vault/git/config', requireAuth, (_req, res) => {
    res.json(configService.getMaskedGitConfig());
  });

  app.post('/api/vault/git/config', requireAuth, async (req, res) => {
    try {
      const updated = configService.updateGitConfig(req.body || {});
      await actualGitService.syncConfig();
      res.json(updated);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message || 'Fehler beim Speichern der Git-Konfiguration' });
    }
  });

  app.post('/api/vault/git/commit', requireAuth, async (req, res) => {
    try {
      const result = await actualGitService.commit(req.body?.reason);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message || 'Fehler beim Erstellen des Commits' });
    }
  });

  app.post('/api/vault/git/test-remote', requireAuth, async (req, res) => {
    try {
      const remote = req.body?.remote || req.body || {};
      const fullConfig = configService.getGitConfig();
      const remoteToTest = { ...remote };
      if (!remoteToTest.token && fullConfig.remote.token) {
        remoteToTest.token = fullConfig.remote.token;
      }
      const result = await actualGitService.testRemote(remoteToTest);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message || 'Verbindungstest fehlgeschlagen' });
    }
  });

  app.post('/api/vault/git/push', requireAuth, async (_req, res) => {
    try {
      const result = await actualGitService.push();
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ success: false, message: (err as Error).message || 'Git-Push fehlgeschlagen' });
    }
  });

  // Fallback to SPA index.html for client-side routing in production
  if (fs.existsSync(distDir)) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const vaultService = new VaultService(VAULT_PATH);
  const gitService = new GitService(vaultService.getVaultDir(), configService);

  // Initialize repository if enabled in config
  gitService.initIfNeeded().catch((err) => {
    console.warn('[Knowmesh Git] Auto-init error:', err);
  });

  const app = createApp(vaultService, gitService);

  let server: http.Server | https.Server;
  let protocolLabel = 'http';

  if (ENABLE_HTTPS) {
    const tls = ensureTlsCredentials(ROOT_DIR);
    server = https.createServer({ key: tls.key, cert: tls.cert }, app);
    protocolLabel = 'https';
    console.log(
      `🔒 TLS/HTTPS aktiv (${tls.isSelfSigned ? 'Auto-generiertes Self-Signed Zertifikat' : 'Eigenes Zertifikat'}): ${tls.certPath}`
    );
  } else {
    server = http.createServer(app);
    protocolLabel = 'http';
    console.log(`🌐 HTTP Modus aktiv (TLS wird extern / via Reverse Proxy terminiert)`);
  }

  const wss = new WebSocketServer({ server, path: '/ws' });
  let sessionCloseTimer: NodeJS.Timeout | null = null;

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    const cookieHeader = req.headers.cookie || '';
    const cookieMatch = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`) || c.startsWith('basalt_session=') || c.startsWith('obsidian_vault_session='));
    const cookieToken = cookieMatch ? decodeURIComponent(cookieMatch.split('=')[1]) : null;

    if (!verifySessionToken(queryToken || cookieToken)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    if (sessionCloseTimer) {
      clearTimeout(sessionCloseTimer);
      sessionCloseTimer = null;
    }

    ws.send(
      JSON.stringify({
        type: 'connected',
        timestamp: Date.now(),
      })
    );

    ws.on('close', () => {
      // Check if all clients disconnected; if so, trigger debounced session-close auto-commit & push
      const hasOpenClients = Array.from(wss.clients).some((c) => c !== ws && c.readyState === WebSocket.OPEN);
      if (!hasOpenClients) {
        if (sessionCloseTimer) clearTimeout(sessionCloseTimer);
        sessionCloseTimer = setTimeout(async () => {
          const stillOpen = Array.from(wss.clients).some((c) => c.readyState === WebSocket.OPEN);
          if (!stillOpen) {
            const gitCfg = configService.getGitConfig();
            if (gitCfg.enabled && gitCfg.autoCommitOnClose) {
              try {
                const commitRes = await gitService.commit('auto: session closed');
                if (commitRes.committed && gitCfg.remote?.enabled && gitCfg.remote?.url) {
                  await gitService.push();
                }
              } catch (err) {
                console.warn('[Knowmesh Git] Auto-commit on session end error:', err);
              }
            }
          }
        }, 5000);
      }
    });
  });

  // Broadcast batched file watcher events to all connected WebSocket clients
  vaultService.startWatcher((batch) => {
    const payload = JSON.stringify({
      type: 'vault:changed',
      paths: batch.paths,
      structural: batch.structural,
      timestamp: Date.now(),
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Knowmesh Server läuft auf:`);
    console.log(`   - Lokal:    ${protocolLabel}://localhost:${PORT}`);
    const localIps = getLocalIpAddresses().filter((ip) => ip !== '127.0.0.1');
    for (const ip of localIps) {
      console.log(`   - Netzwerk: ${protocolLabel}://${ip}:${PORT}`);
    }
    console.log(`📁 Vault-Verzeichnis: ${vaultService.getVaultDir()}`);
  });

}
