import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Order } from '../../types';
import { orderService, pushNotificationService } from '../../services';
import {
  resolveRiderPhotoUrl,
  getRiderInitials,
  getCurrentDispatchWave,
  getWaveStatusText,
  matchStation
} from '../../utils';
import './OrderTracker.css';

interface OrderTrackerProps {
  order: Order;
  onOrderUpdated?: (order: Order) => void;
  onBookAnother?: () => void;
  onTrackAnother?: () => void;
}

export const OrderTracker: React.FC<OrderTrackerProps> = ({
  order: initialOrder,
  onOrderUpdated,
  onBookAnother
}) => {
  const [currentOrder, setCurrentOrder] = useState<Order>(initialOrder);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState<string | null>(
    initialOrder.voiceNote?.audioUrl || null
  );
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [pushStatus, setPushStatus] = useState<'prompt' | 'granted' | 'denied' | 'loading'>(() => {
    const perm = pushNotificationService.getPermissionStatus();
    return perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'prompt';
  });
  const [isReAlerting, setIsReAlerting] = useState(false);

  // Completed ride Rating & Complaint states
  const [savedRating, setSavedRating] = useState<{ rating: number; reviewNote?: string } | null>(
    () => orderService.getLocalOrderRating(initialOrder.orderReference)
  );
  const [selectedStars, setSelectedStars] = useState<number>(0);
  const [reviewNote, setReviewNote] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  const [savedComplaint, setSavedComplaint] = useState<{
    disputeReference: string;
    category: string;
    description: string;
  } | null>(() => orderService.getLocalOrderComplaint(initialOrder.orderReference));
  const [showComplaintForm, setShowComplaintForm] = useState(false);
  const [complaintCategory, setComplaintCategory] = useState('service_quality');
  const [complaintText, setComplaintText] = useState('');
  const [isSubmittingComplaint, setIsSubmittingComplaint] = useState(false);
  const [complaintError, setComplaintError] = useState<string | null>(null);

  // Live assigned rider rating (shown as soon as a rider accepts the order)
  const [riderRating, setRiderRating] = useState<{
    averageRating: number | null;
    totalRatings: number;
  }>({
    averageRating: initialOrder.riderAverageRating ?? null,
    totalRatings: initialOrder.riderTotalRatings ?? 0
  });

  useEffect(() => {
    if (!currentOrder.riderId) return;
    let active = true;
    orderService.getRiderRatingSummary(currentOrder.riderId).then((summary) => {
      if (active) setRiderRating(summary);
    });
    return () => {
      active = false;
    };
  }, [currentOrder.riderId, savedRating]);

  useEffect(() => {
    setSavedRating(orderService.getLocalOrderRating(currentOrder.orderReference));
    setSavedComplaint(orderService.getLocalOrderComplaint(currentOrder.orderReference));
    setShowComplaintForm(false);
    setRatingError(null);
    setComplaintError(null);
  }, [currentOrder.orderReference]);

  const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStars < 1 || isSubmittingRating) return;
    setIsSubmittingRating(true);
    setRatingError(null);
    try {
      const res = await orderService.submitOrderRating({
        orderReference: currentOrder.orderReference,
        customerPhone: currentOrder.customerPhone,
        rating: selectedStars,
        reviewNote
      });
      if (res.success) {
        setSavedRating({ rating: selectedStars, reviewNote: reviewNote.trim() || undefined });
      } else {
        setRatingError(res.error || 'Could not submit rating.');
      }
    } finally {
      setIsSubmittingRating(false);
    }
  };

  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintText.trim() || isSubmittingComplaint) return;
    setIsSubmittingComplaint(true);
    setComplaintError(null);
    try {
      const res = await orderService.submitOrderComplaint({
        orderReference: currentOrder.orderReference,
        customerPhone: currentOrder.customerPhone,
        category: complaintCategory,
        description: complaintText
      });
      if (res.success && res.disputeReference) {
        setSavedComplaint({
          disputeReference: res.disputeReference,
          category: complaintCategory,
          description: complaintText.trim()
        });
        setShowComplaintForm(false);
      } else {
        setComplaintError(res.error || 'Could not submit complaint.');
      }
    } finally {
      setIsSubmittingComplaint(false);
    }
  };

  // Live station wave tracking (Wave 1: 0-45s, Wave 2: 45-105s, Wave 3: 105s+)
  const resolvedPickupStation =
    currentOrder.pickupStation ||
    matchStation(currentOrder.requestDescription || '')?.name ||
    null;
  const [dispatchWave, setDispatchWave] = useState<1 | 2 | 3>(() =>
    getCurrentDispatchWave(currentOrder.createdAt)
  );
  const lastDispatchedWaveRef = useRef<number>(1);

  useEffect(() => {
    if (currentOrder.status !== 'pending' || !resolvedPickupStation) return;

    const tick = () => {
      const nextWave = getCurrentDispatchWave(currentOrder.createdAt);
      setDispatchWave(nextWave);

      if (nextWave > lastDispatchedWaveRef.current) {
        lastDispatchedWaveRef.current = nextWave;
        const token =
          currentOrder.bookingToken ||
          orderService.getBookingCapabilityToken(currentOrder.orderReference);
        if (token) {
          pushNotificationService
            .notifyOrderCreated({
              orderReference: currentOrder.orderReference,
              bookingToken: token,
              orderId: currentOrder.id,
              orderType: currentOrder.orderType,
              customerPhone: currentOrder.customerPhone,
              orderDescription: currentOrder.requestDescription,
              pickupStation: resolvedPickupStation,
              dispatchWave: nextWave
            })
            .catch(() => {});
        }
      }
    };

    tick();
    const intervalId = setInterval(tick, 5000);
    return () => clearInterval(intervalId);
  }, [
    currentOrder.status,
    currentOrder.createdAt,
    currentOrder.orderReference,
    currentOrder.bookingToken,
    currentOrder.id,
    currentOrder.orderType,
    currentOrder.customerPhone,
    currentOrder.requestDescription,
    resolvedPickupStation
  ]);

  const handleEnablePush = async () => {
    setPushStatus('loading');
    try {
      const res = await pushNotificationService.registerCustomerNotifications({
        phoneNumber: currentOrder.customerPhone,
        orderReference: currentOrder.orderReference
      });
      setPushStatus(res.success ? 'granted' : 'denied');
    } catch {
      setPushStatus('prompt');
    }
  };

  const handleRetryNotification = async () => {
    const token =
      currentOrder.bookingToken ||
      orderService.getBookingCapabilityToken(currentOrder.orderReference);
    if (!token || isReAlerting) return;

    setIsReAlerting(true);
    try {
      await pushNotificationService.notifyOrderCreated({
        orderReference: currentOrder.orderReference,
        bookingToken: token,
        orderId: currentOrder.id,
        orderType: currentOrder.orderType,
        customerPhone: currentOrder.customerPhone,
        orderDescription: currentOrder.requestDescription
      });
    } catch {
      // Non-critical retry failure
    } finally {
      setTimeout(() => setIsReAlerting(false), 1200);
    }
  };

  // Resolved public HTTP URL for the rider's profile image
  const resolvedPhotoUrl = resolveRiderPhotoUrl(currentOrder.riderPhotoUrl);

  // Update internal state when prop changes (preserve local voiceNote audioUrl if same order)
  useEffect(() => {
    setCurrentOrder((prev) => ({
      ...initialOrder,
      voiceNote:
        initialOrder.voiceNote ||
        (prev.orderReference === initialOrder.orderReference ? prev.voiceNote : undefined)
    }));
    setAvatarError(false);
  }, [initialOrder]);

  // Resolve playable audio URL for voice orders
  useEffect(() => {
    let isCancelled = false;

    if (currentOrder.orderType !== 'voice') {
      setResolvedAudioUrl(null);
      return;
    }

    const directUrl = currentOrder.voiceNote?.audioUrl;
    if (directUrl && /^(https?:\/\/|blob:|data:)/i.test(directUrl)) {
      setResolvedAudioUrl(directUrl);
      if (!currentOrder.voiceRecordingPath) return;
    }

    if (!currentOrder.voiceRecordingPath) {
      return;
    }

    setIsLoadingAudio(!directUrl);
    orderService
      .getVoiceAudioUrl(currentOrder.voiceRecordingPath)
      .then((signedUrl) => {
        if (isCancelled) return;
        if (signedUrl) {
          setResolvedAudioUrl(signedUrl);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingAudio(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    currentOrder.orderType,
    currentOrder.voiceRecordingPath,
    currentOrder.voiceNote?.audioUrl
  ]);

  useEffect(() => {
    setAvatarError(false);
  }, [currentOrder.id, currentOrder.riderPhotoUrl]);

  const onOrderUpdatedRef = useRef(onOrderUpdated);
  useEffect(() => {
    onOrderUpdatedRef.current = onOrderUpdated;
  }, [onOrderUpdated]);

  // Subscribe to live Realtime updates silently in the background
  useEffect(() => {
    const ref = currentOrder.orderReference;
    if (!ref) return;

    const unsubscribe = orderService.subscribeToOrder(ref, (updatedOrder) => {
      setCurrentOrder((prev) => ({
        ...updatedOrder,
        voiceNote: updatedOrder.voiceNote || prev.voiceNote
      }));
      if (onOrderUpdatedRef.current) {
        onOrderUpdatedRef.current(updatedOrder);
      }
    });

    return unsubscribe;
  }, [currentOrder.orderReference]);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    if (isRefreshing || !currentOrder.orderReference) return;
    setIsRefreshing(true);
    try {
      const res = await orderService.trackOrder(currentOrder.orderReference);
      if (res.success && res.order) {
        setCurrentOrder((prev) => ({
          ...res.order!,
          voiceNote: res.order!.voiceNote || prev.voiceNote
        }));
        if (onOrderUpdatedRef.current) {
          onOrderUpdatedRef.current(res.order);
        }
      }
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [currentOrder.orderReference, isRefreshing]);

  // Copy order reference to clipboard
  const handleCopyReference = async () => {
    try {
      await navigator.clipboard.writeText(currentOrder.orderReference);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Cancel pending order
  const handleConfirmCancel = async () => {
    setIsCancelling(true);
    setCancelError(null);
    try {
      const res = await orderService.cancelOrder(
        currentOrder.orderReference,
        currentOrder.customerPhone
      );
      if (res.success) {
        const updated: Order = {
          ...currentOrder,
          status: 'cancelled',
          updatedAt: new Date().toISOString()
        };
        setCurrentOrder(updated);
        if (onOrderUpdated) onOrderUpdated(updated);
        setCancelModalOpen(false);
      } else {
        setCancelError(res.error || 'Failed to cancel order.');
      }
    } catch (err: unknown) {
      const error = err as Error;
      setCancelError(error.message || 'Error cancelling order.');
    } finally {
      setIsCancelling(false);
    }
  };

  // Timeline step calculation
  const getStepIndex = (status: Order['status']): number => {
    switch (status) {
      case 'pending':
        return 0;
      case 'assigned':
      case 'accepted':
        return 1;
      case 'completed':
        return 2;
      case 'cancelled':
        return -1;
      default:
        return 0;
    }
  };

  const stepIndex = getStepIndex(currentOrder.status);

  // Format Ghana phone for WhatsApp
  const getWhatsAppLink = (phone?: string | null) => {
    if (!phone) return '#';
    const digits = phone.replace(/\D/g, '');
    const intl = digits.startsWith('0') ? `233${digits.slice(1)}` : digits;
    const text = encodeURIComponent(
      `Hello, I am tracking my Manna ride (${currentOrder.orderReference}).`
    );
    return `https://wa.me/${intl}?text=${text}`;
  };

  const formatTime = (iso?: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="tracker-container">
      {/* 1. Clean Status Banner */}
      <div className={`tracker-status-hero status-hero-${currentOrder.status}`}>
        <div className="status-hero-top">
          <div className="status-badge-wrap">
            <span className={`status-pill status-${currentOrder.status}`}>
              {currentOrder.status === 'pending' && <span className="status-pulse-dot" />}
              {currentOrder.status === 'pending' && 'LOOKING FOR RIDER'}
              {currentOrder.status === 'accepted' && 'RIDER ON THE WAY'}
              {currentOrder.status === 'assigned' && 'RIDER ASSIGNED'}
              {currentOrder.status === 'completed' && 'COMPLETED'}
              {currentOrder.status === 'cancelled' && 'CANCELLED'}
            </span>
          </div>

          <button
            type="button"
            className={`btn-tracker-refresh ${isRefreshing ? 'spinning' : ''}`}
            onClick={handleRefresh}
            title="Refresh status"
            aria-label="Refresh status"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>

        <div className="status-hero-content">
          <h2 className="status-hero-title">
            {currentOrder.status === 'pending' && 'Finding a nearby rider...'}
            {currentOrder.status === 'accepted' && 'Your rider is on the way'}
            {currentOrder.status === 'assigned' && 'Rider assigned'}
            {currentOrder.status === 'completed' && 'Ride completed'}
            {currentOrder.status === 'cancelled' && 'Order cancelled'}
          </h2>
          <p className="status-hero-sub">
            {currentOrder.status === 'pending' &&
              (resolvedPickupStation
                ? getWaveStatusText(resolvedPickupStation, dispatchWave)
                : 'Rider details will appear here once accepted.')}
            {currentOrder.status === 'accepted' && 'Your rider is heading to your pickup spot.'}
            {currentOrder.status === 'assigned' && 'Your rider will contact you shortly.'}
            {currentOrder.status === 'completed' && 'Thank you for riding with Manna.'}
            {currentOrder.status === 'cancelled' && 'You can book a new ride anytime.'}
          </p>
        </div>

        {/* Minimal 1-tap alerts opt-in (only shown on active orders if not yet enabled) */}
        {pushStatus !== 'granted' &&
          (currentOrder.status === 'pending' ||
            currentOrder.status === 'assigned' ||
            currentOrder.status === 'accepted') && (
            <div className="tracker-push-alert-banner">
              <div className="push-banner-prompt">
                <span className="push-bell-icon" aria-hidden="true">🔔</span>
                <span className="push-prompt-label">Get phone alerts when your rider arrives</span>
                <button
                  type="button"
                  className="btn-enable-push"
                  onClick={handleEnablePush}
                  disabled={pushStatus === 'loading'}
                >
                  {pushStatus === 'loading' ? '...' : 'Allow'}
                </button>
              </div>
            </div>
          )}
      </div>

      {/* 2. Simple 3-Step Progress Bar (Hidden if cancelled) */}
      {currentOrder.status !== 'cancelled' && (
        <div className="tracker-stepper-card">
          <div className="stepper-track">
            <div className={`stepper-node ${stepIndex >= 0 ? 'completed' : ''} ${stepIndex === 0 ? 'current' : ''}`}>
              <div className="node-icon">{stepIndex > 0 ? '✓' : '1'}</div>
              <div className="node-text">
                <span className="node-label">Placed</span>
                <span className="node-time">{formatTime(currentOrder.createdAt)}</span>
              </div>
            </div>

            <div className={`stepper-line ${stepIndex >= 1 ? 'filled' : ''}`} />

            <div className={`stepper-node ${stepIndex >= 1 ? 'completed' : ''} ${stepIndex === 1 ? 'current' : ''}`}>
              <div className="node-icon">{stepIndex > 1 ? '✓' : '2'}</div>
              <div className="node-text">
                <span className="node-label">Assigned</span>
                <span className="node-time">{formatTime(currentOrder.acceptedAt)}</span>
              </div>
            </div>

            <div className={`stepper-line ${stepIndex >= 2 ? 'filled' : ''}`} />

            <div className={`stepper-node ${stepIndex >= 2 ? 'completed' : ''} ${stepIndex === 2 ? 'current' : ''}`}>
              <div className="node-icon">{stepIndex >= 2 ? '✓' : '3'}</div>
              <div className="node-text">
                <span className="node-label">Done</span>
                <span className="node-time">{formatTime(currentOrder.completedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Assigned Rider Card (Shown once a rider accepts) */}
      {(currentOrder.status === 'accepted' || currentOrder.riderName) && (
        <div className="tracker-rider-card">
          <div className="rider-card-header">
            <div className="rider-avatar-wrap">
              {!avatarError && resolvedPhotoUrl ? (
                <img
                  src={resolvedPhotoUrl}
                  alt={currentOrder.riderName || 'Rider photo'}
                  className="rider-avatar-img"
                  onError={() => setAvatarError(true)}
                  loading="eager"
                />
              ) : (
                <div
                  className="rider-avatar-placeholder"
                  aria-label={currentOrder.riderName || 'Rider avatar'}
                >
                  {getRiderInitials(currentOrder.riderName)}
                </div>
              )}
            </div>

            <div className="rider-info-group">
              <div className="rider-name-row">
                <h3 className="rider-name">{currentOrder.riderName || 'Assigned Rider'}</h3>
                <span className="rider-verified-badge">✓ Verified</span>
              </div>
              <div className="rider-rating-meta-row">
                <span className="rider-rating-badge">
                  ★{' '}
                  {riderRating.averageRating !== null && riderRating.totalRatings > 0
                    ? `${riderRating.averageRating.toFixed(1)} (${riderRating.totalRatings})`
                    : 'New rider'}
                </span>
                {currentOrder.operatingArea && (
                  <span className="rider-area-text">📍 {currentOrder.operatingArea}</span>
                )}
              </div>
            </div>
          </div>

          {(currentOrder.motorcycleReg || currentOrder.motorcycleModel) && (
            <div className="rider-bike-row">
              <span className="bike-icon">🏍️</span>
              <div className="bike-details">
                <span className="bike-model">
                  {currentOrder.motorcycleColour && `${currentOrder.motorcycleColour} `}
                  {currentOrder.motorcycleModel || 'Motorcycle'}
                </span>
                {currentOrder.motorcycleReg && (
                  <span className="bike-reg-plate">{currentOrder.motorcycleReg}</span>
                )}
              </div>
            </div>
          )}

          {currentOrder.riderPhone && (
            <div className="rider-contact-actions">
              <a
                href={`tel:${currentOrder.riderPhone}`}
                className="btn-rider-action btn-rider-call"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z" />
                </svg>
                <span>Call Rider</span>
              </a>

              <a
                href={getWhatsAppLink(currentOrder.riderPhone)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-rider-action btn-rider-wa"
              >
                <span>💬 WhatsApp</span>
              </a>
            </div>
          )}
        </div>
      )}

      {/* 4. Minimal Order Summary Card */}
      <div className="tracker-details-card">
        <div className="details-header-row">
          <div className="ref-group">
            <span className="ref-label">Order ID</span>
            <div className="ref-display-row">
              <span className="ref-code">{currentOrder.orderReference}</span>
              <button
                type="button"
                className="btn-copy-code"
                onClick={handleCopyReference}
                title="Copy order ID"
              >
                {copiedRef ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        {/* Voice Note Audio Player */}
        {currentOrder.orderType === 'voice' && (resolvedAudioUrl || currentOrder.voiceRecordingPath) && (
          <div className="tracker-audio-section">
            <span className="item-label">Voice Note</span>
            {resolvedAudioUrl ? (
              <audio
                key={resolvedAudioUrl}
                src={resolvedAudioUrl}
                controls
                preload="metadata"
                className="tracker-audio-player"
              />
            ) : isLoadingAudio ? (
              <p className="tracker-text-body">Loading voice note...</p>
            ) : (
              <p className="tracker-text-body">Voice note unavailable.</p>
            )}
          </div>
        )}

        {/* Text Request Summary */}
        {currentOrder.requestDescription && currentOrder.orderType !== 'voice' && (
          <div className="tracker-text-section">
            <span className="item-label">Your Request</span>
            <p className="tracker-text-body">{currentOrder.requestDescription}</p>
          </div>
        )}
      </div>

      {/* 4b. Rate & Report Issue (Completed Rides Only) */}
      {currentOrder.status === 'completed' && (
        <div className="tracker-feedback-card">
          {/* Rating Section */}
          {savedRating ? (
            <div className="rating-submitted-box" role="status">
              <div className="rating-submitted-stars" aria-label={`Rated ${savedRating.rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <span key={star} className={star <= savedRating.rating ? 'star-filled' : 'star-empty'}>
                    ★
                  </span>
                ))}
              </div>
              <p className="rating-submitted-text">
                Thank you! You rated this ride <strong>{savedRating.rating}/5</strong>.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmitRating} className="rating-form">
              <h3 className="feedback-card-title">Rate Your Ride</h3>
              <div className="star-picker-row" role="radiogroup" aria-label="Rate your ride from 1 to 5 stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    role="radio"
                    aria-checked={selectedStars === star}
                    aria-label={`${star} star${star > 1 ? 's' : ''}`}
                    className={`star-btn ${star <= selectedStars ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedStars(star);
                      if (ratingError) setRatingError(null);
                    }}
                  >
                    ★
                  </button>
                ))}
              </div>
              {selectedStars > 0 && (
                <span className="star-label-text">{STAR_LABELS[selectedStars]}</span>
              )}

              <input
                type="text"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Add a short note (optional)"
                maxLength={300}
                className="feedback-inline-input"
              />

              {ratingError && <p className="feedback-error-msg">{ratingError}</p>}

              <button
                type="submit"
                className="btn-submit-rating"
                disabled={selectedStars < 1 || isSubmittingRating}
              >
                {isSubmittingRating ? 'Submitting...' : 'Submit Rating'}
              </button>
            </form>
          )}

          {/* Complaint / Report Issue Section */}
          <div className="complaint-divider" />

          {savedComplaint ? (
            <div className="complaint-submitted-box" role="status">
              <strong>✓ Complaint Received ({savedComplaint.disputeReference})</strong>
              <p>Our support team will review your report.</p>
            </div>
          ) : !showComplaintForm ? (
            <button
              type="button"
              className="btn-open-complaint"
              onClick={() => setShowComplaintForm(true)}
            >
              Report a problem with this ride
            </button>
          ) : (
            <form onSubmit={handleSubmitComplaint} className="complaint-form">
              <div className="complaint-form-header">
                <span className="complaint-form-title">Report an Issue</span>
                <button
                  type="button"
                  className="btn-close-complaint"
                  onClick={() => setShowComplaintForm(false)}
                >
                  Cancel
                </button>
              </div>

              <select
                value={complaintCategory}
                onChange={(e) => setComplaintCategory(e.target.value)}
                className="feedback-inline-select"
                aria-label="Issue category"
              >
                <option value="payment_disagreement">Fare / Payment Issue</option>
                <option value="unsafe_driving">Unsafe Driving</option>
                <option value="wrong_destination">Wrong Drop-off / Route</option>
                <option value="service_quality">Poor Service / Behavior</option>
                <option value="other">Other Issue</option>
              </select>

              <textarea
                rows={3}
                value={complaintText}
                onChange={(e) => {
                  setComplaintText(e.target.value);
                  if (complaintError) setComplaintError(null);
                }}
                placeholder="Briefly explain what happened..."
                maxLength={600}
                className="feedback-inline-textarea"
              />

              {complaintError && <p className="feedback-error-msg">{complaintError}</p>}

              <button
                type="submit"
                className="btn-submit-complaint"
                disabled={!complaintText.trim() || isSubmittingComplaint}
              >
                {isSubmittingComplaint ? 'Sending...' : 'Submit Complaint'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* 5. Essential Actions */}
      <div className="tracker-bottom-actions">
        {currentOrder.status === 'pending' && (
          <>
            <button
              type="button"
              className="btn-retry-dispatch"
              onClick={handleRetryNotification}
              disabled={isReAlerting}
            >
              {isReAlerting ? 'Alerting riders...' : 'Re-alert Riders'}
            </button>
            <button
              type="button"
              className="btn-tracker-cancel"
              onClick={() => setCancelModalOpen(true)}
            >
              Cancel Order
            </button>
          </>
        )}

        {onBookAnother && (currentOrder.status === 'completed' || currentOrder.status === 'cancelled') && (
          <button
            type="button"
            className="btn-tracker-secondary"
            onClick={onBookAnother}
          >
            Book Another Ride
          </button>
        )}
      </div>

      {/* 6. Cancel Confirmation Modal */}
      {cancelModalOpen && (
        <div className="tracker-modal-overlay" role="dialog" aria-modal="true">
          <div className="tracker-modal-card">
            <h3 className="modal-title">Cancel Order?</h3>
            <p className="modal-text">
              Cancel order <strong>{currentOrder.orderReference}</strong>?
            </p>

            {cancelError && <div className="modal-error-box">{cancelError}</div>}

            <div className="modal-actions-row">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setCancelModalOpen(false)}
                disabled={isCancelling}
              >
                Keep Ride
              </button>
              <button
                type="button"
                className="btn-modal-confirm-cancel"
                onClick={handleConfirmCancel}
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
