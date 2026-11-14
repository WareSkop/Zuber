import React, { Component, type ErrorInfo, type ReactNode } from 'react';

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
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[Zuber ErrorBoundary] Uncaught render error caught by boundary:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

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
    });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'Unbekannter Anwendungsfehler';
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
              Zuber konnte nicht normal gestartet werden
            </h2>
            <p
              style={{
                fontSize: '14px',
                color: '#8b949e',
                margin: '0 0 20px 0',
                lineHeight: 1.5,
              }}
            >
              Ein unerwarteter Fehler ist beim Laden der Anwendung aufgetreten. Ihre lokal
              gespeicherten Notizen in der IndexedDB sind sicher.
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
                marginBottom: '24px',
                maxHeight: '160px',
              }}
            >
              {errorMessage}
            </div>

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
                  ? 'Wird zurückgesetzt...'
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
                  ? 'Cache wird geladen...'
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
                {this.state.isRetrying ? 'Starte neu...' : 'Erneut versuchen'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
