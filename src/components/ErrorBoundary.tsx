import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { clientLogger } from '../utils/logger';
import {
  buildDiagnosticReport,
  copyDiagnosticReport,
  shareOrDownloadDiagnosticReport,
} from '../utils/logExport';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isResetting: boolean;
  isLoadingCache: boolean;
  isRetrying: boolean;
  copiedLogs: boolean;
  exportedLogs: boolean;
}

const ACTIVE_VIEW_STORAGE_KEYS = [
  'zuber_last_active_note',
  'knowmesh_last_active_note',
  'basalt_last_active_note',
  'zuber_open_tabs',
  'knowmesh_open_tabs',
  'basalt_open_tabs',
  'zuber_active_view',
  'knowmesh_active_view',
  'basalt_active_view',
  'zuber_workspace_view',
  'knowmesh_workspace_view',
  'basalt_workspace_view',
  'zuber_editor_mode',
  'knowmesh_editor_mode',
  'basalt_editor_mode',
  'zuber_split_ratio',
  'knowmesh_split_ratio',
  'basalt_split_ratio',
  'zuber_research_target',
  'knowmesh_research_target',
  'basalt_research_target',
] as const;

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isResetting: false,
      isLoadingCache: false,
      isRetrying: false,
      copiedLogs: false,
      exportedLogs: false,
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorInfo: null,
      isResetting: false,
      isLoadingCache: false,
      isRetrying: false,
      copiedLogs: false,
      exportedLogs: false,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[Zuber ErrorBoundary] Uncaught render error caught by boundary:', error, errorInfo);
    clientLogger.error('react-crash', error.message || 'Uncaught render error', {
      name: error.name,
      stack: error.stack,
      componentStack: errorInfo?.componentStack,
    });
    this.reportCrashToServer(error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  private reportCrashToServer(error: Error, errorInfo: ErrorInfo): void {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (typeof fetch !== 'function') return;
    try {
      const token =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('zuber_auth_token') || localStorage.getItem('knowmesh_auth_token')
          : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const ctx = clientLogger.getDiagnosticsContext();
      fetch('/api/logs/client-crash', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo?.componentStack,
          viewport: ctx.viewport,
        }),
      }).catch(() => {});
    } catch {
      // ignore reporting failures
    }
  }

  private buildCrashReportText(): string {
    return buildDiagnosticReport({
      clientEntries: clientLogger.getEntries(),
      logLevel: clientLogger.getLevel(),
      sourceFilter: 'client',
    });
  }

  private handleExportLogs = async (): Promise<void> => {
    const text = this.buildCrashReportText();
    await shareOrDownloadDiagnosticReport(text);
    this.setState({ exportedLogs: true });
    setTimeout(() => this.setState({ exportedLogs: false }), 2500);
  };

  private handleCopyLogs = async (): Promise<void> => {
    const text = this.buildCrashReportText();
    const ok = await copyDiagnosticReport(text);
    if (ok) {
      this.setState({ copiedLogs: true });
      setTimeout(() => this.setState({ copiedLogs: false }), 2500);
    }
  };

  private clearActiveViewStorage(): void {
    try {
      for (const key of ACTIVE_VIEW_STORAGE_KEYS) {
        localStorage.removeItem(key);
      }
    } catch {}
  }

  private navigateCleanRoot(): void {
    try {
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : '';
      if (typeof window !== 'undefined' && typeof window.location?.replace === 'function') {
        window.location.replace(`${origin}/`);
      }
      if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
        window.location.reload();
      }
    } catch {
      try {
        window.location.reload();
      } catch {}
    }
  }

  private handleResetViewAndReload = (): void => {
    this.setState({ isResetting: true });
    this.clearActiveViewStorage();
    try {
      this.props.onReset?.();
    } catch {}
    this.navigateCleanRoot();
  };

  private handleLoadCacheAndRestart = (): void => {
    this.setState({ isLoadingCache: true });
    this.clearActiveViewStorage();
    try {
      localStorage.setItem('zuber_force_offline_boot', '1');
    } catch {}
    try {
      sessionStorage.clear();
    } catch {}
    try {
      this.props.onReset?.();
    } catch {}
    this.navigateCleanRoot();
  };

  private handleRetry = (): void => {
    this.setState({ isRetrying: true });
    try {
      sessionStorage.clear();
    } catch {}
    try {
      this.props.onReset?.();
    } catch {}
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      isResetting: false,
      isLoadingCache: false,
      isRetrying: false,
      copiedLogs: false,
      exportedLogs: false,
    });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'Unbekannter Anwendungsfehler';
      const componentStack = this.state.errorInfo?.componentStack?.trim() || '';
      const isEn =
        typeof localStorage !== 'undefined' && localStorage.getItem('zuber_language') === 'en';

      return (
        <div
          className="error-boundary-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            pointerEvents: 'auto',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100vw',
            backgroundColor: '#0d1117',
            color: '#c9d1d9',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            padding: '24px',
            boxSizing: 'border-box',
            textAlign: 'center',
          }}
        >
          <div
            className="error-boundary-card"
            style={{
              maxWidth: '560px',
              width: '100%',
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '12px',
              padding: '32px 24px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ marginBottom: '16px' }}>
              <img
                src="/knowmesh_icon.png"
                alt="Zuber"
                style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'contain' }}
              />
            </div>
            <h2
              style={{
                fontSize: '20px',
                fontWeight: 600,
                color: '#f0f6fc',
                margin: '0 0 12px 0',
              }}
            >
              {isEn ? 'Zuber could not start normally' : 'Zuber konnte nicht normal gestartet werden'}
            </h2>
            <p
              style={{
                fontSize: '14px',
                color: '#8b949e',
                margin: '0 0 20px 0',
                lineHeight: 1.5,
              }}
            >
              {isEn
                ? 'An unexpected error occurred while running the app. Your locally cached notes in IndexedDB are safe.'
                : 'Ein unerwarteter Fehler ist beim Laden der Anwendung aufgetreten. Ihre lokal gespeicherten Notizen in der IndexedDB sind sicher.'}
            </p>

            <div
              style={{
                backgroundColor: '#0d1117',
                border: '1px solid #21262d',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '12px',
                fontFamily: 'monospace',
                color: '#f85149',
                textAlign: 'left',
                overflowX: 'auto',
                marginBottom: componentStack ? '12px' : '24px',
                maxHeight: '160px',
              }}
            >
              {errorMessage}
            </div>

            {componentStack && (
              <details
                style={{
                  textAlign: 'left',
                  marginBottom: '20px',
                  backgroundColor: '#0d1117',
                  border: '1px solid #21262d',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '11px',
                  color: '#8b949e',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 500 }}>
                  {isEn ? 'Component Stack (Details)' : 'Komponenten-Stack (Details)'}
                </summary>
                <pre
                  style={{
                    margin: '8px 0 0 0',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'monospace',
                    maxHeight: '140px',
                    overflowY: 'auto',
                  }}
                >
                  {componentStack}
                </pre>
              </details>
            )}

            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="error-boundary-btn error-boundary-btn-reset"
                onClick={this.handleResetViewAndReload}
                style={{
                  backgroundColor: '#d4af37',
                  color: '#0d1117',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  minHeight: '44px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  pointerEvents: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {this.state.isResetting
                  ? isEn
                    ? 'Resetting...'
                    : 'Wird zurückgesetzt...'
                  : isEn
                  ? 'Reset Active View & Reload'
                  : 'Ansicht zurücksetzen & neu laden'}
              </button>

              <button
                type="button"
                className="error-boundary-btn error-boundary-btn-cache"
                onClick={this.handleLoadCacheAndRestart}
                style={{
                  backgroundColor: '#238636',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  minHeight: '44px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  pointerEvents: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {this.state.isLoadingCache
                  ? isEn
                    ? 'Loading cache...'
                    : 'Cache wird geladen...'
                  : isEn
                  ? '🔄 Load Local Cache / Restart App'
                  : '🔄 Lokalen Cache laden / App neu starten'}
              </button>

              <button
                type="button"
                className="error-boundary-btn error-boundary-btn-retry"
                onClick={this.handleRetry}
                style={{
                  backgroundColor: '#21262d',
                  color: '#c9d1d9',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  minHeight: '44px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  pointerEvents: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {this.state.isRetrying
                  ? isEn
                    ? 'Restarting...'
                    : 'Starte neu...'
                  : isEn
                  ? 'Try Again'
                  : 'Erneut versuchen'}
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'center',
                flexWrap: 'wrap',
                marginTop: '14px',
                paddingTop: '14px',
                borderTop: '1px solid #21262d',
              }}
            >
              <button
                type="button"
                className="error-boundary-btn error-boundary-btn-export"
                onClick={this.handleExportLogs}
                style={{
                  backgroundColor: '#1f2937',
                  color: '#e5e7eb',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  minHeight: '44px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  pointerEvents: 'auto',
                }}
              >
                {this.state.exportedLogs
                  ? isEn
                    ? '✓ Logs exported'
                    : '✓ Logs exportiert'
                  : isEn
                  ? 'Export Debug Logs (.txt)'
                  : 'Debug-Logs exportieren (.txt)'}
              </button>

              <button
                type="button"
                className="error-boundary-btn error-boundary-btn-copy"
                onClick={this.handleCopyLogs}
                style={{
                  backgroundColor: '#1f2937',
                  color: '#e5e7eb',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  minHeight: '44px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  pointerEvents: 'auto',
                }}
              >
                {this.state.copiedLogs
                  ? isEn
                    ? '✓ Copied'
                    : '✓ Kopiert'
                  : isEn
                  ? 'Copy Logs'
                  : 'Logs kopieren'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
