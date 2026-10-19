import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { serverLogger } from './logger';
import { clientLogger } from '../src/utils/logger';
import { VaultService } from './vaultService';
import { createApp } from './index';
import { configService } from './configService';

describe('Server & Client Logging Subsystem', () => {
  beforeEach(() => {
    serverLogger.setLevel('debug');
    serverLogger.clear();
    clientLogger.setLevel('debug');
    clientLogger.clear();
  });

  describe('Server Logger', () => {
    it('records log entries and respects ring buffer limit', () => {
      serverLogger.info('test', 'Hello server info');
      serverLogger.warn('test', 'Hello server warn');
      serverLogger.error('test', 'Hello server error', { code: 500 });

      const entries = serverLogger.getEntries();
      expect(entries.length).toBe(3);
      expect(entries[0].level).toBe('info');
      expect(entries[0].message).toBe('Hello server info');
      expect(entries[2].level).toBe('error');
      expect(entries[2].details).toBe('{"code":500}');
    });

    it('filters messages below configured log level', () => {
      serverLogger.setLevel('warn');
      serverLogger.debug('test', 'Ignored debug');
      serverLogger.info('test', 'Ignored info');
      serverLogger.warn('test', 'Accepted warn');
      serverLogger.error('test', 'Accepted error');

      const entries = serverLogger.getEntries();
      expect(entries.length).toBe(2);
      expect(entries[0].level).toBe('warn');
      expect(entries[1].level).toBe('error');
    });

    it('clears log entries on demand', () => {
      serverLogger.info('test', 'To be cleared');
      expect(serverLogger.getEntries().length).toBe(1);

      serverLogger.clear();
      expect(serverLogger.getEntries().length).toBe(0);
    });

    it('caps entries at 1000 items (ring buffer overflow)', () => {
      for (let i = 0; i < 1050; i++) {
        serverLogger.info('test', `Entry ${i}`);
      }
      const entries = serverLogger.getEntries(2000);
      expect(entries.length).toBe(1000);
      expect(entries[entries.length - 1].message).toBe('Entry 1049');
      expect(entries[0].message).toBe('Entry 50');
    });
  });

  describe('Client Logger', () => {
    it('records client log entries with category and timestamp', () => {
      clientLogger.info('sync', 'Sync started');
      clientLogger.debug('editor', 'Editor focused');
      clientLogger.warn('network', 'Slow response');

      const entries = clientLogger.getEntries();
      expect(entries.length).toBe(3);
      expect(entries[0].source).toBe('client');
      expect(entries[0].category).toBe('sync');
      expect(entries[0].message).toBe('Sync started');
    });

    it('filters client log entries according to log level', () => {
      clientLogger.setLevel('error');
      clientLogger.debug('sync', 'debug msg');
      clientLogger.info('sync', 'info msg');
      clientLogger.warn('sync', 'warn msg');
      clientLogger.error('sync', 'error msg');

      const entries = clientLogger.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].level).toBe('error');
      expect(entries[0].message).toBe('error msg');
    });

    it('clears client log entries', () => {
      clientLogger.info('sync', 'will be cleared');
      expect(clientLogger.getEntries().length).toBe(1);

      clientLogger.clear();
      expect(clientLogger.getEntries().length).toBe(0);
    });
  });

  describe('HTTP Log Endpoints (/api/logs)', () => {
    let testVaultDir: string;
    let vaultService: VaultService;
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
      configService.updateSecurity(false);
      testVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmesh-logs-test-'));
      vaultService = new VaultService(testVaultDir);

      const app = createApp(vaultService);
      server = http.createServer(app);

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as AddressInfo;
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      if (testVaultDir && fs.existsSync(testVaultDir)) {
        fs.rmSync(testVaultDir, { recursive: true, force: true });
      }
    });

    it('fetches server logs and level via GET /api/logs', async () => {
      serverLogger.info('api-test', 'Message via endpoint');

      const res = await fetch(`${baseUrl}/api/logs`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.level).toBeDefined();
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.entries.some((e: any) => e.message === 'Message via endpoint')).toBe(true);
    });

    it('changes log level via POST /api/logs/level', async () => {
      const res = await fetch(`${baseUrl}/api/logs/level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'error' }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.level).toBe('error');
      expect(serverLogger.getLevel()).toBe('error');

      // Invalid level rejected with 400
      const badRes = await fetch(`${baseUrl}/api/logs/level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'invalid-level' }),
      });
      expect(badRes.status).toBe(400);
    });

    it('clears logs via DELETE /api/logs', async () => {
      serverLogger.error('api-test', 'Message to clear');
      expect(serverLogger.getEntries().length).toBeGreaterThan(0);

      const res = await fetch(`${baseUrl}/api/logs`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(serverLogger.getEntries().length).toBe(0);
    });
  });
});
