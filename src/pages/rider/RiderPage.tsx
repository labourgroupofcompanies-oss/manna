import React, { useState, useEffect } from 'react';
import { RiderAuth, RiderDashboard } from '../../components';
import { riderService } from '../../services';
import type { RiderProfile } from '../../types';

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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px' }}>
        <span style={{ fontSize: '2rem' }}>🏍️</span>
        <p style={{ color: '#64748B', fontSize: '0.9rem' }}>Loading rider terminal...</p>
      </div>
    );
  }

  return (
    <div className="rider-page-view" style={{ width: '100%', padding: 'clamp(14px, 3.5vw, 20px)' }}>
      {currentRider ? (
        <RiderDashboard rider={currentRider} onLogout={handleLogout} />
      ) : (
        <RiderAuth onAuthSuccess={handleAuthSuccess} />
      )}
    </div>
  );
};
