import React, { useState, useEffect } from 'react';
import { RiderAuth, RiderDashboard } from '../../components';
import { riderService } from '../../services';
import type { RiderProfile } from '../../types';
import './RiderPage.css';

export const RiderPage: React.FC = () => {
  const [currentRider, setCurrentRider] = useState<RiderProfile | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check persistent session on mount
  useEffect(() => {
    let mounted = true;
    async function checkSession() {
      try {
        const rider = await riderService.getCurrentRider();
        if (mounted) {
          setCurrentRider(rider);
        }
      } finally {
        if (mounted) {
          setCheckingAuth(false);
        }
      }
    }
    checkSession();
    return () => {
      mounted = false;
    };
  }, []);

  const handleAuthSuccess = (rider: RiderProfile) => {
    setCurrentRider(rider);
  };

  const handleLogout = async () => {
    await riderService.logoutRider();
    setCurrentRider(null);
  };

  if (checkingAuth) {
    return (
      <div className="rider-page-shell">
        <header className="rider-top-nav-bar">
          <div className="rider-brand-lockup">
            <img src="/manna-logo.png" alt="Manna" className="rider-brand-logo" />
            <span className="rider-nav-tag">Rider</span>
          </div>
        </header>

        <div className="rider-loading-screen">
          <div className="rider-spinner" />
          <p className="rider-loading-text">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rider-page-shell">
      {!currentRider && (
        <header className="rider-top-nav-bar">
          <div className="rider-brand-lockup">
            <img src="/manna-logo.png" alt="Manna" className="rider-brand-logo" />
            <span className="rider-nav-tag">Rider Partner</span>
          </div>
        </header>
      )}

      <div className={`rider-page-body ${currentRider ? 'authenticated' : ''}`}>
        {currentRider ? (
          <RiderDashboard rider={currentRider} onLogout={handleLogout} />
        ) : (
          <RiderAuth onAuthSuccess={handleAuthSuccess} />
        )}
      </div>
    </div>
  );
};
