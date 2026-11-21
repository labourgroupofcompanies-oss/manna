import React from 'react';
import { useRouter } from '../router';
import './AppLayout.css';

interface AppLayoutProps {
  children: React.ReactNode;
  activeSection?: 'customer' | 'rider';
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  activeSection = 'customer'
}) => {
  const { navigate } = useRouter();

  return (
    <div className={`app-container mobile-shell ${activeSection === 'rider' ? 'rider-view' : ''}`}>
      {/* Main Content Area */}
      <main className="app-main-clean">
        {children}
      </main>

      {/* Public Role Navigation (Customer & Rider only - Admin links strictly separated) */}
      <aside className="dev-role-switcher" aria-label="Role Switcher">
        <button
          type="button"
          className={`dev-tab-btn ${activeSection === 'customer' ? 'active' : ''}`}
          onClick={() => navigate('/')}
        >
          Customer
        </button>
        <button
          type="button"
          className={`dev-tab-btn ${activeSection === 'rider' ? 'active' : ''}`}
          onClick={() => navigate('/rider')}
        >
          Rider
        </button>
      </aside>
    </div>
  );
};
