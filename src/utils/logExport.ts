import type { LogEntry, LogLevel } from '../../shared/types';
import { clientLogger, redactSensitiveText } from './logger';

export interface DiagnosticReportOptions {
  clientEntries: LogEntry[];
  serverEntries?: LogEntry[];
  appVersion?: string;
  currentTheme?: string;
  logLevel?: LogLevel;
  sourceFilter?: 'all' | 'client' | 'server';
}

export function buildDiagnosticReport({
  clientEntries,
  serverEntries = [],
  appVersion = 'unknown',
  currentTheme = 'unknown',
  logLevel = clientLogger.getLevel(),
  sourceFilter = 'all',
}: DiagnosticReportOptions): string {
  const ctx = clientLogger.getDiagnosticsContext();
  const combined =
    sourceFilter === 'client'
      ? [...clientEntries]
      : sourceFilter === 'server'
        ? [...serverEntries]
        : [...clientEntries, ...serverEntries];

  combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const header = [
    `# Zuber Diagnostics & Log Export`,
    `Generated: ${new Date().toISOString()}`,
    `Zuber Version: v${appVersion}`,
    `Active Theme: ${currentTheme}`,
    `Online Status: ${ctx.onLine ? 'Online' : 'Offline'}`,
    `Visibility: ${ctx.visibilityState}`,
    `Viewport: ${ctx.viewport} (mobile=${ctx.isMobile})`,
    `Connection: ${ctx.connectionType}`,
    `Service Worker: ${ctx.serviceWorkerState}`,
    `Script Bundles: ${ctx.scriptBundles.length > 0 ? ctx.scriptBundles.join(', ') : 'none'}`,
    `User-Agent: ${ctx.userAgent}`,
    `Active Log Level: ${logLevel.toUpperCase()}`,
    `Filtered Source: ${sourceFilter} (${combined.length} entries)`,
    `--------------------------------------------------------------------------------`,
    '',
  ].join('\n');

  const body = combined
    .map((e) => {
      const details = e.details ? `\n    ${e.details.replace(/\n/g, '\n    ')}` : '';
      return `[${e.timestamp}] [${e.source.toUpperCase()}] [${e.level.toUpperCase()}] [${e.category}] ${e.message}${details}`;
    })
    .join('\n');

  return redactSensitiveText(`${header}\n${body}`);
}

export function getDiagnosticFileName(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `zuber-debug-${iso}.txt`;
}

export function downloadDiagnosticReport(reportText: string, fileName = getDiagnosticFileName()): void {
  const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function shareOrDownloadDiagnosticReport(
  reportText: string,
  fileName = getDiagnosticFileName()
): Promise<'shared' | 'downloaded'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file =
        typeof File === 'function'
          ? new File([reportText], fileName, { type: 'text/plain' })
          : null;
      if (file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Zuber Debug Logs',
          files: [file],
        });
        return 'shared';
      }
      await navigator.share({
        title: 'Zuber Debug Logs',
        text: reportText.slice(0, 100000),
      });
      return 'shared';
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return 'shared';
      }
      // Fall through to file download if Web Share fails
    }
  }
  downloadDiagnosticReport(reportText, fileName);
  return 'downloaded';
}

export async function copyDiagnosticReport(reportText: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(reportText);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.value = reportText;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
  return false;
}
