import type { LogEntry, LogLevel } from '../../shared/types';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const STORAGE_KEY_LEVEL = 'zuber_log_level';
const STORAGE_KEY_LOGS = 'zuber_client_logs';
const MAX_BUFFER_SIZE = 1000;
const MAX_PERSISTED_LOGS = 400;
const MAX_DETAILS_LENGTH = 2500;

export interface DiagnosticsContext {
  userAgent: string;
  viewport: string;
  isMobile: boolean;
  onLine: boolean;
  visibilityState: string;
  connectionType: string;
  serviceWorkerState: string;
  scriptBundles: string[];
  logLevel: LogLevel;
  bufferedEntries: number;
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|password|secret|auth)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/("(?:password|token|sessionSecret|authToken|imapPassword|smtpPassword)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
}

export class ClientLogger {
  private buffer: LogEntry[] = [];
  private currentLevel: LogLevel = 'info';
  private listeners = new Set<(entries: LogEntry[]) => void>();

  constructor() {
    this.currentLevel = this.loadLevel();
    this.buffer = this.loadPersistedLogs();
    this.setupGlobalHandlers();
  }

  private loadLevel(): LogLevel {
    if (typeof localStorage === 'undefined') return 'info';
    try {
      const stored = (localStorage.getItem(STORAGE_KEY_LEVEL) || localStorage.getItem('knowmesh_log_level')) as LogLevel;
      if (stored && ['debug', 'info', 'warn', 'error'].includes(stored)) {
        return stored;
      }
    } catch {
      // ignore
    }
    return 'info';
  }

  private loadPersistedLogs(): LogEntry[] {
    try {
      const raw =
        (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY_LOGS)) ||
        (typeof sessionStorage !== 'undefined' &&
          (sessionStorage.getItem(STORAGE_KEY_LOGS) || sessionStorage.getItem('knowmesh_client_logs'))) ||
        null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.slice(-MAX_BUFFER_SIZE);
      }
    } catch {
      // ignore
    }
    return [];
  }

  private persistLogs(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const subset = this.buffer.slice(-MAX_PERSISTED_LOGS);
      localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(subset));
    } catch {
      try {
        const compact = this.buffer.slice(-100);
        localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(compact));
      } catch {
        // ignore quota errors
      }
    }
  }

  private setupGlobalHandlers(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event) => {
      this.error('window', event.message || 'Window error', event.error?.stack || `${event.filename}:${event.lineno}`);
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const details = reason instanceof Error ? reason.stack : String(reason);
      this.error('promise', `Unhandled Rejection: ${reason instanceof Error ? reason.message : String(reason)}`, details);
    });
  }

  public getLevel(): LogLevel {
    return this.currentLevel;
  }

  public isDebugEnabled(): boolean {
    return this.currentLevel === 'debug';
  }

  public getDiagnosticsContext(): DiagnosticsContext {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const win = typeof window !== 'undefined' ? window : undefined;
    const doc = typeof document !== 'undefined' ? document : undefined;
    const conn = (nav as any)?.connection;
    const swController = nav?.serviceWorker?.controller;
    const scriptBundles = doc
      ? Array.from(doc.querySelectorAll('script[src]'))
          .map((el) => el.getAttribute('src') || '')
          .filter(Boolean)
          .slice(0, 10)
      : [];
    const width = win?.innerWidth ?? 0;
    const height = win?.innerHeight ?? 0;

    return {
      userAgent: nav?.userAgent || 'unknown',
      viewport: `${width}x${height}`,
      isMobile: width > 0 ? width < 768 : false,
      onLine: nav ? nav.onLine : true,
      visibilityState: doc?.visibilityState || 'unknown',
      connectionType: conn
        ? `${conn.effectiveType || 'unknown'} (rtt=${conn.rtt ?? '?'}ms, downlink=${conn.downlink ?? '?'}Mbps)`
        : 'unavailable',
      serviceWorkerState: swController
        ? `${swController.state} (${swController.scriptURL})`
        : nav && 'serviceWorker' in nav
          ? 'no-controller'
          : 'unsupported',
      scriptBundles,
      logLevel: this.currentLevel,
      bufferedEntries: this.buffer.length,
    };
  }

  public setLevel(level: LogLevel): void {
    this.currentLevel = level;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_LEVEL, level);
      } catch {
        // ignore
      }
    }
    this.info('logger', `Client log level set to "${level}"`);
    this.notify();
  }

  public shouldLog(level: LogLevel): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.currentLevel];
  }

  public log(level: LogLevel, category: string, message: string, details?: unknown): void {
    if (!this.shouldLog(level)) return;

    let detailsStr: string | undefined;
    if (details !== undefined && details !== null) {
      if (typeof details === 'string') {
        detailsStr = details;
      } else if (details instanceof Error) {
        detailsStr = details.stack || details.message;
      } else {
        try {
          detailsStr = JSON.stringify(details);
        } catch {
          detailsStr = String(details);
        }
      }
      if (detailsStr) {
        detailsStr = redactSensitiveText(detailsStr);
        if (detailsStr.length > MAX_DETAILS_LENGTH) {
          detailsStr = `${detailsStr.slice(0, MAX_DETAILS_LENGTH)}... [truncated]`;
        }
      }
    }

    const safeMessage = redactSensitiveText(message);

    const entry: LogEntry = {
      id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      source: 'client',
      category,
      message: safeMessage,
      details: detailsStr,
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }

    this.persistLogs();
    this.notify();

    // Mirror to browser console
    const prefix = `[Knowmesh] [${level.toUpperCase()}] [${category}]`;
    if (level === 'error') {
      console.error(prefix, message, detailsStr ?? '');
    } else if (level === 'warn') {
      console.warn(prefix, message, detailsStr ?? '');
    } else if (level === 'info') {
      console.info(prefix, message, detailsStr ?? '');
    } else {
      console.debug(prefix, message, detailsStr ?? '');
    }
  }

  public debug(category: string, message: string, details?: unknown): void {
    this.log('debug', category, message, details);
  }

  public info(category: string, message: string, details?: unknown): void {
    this.log('info', category, message, details);
  }

  public warn(category: string, message: string, details?: unknown): void {
    this.log('warn', category, message, details);
  }

  public error(category: string, message: string, details?: unknown): void {
    this.log('error', category, message, details);
  }

  public getEntries(): LogEntry[] {
    return [...this.buffer];
  }

  public clear(): void {
    this.buffer = [];
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY_LOGS);
      } catch {
        // ignore
      }
    }
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.removeItem(STORAGE_KEY_LOGS);
      } catch {
        // ignore
      }
    }
    this.notify();
  }

  public subscribe(cb: (entries: LogEntry[]) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    const copy = [...this.buffer];
    for (const cb of this.listeners) {
      try {
        cb(copy);
      } catch {
        // ignore
      }
    }
  }
}

export const clientLogger = new ClientLogger();
