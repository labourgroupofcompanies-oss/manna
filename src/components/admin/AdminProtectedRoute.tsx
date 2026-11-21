import React, { useEffect, useState } from 'react';
import { useRouter } from '../../router';
import { adminService } from '../../services';
import { supabase } from '../../services/supabase';
import { AdminLayout } from '../../layouts/AdminLayout';
import { Button } from '../common/Button';
import type { AdminUser } from '../../types';
import '../../layouts/AdminLayout.css';

interface AdminProtectedRouteProps {
  children: (adminUser: AdminUser) => React.ReactNode;
  pageTitle?: string;
}

type AuthStatus = 'loading' | 'unauthenticated' | 'unauthorized' | 'authorized' | 'error';

export const AdminProtectedRoute: React.FC<AdminProtectedRouteProps> = ({ children, pageTitle }) => {
  const { navigate } = useRouter();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function verifyAdminAccess() {
      try {
        const { isAdmin, adminUser: verifiedAdmin, error } = await adminService.checkIsAdmin();

        if (!isMounted) return;

        if (error && !isAdmin) {
          setErrorMessage(error);
          setStatus('error');
          return;
        }

        if (isAdmin && verifiedAdmin) {
          setAdminUser(verifiedAdmin);
          setStatus('authorized');
          return;
        }

        // Check if there is an authenticated non-admin user (e.g. rider or customer)
        if (supabase) {
          const { data: sessionData } = await supabase.auth.getSession();
          if (sessionData?.session?.user) {
            setCurrentUserEmail(sessionData.session.user.email || 'Authenticated User');
            setStatus('unauthorized');
            return;
          }
        }

        // Completely unauthenticated
        setStatus('unauthenticated');
        navigate('/admin/login', { replace: true });
      } catch (err: unknown) {
        if (!isMounted) return;
        const e = err as Error;
        setErrorMessage(e.message || 'Authorization check failed.');
        setStatus('error');
      }
    }

    verifyAdminAccess();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  // 1. Loading State
  if (status === 'loading') {
    return (
      <div className="admin-loading-screen">
        <div className="admin-spinner" />
        <p style={{ fontWeight: 500, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          Verifying administrator credentials...
        </p>
      </div>
    );
  }

  // 2. Unauthenticated (handled by redirection, but render blank or redirect prompt while navigating)
  if (status === 'unauthenticated') {
    return (
      <div className="admin-loading-screen">
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Redirecting to Admin Login...
        </p>
      </div>
    );
  }

  // 3. Unauthorized: Authenticated Customer or Rider attempting to enter /admin
  if (status === 'unauthorized') {
    return (
      <div className="admin-denied-container">
        <div className="admin-denied-card">
          <div className="admin-denied-icon">🚫</div>
          <h2 className="admin-denied-title">403 — Access Denied</h2>
          <p className="admin-denied-desc">
            You are signed in as <strong>{currentUserEmail}</strong>, but this account is not registered
            with administrative privileges. The Okada Book Admin Portal is strictly restricted to the
            platform owner and authorized personnel.
          </p>

          <div className="admin-denied-actions">
            <Button
              variant="primary"
              fullWidth
              onClick={async () => {
                await adminService.logoutAdmin();
                navigate('/admin/login', { replace: true });
              }}
            >
              Sign In as Administrator
            </Button>
            <Button
              variant="outline"
              fullWidth
              onClick={() => {
                navigate('/');
              }}
            >
              Return to Customer Homepage
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Error State
  if (status === 'error') {
    return (
      <div className="admin-denied-container">
        <div className="admin-denied-card">
          <div className="admin-denied-icon">⚠️</div>
          <h2 className="admin-denied-title" style={{ color: 'var(--color-text-primary)' }}>
            System Verification Error
          </h2>
          <p className="admin-denied-desc">
            {errorMessage || 'Unable to verify administrative permissions at this time. Please check your connection.'}
          </p>
          <div className="admin-denied-actions">
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                setStatus('loading');
                window.location.reload();
              }}
            >
              Retry Verification
            </Button>
            <Button
              variant="outline"
              fullWidth
              onClick={() => {
                navigate('/admin/login');
              }}
            >
              Go to Admin Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 5. Authorized Admin: render children inside AdminLayout
  if (status === 'authorized' && adminUser) {
    return (
      <AdminLayout adminUser={adminUser} title={pageTitle}>
        {children(adminUser)}
      </AdminLayout>
    );
  }

  return null;
};
