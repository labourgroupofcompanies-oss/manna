/**
 * Okada Book — Push Notification Types & Payload Definitions
 */

export type NotificationRecipientType = 'customer' | 'rider' | 'admin' | 'all';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  clickAction?: string;
  orderReference?: string;
  data?: Record<string, string>;
  tag?: string;
}

export interface FcmTokenRegistration {
  token: string;
  userType: 'customer' | 'rider' | 'admin';
  phoneNumber?: string;
  orderReference?: string;
  deviceInfo?: {
    userAgent: string;
    platform: string;
    language: string;
    registeredAt: string;
  };
}

export interface PushNotificationRecord {
  id: string;
  recipientType: NotificationRecipientType;
  recipientId?: string | null;
  recipientPhone?: string | null;
  orderReference?: string | null;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  errorMessage?: string | null;
  createdAt: string;
}

export interface PushNotificationDispatchResult {
  success: boolean;
  message?: string;
  deliveredByFirebase?: boolean;
  sentCount?: number;
  failedCount?: number;
  tokensCount?: number;
  isSimulated?: boolean;
  error?: string;
}
