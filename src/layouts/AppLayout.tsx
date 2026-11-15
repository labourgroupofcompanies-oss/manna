import React from 'react';
import './AppLayout.css';

interface AppLayoutProps {
  children: React.ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  activeTab = 'customer',
  onTabChange
}) => {
  return (
    <div className="app-container">
      {/* Brand Header */}
      <header className="app-header">
        <div className="brand-badge">
          <div className="brand-logo-circle">🏍️</div>
          <div>
            <h1 className="brand-title">Okada Book</h1>
            <p className="brand-subtitle">Quick rides across Ghana</p>
          </div>
        </div>
        <span className="pwa-badge">PWA Ready</span>
      </header>

      {/* Role Switcher Navigation (Preview / Environment setup) */}
      <nav className="role-nav" aria-label="Role Navigation">
        <button
          type="button"
          className={`role-tab ${activeTab === 'customer' ? 'active' : ''}`}
          onClick={() => onTabChange?.('customer')}
        >
          Customer
        </button>
        <button
          type="button"
          className={`role-tab ${activeTab === 'rider' ? 'active' : ''}`}
          onClick={() => onTabChange?.('rider')}
        >
          Rider
        </button>
        <button
          type="button"
          className={`role-tab ${activeTab === 'admin' ? 'active' : ''}`}
          onClick={() => onTabChange?.('admin')}
        >
          Admin
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="app-main">
        {children}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>Okada Book &copy; {new Date().getFullYear()} &bull; Built for Ghana</p>
      </footer>
    </div>
  );
};
