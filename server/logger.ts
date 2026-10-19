import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { LogEntry, LogLevel } from '../shared/types';
import { configService } from './configService';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MAX_BUFFER_SIZE = 1000;
const MAX_LOGFILE_BYTES = 5 * 1024 * 1024; // 5 MB

export class ServerLogger {
  private buffer: LogEntry[] = [];
  private logFilePath: string;

  constructor() {
    this.logFilePath = path.join(configService.getConfigDir(), 'knowmesh.log');
  }

  public getLevel(): LogLevel {
    return configService.getLogLevel();
  }

  public setLevel(level: LogLevel): void {
    configService.setLogLevel(level);
    this.info('logger', `Server log level changed to "${level}"`);
  }

  public shouldLog(level: LogLevel): boolean {
    const currentLevel = this.getLevel();
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel];
  }

  private appendToLogFile(entry: LogEntry): void {
    try {
      const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}${
        entry.details ? ` | ${entry.details}` : ''
      }\n`;

      if (fs.existsSync(this.logFilePath)) {
        const stat = fs.statSync(this.logFilePath);
        if (stat.size > MAX_LOGFILE_BYTES) {
          const backupPath = `${this.logFilePath}.1`;
          try {
            if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
            fs.renameSync(this.logFilePath, backupPath);
          } catch {
            // ignore rotation failure
          }
        }
      }

      fs.appendFileSync(this.logFilePath, line, 'utf-8');
    } catch {
      // Ignore file writing errors so logging never crashes server operations
    }
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
    }

    const entry: LogEntry = {
      id: crypto.randomUUID ? crypto.randomUUID() : `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      source: 'server',
      category,
      message,
      details: detailsStr,
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }

    this.appendToLogFile(entry);

    // Also forward to console for container stdout visibility
    const consolePrefix = `[Knowmesh Server] [${entry.level.toUpperCase()}] [${entry.category}]`;
    if (level === 'error') {
      console.error(consolePrefix, message, detailsStr ?? '');
    } else if (level === 'warn') {
      console.warn(consolePrefix, message, detailsStr ?? '');
    } else {
      console.log(consolePrefix, message, detailsStr ?? '');
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

  public getEntries(limit?: number): LogEntry[] {
    if (limit && limit > 0 && limit < this.buffer.length) {
      return this.buffer.slice(-limit);
    }
    return [...this.buffer];
  }

  public clear(): void {
    this.buffer = [];
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.writeFileSync(this.logFilePath, '', 'utf-8');
      }
    } catch {
      // ignore
    }
  }
}

export const serverLogger = new ServerLogger();
