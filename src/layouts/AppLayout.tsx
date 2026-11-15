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
    <div className="app-container mobile-shell">
      {/* Main Content Area */}
      <main className="app-main-clean">
        {children}
      </main>

      {/* Discreet Development / Preview Role Switcher */}
      {onTabChange && (
        <aside className="dev-role-switcher" aria-label="Development Stage Switcher">
          <button
            type="button"
            className={`dev-tab-btn ${activeTab === 'customer' ? 'active' : ''}`}
            onClick={() => onTabChange('customer')}
          >
            Customer
          </button>
          <button
            type="button"
            className={`dev-tab-btn ${activeTab === 'rider' ? 'active' : ''}`}
            onClick={() => onTabChange('rider')}
          >
            Rider
          </button>
          <button
            type="button"
            className={`dev-tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => onTabChange('admin')}
          >
            Admin
          </button>
        </aside>
      )}
    </div>
  );
};
