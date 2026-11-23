import React, { useState } from 'react';
import { riderService, pushNotificationService } from '../../services';
import { validateGhanaPhone, STATIONS_BY_ZONE } from '../../utils';
import type { RiderProfile, RiderRegistrationPayload, RiderLoginPayload } from '../../types';
import { LivePhotoGuide } from './LivePhotoGuide';
import './RiderAuth.css';

interface RiderAuthProps {
  onAuthSuccess: (rider: RiderProfile) => void;
}

export const RiderAuth: React.FC<RiderAuthProps> = ({ onAuthSuccess }) => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Login form state
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register form state
  const [regFullName, setRegFullName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regBikePlate, setRegBikePlate] = useState('');
  const [regBikeModel, setRegBikeModel] = useState('');
  const [regBikeColour, setRegBikeColour] = useState('');
  const [regOperatingArea, setRegOperatingArea] = useState('Main Lorry Station');
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [showLivePhotoGuide, setShowLivePhotoGuide] = useState(false);

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState(false);

  // Phone validation
  const loginValidation = validateGhanaPhone(loginPhone);
  const regValidation = validateGhanaPhone(regPhone);

  // 1. Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!loginValidation.isValid) {
      setErrorMessage(loginValidation.error || 'Please enter a valid Ghanaian phone number.');
      return;
    }

    if (!loginPassword) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      const payload: RiderLoginPayload = {
        phoneNumber: loginValidation.formatted || loginPhone.trim(),
        password: loginPassword
      };

      const result = await riderService.loginRider(payload);

      if (!result.success || !result.rider) {
        setErrorMessage(result.error || 'Invalid phone number or password.');
        return;
      }

      pushNotificationService.registerRiderNotifications(result.rider.id).catch(() => {});
      onAuthSuccess(result.rider);
    } finally {
      setLoading(false);
    }
  };

  // 2. Handle Registration
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!regFullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (!regValidation.isValid) {
      setErrorMessage(regValidation.error || 'Please enter a valid Ghanaian phone number.');
      return;
    }

    if (regPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    if (!regBikePlate.trim()) {
      setErrorMessage('Please enter your motorcycle number plate.');
      return;
    }

    if (!regBikeModel.trim()) {
      setErrorMessage('Please enter your motorcycle model (e.g. Boxer 150).');
      return;
    }

    if (!profilePhoto) {
      setErrorMessage('Profile photo is required. Please capture a clear live photo of your face.');
      return;
    }

    setLoading(true);
    try {
      const payload: RiderRegistrationPayload = {
        fullName: regFullName.trim(),
        phoneNumber: regValidation.formatted || regPhone.trim(),
        password: regPassword,
        motorcycleRegistration: regBikePlate.trim().toUpperCase(),
        motorcycleModel: regBikeModel.trim(),
        motorcycleColour: regBikeColour.trim() || 'Black',
        operatingArea: regOperatingArea.trim(),
        profilePhotoFile: profilePhoto || undefined
      };

      const result = await riderService.registerRider(payload);

      if (!result.success || !result.rider) {
        setErrorMessage(result.error || 'Could not complete registration.');
        return;
      }

      pushNotificationService.notifyRiderRegistered({
        fullName: result.rider.fullName,
        phoneNumber: result.rider.phoneNumber,
        operatingArea: result.rider.operatingArea
      }).catch(() => {});

      setRegSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  if (regSuccess) {
    return (
      <div className="rider-auth-box">
        <div className="reg-success-view">
          <div className="success-check-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="auth-title">Account Created</h2>
          <p className="auth-subtitle">
            Your rider account is ready. Sign in to start taking orders.
          </p>
          <button
            type="button"
            className="btn-auth-primary"
            onClick={() => {
              setRegSuccess(false);
              setAuthMode('login');
              setLoginPhone(regPhone);
            }}
          >
            Sign In Now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rider-auth-box">
      {/* Simple Header */}
      <div className="auth-header">
        <h2 className="auth-title">{authMode === 'login' ? 'Rider Sign In' : 'New Rider Sign Up'}</h2>
        <p className="auth-subtitle">
          {authMode === 'login'
            ? 'Sign in to start taking orders.'
            : 'Register to start delivering.'}
        </p>
      </div>

      {/* Pill Switcher */}
      <div className="auth-pill-switcher" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={authMode === 'login'}
          className={`pill-switch-btn ${authMode === 'login' ? 'active' : ''}`}
          onClick={() => {
            setAuthMode('login');
            setErrorMessage(null);
          }}
        >
          Sign In
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={authMode === 'register'}
          className={`pill-switch-btn ${authMode === 'register' ? 'active' : ''}`}
          onClick={() => {
            setAuthMode('register');
            setErrorMessage(null);
          }}
        >
          Register
        </button>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="auth-error-box" role="alert">
          {errorMessage}
        </div>
      )}

      {/* LOGIN FORM */}
      {authMode === 'login' && (
        <form onSubmit={handleLogin} className="auth-form-fields" noValidate>
          <div className="auth-field">
            <label htmlFor="login-phone-input" className="field-label">
              <span>Phone Number</span>
              {loginPhone && loginValidation.carrier && (
                <span className="carrier-tag">{loginValidation.carrier}</span>
              )}
            </label>
            <div className="phone-input-row">
              <span className="country-code-pill">+233</span>
              <input
                id="login-phone-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="024 123 4567"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
                className="input-simple"
                required
              />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="login-pwd-input" className="field-label">
              <span>Password</span>
            </label>
            <div className="password-input-row">
              <input
                id="login-pwd-input"
                type={showLoginPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="input-simple"
                required
              />
              <button
                type="button"
                className="eye-btn"
                onClick={() => setShowLoginPassword(!showLoginPassword)}
                aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
              >
                {showLoginPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-auth-primary"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <p className="auth-switch-text">
            Don't have an account?{' '}
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => {
                setAuthMode('register');
                setErrorMessage(null);
              }}
            >
              Register here
            </button>
          </p>
        </form>
      )}

      {/* REGISTRATION FORM */}
      {authMode === 'register' && (
        <form onSubmit={handleRegister} className="auth-form-fields" noValidate>
          <div className="auth-field">
            <label htmlFor="reg-name-input" className="field-label">
              Full Name
            </label>
            <input
              id="reg-name-input"
              type="text"
              autoComplete="name"
              placeholder="e.g. Kwame Mensah"
              value={regFullName}
              onChange={(e) => setRegFullName(e.target.value)}
              className="input-simple"
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="reg-phone-input" className="field-label">
              <span>Phone Number</span>
              {regPhone && regValidation.carrier && (
                <span className="carrier-tag">{regValidation.carrier}</span>
              )}
            </label>
            <div className="phone-input-row">
              <span className="country-code-pill">+233</span>
              <input
                id="reg-phone-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="024 123 4567"
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
                className="input-simple"
                required
              />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="reg-pwd-input" className="field-label">
              Password (min 6 characters)
            </label>
            <div className="password-input-row">
              <input
                id="reg-pwd-input"
                type={showRegPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Create a password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                className="input-simple"
                required
              />
              <button
                type="button"
                className="eye-btn"
                onClick={() => setShowRegPassword(!showRegPassword)}
                aria-label={showRegPassword ? 'Hide password' : 'Show password'}
              >
                {showRegPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="reg-plate-input" className="field-label">
              Number Plate
            </label>
            <input
              id="reg-plate-input"
              type="text"
              placeholder="e.g. M-24-GR-1042"
              value={regBikePlate}
              onChange={(e) => setRegBikePlate(e.target.value.toUpperCase())}
              className="input-simple"
              style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
              required
            />
          </div>

          <div className="form-cols-2">
            <div className="auth-field">
              <label htmlFor="reg-model-input" className="field-label">
                Motorcycle Model
              </label>
              <input
                id="reg-model-input"
                type="text"
                placeholder="e.g. Boxer 150"
                value={regBikeModel}
                onChange={(e) => setRegBikeModel(e.target.value)}
                className="input-simple"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="reg-colour-input" className="field-label">
                Colour
              </label>
              <input
                id="reg-colour-input"
                type="text"
                placeholder="e.g. Black"
                value={regBikeColour}
                onChange={(e) => setRegBikeColour(e.target.value)}
                className="input-simple"
              />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="reg-area-select" className="field-label">
              Moto Station
            </label>
            <select
              id="reg-area-select"
              value={regOperatingArea}
              onChange={(e) => setRegOperatingArea(e.target.value)}
              className="input-simple"
              style={{ cursor: 'pointer' }}
            >
              <optgroup label="Kadjebi Town">
                {STATIONS_BY_ZONE['Kadjebi Town'].map((st) => (
                  <option key={st.slug} value={st.name}>
                    {st.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Outside Kadjebi Town">
                {STATIONS_BY_ZONE['Outside Kadjebi Town'].map((st) => (
                  <option key={st.slug} value={st.name}>
                    {st.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="auth-field">
            <label className="field-label">
              <span>
                Profile Photo <span className="required-star">*</span>
              </span>
              <span className="required-badge">Required</span>
            </label>

            {photoPreviewUrl ? (
              <div className="photo-confirmed-card">
                <div className="photo-confirmed-avatar-wrap">
                  <img src={photoPreviewUrl} alt="Rider Profile" className="photo-confirmed-avatar" />
                  <div className="photo-confirmed-check" title="Live Photo Verified">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>
                <div className="photo-confirmed-details">
                  <p className="photo-confirmed-title">Live Photo Captured</p>
                  <p className="photo-confirmed-sub">Clear headshot ready for passenger verification</p>
                  <button
                    type="button"
                    className="btn-retake-compact"
                    onClick={() => setShowLivePhotoGuide(true)}
                  >
                    Retake Live Photo
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="live-photo-trigger-card"
                onClick={() => setShowLivePhotoGuide(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setShowLivePhotoGuide(true);
                  }
                }}
              >
                <div className="camera-icon-badge">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
                <div>
                  <p className="live-photo-trigger-title">Take Live Guided Photo</p>
                  <p className="live-photo-trigger-hint">
                    The app will guide you with a framing oval and lighting check for a clear, trusted photo.
                  </p>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-auth-primary"
          >
            {loading ? 'Creating Account...' : 'Complete Registration'}
          </button>

          <p className="auth-switch-text">
            Already have an account?{' '}
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => {
                setAuthMode('login');
                setErrorMessage(null);
              }}
            >
              Sign in
            </button>
          </p>
        </form>
      )}

      {showLivePhotoGuide && (
        <LivePhotoGuide
          onPhotoCaptured={(file) => {
            setProfilePhoto(file);
            setPhotoPreviewUrl(URL.createObjectURL(file));
          }}
          onClose={() => setShowLivePhotoGuide(false)}
        />
      )}
    </div>
  );
};
