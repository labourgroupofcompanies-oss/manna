import { supabase } from '../supabase';
import {
  getFcmToken,
  getNotificationPermissionState,
  requestNotificationPermission,
  onForegroundMessage,
  playNotificationChime,
  displayNativeNotification
} from './firebaseMessaging';
import type {
  PushNotificationPayload,
  PushNotificationDispatchResult,
  PushNotificationRecord,
  NotificationRecipientType
} from '../../types';

type NotificationListener = (notification: PushNotificationPayload) => void;

class PushNotificationService {
  private listeners: Set<NotificationListener> = new Set();
  private isRealtimeSubscribed: boolean = false;
  private currentRegisteredToken: string | null = null;
  private unsubscribeForeground: (() => void) | null = null;

  constructor() {
    // Listen for FCM foreground messages
    if (typeof window !== 'undefined') {
      this.unsubscribeForeground = onForegroundMessage((payload) => {
        this.emitToListeners(payload);
      });
    }
  }

  public destroy(): void {
    if (this.unsubscribeForeground) {
      this.unsubscribeForeground();
      this.unsubscribeForeground = null;
    }
  }

  /**
   * Subscribe an in-app listener to receive incoming push notifications
   */
  public subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitToListeners(notification: PushNotificationPayload): void {
    this.listeners.forEach((cb) => {
      try {
        cb(notification);
      } catch (err) {
        console.error('[PushNotificationService] Listener error:', err);
      }
    });
  }

  /**
   * Get current device notification permission
   */
  public getPermissionStatus() {
    return getNotificationPermissionState();
  }

