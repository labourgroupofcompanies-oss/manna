import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Order } from '../../types';
import { orderService, pushNotificationService } from '../../services';
import { resolveRiderPhotoUrl, getRiderInitials } from '../../utils';
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
  onBookAnother,
  onTrackAnother
}) => {
  const [currentOrder, setCurrentOrder] = useState<Order>(initialOrder);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [avatarError, setAvatarError] = useState(false);
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState<string | null>(
    initialOrder.voiceNote?.audioUrl || null
  );
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  // Customer comment state
  const [commentDraft, setCommentDraft] = useState<string>(initialOrder.customerComment || '');
  const [isEditingComment, setIsEditingComment] = useState<boolean>(!initialOrder.customerComment);
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [commentFeedback, setCommentFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Push Notification state
  const [pushStatus, setPushStatus] = useState<'prompt' | 'granted' | 'denied' | 'loading'>(() => {
    const perm = pushNotificationService.getPermissionStatus();
    return perm === 'granted' ? 'granted' : perm === 'denied' ? 'denied' : 'prompt';
  });
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [isReAlerting, setIsReAlerting] = useState(false);
  const [reAlertFeedback, setReAlertFeedback] = useState<string | null>(null);

  const handleRetryNotification = async () => {
    const token = currentOrder.bookingToken || orderService.getBookingCapabilityToken(currentOrder.orderReference);
    if (!token) {
      setReAlertFeedback('Capability token not found on this device.');
      return;
    }
    setIsReAlerting(true);
    setReAlertFeedback(null);
    try {
      await pushNotificationService.notifyOrderCreated({
        orderReference: currentOrder.orderReference,
        bookingToken: token,
        orderId: currentOrder.id,
        orderType: currentOrder.orderType,
        customerPhone: currentOrder.customerPhone,
        orderDescription: currentOrder.requestDescription
      });
      setReAlertFeedback('Riders re-alerted successfully! Cooldown in effect.');
    } catch {
      setReAlertFeedback('Could not re-alert riders. Please try again.');
    } finally {
      setIsReAlerting(false);
    }
  };

  const handleEnablePush = async () => {
    setPushStatus('loading');
    setPushFeedback(null);
    try {
      const res = await pushNotificationService.registerCustomerNotifications({
        phoneNumber: currentOrder.customerPhone,
        orderReference: currentOrder.orderReference
      });
      if (res.success) {
        setPushStatus('granted');
        setPushFeedback('Push alerts active! You will be notified the moment a rider accepts.');
      } else {
        setPushStatus('denied');
        setPushFeedback(res.error || 'Could not enable notifications.');
      }
    } catch {
      setPushStatus('prompt');
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

  // Resolve playable audio URL for voice orders (signed URL from Supabase Storage or local blob URL)
  useEffect(() => {
    let isCancelled = false;

    if (currentOrder.orderType !== 'voice') {
      setResolvedAudioUrl(null);
      return;
    }

    const directUrl = currentOrder.voiceNote?.audioUrl;
    if (directUrl && /^(https?:\/\/|blob:|data:)/i.test(directUrl)) {
      setResolvedAudioUrl(directUrl);
      // Still fetch a signed URL in the background if we have a storage path, in case blob URL was revoked
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

  // Reset avatar load error when order ID or rider photo URL changes
  useEffect(() => {
    setAvatarError(false);
  }, [currentOrder.id, currentOrder.riderPhotoUrl]);

  const onOrderUpdatedRef = useRef(onOrderUpdated);
  useEffect(() => {
    onOrderUpdatedRef.current = onOrderUpdated;
  }, [onOrderUpdated]);

  // Subscribe to live Realtime updates + polling fallback
  useEffect(() => {
    const ref = currentOrder.orderReference;
    if (!ref) return;

    const unsubscribe = orderService.subscribeToOrder(ref, (updatedOrder) => {
      setCurrentOrder((prev) => ({
        ...updatedOrder,
        voiceNote: updatedOrder.voiceNote || prev.voiceNote
      }));
      setLastRefreshedAt(new Date());
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
        setLastRefreshedAt(new Date());
        if (onOrderUpdatedRef.current) {
          onOrderUpdatedRef.current(res.order);
        }
      }
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [currentOrder.orderReference, isRefreshing, onOrderUpdated]);

  // Copy order reference to clipboard
  const handleCopyReference = async () => {
    try {
      await navigator.clipboard.writeText(currentOrder.orderReference);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2200);
    } catch {
      // Fallback
    }
  };

  // Copy shareable tracking link to clipboard
  const handleCopyLink = async () => {
    try {
      const url = `${window.location.origin}/?ref=${encodeURIComponent(currentOrder.orderReference)}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
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

  // Sync comment draft when switching to a different order or receiving a saved comment from server
  useEffect(() => {
    setCommentDraft(currentOrder.customerComment || '');
    setIsEditingComment(!currentOrder.customerComment);
    setCommentFeedback(null);
  }, [currentOrder.orderReference]);

  useEffect(() => {
    if (currentOrder.customerComment && !isEditingComment) {
      setCommentDraft(currentOrder.customerComment);
    }
  }, [currentOrder.customerComment, isEditingComment]);

  const handleSaveComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentDraft.trim();
    if (!trimmed || isSavingComment) return;

    setIsSavingComment(true);
    setCommentFeedback(null);
    try {
      const res = await orderService.addOrderComment(
        currentOrder.orderReference,
        trimmed,
        currentOrder.customerPhone
      );
      if (res.success) {
        const savedText = res.customerComment || trimmed;
        const updated: Order = {
          ...currentOrder,
          customerComment: savedText,
          updatedAt: new Date().toISOString()
        };
        setCurrentOrder(updated);
        setCommentDraft(savedText);
        setIsEditingComment(false);
        setCommentFeedback({ type: 'success', text: 'Comment saved and shared with rider & admin.' });
        if (onOrderUpdatedRef.current) {
          onOrderUpdatedRef.current(updated);
        }
      } else {
        setCommentFeedback({ type: 'error', text: res.error || 'Could not save comment.' });
      }
    } catch (err: unknown) {
      const error = err as Error;
      setCommentFeedback({ type: 'error', text: error.message || 'Error saving comment.' });
    } finally {
      setIsSavingComment(false);
    }
  };

  // Timeline step calculation
  const getStepIndex = (status: Order['status']): number => {
    switch (status) {
      case 'pending':
        return 0; // Request Placed / Searching
      case 'assigned':
      case 'accepted':
        return 1; // Rider Assigned
      case 'completed':
        return 2; // Completed
      case 'cancelled':
        return -1; // Cancelled
      default:
        return 0;
    }
  };

  const stepIndex = getStepIndex(currentOrder.status);

  // Format Ghana phone for WhatsApp (e.g. 0245660622 -> 233245660622)
  const getWhatsAppLink = (phone?: string | null) => {
    if (!phone) return '#';
    const digits = phone.replace(/\D/g, '');
    const intl = digits.startsWith('0') ? `233${digits.slice(1)}` : digits;
    const text = encodeURIComponent(
      `Hello! I am tracking my Okada Book ride (${currentOrder.orderReference}).`
    );
    return `https://wa.me/${intl}?text=${text}`;
  };

  // Format timestamps nicely
  const formatTime = (iso?: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="tracker-container">
      {/* 1. Status Header Banner */}
      <div className={`tracker-status-hero status-hero-${currentOrder.status}`}>
        <div className="status-hero-top">
          <div className="status-badge-wrap">
            <span className={`status-pill status-${currentOrder.status}`}>
              {currentOrder.status === 'pending' && <span className="status-pulse-dot" />}
              {currentOrder.status === 'pending' && 'LOOKING FOR RIDER'}
              {currentOrder.status === 'accepted' && 'RIDER ON THE WAY'}
              {currentOrder.status === 'assigned' && 'RIDER ASSIGNED'}
              {currentOrder.status === 'completed' && 'RIDE COMPLETED'}
              {currentOrder.status === 'cancelled' && 'REQUEST CANCELLED'}
            </span>
          </div>

          <button
            type="button"
            className={`btn-tracker-refresh ${isRefreshing ? 'spinning' : ''}`}
            onClick={handleRefresh}
            title="Refresh order status"
            aria-label="Refresh status"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span className="refresh-label">Refresh</span>
          </button>
        </div>

        <div className="status-hero-content">
          <h2 className="status-hero-title">
            {currentOrder.status === 'pending' && 'Searching for Nearby Okada...'}
            {currentOrder.status === 'accepted' && 'Rider is on the way!'}
            {currentOrder.status === 'assigned' && 'Rider assigned to your request'}
            {currentOrder.status === 'completed' && 'Ride successfully completed!'}
            {currentOrder.status === 'cancelled' && 'This request was cancelled'}
          </h2>
          <p className="status-hero-sub">
            {currentOrder.status === 'pending' &&
              'We notified verified riders in your area. You will see their details as soon as one accepts!'}
            {currentOrder.status === 'accepted' &&
              'Your rider has accepted the ride and is riding to your pickup location.'}
            {currentOrder.status === 'completed' &&
              'Thank you for riding with Okada Book Ghana. Stay safe on the road!'}
            {currentOrder.status === 'cancelled' &&
              'This ride request was cancelled. You can book a new ride anytime.'}
          </p>
        </div>

        {/* Live sync pulse line */}
        <div className="tracker-live-pulse-bar" title="Auto-updating via Supabase Realtime">
          <span className="live-dot" />
          <span className="live-text">Live dispatch connected</span>
          <span className="last-sync-text">Updated {lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>

        {/* Push Notification opt-in banner */}
        <div className="tracker-push-alert-banner">
          {pushStatus === 'granted' ? (
            <div className="push-banner-granted">
              <span className="push-bell-icon">🔔</span>
              <span>Push alerts active on this device for <strong>{currentOrder.orderReference}</strong></span>
            </div>
          ) : pushStatus === 'loading' ? (
            <div className="push-banner-prompt">
              <span>Connecting notification service...</span>
            </div>
          ) : (
            <div className="push-banner-prompt">
              <span className="push-bell-icon">🔔</span>
              <span className="push-prompt-label">Get arrival alerts with sound when your rider accepts</span>
              <button
                type="button"
                className="btn-enable-push"
                onClick={handleEnablePush}
              >
                Enable Alerts
              </button>
            </div>
          )}
          {pushFeedback && <div className="push-feedback-text">{pushFeedback}</div>}

          {currentOrder.status === 'pending' && (
            <div className="tracker-retry-dispatch-wrap">
              <button
                type="button"
                className="btn-retry-dispatch"
                onClick={handleRetryNotification}
                disabled={isReAlerting}
              >
                {isReAlerting ? 'Re-alerting Nearby Riders...' : '🛵 Re-alert Nearby Riders'}
              </button>
              {reAlertFeedback && <span className="retry-feedback-text">{reAlertFeedback}</span>}
            </div>
          )}
        </div>
      </div>

      {/* 2. Visual Stepper / Progress Bar (Hide if cancelled) */}
      {currentOrder.status !== 'cancelled' && (
        <div className="tracker-stepper-card">
          <div className="stepper-track">
            {/* Step 1: Placed */}
            <div className={`stepper-node ${stepIndex >= 0 ? 'completed' : ''} ${stepIndex === 0 ? 'current' : ''}`}>
              <div className="node-icon">
                {stepIndex > 0 ? '✓' : '1'}
              </div>
              <div className="node-text">
                <span className="node-label">Placed</span>
                <span className="node-time">{formatTime(currentOrder.createdAt)}</span>
              </div>
            </div>

            <div className={`stepper-line ${stepIndex >= 1 ? 'filled' : ''}`} />

            {/* Step 2: Rider Assigned */}
            <div className={`stepper-node ${stepIndex >= 1 ? 'completed' : ''} ${stepIndex === 1 ? 'current' : ''}`}>
              <div className="node-icon">
                {stepIndex > 1 ? '✓' : '2'}
              </div>
              <div className="node-text">
                <span className="node-label">Assigned</span>
                <span className="node-time">{formatTime(currentOrder.acceptedAt)}</span>
              </div>
            </div>

            <div className={`stepper-line ${stepIndex >= 2 ? 'filled' : ''}`} />

            {/* Step 3: Completed */}
            <div className={`stepper-node ${stepIndex >= 2 ? 'completed' : ''} ${stepIndex === 2 ? 'current' : ''}`}>
              <div className="node-icon">
                {stepIndex >= 2 ? '✓' : '3'}
              </div>
              <div className="node-text">
                <span className="node-label">Completed</span>
                <span className="node-time">{formatTime(currentOrder.completedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Assigned Rider Card (Shown if accepted / assigned) */}
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
                <h3 className="rider-name">{currentOrder.riderName || 'Assigned Okada Rider'}</h3>
                <span className="rider-verified-badge" title="Official Verified Rider">✓ Verified</span>
              </div>
              {currentOrder.operatingArea && (
                <span className="rider-area-text">📍 {currentOrder.operatingArea}</span>
              )}
            </div>
          </div>

          {/* Motorcycle Details */}
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

          {/* Direct Communication Buttons */}
          {currentOrder.riderPhone && (
            <div className="rider-contact-actions">
              <a
                href={`tel:${currentOrder.riderPhone}`}
                className="btn-rider-action btn-rider-call"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z" />
                </svg>
                <span>Call Rider ({currentOrder.riderPhone})</span>
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

      {/* 4. Order Details & Reference Card */}
      <div className="tracker-details-card">
        <div className="details-header-row">
          <div className="ref-group">
            <span className="ref-label">Order Reference</span>
            <div className="ref-display-row">
              <span className="ref-code">{currentOrder.orderReference}</span>
              <button
                type="button"
                className="btn-copy-code"
                onClick={handleCopyReference}
                title="Copy reference code"
              >
                {copiedRef ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn-share-link"
            onClick={handleCopyLink}
            title="Copy direct tracking link to share"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>{copiedLink ? 'Link Copied!' : 'Share Link'}</span>
          </button>
        </div>

        <div className="details-grid">
          <div className="detail-item">
            <span className="item-label">Customer Contact:</span>
            <span className="item-value">{currentOrder.customerPhone}</span>
          </div>

          <div className="detail-item">
            <span className="item-label">Order Type:</span>
            <span className="item-value">
              {currentOrder.orderType === 'voice' ? '🎙️ Voice Note Ride' : '📝 Text Request'}
            </span>
          </div>

          <div className="detail-item">
            <span className="item-label">Time Placed:</span>
            <span className="item-value">
              {new Date(currentOrder.createdAt).toLocaleDateString([], {
                month: 'short',
                day: 'numeric'
              })}{' '}
              at {formatTime(currentOrder.createdAt)}
            </span>
          </div>
        </div>

        {/* Voice Note Audio or Text Description */}
        {currentOrder.orderType === 'voice' && (resolvedAudioUrl || currentOrder.voiceRecordingPath) && (
          <div className="tracker-audio-section">
            <span className="item-label">Recorded Audio Instructions:</span>
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
              <p className="tracker-text-body">Voice note unavailable right now.</p>
            )}
          </div>
        )}

        {currentOrder.requestDescription && (
          <div className="tracker-text-section">
            <span className="item-label">Destination / Ride Description:</span>
            <p className="tracker-text-body">{currentOrder.requestDescription}</p>
          </div>
        )}

        {/* Customer Comment / Note (Reflected in Rider & Admin Portals) */}
        <div className="tracker-comment-section">
          <div className="tracker-comment-header">
            <span className="item-label">💬 Add a Comment / Note for Rider &amp; Admin</span>
            {currentOrder.customerComment && !isEditingComment && (
              <button
                type="button"
                className="btn-edit-comment"
                onClick={() => {
                  setCommentDraft(currentOrder.customerComment || '');
                  setIsEditingComment(true);
                  setCommentFeedback(null);
                }}
              >
                Edit
              </button>
            )}
          </div>

          {!isEditingComment && currentOrder.customerComment ? (
            <p className="tracker-comment-display">{currentOrder.customerComment}</p>
          ) : (
            <form onSubmit={handleSaveComment} className="tracker-comment-form">
              <textarea
                className="tracker-comment-input"
                rows={2}
                maxLength={500}
                placeholder="e.g. I'm wearing a blue shirt by the pharmacy gate..."
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                disabled={isSavingComment}
              />
              <div className="tracker-comment-actions">
                <span className="tracker-comment-count">{commentDraft.length}/500</span>
                <div className="tracker-comment-btns">
                  {currentOrder.customerComment && (
                    <button
                      type="button"
                      className="btn-comment-cancel"
                      onClick={() => {
                        setCommentDraft(currentOrder.customerComment || '');
                        setIsEditingComment(false);
                        setCommentFeedback(null);
                      }}
                      disabled={isSavingComment}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn-comment-save"
                    disabled={isSavingComment || !commentDraft.trim()}
                  >
                    {isSavingComment ? 'Saving...' : currentOrder.customerComment ? 'Update Comment' : 'Save Comment'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {commentFeedback && (
            <div className={`tracker-comment-feedback ${commentFeedback.type}`} role="status">
              {commentFeedback.text}
            </div>
          )}
        </div>
      </div>

      {/* 5. Action Buttons (Cancel / Book Another / Track Another) */}
      <div className="tracker-bottom-actions">
        {currentOrder.status === 'pending' && (
          <button
            type="button"
            className="btn-tracker-cancel"
            onClick={() => setCancelModalOpen(true)}
          >
            Cancel Ride Request
          </button>
        )}

        {onBookAnother && (
          <button
            type="button"
            className="btn-tracker-secondary"
            onClick={onBookAnother}
          >
            Book Another Ride
          </button>
        )}

        {onTrackAnother && (
          <button
            type="button"
            className="btn-tracker-link"
            onClick={onTrackAnother}
          >
            Track a Different Order
          </button>
        )}
      </div>

      {/* 6. Cancel Confirmation Modal */}
      {cancelModalOpen && (
        <div className="tracker-modal-overlay" role="dialog" aria-modal="true">
          <div className="tracker-modal-card">
            <h3 className="modal-title">Cancel Ride Request?</h3>
            <p className="modal-text">
              Are you sure you want to cancel order <strong>{currentOrder.orderReference}</strong>? Nearby riders will no longer see this request.
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
                {isCancelling ? 'Cancelling...' : 'Yes, Cancel Ride'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
