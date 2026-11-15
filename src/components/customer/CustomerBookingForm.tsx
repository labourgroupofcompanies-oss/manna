import React, { useState, useId } from 'react';
import { useVoiceRecorder } from '../../hooks';
import { validateGhanaPhone } from '../../utils';
import { VoiceRecorder } from '../voice/VoiceRecorder';
import type { Order } from '../../types';
import './CustomerBookingForm.css';

export const CustomerBookingForm: React.FC = () => {
  const phoneInputId = useId();
  const textInputId = useId();

  // Contact number state
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);

  // Order mode state: 'type' or 'voice' (default: 'type')
  const [orderMode, setOrderMode] = useState<'type' | 'voice'>('type');

  // Text request state
  const [textRequest, setTextRequest] = useState('');

  // Voice recording hook
  const voiceRecorder = useVoiceRecorder();

  // Form submission states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);

  // Validation
  const phoneValidation = validateGhanaPhone(phone);
  const isPhoneValid = phoneValidation.isValid;

  const isOrderDetailsProvided =
    orderMode === 'type'
      ? textRequest.trim().length > 0
      : Boolean(voiceRecorder.audioUrl) && !voiceRecorder.isRecording;

  const isFormValid = isPhoneValid && isOrderDetailsProvided;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(e.target.value);
  };

  const handlePhoneBlur = () => {
    setPhoneTouched(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Simulate smooth order dispatch
      await new Promise((resolve) => setTimeout(resolve, 800));

      const newOrder: Order = {
        id: `OKD-${Math.floor(100000 + Math.random() * 900000)}`,
        customerPhone: phoneValidation.formatted || phone.trim(),
        requestDescription: orderMode === 'type' ? textRequest.trim() : 'Voice Order Request',
        voiceNote:
          orderMode === 'voice' && voiceRecorder.audioUrl
            ? {
                audioUrl: voiceRecorder.audioUrl,
                durationSeconds: voiceRecorder.recordingDuration
              }
            : undefined,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      setSubmittedOrder(newOrder);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForNewRide = () => {
    setSubmittedOrder(null);
    setTextRequest('');
    setPhoneTouched(false);
    voiceRecorder.resetRecording();
  };

  // Render Confirmation Screen
  if (submittedOrder) {
    return (
      <div className="okada-screen-wrapper">
        <div className="okada-hero-banner" role="banner" aria-label="Okada Book Hero Banner" />
        <div className="okada-white-sheet order-success-sheet">
          <div className="success-icon-badge">✓</div>
          <h2 className="success-title">Ride Requested!</h2>
          <p className="success-subtitle">
            Your Okada booking has been placed locally.
          </p>

          <div className="order-summary-box">
            <div className="summary-row">
              <span className="summary-label">Order Ref:</span>
              <span className="summary-value order-id-pill">{submittedOrder.id}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Contact:</span>
              <span className="summary-value">{submittedOrder.customerPhone}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Order Method:</span>
              <span className="summary-value">
                {submittedOrder.voiceNote ? '🎙️ Voice Note' : '📝 Type Order'}
              </span>
            </div>
            {submittedOrder.voiceNote ? (
              <div className="summary-voice-preview">
                <span className="summary-label">Audio Note:</span>
                <audio
                  src={submittedOrder.voiceNote.audioUrl}
                  controls
                  className="summary-audio-player"
                />
              </div>
            ) : (
              <div className="summary-text-preview">
                <span className="summary-label">Request:</span>
                <p className="summary-text-body">{submittedOrder.requestDescription}</p>
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn-order-ride btn-book-another"
            onClick={handleResetForNewRide}
          >
            <span>Book Another Ride</span>
          </button>

          {/* Bottom Skyline */}
          <div className="accra-skyline-footer" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="okada-screen-wrapper">
      {/* 1. Top Hero Section with Logo and Rider */}
      <div className="okada-hero-banner" role="banner" aria-label="Okada Book Branding Header" />

      {/* 2. White Card Sheet overlapping hero */}
      <div className="okada-white-sheet">
        <form onSubmit={handleSubmit} noValidate className="booking-form-content">
          {/* A. Your Contact Section */}
          <div className="contact-section">
            <div className="contact-header-row">
              <div className="contact-icon-circle" aria-hidden="true">
                {/* Telephone Handset Icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                  <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z" />
                </svg>
              </div>
              <div className="contact-text-group">
                <label htmlFor={phoneInputId} className="contact-title">
                  Your Contact
                </label>
                <span className="contact-subtitle">Enter your phone number</span>
              </div>
            </div>

            {/* Phone Input Box */}
            <div className="phone-input-box">
              <div className="phone-icon-addon" aria-hidden="true">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#101B3D"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="5" y="2" width="14" height="20" rx="3" ry="3" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
              </div>
              <input
                id={phoneInputId}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="e.g. 0245660622"
                value={phone}
                onChange={handlePhoneChange}
                onBlur={handlePhoneBlur}
                className="phone-native-input"
                aria-describedby="phone-feedback-msg"
              />
            </div>

            {/* Validation Feedback */}
            <div id="phone-feedback-msg" className="phone-feedback-row" aria-live="polite">
              {phoneTouched && !isPhoneValid && (
                <span className="feedback-error-text">
                  {phoneValidation.error || 'Please enter a valid 10-digit Ghanaian number'}
                </span>
              )}
              {isPhoneValid && (
                <span className="feedback-success-text">
                  ✓ Valid {phoneValidation.carrier} ({phoneValidation.formatted})
                </span>
              )}
            </div>
          </div>

          {/* B. Place Your Order Section */}
          <div className="place-order-section">
            <h3 className="place-order-title">Place Your Order</h3>

            {/* Two Large Selectable Method Buttons */}
            <div className="order-methods-row" role="tablist" aria-label="Select Order Method">
              {/* Type Order Option */}
              <button
                type="button"
                role="tab"
                aria-selected={orderMode === 'type'}
                className={`order-method-card ${orderMode === 'type' ? 'active' : ''}`}
                onClick={() => setOrderMode('type')}
              >
                <div className="method-icon-wrap" aria-hidden="true">
                  {/* Keyboard Icon */}
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="#063A9B">
                    <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
                  </svg>
                </div>
                <span className="method-label">Type Order</span>
              </button>

              {/* Voice Order Option */}
              <button
                type="button"
                role="tab"
                aria-selected={orderMode === 'voice'}
                className={`order-method-card ${orderMode === 'voice' ? 'active' : ''}`}
                onClick={() => setOrderMode('voice')}
              >
                <div className="method-icon-wrap" aria-hidden="true">
                  {/* Microphone Icon */}
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="#063A9B">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                </div>
                <span className="method-label">Voice Order</span>
              </button>
            </div>

            {/* Type Order Drawer */}
            {orderMode === 'type' && (
              <div className="type-input-drawer">
                <textarea
                  id={textInputId}
                  rows={3}
                  value={textRequest}
                  onChange={(e) => setTextRequest(e.target.value)}
                  placeholder="Where do you want to go? Describe your request..."
                  className="type-order-textarea"
                />
              </div>
            )}

            {/* Voice Order Drawer */}
            {orderMode === 'voice' && (
              <div className="voice-input-drawer">
                <VoiceRecorder
                  recorder={voiceRecorder}
                  onSwitchToText={() => setOrderMode('type')}
                />
              </div>
            )}
          </div>

          {/* C. Order Ride Button */}
          <div className="submit-row">
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="btn-order-ride"
              aria-label="Order Ride"
            >
              {/* Motorcycle with speed trails icon */}
              <span className="order-btn-motorcycle" aria-hidden="true">
                <svg width="38" height="26" viewBox="0 0 48 32" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="2" y1="9" x2="14" y2="9" strokeWidth="2.2" />
                  <line x1="0" y1="16" x2="16" y2="16" strokeWidth="2.5" />
                  <line x1="4" y1="23" x2="12" y2="23" strokeWidth="2.2" />
                  <circle cx="21" cy="22" r="5" strokeWidth="2.5" />
                  <circle cx="39" cy="22" r="5" strokeWidth="2.5" />
                  <path d="M21 22l6-4 6 0 6 4" strokeWidth="2.5" />
                  <path d="M27 18l3-9 5 0" strokeWidth="2.5" />
                  <circle cx="31" cy="7" r="2.5" fill="white" stroke="none" />
                  <path d="M30 10l-4 4 6 0" strokeWidth="2.5" />
                </svg>
              </span>

              <span className="order-btn-label">
                {isSubmitting ? 'Ordering Ride...' : 'Order Ride'}
              </span>

              {/* Right Chevron Arrow */}
              <span className="order-btn-chevron" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
          </div>

          {/* D. Trust Badge */}
          <div className="trust-badge-container">
            <div className="trust-badge-row">
              <span className="trust-shield-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#0B57D0">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
                </svg>
              </span>
              <span className="trust-badge-text">Safe &bull; Fast &bull; Reliable</span>
            </div>
            {/* Curved Blue Swoosh Arc */}
            <div className="trust-arc-wrap" aria-hidden="true">
              <svg width="120" height="10" viewBox="0 0 120 10" fill="none">
                <path d="M2 2C35 9 85 9 118 2" stroke="#0B57D0" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>
          </div>

          {/* E. Accra City Skyline with Independence Arch */}
          <div className="accra-skyline-footer" aria-hidden="true" />
        </form>
      </div>
    </div>
  );
};
