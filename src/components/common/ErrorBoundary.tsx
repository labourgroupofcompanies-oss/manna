import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected error occurred.'
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught application error:', error, info);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#F5F8FF',
            fontFamily: 'Inter, system-ui, sans-serif'
          }}
        >
          <div
            style={{
              maxWidth: '420px',
              width: '100%',
              background: '#FFFFFF',
              borderRadius: '16px',
              padding: '28px 24px',
              textAlign: 'center',
              boxShadow: '0 10px 30px rgba(6, 58, 155, 0.1)',
              border: '1px solid #E2E8F0'
            }}
          >
            <div style={{ fontSize: '2.2rem', marginBottom: '10px' }}>⚠️</div>
            <h2 style={{ margin: '0 0 8px', color: '#0F172A', fontSize: '1.25rem' }}>
              Something went wrong
            </h2>
            <p style={{ margin: '0 0 20px', color: '#475569', fontSize: '0.92rem', lineHeight: 1.5 }}>
              The app hit an unexpected snag. Tap below to reload and continue.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                background: '#063A9B',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '10px',
                padding: '12px 22px',
                fontSize: '0.95rem',
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%'
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
