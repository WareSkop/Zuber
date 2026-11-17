/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';

function createMemoryStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
}

Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: createMemoryStorage(), configurable: true });

import { ClientLogger, clientLogger, redactSensitiveText } from './logger';
import { buildDiagnosticReport } from './logExport';

describe('ClientLogger persistence & logExport', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clientLogger.clear();
    clientLogger.setLevel('info');
  });

  it('persists client logs in localStorage and survives sessionStorage.clear()', () => {
    clientLogger.setLevel('debug');
    clientLogger.debug('canvas', 'Node drag stop', { nodeId: 'n1' });
    clientLogger.error('react-crash', 'Minified React error #310', { componentStack: 'at ConflictModal' });

    // Simulate ErrorBoundary clearing sessionStorage during recovery
    sessionStorage.clear();

    const reloadedLogger = new ClientLogger();
    const entries = reloadedLogger.getEntries();
    expect(entries.some((e) => e.category === 'canvas' && e.message === 'Node drag stop')).toBe(true);
    expect(entries.some((e) => e.category === 'react-crash' && e.details?.includes('ConflictModal'))).toBe(true);
    expect(reloadedLogger.isDebugEnabled()).toBe(true);
  });

  it('redacts tokens and passwords from messages, details, and exported reports', () => {
    const raw = 'Authorization: Bearer secret-jwt-123 /ws?token=abc123 {"password":"my-secret","token":"tok"}';
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain('secret-jwt-123');
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain('my-secret');
    expect(redacted).toContain('[REDACTED]');

    clientLogger.info('sync', 'Auth check Bearer tok999', { password: 'pw123' });
    const report = buildDiagnosticReport({
      clientEntries: clientLogger.getEntries(),
      serverEntries: [
        {
          id: 'srv-1',
          timestamp: new Date().toISOString(),
          level: 'warn',
          source: 'server',
          category: 'vault',
          message: 'Conflict on diagram.canvas',
        },
      ],
      appVersion: '0.3.0',
      currentTheme: 'obsidian-dark',
      logLevel: 'debug',
      sourceFilter: 'all',
    });

    expect(report).toContain('# Zuber Diagnostics & Log Export');
    expect(report).toContain('Viewport:');
    expect(report).toContain('Service Worker:');
    expect(report).toContain('Conflict on diagram.canvas');
    expect(report).not.toContain('tok999');
    expect(report).not.toContain('pw123');
  });
});
