import React, { useState, useId, useEffect } from 'react';
import { useVoiceRecorder } from '../../hooks';
import {
  validateGhanaPhone,
  validateGuidedTextOrder,
  formatGuidedOrderDescription,
  getRecentPlaces,
  saveRecentPlaces,
  QUICK_NOTE_CHIPS,
  STATIONS_BY_ZONE,
  matchStation,
  type ServiceType
} from '../../utils';
import { orderService, pushNotificationService } from '../../services';
import { mediaUploadManager } from '../../services/storage/mediaUploadManager';
import { offlineMediaQueue, type QueuedUploadItem } from '../../services/storage/offlineMediaQueue';
import { VoiceRecorder } from '../voice/VoiceRecorder';
import { OrderTracker } from './OrderTracker';
import { MannaHeroBanner } from '../common/MannaHeroBanner';
import type { Order } from '../../types';
import './CustomerBookingForm.css';

export interface CustomerBookingFormProps {
  onOrderSubmitted?: (order: Order) => void;
  onSwitchToTrack?: () => void;
}

export const CustomerBookingForm: React.FC<CustomerBookingFormProps> = ({
  onOrderSubmitted,
  onSwitchToTrack
}) => {
  const phoneInputId = useId();
  const stationSelectId = useId();
  const pickupInputId = useId();
  const destinationInputId = useId();
  const noteInputId = useId();

  // Contact number state (remember last used phone for repeat bookings)
  const [phone, setPhone] = useState(() => {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    try {
      return window.localStorage.getItem('okada_customer_phone') || '';
    } catch {
      return '';
    }
  });
  const [phoneTouched, setPhoneTouched] = useState(false);

  // Service type: 'ride' (default) or 'delivery'
  const [serviceType, setServiceType] = useState<ServiceType>('ride');

  // Order mode state: 'type' or 'voice' (default: 'type')
  const [orderMode, setOrderMode] = useState<'type' | 'voice'>('type');

  // Guided text order fields & nearest pickup station (for Wave 1 dispatch)
  const [pickupStation, setPickupStation] = useState('');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [extraNote, setExtraNote] = useState('');
  const [pickupTouched, setPickupTouched] = useState(false);
  const [destinationTouched, setDestinationTouched] = useState(false);
  const [activeRouteField, setActiveRouteField] = useState<'pickup' | 'destination'>('pickup');
  const [recentPlaces, setRecentPlaces] = useState<string[]>(() => getRecentPlaces());

  // Voice recording hook
  const voiceRecorder = useVoiceRecorder();

  // Submission & Transfer states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadPercentage, setUploadPercentage] = useState<number | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [pendingOfflineItems, setPendingOfflineItems] = useState<QueuedUploadItem[]>([]);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [onlineRidersCount, setOnlineRidersCount] = useState<number | null>(null);

  // Check online rider availability on mount (and every 20s)
  useEffect(() => {
    let active = true;
    const fetchCount = async () => {
      const count = await orderService.getOnlineRidersCount();
      if (active) setOnlineRidersCount(count);
    };
    fetchCount();
    const id = setInterval(fetchCount, 20000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Subscribe to offline queue changes
  useEffect(() => {
    const unsubscribe = offlineMediaQueue.subscribe((items) => {
      setPendingOfflineItems(items);
    });
    return unsubscribe;
  }, []);

  const handleSyncOffline = async () => {
    if (isSyncingOffline) return;
    setIsSyncingOffline(true);
    try {
      await mediaUploadManager.syncOfflineQueue();
    } finally {
      setIsSyncingOffline(false);
    }
  };

  // Validation
  const phoneValidation = validateGhanaPhone(phone);
  const isPhoneValid = phoneValidation.isValid;

  const guidedValidation = validateGuidedTextOrder({
    serviceType,
    pickup,
    destination,
    extraNote
  });

  const formattedTextDescription = formatGuidedOrderDescription({
    serviceType,
    pickup,
    destination,
    extraNote
  });

  const isOrderDetailsProvided =
    orderMode === 'type'
      ? guidedValidation.isValid
      : Boolean(voiceRecorder.audioBlob) && !voiceRecorder.isRecording;

  const isFormValid = isPhoneValid && isOrderDetailsProvided;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(e.target.value);
    if (submissionError) setSubmissionError(null);
  };

  const handleSwapRoute = () => {
    setPickup(destination);
    setDestination(pickup);
  };

  const handleSelectRecentPlace = (place: string) => {
    if (activeRouteField === 'pickup' || !pickup.trim()) {
      setPickup(place);
      setActiveRouteField('destination');
    } else {
      setDestination(place);
    }
    if (submissionError) setSubmissionError(null);
  };

  const handleToggleQuickNote = (chip: string) => {
    const trimmed = extraNote.trim();
    const parts = trimmed ? trimmed.split(',').map((p) => p.trim()).filter(Boolean) : [];
    const existsIndex = parts.findIndex((p) => p.toLowerCase() === chip.toLowerCase());

    if (existsIndex >= 0) {
      parts.splice(existsIndex, 1);
    } else {
      parts.push(chip);
    }
    setExtraNote(parts.join(', '));
    if (submissionError) setSubmissionError(null);
  };

  const isChipActive = (chip: string) => {
    const parts = extraNote
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    return parts.includes(chip.toLowerCase());
  };

  // Handle Order Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    // Trigger browser notification permission directly inside the user's tap gesture
    // (mobile Chrome & iOS PWA block Notification.requestPermission() after an async await)
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {});
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    setOfflineNotice(null);
    setUploadPercentage(null);

    try {
      // Resolve pickup station from explicit selector OR smart-matched from typed pickup text
      const resolvedStation =
        pickupStation ||
        (orderMode === 'type' ? matchStation(pickup)?.name || '' : '') ||
        undefined;

      const response = await orderService.submitOrder(
        {
          customerPhone: phoneValidation.formatted || phone.trim(),
          orderType: orderMode === 'type' ? 'text' : 'voice',
          orderDescription: orderMode === 'type' ? formattedTextDescription : undefined,
          pickupStation: resolvedStation,
          audioFile: orderMode === 'voice' && voiceRecorder.audioBlob ? voiceRecorder.audioBlob : undefined,
          durationSeconds: voiceRecorder.recordingDuration
        },
        ({ percentage }) => {
          setUploadPercentage(percentage);
        }
      );

      if (response.isQueuedOffline) {
        setOfflineNotice(
          response.message ||
            'Saved offline. Your order will be sent automatically once internet is back.'
        );
        return;
      }

      if (!response.success || !response.orderReference) {
        setSubmissionError(response.error || 'Failed to submit order. Please try again.');
        return;
      }

      const normalizedPhone = phoneValidation.formatted || phone.trim();
      if (typeof window !== 'undefined' && window.localStorage && normalizedPhone) {
        try {
          window.localStorage.setItem('okada_customer_phone', normalizedPhone);
        } catch {
          // ignore storage quota errors
        }
      }

      if (orderMode === 'type') {
        setRecentPlaces(saveRecentPlaces([pickup, destination]));
      }

      const confirmedOrder: Order = {
        id: response.orderId || response.orderReference,
        orderReference: response.orderReference,
        bookingToken: response.bookingToken,
        customerPhone: normalizedPhone,
        orderType: orderMode === 'type' ? 'text' : 'voice',
        requestDescription: orderMode === 'type' ? formattedTextDescription : 'Voice Order Request',
        pickupStation: resolvedStation || null,
        voiceRecordingPath: response.voiceRecordingPath || null,
        voiceNote:
          orderMode === 'voice' && voiceRecorder.audioUrl
            ? {
                audioUrl: voiceRecorder.audioUrl,
                durationSeconds: voiceRecorder.recordingDuration
              }
            : undefined,
        status: response.status || 'pending',
        createdAt: response.createdAt || new Date().toISOString(),
        updatedAt: response.createdAt || new Date().toISOString()
      };

      orderService.saveOrderToLocalHistory(confirmedOrder);

      pushNotificationService.notifyOrderCreated({
        orderReference: confirmedOrder.orderReference,
        bookingToken: response.bookingToken,
        orderId: confirmedOrder.id,
        orderType: confirmedOrder.orderType,
        customerPhone: confirmedOrder.customerPhone,
        orderDescription: confirmedOrder.requestDescription,
        pickupStation: resolvedStation,
        dispatchWave: 1
      }).catch((notifyErr) => {
        console.warn('Push notification dispatch warning:', notifyErr);
      });

      pushNotificationService.registerCustomerNotifications({
        orderReference: confirmedOrder.orderReference,
        phoneNumber: confirmedOrder.customerPhone
      }).catch(() => {});

      setSubmittedOrder(confirmedOrder);
      if (onOrderSubmitted) {
        onOrderSubmitted(confirmedOrder);
      }
    } catch (err: unknown) {
      const error = err as Error;
      setSubmissionError(error.message || 'An unexpected error occurred while submitting your order.');
    } finally {
      setIsSubmitting(false);
      setUploadPercentage(null);
    }
  };

  const handleResetForNewRide = () => {
    setSubmittedOrder(null);
    setPickupStation('');
    setPickup('');
    setDestination('');
    setExtraNote('');
    setPickupTouched(false);
    setDestinationTouched(false);
    setSubmissionError(null);
    setPhoneTouched(false);
    voiceRecorder.resetRecording();
  };

  if (submittedOrder) {
    return (
      <div className="okada-screen-wrapper">
        <MannaHeroBanner ariaLabel="Manna Hero Banner" />
        <div className="okada-white-sheet order-success-sheet">
          <OrderTracker
            order={submittedOrder}
            onOrderUpdated={(updated) => setSubmittedOrder(updated)}
            onBookAnother={handleResetForNewRide}
            onTrackAnother={onSwitchToTrack}
          />
          <div className="accra-skyline-footer" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="okada-screen-wrapper">
      <MannaHeroBanner ariaLabel="Manna Branding Header" />

      <div className="okada-white-sheet">
        {/* Subtle online riders pill (only shown when riders are online) */}
        {onlineRidersCount !== null && onlineRidersCount > 0 && (
          <div className="online-riders-pill" role="status">
            <span className="online-dot" />
            <span>
              {onlineRidersCount} {onlineRidersCount === 1 ? 'rider' : 'riders'} nearby
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="booking-form-content">
          {/* 1. Compact Phone Input */}
          <div className="compact-field-group">
            <label htmlFor={phoneInputId} className="compact-label">
              Phone Number
            </label>
            <div className={`phone-input-box ${isPhoneValid ? 'valid' : ''}`}>
              <div className="phone-icon-addon" aria-hidden="true">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#063A9B"
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
                onBlur={() => setPhoneTouched(true)}
                className="phone-native-input"
                aria-describedby="phone-feedback-msg"
              />
              {isPhoneValid && (
                <span className="phone-valid-check" aria-hidden="true">✓</span>
              )}
            </div>

            {phoneTouched && !isPhoneValid && (
              <div id="phone-feedback-msg" className="phone-feedback-row" aria-live="polite">
                <span className="feedback-error-text">
                  {phoneValidation.error || 'Enter a valid 10-digit Ghana number'}
                </span>
              </div>
            )}
          </div>

          {/* 2. Nearest Moto Station (dispatches to riders there first — separate from exact pickup spot) */}
          <div className="compact-field-group">
            <label htmlFor={stationSelectId} className="compact-label">
              Nearest Moto Station
            </label>
            <div className="station-select-wrap">
              <span className="station-select-icon" aria-hidden="true">📍</span>
              <select
                id={stationSelectId}
                value={pickupStation}
                onChange={(e) => {
                  setPickupStation(e.target.value);
                  if (submissionError) setSubmissionError(null);
                }}
                className="station-native-select"
              >
                <option value="">Choose nearest station</option>
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
          </div>

          {/* 3. Compact Ride / Parcel + Type / Voice Controls */}
          <div className="compact-controls-stack">
            <div className="compact-segment-bar" role="radiogroup" aria-label="Service type">
              <button
                type="button"
                role="radio"
                aria-checked={serviceType === 'ride'}
                className={`compact-segment-btn ${serviceType === 'ride' ? 'active' : ''}`}
                onClick={() => setServiceType('ride')}
              >
                🛵 Ride
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={serviceType === 'delivery'}
                className={`compact-segment-btn ${serviceType === 'delivery' ? 'active' : ''}`}
                onClick={() => setServiceType('delivery')}
              >
                📦 Parcel
              </button>
            </div>

            <div className="order-methods-row compact-methods" role="tablist" aria-label="Order method">
              <button
                type="button"
                role="tab"
                aria-selected={orderMode === 'type'}
                className={`compact-method-btn ${orderMode === 'type' ? 'active' : ''}`}
                onClick={() => {
                  setOrderMode('type');
                  if (submissionError) setSubmissionError(null);
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
                </svg>
                <span>Type</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={orderMode === 'voice'}
                className={`compact-method-btn ${orderMode === 'voice' ? 'active' : ''}`}
                onClick={() => {
                  setOrderMode('voice');
                  if (submissionError) setSubmissionError(null);
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
                <span>Voice</span>
              </button>
            </div>
          </div>

          {/* 3. Guided Type Order */}
          {orderMode === 'type' && (
            <div className="type-input-drawer">
              <div className="drawer-pro-guide">
                <span className="drawer-pro-guide-icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </span>
                <span className="drawer-pro-guide-text">
                  {serviceType === 'delivery'
                    ? 'Enter exact pickup location, drop-off location, and item note.'
                    : 'Enter your exact current location, destination, and a nearby landmark.'}
                </span>
              </div>

              <div className="guided-route-card">
                <div className="route-timeline" aria-hidden="true">
                  <span className="route-dot route-dot-pickup" />
                  <span className="route-line" />
                  <span className="route-dot route-dot-dest" />
                </div>

                <div className="route-inputs-stack">
                  <div className="route-field-group">
                    <label htmlFor={pickupInputId} className="route-field-label">
                      {serviceType === 'delivery' ? 'Exact Pickup Location' : 'Your Exact Location'}
                    </label>
                    <div className="route-input-wrap">
                      <input
                        id={pickupInputId}
                        type="text"
                        value={pickup}
                        onFocus={() => setActiveRouteField('pickup')}
                        onBlur={() => setPickupTouched(true)}
                        onChange={(e) => {
                          setPickup(e.target.value);
                          if (submissionError) setSubmissionError(null);
                        }}
                        placeholder={
                          serviceType === 'delivery'
                            ? 'e.g. Behind the pharmacy, blue gate'
                            : 'e.g. Near the pharmacy, opposite Shell'
                        }
                        className="route-native-input"
                        maxLength={120}
                      />
                      {pickup && (
                        <button
                          type="button"
                          className="route-clear-btn"
                          onClick={() => setPickup('')}
                          aria-label="Clear pickup"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                    {pickupTouched && !guidedValidation.pickupValid && (
                      <span className="route-field-hint">{guidedValidation.pickupHint}</span>
                    )}
                  </div>

                  <div className="route-divider-row">
                    <div className="route-divider-line" />
                    {(pickup.trim() || destination.trim()) && (
                      <button
                        type="button"
                        className="btn-swap-route"
                        onClick={handleSwapRoute}
                        title="Swap locations"
                        aria-label="Swap locations"
                      >
                        ⇅
                      </button>
                    )}
                  </div>

                  <div className="route-field-group">
                    <label htmlFor={destinationInputId} className="route-field-label">
                      {serviceType === 'delivery' ? 'Drop-off' : 'Where are you going?'}
                    </label>
                    <div className="route-input-wrap">
                      <input
                        id={destinationInputId}
                        type="text"
                        value={destination}
                        onFocus={() => setActiveRouteField('destination')}
                        onBlur={() => setDestinationTouched(true)}
                        onChange={(e) => {
                          setDestination(e.target.value);
                          if (submissionError) setSubmissionError(null);
                        }}
                        placeholder="e.g. Kadjebi Market"
                        className="route-native-input"
                        maxLength={120}
                      />
                      {destination && (
                        <button
                          type="button"
                          className="route-clear-btn"
                          onClick={() => setDestination('')}
                          aria-label="Clear destination"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                    {destinationTouched && !guidedValidation.destinationValid && (
                      <span className="route-field-hint">{guidedValidation.destinationHint}</span>
                    )}
                  </div>
                </div>
              </div>

              {recentPlaces.length > 0 && (
                <div className="quick-chips-row">
                  {recentPlaces.slice(0, 3).map((place) => (
                    <button
                      key={place}
                      type="button"
                      className="quick-chip recent-place-chip"
                      onClick={() => handleSelectRecentPlace(place)}
                    >
                      🕒 {place}
                    </button>
                  ))}
                </div>
              )}

              <input
                id={noteInputId}
                type="text"
                value={extraNote}
                onChange={(e) => {
                  setExtraNote(e.target.value);
                  if (submissionError) setSubmissionError(null);
                }}
                placeholder={
                  serviceType === 'delivery'
                    ? 'Note (optional): item, receiver name...'
                    : 'Note (optional): landmark, 2 people, luggage...'
                }
                className="guided-note-input"
                maxLength={160}
                aria-label="Optional note"
              />

              <div className="quick-chips-row" aria-label="Quick note options">
                {QUICK_NOTE_CHIPS[serviceType].slice(0, 3).map((chip) => {
                  const active = isChipActive(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      className={`quick-chip ${active ? 'active' : ''}`}
                      onClick={() => handleToggleQuickNote(chip)}
                      aria-pressed={active}
                    >
                      {active ? '✓ ' : '+ '}
                      {chip}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3b. Guided Voice Order */}
          {orderMode === 'voice' && (
            <div className="voice-input-drawer">
              <VoiceRecorder
                recorder={voiceRecorder}
                serviceType={serviceType}
                onSwitchToText={() => setOrderMode('type')}
              />
            </div>
          )}

          {/* Offline Queue Banner */}
          {pendingOfflineItems.length > 0 && (
            <div className="offline-queue-banner" role="status">
              <div className="offline-queue-info">
                <span>📡</span>
                <span>
                  <strong>{pendingOfflineItems.length}</strong> queued offline
                </span>
              </div>
              <button
                type="button"
                className="btn-sync-offline"
                onClick={handleSyncOffline}
                disabled={isSyncingOffline}
              >
                {isSyncingOffline ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          )}

          {/* Offline Saved Notice */}
          {offlineNotice && (
            <div className="submission-error-alert" style={{ backgroundColor: '#ECFDF5', borderColor: '#34D399', color: '#065F46' }} role="status">
              <span className="error-alert-icon" aria-hidden="true">💾</span>
              <div className="error-alert-content">
                <strong style={{ color: '#065F46' }}>Saved Offline</strong>
                <p style={{ color: '#047857' }}>{offlineNotice}</p>
              </div>
            </div>
          )}

          {/* Submission Error Banner */}
          {submissionError && (
            <div className="submission-error-alert" role="alert">
              <span className="error-alert-icon" aria-hidden="true">⚠️</span>
              <div className="error-alert-content">
                <strong>Submission Issue</strong>
                <p>{submissionError}</p>
              </div>
            </div>
          )}

          {/* Live Dispatch Progress Card */}
          {isSubmitting && (
            <div className="dispatch-progress-card" aria-live="polite">
              <div className="dispatch-progress-header">
                <div className="dispatch-radar-circle">
                  <div className="radar-ripple" />
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a10 10 0 1 0 10 10" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <div className="dispatch-text-group">
                  <span className="dispatch-title">
                    {uploadPercentage !== null && uploadPercentage < 100
                      ? 'Uploading Voice Note'
                      : 'Sending to Nearby Riders'}
                  </span>
                  <span className="dispatch-sub">
                    {uploadPercentage !== null && uploadPercentage < 100
                      ? 'Almost done...'
                      : 'Connecting with local riders...'}
                  </span>
                </div>
                {uploadPercentage !== null && (
                  <span className="dispatch-percentage-badge">{uploadPercentage}%</span>
                )}
              </div>

              <div className="dispatch-progress-track">
                <div
                  className={`dispatch-progress-bar ${uploadPercentage === null ? 'indeterminate' : ''}`}
                  style={{ width: uploadPercentage !== null ? `${uploadPercentage}%` : '70%' }}
                />
              </div>
            </div>
          )}

          {/* 4. Submit Button */}
          <div className="submit-row">
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="btn-order-ride"
              aria-label={serviceType === 'delivery' ? 'Order Delivery' : 'Order Ride'}
              aria-busy={isSubmitting}
            >
              <span className="order-btn-motorcycle" aria-hidden="true">
                <svg width="36" height="24" viewBox="0 0 48 32" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
                {isSubmitting
                  ? uploadPercentage !== null
                    ? `Uploading (${uploadPercentage}%)...`
                    : 'Submitting...'
                  : submissionError
                  ? 'Retry Order'
                  : serviceType === 'delivery'
                  ? 'Order Delivery'
                  : 'Order Ride'}
              </span>

              <span className="order-btn-chevron" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
          </div>

          {/* 5. Minimal Trust Footer */}
          <div className="trust-badge-container">
            <div className="trust-badge-row">
              <span className="trust-shield-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#0B57D0">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
                </svg>
              </span>
              <span className="trust-badge-text">Safe &bull; Fast &bull; Reliable</span>
            </div>
          </div>

          <div className="accra-skyline-footer" aria-hidden="true" />
        </form>
      </div>
    </div>
  );
};
