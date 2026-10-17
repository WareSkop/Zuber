import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[Knowmesh ErrorBoundary] Uncaught render error caught by boundary:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  private handleReload = (): void => {
    // Attempt normal reload
    window.location.reload();
  };

  private handleResetCache = (): void => {
    try {
      // Clear session/runtime transient state if corrupted, keep vault IndexedDB notes intact
      sessionStorage.clear();
    } catch {}
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'Unbekannter Anwendungsfehler';

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100vw',
            backgroundColor: '#0d1117',
            color: '#c9d1d9',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            padding: '24px',
            boxSizing: 'border-box',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              maxWidth: '560px',
              width: '100%',
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '12px',
              padding: '32px 24px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
            }}
          >
            <div style={{ fontSize: '42px', marginBottom: '16px' }}>📲</div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#f0f6fc', margin: '0 0 12px 0' }}>
              Knowmesh konnte nicht normal gestartet werden
            </h2>
            <p style={{ fontSize: '14px', color: '#8b949e', margin: '0 0 20px 0', lineHeight: 1.5 }}>
              Ein unerwarteter Fehler ist beim Laden der Anwendung aufgetreten. Ihre lokal gespeicherten Notizen in der
              IndexedDB sind sicher.
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

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  backgroundColor: '#238636',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                🔄 Lokalen Cache laden / App neu starten
              </button>

              <button
                type="button"
                onClick={this.handleResetCache}
                style={{
                  backgroundColor: '#21262d',
                  color: '#c9d1d9',
                  border: '1px solid #30363d',
                  borderRadius: '6px',
                  padding: '10px 18px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Erneut versuchen
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
