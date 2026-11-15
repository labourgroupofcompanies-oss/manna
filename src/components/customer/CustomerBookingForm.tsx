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

  // Order mode state: 'type' or 'voice'
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

  // Handle phone input change
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(e.target.value);
  };

  const handlePhoneBlur = () => {
    setPhoneTouched(true);
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Simulate local order submission delay for smooth UX
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

  // Reset form for new ride
  const handleResetForNewRide = () => {
    setSubmittedOrder(null);
    setTextRequest('');
    setPhoneTouched(false);
    voiceRecorder.resetRecording();
  };

  // Render Success Screen
  if (submittedOrder) {
    return (
      <div className="booking-card order-success-card" role="region" aria-label="Order Confirmation">
        <div className="success-icon-badge">✓</div>
        <h2 className="success-title">Ride Requested!</h2>
        <p className="success-subtitle">
          Your Okada booking has been placed locally.
        </p>

        <div className="order-summary-box">
          <div className="summary-row">
            <span className="summary-label">Order Reference:</span>
            <span className="summary-value order-id-pill">{submittedOrder.id}</span>
          </div>

          <div className="summary-row">
            <span className="summary-label">Your Contact:</span>
            <span className="summary-value">{submittedOrder.customerPhone}</span>
          </div>

          <div className="summary-row">
            <span className="summary-label">Order Type:</span>
            <span className="summary-value">
              {submittedOrder.voiceNote ? '🎙️ Voice Note Request' : '📝 Typed Request'}
            </span>
          </div>

          {submittedOrder.voiceNote ? (
            <div className="summary-voice-preview">
              <span className="summary-label">Voice Recording:</span>
              <audio
                src={submittedOrder.voiceNote.audioUrl}
                controls
                className="summary-audio-player"
              />
            </div>
          ) : (
            <div className="summary-text-preview">
              <span className="summary-label">Destination &amp; Request:</span>
              <p className="summary-text-body">{submittedOrder.requestDescription}</p>
            </div>
          )}

          <div className="summary-row">
            <span className="summary-label">Time Placed:</span>
            <span className="summary-value">
              {new Date(submittedOrder.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-full-width"
          onClick={handleResetForNewRide}
        >
          Book Another Ride
        </button>
      </div>
    );
  }

  return (
    <div className="booking-card" role="region" aria-label="Okada Customer Booking Form">
      {/* Branding Header */}
      <header className="booking-branding">
        <div className="branding-logo-circle" aria-hidden="true">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="5" cy="16" r="3" />
            <circle cx="19" cy="16" r="3" />
            <path d="M12 17h4l3-7H9" />
            <path d="M9 17l2-5 3 0" />
            <path d="M14 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          </svg>
        </div>
        <div className="branding-text">
          <h2 className="branding-title">Okada Book</h2>
          <p className="branding-tagline">Ride Easy... Get There Fast!</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} noValidate className="booking-form">
        {/* Contact Number Input */}
        <div className="form-section">
          <label htmlFor={phoneInputId} className="section-label">
            Your Contact
            <span className="required-star" aria-hidden="true">*</span>
          </label>

          <div className="phone-input-wrapper">
            <span className="ghana-flag-addon" aria-hidden="true">🇬🇭 +233</span>
            <input
              id={phoneInputId}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="e.g. 0245660622"
              value={phone}
              onChange={handlePhoneChange}
              onBlur={handlePhoneBlur}
              className={`phone-input ${
                phoneTouched && !isPhoneValid ? 'input-invalid' : ''
              } ${isPhoneValid ? 'input-valid' : ''}`}
              aria-describedby="phone-feedback"
            />
          </div>

          <div id="phone-feedback" className="input-feedback" aria-live="polite">
            {phoneTouched && !isPhoneValid && (
              <span className="feedback-error">
                {phoneValidation.error || 'Enter a valid Ghanaian phone number (e.g. 0245660622)'}
              </span>
            )}
            {isPhoneValid && (
              <span className="feedback-success">
                ✓ Valid {phoneValidation.carrier} Number ({phoneValidation.formatted})
              </span>
            )}
            {!phoneTouched && !isPhoneValid && (
              <span className="feedback-hint">Example: 0245660622</span>
            )}
          </div>
        </div>

        {/* Order Method Selector */}
        <div className="form-section">
          <span className="section-label">
            Choose Order Method
            <span className="required-star" aria-hidden="true">*</span>
          </span>

          <div className="order-mode-toggle" role="tablist" aria-label="Select Order Method">
            <button
              type="button"
              role="tab"
              aria-selected={orderMode === 'type'}
              className={`mode-toggle-btn ${orderMode === 'type' ? 'active' : ''}`}
              onClick={() => setOrderMode('type')}
            >
              <span className="mode-icon">📝</span>
              <span className="mode-title">TYPE ORDER</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={orderMode === 'voice'}
              className={`mode-toggle-btn ${orderMode === 'voice' ? 'active' : ''}`}
              onClick={() => setOrderMode('voice')}
            >
              <span className="mode-icon">🎙️</span>
              <span className="mode-title">VOICE ORDER</span>
            </button>
          </div>

          {/* Conditional Content: Type Order */}
          {orderMode === 'type' && (
            <div className="type-order-area">
              <label htmlFor={textInputId} className="visually-hidden">
                Where do you want to go? Describe your request
              </label>
              <textarea
                id={textInputId}
                rows={4}
                value={textRequest}
                onChange={(e) => setTextRequest(e.target.value)}
                placeholder="Where do you want to go? Describe your request..."
                className="order-textarea"
                aria-required="true"
              />
              <div className="textarea-footer">
                <span className="textarea-hint">
                  Specify pickup landmark and destination.
                </span>
                <span className="character-count">
                  {textRequest.length} characters
                </span>
              </div>
            </div>
          )}

          {/* Conditional Content: Voice Order */}
          {orderMode === 'voice' && (
            <div className="voice-order-area">
              <VoiceRecorder
                recorder={voiceRecorder}
                onSwitchToText={() => setOrderMode('type')}
              />
            </div>
          )}
        </div>

        {/* Submit Order Button */}
        <div className="form-submit-section">
          <button
            type="submit"
            disabled={!isFormValid || isSubmitting}
            className="btn btn-primary btn-submit-order btn-full-width"
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="submit-spinner" aria-hidden="true" />
                <span>Processing Order...</span>
              </>
            ) : (
              <span>Order Ride</span>
            )}
          </button>

          {!isFormValid && (
            <p className="submit-disabled-hint">
              {!isPhoneValid
                ? 'Please enter your phone number to proceed'
                : orderMode === 'type'
                ? 'Please describe where you want to go'
                : 'Please record your voice note or stop the recording'}
            </p>
          )}
        </div>
      </form>
    </div>
  );
};
