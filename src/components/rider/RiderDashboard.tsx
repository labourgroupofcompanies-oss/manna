import React, { useState, useEffect, useCallback } from 'react';
import { riderService, supabase } from '../../services';
import type { RiderProfile, AvailableOrderSummary, ActiveRiderOrder, RiderMetrics } from '../../types';
import './RiderDashboard.css';

interface RiderDashboardProps {
  rider: RiderProfile;
  onLogout: () => void;
}

export const RiderDashboard: React.FC<RiderDashboardProps> = ({ rider, onLogout }) => {
  // Rider state
  const [isAvailable, setIsAvailable] = useState(rider.isAvailable);
  const [togglingAvailability, setTogglingAvailability] = useState(false);

  // Tabs: 'available' or 'active'
  const [activeTab, setActiveTab] = useState<'available' | 'active'>('available');

  // Orders data
  const [availableOrders, setAvailableOrders] = useState<AvailableOrderSummary[]>([]);
  const [activeOrders, setActiveOrders] = useState<ActiveRiderOrder[]>([]);
  const [metrics, setMetrics] = useState<RiderMetrics>({ todayCompletedCount: 0, todayAcceptedCount: 0 });

  // Action states
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Audio signed URLs cache (path -> url)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});

  // 1. Fetch Orders and Metrics
  const refreshDashboardData = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const [metricsData, activeData] = await Promise.all([
        riderService.getTodayMetrics(),
        riderService.getActiveOrders()
      ]);

      setMetrics(metricsData);
      setActiveOrders(activeData);

      // Only fetch available orders if rider is online
      if (isAvailable) {
        const availableData = await riderService.getAvailableOrders();
        setAvailableOrders(availableData);
      } else {
        setAvailableOrders([]);
      }
    } finally {
      setLoadingOrders(false);
    }
  }, [isAvailable]);

  // Initial load
  useEffect(() => {
    refreshDashboardData();
  }, [refreshDashboardData]);

  // 2. Real-time Subscription for Available Orders (Active only when online)
  useEffect(() => {
    if (!isAvailable || !supabase) return;

    // Listen to changes on the orders table
    const ordersChannel = supabase
      .channel('rider-available-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const newOrder = payload.new as Record<string, unknown>;
          if (newOrder.status === 'pending') {
            const orderSummary: AvailableOrderSummary = {
              id: newOrder.id as string,
              orderReference: newOrder.order_reference as string,
              orderType: newOrder.order_type as 'text' | 'voice',
              orderDescription: (newOrder.order_description as string) || null,
              voiceRecordingPath: (newOrder.voice_recording_path as string) || null,
              createdAt: (newOrder.created_at as string) || new Date().toISOString()
            };

            setAvailableOrders((prev) => [orderSummary, ...prev.filter((o) => o.id !== orderSummary.id)]);
            setActionFeedback({
              type: 'info',
              message: `🔔 New ride request available: ${orderSummary.orderReference}!`
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
          // If order is no longer pending, remove it from available orders list
          if (updated.status !== 'pending') {
            setAvailableOrders((prev) => prev.filter((o) => o.id !== updated.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
    };
  }, [isAvailable]);

  // 3. Handle Availability Toggle
  const handleToggleAvailability = async () => {
    if (togglingAvailability) return;
    setTogglingAvailability(true);
    setActionFeedback(null);

    const targetState = !isAvailable;
    const result = await riderService.toggleAvailability(targetState);

    setTogglingAvailability(false);

    if (result.success) {
      setIsAvailable(result.isAvailable);
      if (result.isAvailable) {
        setActionFeedback({
          type: 'success',
          message: 'You are now ONLINE. You will receive real-time ride requests.'
        });
      } else {
        setActionFeedback({
          type: 'info',
          message: 'You are now OFFLINE. Ride offers paused.'
        });
      }
    } else {
      setActionFeedback({
        type: 'error',
        message: result.error || 'Failed to update availability. Please try again.'
      });
    }
  };

  // 4. Handle Order Acceptance
  const handleAcceptOrder = async (orderId: string) => {
    if (processingOrderId) return;
    setProcessingOrderId(orderId);
    setActionFeedback(null);

    try {
      const result = await riderService.acceptOrder(orderId);

      if (!result.success || !result.order) {
        setActionFeedback({
          type: 'error',
          message: result.error || 'Could not accept order. It may have already been taken by another rider.'
        });
        // Remove from available list
        setAvailableOrders((prev) => prev.filter((o) => o.id !== orderId));
        return;
      }

      // Order accepted! Move to active orders
      const acceptedOrder = result.order;
      setAvailableOrders((prev) => prev.filter((o) => o.id !== orderId));
      setActiveOrders((prev) => [acceptedOrder, ...prev]);
      setActiveTab('active');
      setMetrics((prev) => ({
        ...prev,
        todayAcceptedCount: prev.todayAcceptedCount + 1
      }));

      setActionFeedback({
        type: 'success',
        message: `Ride ${acceptedOrder.orderReference} accepted! Customer contact is now available.`
      });
    } finally {
      setProcessingOrderId(null);
    }
  };

  // 5. Handle Complete Order
  const handleCompleteOrder = async (orderId: string) => {
    if (processingOrderId) return;
    setProcessingOrderId(orderId);
    setActionFeedback(null);

    try {
      const result = await riderService.completeOrder(orderId);

      if (!result.success) {
        setActionFeedback({
          type: 'error',
          message: result.error || 'Failed to complete order. Please try again.'
        });
        return;
      }

      // Mark order complete in state
      setActiveOrders((prev) => prev.filter((o) => o.id !== orderId));
      setMetrics((prev) => ({
        ...prev,
        todayCompletedCount: prev.todayCompletedCount + 1,
        todayAcceptedCount: Math.max(0, prev.todayAcceptedCount - 1)
      }));

      setActionFeedback({
        type: 'success',
        message: 'Ride successfully marked as completed! Excellent job.'
      });
    } finally {
      setProcessingOrderId(null);
    }
  };

  // 6. Audio Player Helper
  const loadAudioUrl = async (recordingPath: string) => {
    if (audioUrls[recordingPath]) return;
    const url = await riderService.getVoiceAudioUrl(recordingPath);
    if (url) {
      setAudioUrls((prev) => ({ ...prev, [recordingPath]: url }));
    }
  };

  return (
    <div className="rider-dashboard-container">
      {/* Top Rider Header */}
      <header className="rider-dash-header">
        <div className="rider-dash-profile">
          <div className="rider-avatar-wrap">
            {rider.profilePhotoUrl ? (
              <img src={rider.profilePhotoUrl} alt={rider.fullName} className="rider-avatar-img" />
            ) : (
              <div className="rider-avatar-placeholder">🏍️</div>
            )}
          </div>
          <div className="rider-identity">
            <h2 className="rider-welcome-name">Akwaaba, {(rider.fullName || 'Rider').split(' ')[0]}!</h2>
            <p className="rider-bike-meta">
              {rider.motorcycleModel} &bull; <span className="plate-badge">{rider.motorcycleRegistration}</span>
            </p>
            <p className="rider-area-meta">📍 {rider.operatingArea}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="btn-rider-logout"
          aria-label="Log out of rider session"
        >
          Logout
        </button>
      </header>

      {/* Large Tactile Availability Switch */}
      <div className={`availability-control-box ${isAvailable ? 'online' : 'offline'}`}>
        <div className="availability-info">
          <div className="status-indicator-dot" aria-hidden="true" />
          <div>
            <span className="availability-status-label">
              {isAvailable ? 'YOU ARE ONLINE' : 'YOU ARE OFFLINE'}
            </span>
            <p className="availability-desc">
              {isAvailable
                ? 'Ready to accept customer ride requests.'
                : 'Turn switch on to start receiving requests.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={isAvailable}
          disabled={togglingAvailability}
          onClick={handleToggleAvailability}
          className={`toggle-switch-btn ${isAvailable ? 'active' : ''}`}
          aria-label="Toggle Online/Offline Status"
        >
          <span className="toggle-switch-handle" />
        </button>
      </div>

      {/* Daily Metrics Cards */}
      <div className="rider-metrics-grid">
        <div className="metric-card">
          <span className="metric-value">{metrics.todayCompletedCount}</span>
          <span className="metric-label">Completed Today</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{activeOrders.length}</span>
          <span className="metric-label">Active Rides</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{availableOrders.length}</span>
          <span className="metric-label">Available Near You</span>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionFeedback && (
        <div className={`dash-feedback-alert ${actionFeedback.type}`} role="alert">
          <span className="feedback-icon" aria-hidden="true">
            {actionFeedback.type === 'success' ? '✓' : actionFeedback.type === 'error' ? '⚠️' : 'ℹ️'}
          </span>
          <p>{actionFeedback.message}</p>
        </div>
      )}

      {/* Navigation Tabs between Available & Active Orders */}
      <div className="dash-orders-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'available'}
          className={`dash-tab-btn ${activeTab === 'available' ? 'active' : ''}`}
          onClick={() => setActiveTab('available')}
        >
          <span>Available Requests</span>
          {availableOrders.length > 0 && isAvailable && (
            <span className="tab-badge">{availableOrders.length}</span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'active'}
          className={`dash-tab-btn ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          <span>My Active Rides</span>
          {activeOrders.length > 0 && (
            <span className="tab-badge highlight">{activeOrders.length}</span>
          )}
        </button>
      </div>

      {/* TAB 1: AVAILABLE ORDERS */}
      {activeTab === 'available' && (
        <div className="orders-stream-section">
          {!isAvailable ? (
            <div className="empty-state-box">
              <span className="empty-icon" aria-hidden="true">🛑</span>
              <h3>You are currently Offline</h3>
              <p>Turn on your availability switch above to receive live customer requests across your operating area.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleToggleAvailability}
              >
                Go Online Now
              </button>
            </div>
          ) : loadingOrders && availableOrders.length === 0 ? (
            <div className="empty-state-box">
              <span className="empty-icon spinner-icon" aria-hidden="true">⏳</span>
              <p>Scanning for nearby ride requests...</p>
            </div>
          ) : availableOrders.length === 0 ? (
            <div className="empty-state-box">
              <span className="empty-icon" aria-hidden="true">🏍️</span>
              <h3>No Ride Requests Available</h3>
              <p>Standing by for new orders. The dispatch terminal will alert you immediately when a customer submits a request.</p>
              <button
                type="button"
                className="btn btn-outline"
                onClick={refreshDashboardData}
              >
                Refresh Feed
              </button>
            </div>
          ) : (
            <div className="orders-cards-list">
              {availableOrders.map((order) => (
                <div key={order.id} className="available-order-card">
                  <div className="order-card-header">
                    <span className="order-ref-pill">{order.orderReference}</span>
                    <span className="order-time-meta">
                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="order-type-indicator">
                    {order.orderType === 'voice' ? (
                      <span className="type-badge voice">🎙️ Voice Note Request</span>
                    ) : (
                      <span className="type-badge text">📝 Text Request</span>
                    )}
                  </div>

                  {order.orderType === 'text' && (
                    <div className="order-desc-body">
                      <p>{order.orderDescription}</p>
                    </div>
                  )}

                  {order.orderType === 'voice' && order.voiceRecordingPath && (
                    <div className="order-voice-playback">
                      {audioUrls[order.voiceRecordingPath] ? (
                        <audio src={audioUrls[order.voiceRecordingPath]} controls className="voice-audio-ctrl" />
                      ) : (
                        <button
                          type="button"
                          className="btn-listen-voice"
                          onClick={() => loadAudioUrl(order.voiceRecordingPath!)}
                        >
                          ▶ Listen to Customer Request
                        </button>
                      )}
                    </div>
                  )}

                  {/* Accept Order Action */}
                  <button
                    type="button"
                    disabled={processingOrderId === order.id}
                    onClick={() => handleAcceptOrder(order.id)}
                    className="btn btn-primary btn-full-width btn-accept-order"
                  >
                    {processingOrderId === order.id ? 'Securing Order...' : 'ACCEPT ORDER'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ACTIVE ORDERS */}
      {activeTab === 'active' && (
        <div className="orders-stream-section">
          {activeOrders.length === 0 ? (
            <div className="empty-state-box">
              <span className="empty-icon" aria-hidden="true">📋</span>
              <h3>No Active Rides</h3>
              <p>You have no pending rides assigned. Switch to Available Requests to accept a new customer trip.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setActiveTab('available')}
              >
                View Available Requests
              </button>
            </div>
          ) : (
            <div className="orders-cards-list">
              {activeOrders.map((order) => (
                <div key={order.id} className="active-order-card">
                  <div className="order-card-header">
                    <div>
                      <span className="order-ref-pill">{order.orderReference}</span>
                      <span className="status-badge-accepted">ASSIGNED TO YOU</span>
                    </div>
                    <span className="order-time-meta">
                      Accepted: {new Date(order.acceptedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Customer Contact Information (Only visible after assignment) */}
                  <div className="customer-contact-reveal-box">
                    <span className="reveal-label">Customer Contact:</span>
                    <a href={`tel:${order.customerPhone}`} className="btn-call-customer">
                      <span className="call-phone-icon">📞</span>
                      <span>Call {order.customerPhone}</span>
                    </a>
                  </div>

                  {/* Destination / Request Content */}
                  <div className="active-order-content">
                    <span className="content-label">Trip Request Details:</span>
                    {order.orderType === 'text' ? (
                      <p className="order-desc-body">{order.orderDescription}</p>
                    ) : order.voiceRecordingPath ? (
                      <div className="order-voice-playback">
                        {audioUrls[order.voiceRecordingPath] ? (
                          <audio src={audioUrls[order.voiceRecordingPath]} controls className="voice-audio-ctrl" />
                        ) : (
                          <button
                            type="button"
                            className="btn-listen-voice"
                            onClick={() => loadAudioUrl(order.voiceRecordingPath!)}
                          >
                            ▶ Listen to Voice Note
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="order-desc-body">Voice Note Request</p>
                    )}
                  </div>

                  {/* Mark Completed Button */}
                  <button
                    type="button"
                    disabled={processingOrderId === order.id}
                    onClick={() => handleCompleteOrder(order.id)}
                    className="btn btn-accent btn-full-width btn-complete-order"
                  >
                    {processingOrderId === order.id ? 'Updating Trip...' : '✓ Complete Ride'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
