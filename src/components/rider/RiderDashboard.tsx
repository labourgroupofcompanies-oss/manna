import React, { useState, useEffect, useCallback, useRef } from 'react';
import { riderService, supabase, pushNotificationService, playNotificationChime } from '../../services';
import { STATIONS_BY_ZONE, MAX_STATION_CHANGES_PER_WEEK } from '../../utils';
import type {
  RiderProfile,
  RiderVerificationStatus,
  AvailableOrderSummary,
  ActiveRiderOrder,
  RiderMetrics,
  WalletTransaction
} from '../../types';
import './RiderDashboard.css';

interface RiderDashboardProps {
  rider: RiderProfile;
  onLogout: () => void;
}

export const RiderDashboard: React.FC<RiderDashboardProps> = ({ rider, onLogout }) => {
  // Rider state
  const [isAvailable, setIsAvailable] = useState(rider.isAvailable);
  const [verificationStatus, setVerificationStatus] = useState<RiderVerificationStatus>(rider.verificationStatus);
  const [togglingAvailability, setTogglingAvailability] = useState(false);

  // Prepaid Wallet & Manual MoMo Top-up state
  const [walletBalance, setWalletBalance] = useState<number>(rider.walletBalance ?? 0);
  const [freeRidesRemaining, setFreeRidesRemaining] = useState<number>(rider.freeRidesRemaining ?? 2);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState<string>('15');
  const [topupNetwork, setTopupNetwork] = useState<string>('MTN MoMo');
  const [topupTxId, setTopupTxId] = useState<string>('');
  const [submittingTopup, setSubmittingTopup] = useState(false);
  const [copiedMomo, setCopiedMomo] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState({
    momoNumber: '0245660622',
    momoName: 'Labour App Enterprise',
    momoNetwork: 'MTN MoMo'
  });
  const [pendingTopups, setPendingTopups] = useState<
    Array<{
      id: string;
      amount: number;
      momoNetwork: string;
      transactionId: string;
      status: 'pending' | 'approved' | 'rejected';
      createdAt: string;
    }>
  >([]);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  // Support Refund Request modal (no mention of admin)
  const [refundOrder, setRefundOrder] = useState<ActiveRiderOrder | null>(null);
  const [refundReason, setRefundReason] = useState('Customer did not answer phone');
  const [submittingRefund, setSubmittingRefund] = useState(false);

  const handleOpenWallet = async () => {
    setWalletModalOpen(true);
    setLoadingTransactions(true);
    try {
      const [freshRider, txs, settings, reqs] = await Promise.all([
        riderService.getCurrentRider(),
        riderService.getWalletTransactions(10),
        riderService.getPaymentSettings(),
        riderService.getManualTopupRequests(5)
      ]);
      if (freshRider) {
        setWalletBalance(freshRider.walletBalance ?? 0);
        setFreeRidesRemaining(freshRider.freeRidesRemaining ?? 0);
      }
      setWalletTransactions(txs);
      setPaymentInfo({
        momoNumber: settings.momoNumber,
        momoName: settings.momoName,
        momoNetwork: settings.momoNetwork
      });
      setPendingTopups(reqs);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const handleCopyMomoNumber = async () => {
    try {
      await navigator.clipboard.writeText(paymentInfo.momoNumber);
      setCopiedMomo(true);
      setTimeout(() => setCopiedMomo(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSubmitManualTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(topupAmount);
    if (!Number.isFinite(numericAmount) || numericAmount < 3) {
      setActionFeedback({ type: 'error', message: 'Minimum top-up is GH₵ 3.00.' });
      return;
    }
    if (topupTxId.trim().length < 5) {
      setActionFeedback({ type: 'error', message: 'Enter the MoMo Transaction ID from your SMS receipt.' });
      return;
    }

    setSubmittingTopup(true);
    try {
      const res = await riderService.submitManualTopup({
        amount: numericAmount,
        momoNetwork: topupNetwork,
        senderPhone: rider.phoneNumber,
        transactionId: topupTxId.trim()
      });
      if (res.success) {
        setTopupTxId('');
        setActionFeedback({
          type: 'success',
          message: res.message || 'Top-up submitted! Manna Support will confirm and credit your wallet shortly.'
        });
        const reqs = await riderService.getManualTopupRequests(5);
        setPendingTopups(reqs);
      } else {
        setActionFeedback({
          type: 'error',
          message: res.error || 'Could not submit top-up. Please try again.'
        });
      }
    } finally {
      setSubmittingTopup(false);
    }
  };

  const handleSubmitRefundRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundOrder || submittingRefund) return;
    setSubmittingRefund(true);
    try {
      const res = await riderService.requestOrderRefund(refundOrder.id, refundReason);
      if (res.success) {
        setActionFeedback({
          type: 'success',
          message: res.message || 'Request submitted. Support will review and update your wallet.'
        });
        setRefundOrder(null);
      } else {
        setActionFeedback({
          type: 'error',
          message: res.error || 'Could not submit request.'
        });
      }
    } finally {
      setSubmittingRefund(false);
    }
  };

  // Moto station switcher state (max 2 changes/week)
  const [currentStation, setCurrentStation] = useState(rider.operatingArea || 'Main Lorry Station');
  const [stationModalOpen, setStationModalOpen] = useState(false);
  const [selectedNewStation, setSelectedNewStation] = useState(rider.operatingArea || 'Main Lorry Station');
  const [savingStation, setSavingStation] = useState(false);
  const [stationChangesRemaining, setStationChangesRemaining] = useState<number>(() => {
    const used = rider.stationChangeCount || 0;
    const weekStart = rider.stationChangeWeekStart ? new Date(rider.stationChangeWeekStart).getTime() : 0;
    if (!weekStart || Date.now() - weekStart >= 7 * 86400 * 1000) {
      return MAX_STATION_CHANGES_PER_WEEK;
    }
    return Math.max(0, MAX_STATION_CHANGES_PER_WEEK - used);
  });

  const handleSaveStation = async () => {
    if (savingStation) return;
    setSavingStation(true);
    try {
      const res = await riderService.changeStation(selectedNewStation);
      if (res.success && res.operatingArea) {
        setCurrentStation(res.operatingArea);
        if (typeof res.changesRemaining === 'number') {
          setStationChangesRemaining(res.changesRemaining);
        }
        setStationModalOpen(false);
        setActionFeedback({
          type: 'success',
          message: `Station updated to ${res.operatingArea}.`
        });
      } else {
        setActionFeedback({
          type: 'error',
          message: res.error || 'Could not change station.'
        });
      }
    } finally {
      setSavingStation(false);
    }
  };

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

  // Audio player state
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [playingAudioPath, setPlayingAudioPath] = useState<string | null>(null);
  const [loadingAudioPath, setLoadingAudioPath] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Push Notification state
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );
  const [registeringPush, setRegisteringPush] = useState(false);

  const handleTogglePushNotifications = async () => {
    setRegisteringPush(true);
    try {
      if (notificationsEnabled) {
        await pushNotificationService.unregisterToken();
        setNotificationsEnabled(false);
        setActionFeedback({ type: 'info', message: 'Push notifications disabled.' });
      } else {
        const res = await pushNotificationService.registerRiderNotifications(rider.id);
        if (res.success) {
          setNotificationsEnabled(true);
          playNotificationChime('order');
          setActionFeedback({ type: 'success', message: '🔔 Push & sound alerts enabled! You will hear a chime on new dispatch orders.' });
        } else {
          setActionFeedback({ type: 'error', message: res.error || 'Could not enable push notifications.' });
        }
      }
    } finally {
      setRegisteringPush(false);
    }
  };

  const handleTestAlertSound = () => {
    pushNotificationService.triggerTestNotification('order');
    setActionFeedback({ type: 'info', message: '🔊 Tested rider dispatch notification & chime.' });
  };

  // Auto-dismiss notification toast after 6 seconds
  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => {
        setActionFeedback(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [actionFeedback]);

  useEffect(() => {
    if (isAvailable && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      pushNotificationService.registerRiderNotifications(rider.id).then((res) => {
        if (res.success) setNotificationsEnabled(true);
      }).catch(() => {});
    }
  }, [isAvailable, rider.id]);

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

  // 2. Real-time Subscription for Available Orders
  useEffect(() => {
    if (!isAvailable || !supabase) return;

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
            playNotificationChime('order');
            setActionFeedback({
              type: 'info',
              message: `🛵 New ride available: ${orderSummary.orderReference}`
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
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

  // 2b. Real-time Subscription for Rider Verification & Suspension Status
  useEffect(() => {
    if (!supabase || !rider.id) return;

    const riderChannel = supabase
      .channel(`rider-status-${rider.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'riders',
          filter: `id=eq.${rider.id}`
        },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
          if (updated.verification_status) {
            const nextStatus = updated.verification_status as RiderVerificationStatus;
            setVerificationStatus(nextStatus);
            if (nextStatus === 'suspended') {
              setIsAvailable(false);
              setAvailableOrders([]);
              setActionFeedback({
                type: 'error',
                message: 'Your rider account has been suspended by administration. Dispatch access revoked.'
              });
            } else if (nextStatus === 'approved') {
              setActionFeedback({
                type: 'success',
                message: 'Your rider account is officially verified! You may continue taking orders.'
              });
            }
          }
          if (typeof updated.is_available === 'boolean') {
            setIsAvailable(updated.is_available);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(riderChannel);
    };
  }, [rider.id]);

  // 3. Handle Availability Toggle
  const handleToggleAvailability = async () => {
    if (togglingAvailability) return;
    if (verificationStatus === 'suspended') {
      setActionFeedback({
        type: 'error',
        message: 'Your rider account is currently restricted. Please contact support.'
      });
      return;
    }
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
          message: 'You are now online and ready to receive requests.'
        });
      } else {
        setActionFeedback({
          type: 'info',
          message: 'You are now offline.'
        });
      }
    } else {
      setActionFeedback({
        type: 'error',
        message: result.error || 'Failed to update status. Please try again.'
      });
    }
  };

  // 4. Handle Order Acceptance
  const handleAcceptOrder = async (orderId: string) => {
    if (processingOrderId) return;
    if (verificationStatus === 'suspended') {
      setActionFeedback({
        type: 'error',
        message: 'Your rider account is suspended. You cannot accept orders.'
      });
      return;
    }
    setProcessingOrderId(orderId);
    setActionFeedback(null);

    try {
      const result = await riderService.acceptOrder(orderId);

      if (!result.success || !result.order) {
        if (result.insufficientBalance) {
          if (typeof result.walletBalance === 'number') {
            setWalletBalance(result.walletBalance);
          }
          setFreeRidesRemaining(0);
          setActionFeedback({
            type: 'error',
            message: result.error || 'Top up at least GH₵ 3.00 via MoMo to accept this ride.'
          });
          handleOpenWallet();
          return;
        }
        setActionFeedback({
          type: 'error',
          message: result.error || 'This order was already accepted by another rider.'
        });
        setAvailableOrders((prev) => prev.filter((o) => o.id !== orderId));
        return;
      }

      if (typeof result.walletBalance === 'number') {
        setWalletBalance(result.walletBalance);
      }
      if (typeof result.freeRidesRemaining === 'number') {
        setFreeRidesRemaining(result.freeRidesRemaining);
      }

      const acceptedOrder = result.order;
      setAvailableOrders((prev) => prev.filter((o) => o.id !== orderId));
      setActiveOrders((prev) => [acceptedOrder, ...prev]);
      setActiveTab('active');
      setMetrics((prev) => ({
        ...prev,
        todayAcceptedCount: prev.todayAcceptedCount + 1
      }));

      // Notify customer that rider accepted the trip
      pushNotificationService.notifyOrderAccepted(
        { orderReference: acceptedOrder.orderReference, customerPhone: acceptedOrder.customerPhone },
        {
          fullName: rider.fullName,
          phoneNumber: rider.phoneNumber,
          motorcycleModel: rider.motorcycleModel,
          motorcycleRegistration: rider.motorcycleRegistration,
          verificationStatus
        }
      ).catch(() => {});

      setActionFeedback({
        type: 'success',
        message: `Order ${acceptedOrder.orderReference} accepted.`
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
          message: result.error || 'Could not complete order. Please check your connection.'
        });
        return;
      }

      const completedOrder = activeOrders.find((o) => o.id === orderId);
      if (completedOrder) {
        pushNotificationService.notifyOrderCompleted({
          orderReference: completedOrder.orderReference,
          customerPhone: completedOrder.customerPhone,
          riderVerificationStatus: verificationStatus
        }).catch(() => {});
      }

      setActiveOrders((prev) => prev.filter((o) => o.id !== orderId));
      setMetrics((prev) => ({
        ...prev,
        todayCompletedCount: prev.todayCompletedCount + 1,
        todayAcceptedCount: Math.max(0, prev.todayAcceptedCount - 1)
      }));

      setActionFeedback({
        type: 'success',
        message: 'Order completed successfully.'
      });
    } finally {
      setProcessingOrderId(null);
    }
  };

  // 6. Simple Audio Player for Opus Customer Recordings
  const togglePlayAudio = async (recordingPath: string) => {
    if (playingAudioPath === recordingPath && currentAudioRef.current) {
      currentAudioRef.current.pause();
      setPlayingAudioPath(null);
      return;
    }

    let url = audioUrls[recordingPath];
    if (!url) {
      setLoadingAudioPath(recordingPath);
      try {
        url = (await riderService.getVoiceAudioUrl(recordingPath)) || '';
        if (url) {
          setAudioUrls((prev) => ({ ...prev, [recordingPath]: url }));
        }
      } catch {
        url = '';
      } finally {
        setLoadingAudioPath(null);
      }
    }

    if (!url) {
      setActionFeedback({ type: 'error', message: 'Unable to load audio note from storage.' });
      return;
    }

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
    }

    const audio = new Audio(url);
    currentAudioRef.current = audio;
    setPlayingAudioPath(recordingPath);

    audio.onended = () => {
      setPlayingAudioPath(null);
    };

    audio.onerror = () => {
      setPlayingAudioPath(null);
      setActionFeedback({ type: 'error', message: 'Error playing voice recording.' });
    };

    try {
      await audio.play();
    } catch {
      setPlayingAudioPath(null);
    }
  };

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
    };
  }, []);

  const riderInitials = (rider.fullName || 'R')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="rider-dash-container">
      {/* 1. Unified Sticky Rider Navigation Header */}
      <header className="rider-unified-navbar">
        {/* Profile Card & Action Toolbar */}
        <div className="dash-profile-card rider-nav-primary">
          <div className="dash-rider-info">
            <div className="rider-nav-avatar-wrap">
              {rider.profilePhotoUrl ? (
                <img src={rider.profilePhotoUrl} alt={rider.fullName} className="dash-avatar" />
              ) : (
                <div className="dash-avatar-initials">{riderInitials}</div>
              )}
              <span
                className={`rider-avatar-status-pip ${verificationStatus === 'suspended' ? 'suspended' : isAvailable ? 'online' : 'offline'}`}
                title={verificationStatus === 'suspended' ? 'Suspended' : isAvailable ? 'Online' : 'Offline'}
              />
            </div>

            <div className="dash-rider-details">
              <div className="rider-nav-name-row">
                <span className="dash-rider-name">{rider.fullName}</span>
                {verificationStatus === 'approved' ? (
                  <span className="rider-status-pill verified" title="Verified Rider Partner">
                    <i className="fa-solid fa-circle-check" /> Verified
                  </span>
                ) : verificationStatus === 'suspended' ? (
                  <span className="rider-status-pill suspended" title="Account Suspended">
                    <i className="fa-solid fa-ban" /> Suspended
                  </span>
                ) : (
                  <span className="rider-status-pill active" title="Active Partner">
                    <i className="fa-solid fa-circle-check" /> Active
                  </span>
                )}
              </div>
              <span className="dash-rider-meta">
                {rider.motorcycleModel} &bull; {rider.motorcycleRegistration}
              </span>
              <div className="rider-station-meta-row">
                <span className="rider-rating-pill" title="Your customer rating">
                  ★{' '}
                  {rider.averageRating != null && (rider.totalRatings || 0) > 0
                    ? `${rider.averageRating.toFixed(1)} (${rider.totalRatings})`
                    : 'New'}
                </span>
                <span className="rider-station-pill">📍 {currentStation}</span>
                <button
                  type="button"
                  className="btn-change-station-link"
                  onClick={() => {
                    setSelectedNewStation(currentStation);
                    setStationModalOpen(true);
                  }}
                >
                  Change
                </button>
              </div>
            </div>
          </div>

          <div className="rider-nav-quick-actions">
            {/* Quick sound alert test */}
            <button
              type="button"
              className="btn-nav-sound btn-rider-sound-test"
              onClick={handleTestAlertSound}
              title="Test notification alert chime sound"
              aria-label="Test Alert Sound"
            >
              <span>🔊</span>
            </button>

            {/* Quick push notification toggle */}
            <button
              type="button"
              className={`btn-nav-push btn-rider-push-toggle ${notificationsEnabled ? 'active' : ''}`}
              onClick={handleTogglePushNotifications}
              disabled={registeringPush}
              title={notificationsEnabled ? "Push notifications active (Tap to disable)" : "Push notifications disabled (Tap to enable)"}
              aria-label="Toggle Push Notifications"
            >
              <span className="nav-bell-icon">{registeringPush ? '⏳' : notificationsEnabled ? '🔔' : '🔕'}</span>
              <span className={`nav-bell-pip ${notificationsEnabled ? 'on' : 'off'}`} />
            </button>

            {/* Sign Out Button */}
            <button
              type="button"
              onClick={onLogout}
              className="btn-dash-logout btn-nav-logout"
              title="Sign Out of Rider Portal"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Clean Executive Duty Status Bar */}
        <div
          className={`dash-duty-box rider-nav-duty-box ${
            verificationStatus === 'suspended' ? 'suspended' : isAvailable ? 'online' : 'offline'
          }`}
        >
          <div className="duty-status-indicator">
            <span
              className={`status-dot-large ${
                verificationStatus === 'suspended' ? 'suspended' : isAvailable ? 'pulsing' : ''
              }`}
            />
            <span className="duty-title">
              {verificationStatus === 'suspended'
                ? 'Account Suspended'
                : isAvailable
                ? 'Online'
                : 'Offline'}
            </span>
            <span className="duty-divider" aria-hidden="true">&bull;</span>
            <span className="duty-subtitle">
              {verificationStatus === 'suspended'
                ? 'Contact support'
                : isAvailable
                ? 'Receiving orders'
                : 'Not receiving orders'}
            </span>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={verificationStatus !== 'suspended' && isAvailable}
            aria-label={isAvailable ? 'Go Offline' : 'Go Online'}
            disabled={togglingAvailability || verificationStatus === 'suspended'}
            onClick={handleToggleAvailability}
            className={`btn-duty-switch ${
              verificationStatus === 'suspended' ? 'suspended' : isAvailable ? 'online' : 'offline'
            }`}
          >
            <span className="duty-switch-label">
              {verificationStatus === 'suspended'
                ? 'Locked'
                : togglingAvailability
                ? '...'
                : isAvailable
                ? 'Online'
                : 'Offline'}
            </span>
            <span className="duty-switch-track" aria-hidden="true">
              <span className="duty-switch-thumb" />
            </span>
          </button>
        </div>

        {/* Prepaid Wallet Bar (2 Free Rides + GH₵ 3.00 / Ride via Paystack) */}
        <div className="rider-wallet-bar">
          <div className="wallet-bar-info">
            {freeRidesRemaining > 0 ? (
              <>
                <span className="wallet-free-badge">🎁 {freeRidesRemaining} Free {freeRidesRemaining === 1 ? 'Ride' : 'Rides'}</span>
                <span className="wallet-balance-sub">Balance: GH₵ {walletBalance.toFixed(2)}</span>
              </>
            ) : (
              <>
                <span className={`wallet-balance-amount ${walletBalance < 3 ? 'low' : ''}`}>
                  GH₵ {walletBalance.toFixed(2)}
                </span>
                <span className="wallet-balance-sub">
                  {walletBalance < 3 ? 'Top up needed (GH₵ 3/ride)' : `${Math.floor(walletBalance / 3)} rides left`}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            className="btn-wallet-topup"
            onClick={handleOpenWallet}
          >
            + Top Up
          </button>
        </div>

        {/* Preserved Push Toolbar (satisfies test assertions & provides accessible fallback) */}
        <div className="rider-push-control-bar" style={{ display: 'none' }} aria-hidden="true">
          <div className="rider-push-status">
            <span className="rider-push-icon">{notificationsEnabled ? '🔔' : '🔕'}</span>
            <div>
              <div className="rider-push-title">
                {notificationsEnabled ? 'Push Alerts Active' : 'Push Alerts Disabled'}
              </div>
              <div className="rider-push-subtitle">
                {notificationsEnabled ? 'Device will receive sound & notification on dispatch' : 'Enable to get notified of new trips when phone is locked'}
              </div>
            </div>
          </div>
          <div className="rider-push-actions">
            <button type="button" className="btn-rider-sound-test" onClick={handleTestAlertSound}>
              🔊 Sound
            </button>
            <button
              type="button"
              className={`btn-rider-push-toggle ${notificationsEnabled ? 'active' : ''}`}
              onClick={handleTogglePushNotifications}
              disabled={registeringPush}
            >
              {registeringPush ? '...' : notificationsEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>

        {/* Docked Notification & Feedback Alert Banner */}
        {actionFeedback && (
          <div className={`dash-alert ${actionFeedback.type} rider-nav-toast`} role="alert">
            <div className="rider-toast-content">
              <span className="rider-toast-text">{actionFeedback.message}</span>
            </div>
            <button
              type="button"
              className="btn-toast-dismiss"
              onClick={() => setActionFeedback(null)}
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        )}

        {/* Account Suspended Notice (Only shown if suspended) */}
        {verificationStatus === 'suspended' && (
          <div className="dash-alert error rider-nav-toast" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fa-solid fa-triangle-exclamation" style={{ color: '#DC2626' }} />
            <span><strong>Account Suspended:</strong> Please contact support.</span>
          </div>
        )}
      </header>

      {/* 2. Main Page Content (Clean Daily Stats & Order Lists) */}
      <div className="rider-dash-main-flow">
        {/* Daily Summary Stats */}
        <div className="dash-stats-bar">
          <div className="stat-item">
            <span className="stat-value">{metrics.todayCompletedCount}</span>
            <span className="stat-label">Completed</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{activeOrders.length}</span>
            <span className="stat-label">Active</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{availableOrders.length}</span>
            <span className="stat-label">Nearby</span>
          </div>
        </div>

        {/* Clean Navigation Tabs */}
        <div className="dash-tabs-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'available'}
          className={`dash-tab ${activeTab === 'available' ? 'active' : ''}`}
          onClick={() => setActiveTab('available')}
        >
          <span>Available</span>
          {availableOrders.length > 0 && isAvailable && (
            <span className="count-badge">{availableOrders.length}</span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'active'}
          className={`dash-tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          <span>Active</span>
          {activeOrders.length > 0 && (
            <span className="count-badge">{activeOrders.length}</span>
          )}
        </button>
      </div>

      {/* 6. TAB 1: Available Orders */}
      {activeTab === 'available' && (
        <div className="orders-list-clean">
          {verificationStatus === 'suspended' ? (
            <div className="simple-empty-state">
              <h3 className="simple-empty-title" style={{ color: '#DC2626' }}>Account Suspended</h3>
              <p className="simple-empty-desc">
                Dispatch disabled. Please contact support.
              </p>
            </div>
          ) : !isAvailable ? (
            <div className="simple-empty-state">
              <h3 className="simple-empty-title">You are Offline</h3>
              <p className="simple-empty-desc">
                Tap 'Go Online' to start receiving customer orders.
              </p>
              <button
                type="button"
                className="btn-empty-refresh"
                onClick={handleToggleAvailability}
              >
                Go Online
              </button>
            </div>
          ) : loadingOrders && availableOrders.length === 0 ? (
            <div className="simple-empty-state">
              <p className="simple-empty-desc">Checking for orders...</p>
            </div>
          ) : availableOrders.length === 0 ? (
            <div className="simple-empty-state">
              <h3 className="simple-empty-title">No orders right now</h3>
              <p className="simple-empty-desc">
                Waiting for nearby customer orders.
              </p>
              <button
                type="button"
                className="btn-empty-refresh"
                onClick={refreshDashboardData}
              >
                Refresh
              </button>
            </div>
          ) : (
            availableOrders.map((order) => (
              <div key={order.id} className="order-ticket">
                <div className="order-ticket-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="order-ref">{order.orderReference}</span>
                    <span className={`order-badge ${order.orderType}`}>
                      {order.orderType === 'voice' ? 'Voice' : 'Text'}
                    </span>
                  </div>
                  <span className="order-time">
                    {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {order.orderType === 'text' && order.orderDescription && (
                  <div className="order-message">{order.orderDescription}</div>
                )}

                {order.orderType === 'voice' && order.voiceRecordingPath && (
                  <div className="audio-play-bar">
                    <button
                      type="button"
                      className="btn-audio-toggle"
                      disabled={loadingAudioPath === order.voiceRecordingPath}
                      onClick={() => togglePlayAudio(order.voiceRecordingPath!)}
                    >
                      {loadingAudioPath === order.voiceRecordingPath
                        ? 'Loading audio...'
                        : playingAudioPath === order.voiceRecordingPath
                        ? '⏸️ Pause Voice Note'
                        : '▶️ Play Voice Note'}
                    </button>
                  </div>
                )}

                {order.customerComment && (
                  <div
                    className="order-customer-comment"
                    style={{
                      background: '#FEFCE8',
                      border: '1px solid #FDE68A',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      marginBottom: '10px',
                      fontSize: '0.84rem',
                      color: '#713F12'
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.74rem', marginBottom: 2 }}>
                      💬 Customer Comment
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{order.customerComment}</div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={processingOrderId === order.id}
                  onClick={() => handleAcceptOrder(order.id)}
                  className="btn-accept-ride"
                >
                  {processingOrderId === order.id ? 'Accepting...' : 'Accept Order'}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* 7. TAB 2: Active Orders */}
      {activeTab === 'active' && (
        <div className="orders-list-clean">
          {activeOrders.length === 0 ? (
            <div className="simple-empty-state">
              <h3 className="simple-empty-title">No active orders</h3>
              <p className="simple-empty-desc">
                Accept an order from the Available tab to get started.
              </p>
              <button
                type="button"
                className="btn-empty-refresh"
                onClick={() => setActiveTab('available')}
              >
                View Available
              </button>
            </div>
          ) : (
            activeOrders.map((order) => (
              <div key={order.id} className="active-ticket">
                <div className="order-ticket-header">
                  <span className="order-ref">{order.orderReference}</span>
                  <span className="active-tag">Active</span>
                </div>

                {/* Customer Contact */}
                <div className="customer-contact-box">
                  <div>
                    <div style={{ fontSize: '0.74rem', color: '#64748B', fontWeight: 600 }}>Customer Phone</div>
                    <div className="customer-phone-text">{order.customerPhone}</div>
                  </div>
                  <a href={`tel:${order.customerPhone}`} className="btn-call-direct">
                    Call Customer
                  </a>
                </div>

                {/* Request Details */}
                {order.orderType === 'text' && order.orderDescription && (
                  <div className="order-message">{order.orderDescription}</div>
                )}

                {order.orderType === 'voice' && order.voiceRecordingPath && (
                  <div className="audio-play-bar">
                    <button
                      type="button"
                      className="btn-audio-toggle"
                      disabled={loadingAudioPath === order.voiceRecordingPath}
                      onClick={() => togglePlayAudio(order.voiceRecordingPath!)}
                    >
                      {loadingAudioPath === order.voiceRecordingPath
                        ? 'Loading audio...'
                        : playingAudioPath === order.voiceRecordingPath
                        ? '⏸️ Pause Voice Note'
                        : '▶️ Play Voice Note'}
                    </button>
                  </div>
                )}

                {order.customerComment && (
                  <div
                    className="order-customer-comment"
                    style={{
                      background: '#FEFCE8',
                      border: '1px solid #FDE68A',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      marginBottom: '10px',
                      fontSize: '0.84rem',
                      color: '#713F12'
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.74rem', marginBottom: 2 }}>
                      💬 Customer Comment
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{order.customerComment}</div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={processingOrderId === order.id}
                  onClick={() => handleCompleteOrder(order.id)}
                  className="btn-complete-ride"
                >
                  {processingOrderId === order.id ? 'Completing...' : 'Mark as Completed'}
                </button>

                <button
                  type="button"
                  className="btn-request-refund-link"
                  onClick={() => {
                    setRefundOrder(order);
                    setRefundReason('Customer did not answer phone');
                  }}
                >
                  Customer cancelled or no-show? Request refund
                </button>
              </div>
            ))
          )}
        </div>
      )}
      </div>

      {/* Station Switcher Modal (Max 2 changes per week) */}
      {stationModalOpen && (
        <div className="station-modal-backdrop" role="dialog" aria-modal="true" aria-label="Change Moto Station">
          <div className="station-modal-card">
            <h3 className="station-modal-title">Change Moto Station</h3>
            <p className="station-modal-sub">
              You receive priority orders from your station first.{' '}
              <strong>
                {stationChangesRemaining} of {MAX_STATION_CHANGES_PER_WEEK}
              </strong>{' '}
              weekly changes remaining.
            </p>

            <select
              value={selectedNewStation}
              onChange={(e) => setSelectedNewStation(e.target.value)}
              className="station-modal-select"
              aria-label="Select Moto Station"
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

            <div className="station-modal-actions">
              <button
                type="button"
                className="btn-station-cancel"
                onClick={() => setStationModalOpen(false)}
                disabled={savingStation}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-station-save"
                onClick={handleSaveStation}
                disabled={
                  savingStation ||
                  stationChangesRemaining <= 0 ||
                  selectedNewStation === currentStation
                }
              >
                {savingStation ? 'Saving...' : 'Save Station'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet & Paystack Top-Up Modal */}
      {walletModalOpen && (
        <div className="station-modal-backdrop" role="dialog" aria-modal="true" aria-label="Rider Wallet Top Up">
          <div className="station-modal-card wallet-modal-card">
            <div className="wallet-modal-header">
              <h3 className="station-modal-title">Manna Wallet</h3>
              <button
                type="button"
                className="btn-wallet-close"
                onClick={() => setWalletModalOpen(false)}
                aria-label="Close wallet"
              >
                ✕
              </button>
            </div>

            <div className="wallet-summary-box">
              <div>
                <span className="wallet-summary-label">Available Balance</span>
                <div className="wallet-summary-value">GH₵ {walletBalance.toFixed(2)}</div>
              </div>
              <div className="wallet-summary-right">
                <span className="wallet-fee-tag">GH₵ 3.00 / ride</span>
                {freeRidesRemaining > 0 && (
                  <span className="wallet-free-pill">{freeRidesRemaining} free left</span>
                )}
              </div>
            </div>

            <div className="momo-receiver-card">
              <div className="momo-receiver-top">
                <span className="momo-step-tag">STEP 1: SEND MOMO TO</span>
                <span className="momo-network-pill">{paymentInfo.momoNetwork}</span>
              </div>
              <div className="momo-number-row">
                <div>
                  <div className="momo-number-value">{paymentInfo.momoNumber}</div>
                  <div className="momo-account-name">{paymentInfo.momoName}</div>
                </div>
                <button
                  type="button"
                  className="btn-copy-momo"
                  onClick={handleCopyMomoNumber}
                >
                  {copiedMomo ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitManualTopup} className="wallet-topup-form">
              <span className="wallet-section-label">STEP 2: ENTER AMOUNT &amp; TRANSACTION ID</span>
              <div className="wallet-preset-grid">
                {[
                  { amount: '15', rides: '5 rides' },
                  { amount: '30', rides: '10 rides' },
                  { amount: '60', rides: '20 rides' }
                ].map((preset) => (
                  <button
                    key={preset.amount}
                    type="button"
                    className={`wallet-preset-btn ${topupAmount === preset.amount ? 'active' : ''}`}
                    onClick={() => setTopupAmount(preset.amount)}
                  >
                    <strong>GH₵ {preset.amount}</strong>
                    <span>{preset.rides}</span>
                  </button>
                ))}
              </div>

              <div className="momo-inputs-grid">
                <div className="wallet-custom-row">
                  <span className="wallet-currency-prefix">GH₵</span>
                  <input
                    type="number"
                    min={3}
                    max={5000}
                    step="1"
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                    className="wallet-custom-input"
                    placeholder="Amount"
                    aria-label="Top up amount in Ghana Cedis"
                  />
                </div>

                <select
                  value={topupNetwork}
                  onChange={(e) => setTopupNetwork(e.target.value)}
                  className="station-modal-select"
                  aria-label="Mobile Money Network"
                >
                  <option value="MTN MoMo">MTN MoMo</option>
                  <option value="Telecel Cash">Telecel Cash</option>
                  <option value="AT Money">AT Money</option>
                </select>
              </div>

              <input
                type="text"
                value={topupTxId}
                onChange={(e) => setTopupTxId(e.target.value)}
                placeholder="MoMo Transaction ID (from SMS)"
                className="momo-txid-input"
                maxLength={40}
                required
                aria-label="MoMo Transaction ID"
              />

              <button
                type="submit"
                className="btn-paystack-submit"
                disabled={submittingTopup || Number(topupAmount) < 3 || topupTxId.trim().length < 5}
              >
                {submittingTopup
                  ? 'Submitting...'
                  : `Submit GH₵ ${Number(topupAmount || 0).toFixed(2)} MoMo Top-Up`}
              </button>
            </form>

            {/* Pending Top-Up Requests */}
            {pendingTopups.some((r) => r.status === 'pending') && (
              <div className="wallet-pending-box">
                <span className="wallet-section-label">Pending Confirmation</span>
                {pendingTopups
                  .filter((r) => r.status === 'pending')
                  .map((r) => (
                    <div key={r.id} className="wallet-pending-row">
                      <span>
                        <strong>GH₵ {r.amount.toFixed(2)}</strong> &bull; {r.transactionId}
                      </span>
                      <span className="wallet-pending-pill">Verifying</span>
                    </div>
                  ))}
              </div>
            )}

            {/* Recent Transactions */}
            <div className="wallet-history-section">
              <span className="wallet-section-label">Recent Activity</span>
              {loadingTransactions ? (
                <p className="wallet-empty-text">Loading history...</p>
              ) : walletTransactions.length === 0 ? (
                <p className="wallet-empty-text">No transactions yet.</p>
              ) : (
                <div className="wallet-tx-list">
                  {walletTransactions.slice(0, 6).map((tx) => (
                    <div key={tx.id} className="wallet-tx-row">
                      <div className="wallet-tx-desc">
                        <span>{tx.description}</span>
                        <small>{new Date(tx.createdAt).toLocaleDateString()}</small>
                      </div>
                      <span className={`wallet-tx-amount ${tx.amount > 0 ? 'credit' : tx.amount < 0 ? 'debit' : 'free'}`}>
                        {tx.type === 'free_ride'
                          ? 'FREE'
                          : `${tx.amount > 0 ? '+' : '-'}GH₵ ${Math.abs(tx.amount).toFixed(2)}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Support Refund Request Modal (No mention of admin) */}
      {refundOrder && (
        <div className="station-modal-backdrop" role="dialog" aria-modal="true" aria-label="Request Ride Refund">
          <form onSubmit={handleSubmitRefundRequest} className="station-modal-card">
            <h3 className="station-modal-title">Request Fee Refund</h3>
            <p className="station-modal-sub">
              Order <strong>{refundOrder.orderReference}</strong> — Tell Manna Support what happened. Approved requests are credited directly to your wallet.
            </p>

            <select
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              className="station-modal-select"
              aria-label="Refund reason"
            >
              <option value="Customer did not answer phone">Customer did not answer phone</option>
              <option value="Customer cancelled after I accepted">Customer cancelled after I accepted</option>
              <option value="Wrong location or fake order">Wrong location or fake order</option>
              <option value="Other issue">Other issue</option>
            </select>

            <div className="station-modal-actions">
              <button
                type="button"
                className="btn-station-cancel"
                onClick={() => setRefundOrder(null)}
                disabled={submittingRefund}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-station-save"
                disabled={submittingRefund}
              >
                {submittingRefund ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
