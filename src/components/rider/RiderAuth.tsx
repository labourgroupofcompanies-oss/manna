import React, { useState } from 'react';
import { riderService } from '../../services';
import { validateGhanaPhone } from '../../utils';
import type { RiderProfile, RiderRegistrationPayload, RiderLoginPayload } from '../../types';
import './RiderAuth.css';

interface RiderAuthProps {
  onAuthSuccess: (rider: RiderProfile) => void;
}

export const RiderAuth: React.FC<RiderAuthProps> = ({ onAuthSuccess }) => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Login form state
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form state
  const [regFullName, setRegFullName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regBikePlate, setRegBikePlate] = useState('');
  const [regBikeModel, setRegBikeModel] = useState('');
  const [regBikeColour, setRegBikeColour] = useState('');
  const [regOperatingArea, setRegOperatingArea] = useState('Circle / Kaneshie');
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);

  // Status & Feedback
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState(false);

  // 1. Handle Rider Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const phoneValidation = validateGhanaPhone(loginPhone);
    if (!phoneValidation.isValid) {
      setErrorMessage(phoneValidation.error || 'Please enter a valid 10-digit Ghanaian phone number.');
      return;
    }

    if (!loginPassword) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      const payload: RiderLoginPayload = {
        phoneNumber: loginPhone,
        password: loginPassword
      };

      const result = await riderService.loginRider(payload);

      if (!result.success || !result.rider) {
        setErrorMessage(result.error || 'Login failed. Please check your phone number and password.');
        return;
      }

      onAuthSuccess(result.rider);
    } finally {
      setLoading(false);
    }
  };

  // 2. Handle Rider Registration
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validate inputs
    if (!regFullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    const phoneValidation = validateGhanaPhone(regPhone);
    if (!phoneValidation.isValid) {
      setErrorMessage(phoneValidation.error || 'Please enter a valid 10-digit Ghanaian phone number.');
      return;
    }

    if (regPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (!regBikePlate.trim()) {
      setErrorMessage('Please enter your motorcycle number plate.');
      return;
    }

    if (!regBikeModel.trim()) {
      setErrorMessage('Please enter your motorcycle brand/model (e.g. Bajaj Boxer 150).');
      return;
    }

    setLoading(true);

    try {
      const payload: RiderRegistrationPayload = {
        fullName: regFullName.trim(),
        phoneNumber: regPhone.trim(),
        password: regPassword,
        motorcycleRegistration: regBikePlate.trim().toUpperCase(),
        motorcycleModel: regBikeModel.trim(),
        motorcycleColour: regBikeColour.trim() || 'Black',
        operatingArea: regOperatingArea.trim(),
        profilePhotoFile: profilePhoto || undefined
      };

      const result = await riderService.registerRider(payload);

      if (!result.success || !result.rider) {
        setErrorMessage(result.error || 'Registration could not be completed.');
        return;
      }

      setRegSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  // 3. Success View after registration
  if (regSuccess) {
    return (
      <div className="rider-auth-card rider-reg-success-card">
        <div className="rider-success-badge" aria-hidden="true">✓</div>
        <h2 className="rider-auth-title">Registration Successful!</h2>
        <p className="rider-auth-desc">
          Your rider account has been created. You can now log in with your phone number and password to access the dispatch terminal.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-full-width"
          onClick={() => {
            setRegSuccess(false);
            setAuthMode('login');
            setLoginPhone(regPhone);
          }}
        >
          Go to Rider Login
        </button>
      </div>
    );
  }

  return (
    <div className="rider-auth-card">
      {/* Brand Header */}
      <div className="rider-auth-header">
        <div className="rider-auth-logo">🏍️</div>
        <div>
          <h2 className="rider-auth-title">Rider Terminal</h2>
          <p className="rider-auth-tagline">Ride Easy... Get There Fast!</p>
        </div>
      </div>

      {/* Tabs Switcher: Login / Register */}
      <div className="rider-auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={authMode === 'login'}
          className={`rider-tab-btn ${authMode === 'login' ? 'active' : ''}`}
          onClick={() => {
            setAuthMode('login');
            setErrorMessage(null);
          }}
        >
          Rider Login
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={authMode === 'register'}
          className={`rider-tab-btn ${authMode === 'register' ? 'active' : ''}`}
          onClick={() => {
            setAuthMode('register');
            setErrorMessage(null);
          }}
        >
          New Registration
        </button>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="rider-error-banner" role="alert">
          <span className="error-icon" aria-hidden="true">⚠️</span>
          <p>{errorMessage}</p>
        </div>
      )}

      {/* LOGIN FORM */}
      {authMode === 'login' && (
        <form onSubmit={handleLoginSubmit} className="rider-form">
          <div className="form-group">
            <label htmlFor="login-phone" className="form-label">
              Phone Number
            </label>
            <input
              id="login-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="e.g. 0245660622"
              value={loginPhone}
              onChange={(e) => setLoginPhone(e.target.value)}
              className="input-control"
              required
            />
            <span className="field-hint">Your 10-digit registered Ghanaian phone number</span>
          </div>

          <div className="form-group">
            <label htmlFor="login-password" className="form-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              className="input-control"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-full-width rider-submit-btn"
          >
            {loading ? 'Authenticating...' : 'Log In to Rider Dashboard'}
          </button>

          <p className="rider-toggle-note">
            New rider?{' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setAuthMode('register');
                setErrorMessage(null);
              }}
            >
              Register your motorcycle here
            </button>
          </p>
        </form>
      )}

      {/* REGISTRATION FORM */}
      {authMode === 'register' && (
        <form onSubmit={handleRegisterSubmit} className="rider-form">
          <div className="form-group">
            <label htmlFor="reg-name" className="form-label">
              Full Name <span className="req">*</span>
            </label>
            <input
              id="reg-name"
              type="text"
              autoComplete="name"
              placeholder="e.g. Kwame Mensah"
              value={regFullName}
              onChange={(e) => setRegFullName(e.target.value)}
              className="input-control"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-phone" className="form-label">
              Phone Number <span className="req">*</span>
            </label>
            <input
              id="reg-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="e.g. 0245660622"
              value={regPhone}
              onChange={(e) => setRegPhone(e.target.value)}
              className="input-control"
              required
            />
            <span className="field-hint">Must be a valid Ghanaian mobile number</span>
          </div>

          <div className="form-group">
            <label htmlFor="reg-password" className="form-label">
              Create Password <span className="req">*</span>
            </label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              placeholder="Minimum 6 characters"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              className="input-control"
              required
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label htmlFor="reg-plate" className="form-label">
                Number Plate <span className="req">*</span>
              </label>
              <input
                id="reg-plate"
                type="text"
                placeholder="e.g. M-24-GR-1042"
                value={regBikePlate}
                onChange={(e) => setRegBikePlate(e.target.value)}
                className="input-control uppercase-input"
                required
              />
            </div>

            <div className="form-group colour-group">
              <label htmlFor="reg-colour" className="form-label">
                Motorcycle Colour
              </label>
              <input
                id="reg-colour"
                type="text"
                placeholder="e.g. Black"
                value={regBikeColour}
                onChange={(e) => setRegBikeColour(e.target.value)}
                className="input-control colour-input-compact"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="reg-model" className="form-label">
              Motorcycle Brand / Model <span className="req">*</span>
            </label>
            <input
              id="reg-model"
              type="text"
              placeholder="e.g. Bajaj Boxer 150 / Haojue 125"
              value={regBikeModel}
              onChange={(e) => setRegBikeModel(e.target.value)}
              className="input-control"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-area" className="form-label">
              Primary Operating Area <span className="req">*</span>
            </label>
            <select
              id="reg-area"
              value={regOperatingArea}
              onChange={(e) => setRegOperatingArea(e.target.value)}
              className="input-control select-control"
            >
              <option value="Circle / Kaneshie / Odorkor">Circle / Kaneshie / Odorkor</option>
              <option value="Madina / Adenta / Legon">Madina / Adenta / Legon</option>
              <option value="Lapaz / Achimota / Abeka">Lapaz / Achimota / Abeka</option>
              <option value="Osu / Cantonments / Labadi">Osu / Cantonments / Labadi</option>
              <option value="Tema / Ashaiman / Spintex">Tema / Ashaiman / Spintex</option>
              <option value="Kumasi Central / Kejetia">Kumasi Central / Kejetia</option>
              <option value="Greater Accra (All Zones)">Greater Accra (All Zones)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="reg-photo" className="form-label">
              Profile Photo (Optional)
            </label>
            <input
              id="reg-photo"
              type="file"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setProfilePhoto(e.target.files[0]);
                }
              }}
              className="input-control file-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-full-width rider-submit-btn"
          >
            {loading ? 'Creating Profile...' : 'Complete Rider Registration'}
          </button>

          <p className="rider-toggle-note">
            Already have an account?{' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setAuthMode('login');
                setErrorMessage(null);
              }}
            >
              Log in here
            </button>
          </p>
        </form>
      )}
    </div>
  );
};
