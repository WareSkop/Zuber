/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getServerClockOffset,
  setServerClockOffset,
  toNormalizedServerTime,
} from '../api';
import { isFastForwardCompatible, syncEngine } from './syncEngine';
import { VaultService } from '../../server/vaultService';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Clock Drift Normalization & Fast-Forward Typing Resolution', () => {
  beforeEach(() => {
    setServerClockOffset(0);
  });

  describe('1. Clock Drift Offset Calculation', () => {
    it('accurately adjusts client timestamps based on server clock offset', () => {
      // Server is 150 seconds (2.5 minutes) behind client
      setServerClockOffset(-150000);
      expect(getServerClockOffset()).toBe(-150000);

      const clientTime = 1700000000000;
      const normalizedTime = toNormalizedServerTime(clientTime);
      expect(normalizedTime).toBe(clientTime - 150000);

      // Server is 60 seconds ahead of client
      setServerClockOffset(60000);
      expect(toNormalizedServerTime(clientTime)).toBe(clientTime + 60000);
    });
  });

  describe('2. Frontend isFastForwardCompatible Helper', () => {
    it('detects forward typing progress (local is ahead)', () => {
      const serverBody = 'Hier ist ein neues Noteb';
      const localBody = 'Hier ist ein neues Notebook';

      const res = isFastForwardCompatible(localBody, serverBody);
      expect(res.compatible).toBe(true);
      expect(res.winner).toBe('local');
    });

    it('detects server is ahead (server has additional typing)', () => {
      const localBody = 'Hier ist ein neues Noteb';
      const serverBody = 'Hier ist ein neues Notebook';

      const res = isFastForwardCompatible(localBody, serverBody);
      expect(res.compatible).toBe(true);
      expect(res.winner).toBe('server');
    });

    it('handles identical contents with CRLF line ending differences', () => {
      const localBody = 'Line 1\r\nLine 2\r\nLine 3\n';
      const serverBody = 'Line 1\nLine 2\nLine 3';

      const res = isFastForwardCompatible(localBody, serverBody);
      expect(res.compatible).toBe(true);
      expect(res.winner).toBe('local');
    });

    it('detects prepend extensions (ends with)', () => {
      const serverBody = 'End of note';
      const localBody = 'Introductory header\n\nEnd of note';

      const res = isFastForwardCompatible(localBody, serverBody);
      expect(res.compatible).toBe(true);
      expect(res.winner).toBe('local');
    });

    it('flags divergent changes as incompatible conflicts', () => {
      const localBody = 'Notebook with section A';
      const serverBody = 'Notebook with section B';

      const res = isFastForwardCompatible(localBody, serverBody);
      expect(res.compatible).toBe(false);
    });

    it('handles empty strings cleanly', () => {
      expect(isFastForwardCompatible('Something', '')).toEqual({
        compatible: true,
        winner: 'local',
      });
      expect(isFastForwardCompatible('', 'Something')).toEqual({
        compatible: true,
        winner: 'server',
      });
      expect(isFastForwardCompatible('', '')).toEqual({
        compatible: true,
        winner: 'local',
      });
    });
  });

  describe('3. Backend VaultService isFastForward Evaluation', () => {
    let tmpDir: string;
    let vaultService: VaultService;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuber-ff-test-'));
      vaultService = new VaultService(tmpDir);
    });

    it('accepts fast-forward typing on markdown notes', () => {
      const existing = {
        path: 'Test.md',
        name: 'Test',
        body: 'User typed Noteb',
        rawContent: 'User typed Noteb',
        frontmatter: {},
        properties: [],
        links: [],
        embeds: [],
        tags: [],
        headings: [],
        updatedAt: 1000,
      };

      const incoming = {
        body: 'User typed Notebook',
        properties: [],
      };

      expect(vaultService.isFastForward(existing, incoming)).toBe(true);
    });

    it('rejects fast-forward on .canvas and .base files', () => {
      const existingCanvas = {
        path: 'Diagram.canvas',
        name: 'Diagram',
        body: '{"nodes": []}',
        rawContent: '{"nodes": []}',
        frontmatter: {},
        properties: [],
        links: [],
        embeds: [],
        tags: [],
        headings: [],
        updatedAt: 1000,
      };

      expect(vaultService.isFastForward(existingCanvas, { body: '{"nodes": [{"id":"1"}]}' })).toBe(false);

      const existingBase = {
        path: 'Table.base',
        name: 'Table',
        body: 'views:\n  - type: table',
        rawContent: 'views:\n  - type: table',
        frontmatter: {},
        properties: [],
        links: [],
        embeds: [],
        tags: [],
        headings: [],
        updatedAt: 1000,
      };

      expect(vaultService.isFastForward(existingBase, { body: 'views:\n  - type: table\n    columns: []' })).toBe(false);
    });

    it('rejects fast-forward if properties diverged', () => {
      const existing = {
        path: 'Test.md',
        name: 'Test',
        body: 'User typed Noteb',
        rawContent: 'User typed Noteb',
        frontmatter: { status: 'draft' },
        properties: [{ key: 'status', value: 'draft', type: 'text' as const }],
        links: [],
        embeds: [],
        tags: [],
        headings: [],
        updatedAt: 1000,
      };

      const incoming = {
        body: 'User typed Notebook',
        properties: [{ key: 'status', value: 'published', type: 'text' as const }],
      };

      expect(vaultService.isFastForward(existing, incoming)).toBe(false);
    });
  });

  describe('4. SyncEngine Request Serialization & Active Save Locks', () => {
    it('chains consecutive saves on the same file path sequentially', async () => {
      const executionOrder: number[] = [];

      // Stub executeSaveNote to record execution order with artificial delay
      const originalSave = (syncEngine as any).executeSaveNote;
      try {
        (syncEngine as any).executeSaveNote = async (payload: any) => {
          const id = payload.testId;
          executionOrder.push(id);
          // Wait 30ms to simulate network duration
          await new Promise((r) => setTimeout(r, 30));
          return {
            path: payload.path,
            name: 'note',
            body: payload.body || '',
            frontmatter: {},
            properties: [],
            links: [],
            embeds: [],
            tags: [],
            headings: [],
            updatedAt: Date.now(),
          };
        };

        const p1 = syncEngine.saveNote({ path: 'Sequential.md', body: 'v1', testId: 1 } as any);
        const p2 = syncEngine.saveNote({ path: 'Sequential.md', body: 'v2', testId: 2 } as any);
        const p3 = syncEngine.saveNote({ path: 'Sequential.md', body: 'v3', testId: 3 } as any);

        await Promise.all([p1, p2, p3]);

        expect(executionOrder).toEqual([1, 2, 3]);
      } finally {
        (syncEngine as any).executeSaveNote = originalSave;
      }
    });
  });
});
