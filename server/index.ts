import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import {
  COOKIE_NAME,
  createSessionToken,
  extractTokenFromRequest,
  getExpectedPassword,
  requireAuth,
  verifySessionToken,
} from './auth';
import { ensureTlsCredentials } from './tls';
import { VaultService } from './vaultService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 3443);
const ENABLE_HTTPS = (process.env.ENABLE_HTTPS ?? 'true').toLowerCase() !== 'false';
const VAULT_PATH = path.resolve(ROOT_DIR, process.env.VAULT_PATH || './vault');

export function createApp(vaultService: VaultService) {
  const app = express();

  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());

  // --- Auth Endpoints ---
  app.get('/api/auth/status', (req, res) => {
    const token = extractTokenFromRequest(req);
    const authenticated = verifySessionToken(token);
    res.json({
      authenticated,
      https: ENABLE_HTTPS || req.secure || req.headers['x-forwarded-proto'] === 'https',
      vaultPath: vaultService.getVaultDir(),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { password } = req.body as { password?: string };
    const expected = getExpectedPassword();

    if (!password || password !== expected) {
      res.status(401).json({ error: 'Ungültiges Passwort.' });
      return;
    }

    const token = createSessionToken();
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ENABLE_HTTPS,
      maxAge: 1000 * 60 * 60 * 24 * 14,
    });

    res.json({
      authenticated: true,
      token,
    });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ authenticated: false });
  });

  // --- Protected Vault API Endpoints ---
  app.get('/api/vault/tree', requireAuth, (_req, res) => {
    try {
      const tree = vaultService.getFileTree();
      const files = vaultService.listAllFiles();
      res.json({ tree, files, vaultPath: vaultService.getVaultDir() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/vault/note', requireAuth, (req, res) => {
    try {
      const relPath = String(req.query.path || '');
      if (!relPath) {
        res.status(400).json({ error: 'Pfad fehlt.' });
        return;
      }
      const note = vaultService.getNote(relPath);
      res.json(note);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vault/note', requireAuth, (req, res) => {
    try {
      const { path: relPath, rawContent, body, properties } = req.body;
      if (!relPath || typeof relPath !== 'string') {
        res.status(400).json({ error: 'Pfad fehlt.' });
        return;
      }
      const saved = vaultService.saveNote(relPath, { rawContent, body, properties });
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vault/folder', requireAuth, (req, res) => {
    try {
      const { path: relPath } = req.body;
      if (!relPath || typeof relPath !== 'string') {
        res.status(400).json({ error: 'Ordnerpfad fehlt.' });
        return;
      }
      vaultService.createFolder(relPath);
      res.json({ ok: true, path: relPath });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vault/rename', requireAuth, (req, res) => {
    try {
      const { oldPath, newPath } = req.body;
      if (!oldPath || !newPath) {
        res.status(400).json({ error: 'Alter und neuer Pfad erforderlich.' });
        return;
      }
      const result = vaultService.renameOrMove(oldPath, newPath);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/vault/entry', requireAuth, (req, res) => {
    try {
      const relPath = String(req.query.path || '');
      if (!relPath) {
        res.status(400).json({ error: 'Pfad fehlt.' });
        return;
      }
      vaultService.deleteEntry(relPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
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
      const relPath = String(req.query.path || '');
      res.json(vaultService.getBacklinks(relPath));
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

  app.get('/api/vault/resolve', requireAuth, (req, res) => {
    try {
      const target = String(req.query.target || '');
      const from = req.query.from ? String(req.query.from) : undefined;
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
      // Browser may cache for 1h; afterwards it revalidates cheaply via ETag/Last-Modified.
      res.sendFile(
        absPath,
        {
          cacheControl: false,
          lastModified: true,
          etag: true,
          headers: { 'Cache-Control': 'private, max-age=3600' },
        },
        (err) => {
          if (err && !res.headersSent) res.status(404).send('Anhang nicht gefunden');
        }
      );
    } catch (err) {
      res.status(400).send((err as Error).message);
    }
  });

  // Upload image/attachment into vault Attachments folder
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  app.post('/api/vault/upload', requireAuth, upload.single('file'), (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Keine Datei hochgeladen.' });
        return;
      }
      const folder = String(req.body.folder || 'Attachments').replace(/^[/\\]+/, '');
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._äöüÄÖÜß -]/g, '_');
      const relPath = `${folder}/${Date.now()}-${safeName}`;
      const absPath = vaultService.resolveSafePath(relPath);
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(absPath, file.buffer);
      vaultService.indexFile(relPath);
      res.json({
        path: relPath,
        name: path.basename(relPath),
        wikiEmbed: `![[${path.basename(relPath)}]]`,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Serve built static frontend in production
  const distDir = path.join(ROOT_DIR, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
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
  const app = createApp(vaultService);

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
  }

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    // Parse token from cookie or query string
    const url = new URL(req.url || '/ws', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    const cookieHeader = req.headers.cookie || '';
    const cookieMatch = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    const cookieToken = cookieMatch ? decodeURIComponent(cookieMatch.split('=')[1]) : null;

    if (!verifySessionToken(queryToken || cookieToken)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'connected',
        timestamp: Date.now(),
      })
    );
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
    console.log(`🚀 Obsidian Web Vault Server läuft auf ${protocolLabel}://localhost:${PORT}`);
    console.log(`📁 Vault-Verzeichnis: ${vaultService.getVaultDir()}`);
  });
}
