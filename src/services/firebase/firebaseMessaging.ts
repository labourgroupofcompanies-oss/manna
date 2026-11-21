import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig';
import type { PushNotificationPayload, NotificationPermissionState } from '../../types';

let firebaseAppInstance: FirebaseApp | null = null;
let messagingInstance: Messaging | null = null;
let messagingSupportedPromise: Promise<boolean> | null = null;

/**
 * Check if the browser supports Firebase Cloud Messaging and Service Workers
 */
export async function checkMessagingSupport(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;

  if (messagingSupportedPromise === null) {
    messagingSupportedPromise = isSupported().catch(() => false);
  }
  return messagingSupportedPromise;
}

/**
 * Get current notification permission state
 */
export function getNotificationPermissionState(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as NotificationPermissionState;
}

/**
 * Initialize or get Firebase App
 */
export function getFirebaseApp(): FirebaseApp {
  if (!firebaseAppInstance) {
    if (getApps().length > 0) {
      firebaseAppInstance = getApp();
    } else {
      firebaseAppInstance = initializeApp(firebaseConfig);
    }
  }
  return firebaseAppInstance;
}

/**
 * Initialize or get Firebase Messaging instance
 */
export async function getFirebaseMessaging(): Promise<Messaging | null> {
  const supported = await checkMessagingSupport();
  if (!supported) {
    return null;
  }

  if (!messagingInstance) {
    try {
      const app = getFirebaseApp();
      messagingInstance = getMessaging(app);
    } catch (err) {
      console.warn('[FirebaseMessaging] Initialization warning:', err);
      return null;
    }
  }
  return messagingInstance;
}

/**
 * Request notification permissions from user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (err) {
    console.warn('[FirebaseMessaging] Permission request error:', err);
    return 'denied';
  }
}

/**
 * Register Service Worker and retrieve FCM Token using VAPID key
 */
export async function getFcmToken(): Promise<string | null> {
  try {
    if (!isFirebaseConfigured()) {
      if (typeof window !== 'undefined') {
        let localDevToken = localStorage.getItem('okada_dev_fcm_token');
        if (!localDevToken) {
          localDevToken = `dev_token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          localStorage.setItem('okada_dev_fcm_token', localDevToken);
        }
        console.info('[FirebaseMessaging] Using simulated local dev token (Firebase API key not configured):', localDevToken);
        return localDevToken;
      }
      return null;
    }

    const supported = await checkMessagingSupport();
    if (!supported) return null;

    const messaging = await getFirebaseMessaging();
    if (!messaging) return null;

    // Check permission
    const permission = getNotificationPermissionState();
    if (permission !== 'granted') {
      const newPerm = await requestNotificationPermission();
      if (newPerm !== 'granted') return null;
    }

    // Prefer using the active unified service worker (PWA worker which imported firebase-messaging-sw.js)
    let swRegistration: ServiceWorkerRegistration | undefined;
    if ('serviceWorker' in navigator) {
      try {
        const readyRegistration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1500))
        ]);

        if (readyRegistration) {
          swRegistration = readyRegistration;
        } else {
          swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
            scope: '/'
          });
          await navigator.serviceWorker.ready;
        }
      } catch (swErr) {
        console.warn('[FirebaseMessaging] Service worker coordination warning:', swErr);
      }
    }

    // Retrieve FCM registration token using VAPID key
    const tokenOptions: { serviceWorkerRegistration?: ServiceWorkerRegistration; vapidKey?: string } = {};
    if (swRegistration) {
      tokenOptions.serviceWorkerRegistration = swRegistration;
    }

    // Task 4: Use VAPID public key via VITE_FIREBASE_VAPID_KEY
    const vapidKey = firebaseConfig.vapidKey || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY : '');
    if (vapidKey && typeof vapidKey === 'string' && vapidKey.trim().length > 0) {
      tokenOptions.vapidKey = vapidKey.trim();
    }

    const token = await getToken(messaging, tokenOptions);
    return token || null;
  } catch (err) {
    console.warn('[FirebaseMessaging] Unable to get FCM token:', err);
    // Return a stable fallback device token if live FCM token retrieval fails
    if (typeof window !== 'undefined') {
      let localDevToken = localStorage.getItem('okada_dev_fcm_token');
      if (!localDevToken) {
        localDevToken = `dev_token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem('okada_dev_fcm_token', localDevToken);
      }
      return localDevToken;
    }
    return null;
  }
}

/**
 * Play an audible chime alert using Web Audio API synthesizer
 */
export function playNotificationChime(type: 'order' | 'ride' | 'alert' = 'order'): void {
  if (typeof window === 'undefined') return;

  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'order') {
      // Pleasant two-tone chime (Okada ride bell)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.12); // A5

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.start(now);
      osc.stop(now + 0.45);
    } else if (type === 'ride') {
      // Triple ascending chime
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.2); // G5

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc.start(now);
      osc.stop(now + 0.55);
    } else {
      // Attention alert chime
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(880, now + 0.15);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch {
    // Non-critical audio warning
  }
}

/**
 * Display native browser notification if granted and document is hidden
 */
export function displayNativeNotification(payload: PushNotificationPayload): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(payload.title, {
      body: payload.body,
      icon: payload.icon || '/favicon.svg',
      badge: '/favicon.svg',
      tag: payload.tag || payload.orderReference || 'kaba-alert',
      data: payload.data || {}
    });

    notification.onclick = () => {
      window.focus();
      if (payload.clickAction && payload.clickAction !== window.location.pathname) {
        window.location.href = payload.clickAction;
      }
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications via serviceWorkerRegistration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon || '/favicon.svg',
          badge: '/favicon.svg',
          data: payload.data || {}
        });
      }).catch(() => {});
    }
  }
}

/**
 * Listen for foreground FCM push messages
 */
export function onForegroundMessage(
  callback: (payload: PushNotificationPayload) => void
): () => void {
  let unsubscribeFn: (() => void) | null = null;

  getFirebaseMessaging().then((messaging) => {
    if (!messaging) return;

    unsubscribeFn = onMessage(messaging, (payload) => {
      const parsed: PushNotificationPayload = {
        title: payload.notification?.title || payload.data?.title || 'KABA Ride Alert',
        body: payload.notification?.body || payload.data?.body || '',
        icon: payload.notification?.icon || payload.data?.icon || '/favicon.svg',
        clickAction: payload.data?.click_action,
        orderReference: payload.data?.orderReference,
        data: payload.data as Record<string, string>
      };

      // Play audio chime
      playNotificationChime(parsed.orderReference ? 'ride' : 'order');

      // If document is hidden/backgrounded, display native notification
      if (typeof document !== 'undefined' && document.hidden) {
        displayNativeNotification(parsed);
      }

      callback(parsed);
    });
  });

  return () => {
    if (unsubscribeFn) {
      unsubscribeFn();
    }
  };
}