  /**
   * Request push permission and register token to Supabase for a Customer
   */
  public async registerCustomerNotifications(params: {
    phoneNumber?: string;
    orderReference?: string;
  }): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') {
        return { success: false, error: 'Notification permission denied' };
      }

      const token = await getFcmToken();
      if (!token) {
        return { success: false, error: 'Could not obtain FCM token' };
      }

      this.currentRegisteredToken = token;

      if (supabase) {
        const deviceInfo = typeof navigator !== 'undefined' ? {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          registeredAt: new Date().toISOString()
        } : {};

        await supabase.rpc('register_fcm_token', {
          p_token: token,
          p_user_type: 'customer',
          p_phone_number: params.phoneNumber || null,
          p_order_reference: params.orderReference || null,
          p_device_info: deviceInfo
        });
      }

      // Store in localStorage for reference
      if (typeof window !== 'undefined') {
        localStorage.setItem('okada_fcm_registered_type', 'customer');
        if (params.orderReference) {
          localStorage.setItem(`okada_fcm_token_${params.orderReference}`, token);
        }
      }

      return { success: true, token };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Request push permission and register token for a Rider
   */
  public async registerRiderNotifications(riderId: string): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') {
        return { success: false, error: 'Notification permission denied' };
      }

      const token = await getFcmToken();
      if (!token) {
        return { success: false, error: 'Could not obtain FCM token' };
      }

      this.currentRegisteredToken = token;

      if (supabase) {
        const deviceInfo = typeof navigator !== 'undefined' ? {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          riderId,
          registeredAt: new Date().toISOString()
        } : {};

        await supabase.rpc('register_fcm_token', {
          p_token: token,
          p_user_type: 'rider',
          p_device_info: deviceInfo
        });
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('okada_fcm_registered_type', 'rider');
      }

      return { success: true, token };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Request push permission and register token for an Admin
   */
  public async registerAdminNotifications(): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') {
        return { success: false, error: 'Notification permission denied' };
      }

      const token = await getFcmToken();
      if (!token) {
        return { success: false, error: 'Could not obtain FCM token' };
      }

      this.currentRegisteredToken = token;

      if (supabase) {
        const deviceInfo = typeof navigator !== 'undefined' ? {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          role: 'admin',
          registeredAt: new Date().toISOString()
        } : {};

        await supabase.rpc('register_fcm_token', {
          p_token: token,
          p_user_type: 'admin',
          p_device_info: deviceInfo
        });
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('okada_fcm_registered_type', 'admin');
      }

      return { success: true, token };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Unregister FCM token on logout or user toggle
   */
  public async unregisterToken(): Promise<boolean> {
    try {
      const token = this.currentRegisteredToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('okada_dev_fcm_token') : null);
      if (token && supabase) {
        await supabase.rpc('delete_fcm_token', { p_token: token });
      }
      this.currentRegisteredToken = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('okada_fcm_registered_type');
      }
      return true;
    } catch (err) {
      console.warn('[PushNotificationService] Unregister error:', err);
      return false;
    }
  }

  /**
   * Checks whether an order-specific customer notification belongs to this browser/device
   * by matching localStorage recent orders, registered order FCM token, or active tracking URL.
   */
  private isCustomerOrderOwnedByDevice(orderReference: string): boolean {
    if (typeof window === 'undefined') return false;
    const normalizedRef = orderReference.trim().toUpperCase();
    if (!normalizedRef) return false;

    try {
      // 1. Check active URL tracking parameter (?ref=OKD-XXXXXX)
      const urlParams = new URLSearchParams(window.location.search);
      const urlRef = (urlParams.get('ref') || '').trim().toUpperCase();
      if (urlRef && urlRef === normalizedRef) {
        return true;
      }

      if (!window.localStorage) return false;

      // 2. Check if this device explicitly registered an FCM token for this order
      if (window.localStorage.getItem(`okada_fcm_token_${normalizedRef}`)) {
        return true;
      }

      // 3. Check if this order exists in the customer's local recent orders history
      const recentRaw = window.localStorage.getItem('okada_recent_orders');
      if (recentRaw) {
        const recentOrders = JSON.parse(recentRaw) as Array<{ orderReference?: string }>;
        if (Array.isArray(recentOrders)) {
          const hasMatch = recentOrders.some(
            (o) => (o.orderReference || '').trim().toUpperCase() === normalizedRef
          );
          if (hasMatch) return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * Setup Realtime listener for incoming in-app notifications
   */
  public initRealtimeSubscription(filter?: {
    recipientType?: NotificationRecipientType;
    orderReference?: string;
  }): () => void {
    if (!supabase || this.isRealtimeSubscribed) {
      return () => {};
    }

    const channelName = `push-notifications-${filter?.recipientType || 'all'}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'push_notifications' },
        async (payload) => {
          const raw = payload.new as Record<string, unknown>;
          const recordRecipientType = (raw.recipient_type ?? raw.recipientType) as NotificationRecipientType | undefined;
          const recordRecipientId = (raw.recipient_id ?? raw.recipientId ?? null) as string | null;
          const recordOrderRef = (raw.order_reference ?? raw.orderReference ?? null) as string | null;
          const recordTitle = (raw.title as string) || '';
          const recordBody = (raw.body as string) || '';
          const recordData = (raw.data as Record<string, string>) || {};

          // 1. Check if notification matches explicit filter scope
          if (filter?.orderReference && recordOrderRef && recordOrderRef !== filter.orderReference) {
            return;
          }
          if (filter?.recipientType && recordRecipientType && recordRecipientType !== 'all' && recordRecipientType !== filter.recipientType) {
            return;
          }

          // 2. Strict user-targeted delivery: if recipient_id is set (e.g. specific rider approval/decline),
          // ONLY deliver to the authenticated user whose auth.users.id matches recipient_id
          if (recordRecipientId) {
            try {
              const { data: sessionData } = await supabase.auth.getSession();
              const currentUserId = sessionData?.session?.user?.id || null;
              if (!currentUserId || currentUserId !== recordRecipientId) {
                return;
              }
            } catch {
              return;
            }
          } else if (typeof window !== 'undefined' && recordRecipientType && recordRecipientType !== 'all') {
            // 3. Portal-level scoping for non-targeted broadcasts
            const path = window.location.pathname || '/';
            if (recordRecipientType === 'admin' && !path.startsWith('/admin')) {
              return;
            }
            if (recordRecipientType === 'rider' && !path.startsWith('/rider')) {
              return;
            }
            if (recordRecipientType === 'customer') {
              if (path.startsWith('/admin') || path.startsWith('/rider')) {
                return;
              }
              // Order-specific customer notifications (e.g. rider accepted / completed ride)
              // must ONLY notify the customer device that placed or is tracking that order
              if (recordOrderRef && !this.isCustomerOrderOwnedByDevice(recordOrderRef)) {
                return;
              }
            }
          }

          const notification: PushNotificationPayload = {
            title: recordTitle,
            body: recordBody,
            orderReference: recordOrderRef || undefined,
            data: recordData,
            clickAction: recordData?.click_action || '/'
          };

          // Play audio alert
          playNotificationChime(recordRecipientType === 'rider' ? 'order' : 'ride');

          // If document is backgrounded, show native alert
          if (typeof document !== 'undefined' && document.hidden) {
            displayNativeNotification(notification);
          }

          // Emit to all component listeners
          this.emitToListeners(notification);
        }
      )
      .subscribe();

    this.isRealtimeSubscribed = true;

    return () => {
      supabase.removeChannel(channel);
      this.isRealtimeSubscribed = false;
    };
  }

  /**
   * Core dispatcher: sends push notification via Supabase Edge Function or database RPC
   */
  public async dispatchNotification(params: {
    recipientType: NotificationRecipientType;
    title: string;
    body: string;
    tokens?: string[];
    orderReference?: string;
    bookingToken?: string;
    recipientPhone?: string;
    recipientId?: string;
    clickAction?: string;
    data?: Record<string, string>;
    skipEdgeFunction?: boolean;
    useAnonymousAuth?: boolean;
  }): Promise<PushNotificationDispatchResult> {
    if (!supabase) {
      return { success: false, error: 'Database client not initialized' };
    }

    try {
      // 1. Attempt via Supabase Edge Function (unless skipped for non-privileged Realtime broadcasts)
      if (!params.skipEdgeFunction) {
        const invokeOptions: {
          body: Record<string, unknown>;
          headers?: Record<string, string>;
        } = {
          body: {
            tokens: params.tokens,
            recipient_type: params.recipientType,
            recipient_id: params.recipientId,
            recipient_phone: params.recipientPhone,
            order_reference: params.orderReference,
            booking_token: params.bookingToken,
            title: params.title,
            body: params.body,
            click_action: params.clickAction,
            data: {
              ...params.data,
              orderReference: params.orderReference || '',
              bookingToken: params.bookingToken || '',
              click_action: params.clickAction || '/'
            }
          }
        };

        // For anonymous customer bookings with a capability token, omit any active Rider/Admin
        // browser session JWT so same-browser role switching doesn't trigger a 403 Forbidden.
        if (params.useAnonymousAuth) {
          invokeOptions.headers = { Authorization: '' };
        }

        const { data: edgeResult, error: edgeError } = await supabase.functions.invoke('send-push-notification', invokeOptions);

        if (!edgeError && edgeResult?.success) {
          return edgeResult;
        }
      }

      // 2. Direct Database Fallback: record notification directly in Supabase
      // This immediately broadcasts to all active portals via Supabase Realtime!
      await supabase.rpc('record_push_notification', {
        p_recipient_type: params.recipientType,
        p_title: params.title,
        p_body: params.body,
        p_order_reference: params.orderReference || null,
        p_recipient_id: params.recipientId || null,
        p_recipient_phone: params.recipientPhone || null,
        p_data: {
          ...params.data,
          orderReference: params.orderReference || null,
          click_action: params.clickAction || '/'
        }
      });

      return {
        success: true,
        sentCount: 0,
        deliveredByFirebase: false,
        isSimulated: true,
        message: 'Notification recorded and broadcast via Realtime'
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  // ============================================================================
  // Specialized Lifecycle Notification Triggers
  // ============================================================================

  /**
   * Trigger when a new order is created
   * Alerts:
   * 1. All available Riders: "🛵 New Ride Request: OKD-XXXXXX"
   * 2. All Admins: "📋 New Order Placed: OKD-XXXXXX"
   */
  public async notifyOrderCreated(order: {
    orderReference: string;
    bookingToken?: string;
    orderId?: string;
    orderType: string;
    customerPhone: string;
    orderDescription?: string | null;
  }): Promise<void> {
    const descSummary = order.orderType === 'voice' ? 'Voice Ride Request' : (order.orderDescription || 'Okada ride requested');
    const brief = descSummary.length > 50 ? `${descSummary.substring(0, 47)}...` : descSummary;

    // 1. Notify Riders via Edge Function with verified capability token
    await this.dispatchNotification({
      recipientType: 'rider',
      title: `🛵 New Ride Request: ${order.orderReference}`,
      body: `${brief}. Open Rider Dashboard to accept.`,
      orderReference: order.orderReference,
      bookingToken: order.bookingToken || order.orderId,
      recipientPhone: order.customerPhone,
      clickAction: '/rider',
      useAnonymousAuth: true,
      data: {
        type: 'new_order_broadcast',
        orderReference: order.orderReference,
        orderType: order.orderType,
        customerPhone: order.customerPhone,
        bookingToken: order.bookingToken || order.orderId || ''
      }
    });

    // 2. Record Admin notification directly in Supabase audit history
    // (Broadcasts to Admin portal via Supabase Realtime without unauthorized Edge Function broadcast)
    if (supabase) {
      try {
        await supabase.rpc('record_push_notification', {
          p_recipient_type: 'admin',
          p_title: `📋 New Order: ${order.orderReference}`,
          p_body: `Customer: ${order.customerPhone} • Type: ${order.orderType}`,
          p_order_reference: order.orderReference,
          p_recipient_id: null,
          p_recipient_phone: order.customerPhone,
          p_data: {
            type: 'new_order_admin',
            orderReference: order.orderReference,
            customerPhone: order.customerPhone,
            sent_at: new Date().toISOString()
          }
        });
      } catch {
        // Silent catch for background admin broadcast record
      }
    }
  }

  /**
   * Trigger when a rider accepts an order
   * Alerts:
   * 1. Customer: "🎉 Rider Assigned! [Rider Name] is on the way."
   * 2. Admins: "🤝 Order OKD-XXXXXX accepted by [Rider Name]"
   */
  public async notifyOrderAccepted(order: {
    orderReference: string;
    customerPhone: string;
  }, rider: {
    fullName: string;
    phoneNumber: string;
    motorcycleModel?: string;
    motorcycleRegistration?: string;
    verificationStatus?: string;
  }): Promise<void> {
    const bikeInfo = rider.motorcycleModel ? ` (${rider.motorcycleModel} - ${rider.motorcycleRegistration})` : '';
    const isRiderApproved = rider.verificationStatus === undefined || rider.verificationStatus === 'approved';

    // Notify Customer (uses Edge Function FCM when rider is admin-approved, or Realtime fallback when pending)
    await this.dispatchNotification({
      recipientType: 'customer',
      title: `🎉 Rider Found for ${order.orderReference}!`,
      body: `${rider.fullName}${bikeInfo} has accepted your trip and is heading to you.`,
      orderReference: order.orderReference,
      recipientPhone: order.customerPhone,
      clickAction: `/?ref=${order.orderReference}&tab=track`,
      skipEdgeFunction: !isRiderApproved,
      data: {
        type: 'order_accepted',
        orderReference: order.orderReference,
        riderName: rider.fullName,
        riderPhone: rider.phoneNumber
      }
    });

    // Record Admin notification directly in Supabase audit history (broadcasts via Realtime without triggering 403)
    await this.dispatchNotification({
      recipientType: 'admin',
      title: `🤝 Order Accepted: ${order.orderReference}`,
      body: `Assigned to ${rider.fullName} (${rider.phoneNumber})`,
      orderReference: order.orderReference,
      clickAction: '/admin/orders',
      skipEdgeFunction: true,
      data: {
        type: 'order_accepted_admin',
        orderReference: order.orderReference
      }
    });
  }

  /**
   * Trigger when an order is completed
   * Alerts:
   * 1. Customer: "✅ Trip Completed! Thank you for riding with Okada Book."
   */
  public async notifyOrderCompleted(order: {
    orderReference: string;
    customerPhone: string;
    riderVerificationStatus?: string;
  }): Promise<void> {
    const isRiderApproved = order.riderVerificationStatus === undefined || order.riderVerificationStatus === 'approved';

    await this.dispatchNotification({
      recipientType: 'customer',
      title: `✅ Trip Completed: ${order.orderReference}`,
      body: 'Your ride has safely concluded. Thank you for booking with Okada Book!',
      orderReference: order.orderReference,
      recipientPhone: order.customerPhone,
      clickAction: `/?ref=${order.orderReference}&tab=track`,
      skipEdgeFunction: !isRiderApproved,
      data: {
        type: 'order_completed',
        orderReference: order.orderReference
      }
    });
  }

  /**
   * Trigger when a new rider registers
   * Alerts:
   * 1. Admins: "👤 New Rider Registration: [Rider Name] awaiting approval"
   */
  public async notifyRiderRegistered(rider: {
    fullName: string;
    phoneNumber: string;
    operatingArea: string;
  }): Promise<void> {
    await this.dispatchNotification({
      recipientType: 'admin',
      title: `👤 New Rider Registered: ${rider.fullName}`,
      body: `Phone: ${rider.phoneNumber} • Area: ${rider.operatingArea}. Review verification in Admin Portal.`,
      clickAction: '/admin/riders',
      skipEdgeFunction: true,
      data: {
        type: 'rider_registered',
        riderName: rider.fullName,
        riderPhone: rider.phoneNumber
      }
    });
  }

  /**
   * Trigger when admin updates rider status
   * Alerts:
   * 1. Rider: "🛡️ Rider Account Status: [Approved / Suspended]"
   */
  public async notifyRiderStatusChanged(params: {
    riderId: string;
    riderUserId: string;
    riderName: string;
    status: string;
    reason?: string;
  }): Promise<void> {
    if (!params.riderUserId) {
      return;
    }

    const isApproved = params.status === 'approved';
    const title = isApproved ? '🎉 Congratulations! You are Verified' : `🛡️ Account Notice: Status is ${params.status}`;
    const body = isApproved
      ? 'Your rider documents have been approved by admin. You can now accept rides anytime!'
      : (params.reason || `Your account verification status has been updated to ${params.status}.`);

    await this.dispatchNotification({
      recipientType: 'rider',
      recipientId: params.riderUserId,
      title,
      body,
      clickAction: '/rider',
      data: {
        type: 'rider_status_update',
        status: params.status,
        riderId: params.riderId,
        riderUserId: params.riderUserId
      }
    });
  }

  /**
   * Fetch recent notification history from database
   */
  public async getNotificationHistory(params: {
    recipientType?: NotificationRecipientType;
    orderReference?: string;
    limit?: number;
  }): Promise<PushNotificationRecord[]> {
    if (!supabase) return [];

    try {
      let query = supabase
        .from('push_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(params.limit || 20);

      if (params.orderReference) {
        query = query.eq('order_reference', params.orderReference);
      } else if (params.recipientType && params.recipientType !== 'all') {
        query = query.or(`recipient_type.eq.${params.recipientType},recipient_type.eq.all`);
      }

      const { data, error } = await query;
      if (error || !data) return [];

      return data.map((d: Record<string, unknown>) => ({
        id: d.id as string,
        recipientType: d.recipient_type as NotificationRecipientType,
        recipientId: d.recipient_id as string | null,
        recipientPhone: d.recipient_phone as string | null,
        orderReference: d.order_reference as string | null,
        title: d.title as string,
        body: d.body as string,
        data: d.data as Record<string, unknown> | null,
        status: d.status as 'queued' | 'sent' | 'delivered' | 'failed',
        errorMessage: d.error_message as string | null,
        createdAt: d.created_at as string
      }));
    } catch {
      return [];
    }
  }

  /**
   * Triggers a local test notification in the active browser window
   * to verify permission, in-app toast, audio chime, and native notifications.
   */
  public triggerTestNotification(type: 'order' | 'ride' | 'admin' = 'order'): void {
    const testPayloads: Record<string, PushNotificationPayload> = {
      order: {
        title: '🛵 KABA Ride Alert (Test)',
        body: 'New ride request nearby: Accra Central to Osu. Tap to view.',
        orderReference: 'OKD-TEST99',
        clickAction: '/rider',
        data: { type: 'test_order' }
      },
      ride: {
        title: '🎉 Rider Assigned! (Test)',
        body: 'Kwame Mensah (Yamaha Crux - GW-4521-22) is heading to your pickup location.',
        orderReference: 'OKD-TEST99',
        clickAction: '/?ref=OKD-TEST99&tab=track',
        data: { type: 'test_ride' }
      },
      admin: {
        title: '🛡️ KABA Admin System Notice (Test)',
        body: 'Operator dispatch channels and push services are verified operational.',
        clickAction: '/admin/settings',
        data: { type: 'test_admin' }
      }
    };

    const payload = testPayloads[type] || testPayloads.order;

    // 1. Play audio chime
    playNotificationChime(type === 'admin' ? 'alert' : type === 'order' ? 'order' : 'ride');

    // 2. Display native OS notification if granted
    if (typeof document !== 'undefined') {
      displayNativeNotification(payload);
    }

    // 3. Emit to in-app toast listeners
    this.emitToListeners(payload);
  }
}

export const pushNotificationService = new PushNotificationService();
