import React, { useState, useEffect } from 'react';
import { useRouter } from '../../router';
import { adminService } from '../../services';
import { Button } from '../../components/common/Button';
import './AdminLoginPage.css';

export const AdminLoginPage: React.FC = () => {
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checkingExistingSession, setCheckingExistingSession] = useState(true);

  // Check if already authenticated as admin
  useEffect(() => {
    let isMounted = true;
    async function checkSession() {
      try {
        const { isAdmin } = await adminService.checkIsAdmin();
        if (isMounted && isAdmin) {
          navigate('/admin/dashboard', { replace: true });
        }
      } finally {
        if (isMounted) {
          setCheckingExistingSession(false);
        }
      }
    }
    checkSession();
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMessage('Please enter both your administrator email and password.');
      return;
    }

    setLoading(true);
    try {
      const result = await adminService.loginAdmin(cleanEmail, password);
      if (result.success) {
        navigate('/admin/dashboard', { replace: true });
      } else {
        setErrorMessage(result.error || 'Login failed. Please verify your credentials.');
      }
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'An error occurred during administrator authentication.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingExistingSession) {
    return (
      <div className="admin-login-shell">
        <div className="admin-login-checking">
          <div className="admin-spinner" />
          <p>Verifying admin session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-login-shell">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <img src="/manna-logo.png" alt="Manna — Fast. Easy. Reliable" className="admin-login-logo" />
          <div className="admin-login-badge">
            <i className="fa-solid fa-shield-halved" />
            <span>Administrator Access</span>
          </div>
          <h1 className="admin-login-title">Manna Operations</h1>
          <p className="admin-login-subtitle">
            Fleet, verifications, and real-time dispatch control
          </p>
        </div>

        {errorMessage && (
          <div className="admin-login-error" role="alert">
            <span className="admin-login-error-icon">
              <i className="fa-solid fa-triangle-exclamation" />
            </span>
            <div className="admin-login-error-text">
              <strong>Authentication Error:</strong> {errorMessage}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="admin-login-form" noValidate>
          <div className="admin-form-group">
            <label className="admin-form-label" htmlFor="admin-email">
              Admin Email Address
            </label>
            <div className="admin-input-wrapper">
              <span className="admin-input-icon">
                <i className="fa-solid fa-envelope" />
              </span>
              <input
                id="admin-email"
                type="email"
                inputMode="email"
                className="admin-form-input with-icon"
                placeholder="owner@okadabook.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="admin-form-group">
            <label className="admin-form-label" htmlFor="admin-password">
              Admin Password
            </label>
            <div className="admin-input-wrapper">
              <span className="admin-input-icon">
                <i className="fa-solid fa-key" />
              </span>
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                className="admin-form-input with-icon with-action"
                placeholder="Enter password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
              <button
                type="button"
                className="admin-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={loading}
            style={{ marginTop: '8px', minHeight: '48px', fontSize: '1rem', fontWeight: 600 }}
          >
            {loading ? 'Signing in...' : 'Sign In to Admin Console →'}
          </Button>
        </form>

        <div className="admin-login-footer">
          <div className="admin-login-security-pill">
            <i className="fa-solid fa-lock" />
            <span>Secured by Supabase Row Level Security</span>
          </div>

          <div className="admin-login-links">
            <a
              href="/"
              className="admin-back-link"
              onClick={(e) => {
                e.preventDefault();
                navigate('/');
              }}
            >
              ← Customer Booking View
            </a>
            <span className="admin-link-sep">•</span>
            <a
              href="/rider"
              className="admin-back-link"
              onClick={(e) => {
                e.preventDefault();
                navigate('/rider');
              }}
            >
              Rider Portal →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
