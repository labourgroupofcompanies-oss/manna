// ==============================================================================
// KABA — FIREBASE CLOUD MESSAGING SERVICE WORKER
// File: public/firebase-messaging-sw.js
// Description: Handles background push notifications when app is closed
//              or tab is inactive, with action click handling and focus.
//              Designed to run standalone or imported by the Workbox PWA sw.
// ==============================================================================

/* eslint-disable no-undef */

self.__WB_DISABLE_DEV_LOGS = true;

// Ensure updated service worker activates promptly for reliable background push
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Give the service worker access to Firebase Messaging compat libraries
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// KABA Firebase Project Configuration
const kabaFirebaseConfig = {
  apiKey: "AIzaSyAV6z8qJgo1ZIdOrzggfFkNeuGOayxzQb0",
  authDomain: "kababooking.firebaseapp.com",
  projectId: "kababooking",
  storageBucket: "kababooking.firebasestorage.app",
  messagingSenderId: "478088933991",
  appId: "1:478088933991:web:cab60628930f106233dac2"
};

let isFirebaseMessagingActive = false;

try {
  if (typeof firebase !== 'undefined') {
    if (firebase.apps.length === 0) {
      firebase.initializeApp(kabaFirebaseConfig);
    }
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      console.log('[firebase-messaging-sw.js] Received background FCM message: ', payload);

      // When FCM includes a notification block, the browser/Firebase SDK already displays
      // the system notification automatically — only call showNotification for data-only payloads
      // to avoid duplicate notifications on mobile devices.
      if (payload.notification && payload.notification.title) {
        return;
      }

      const notificationTitle = payload.data?.title || 'Manna Ride Alert';
      const clickAction = payload.data?.click_action || payload.fcmOptions?.link || '/';

      const notificationOptions = {
        body: payload.data?.body || 'You have a new update.',
        icon: payload.data?.icon || '/icons/notification-icon.png',
        badge: '/icons/notification-badge.png',
        tag: payload.data?.orderReference || 'manna-notification',
        data: {
          click_action: clickAction,
          ...payload.data
        },
        vibrate: [200, 100, 200],
        requireInteraction: true
      };

      return self.registration.showNotification(notificationTitle, notificationOptions);
    });

    isFirebaseMessagingActive = true;
  }
} catch (err) {
  console.warn('[firebase-messaging-sw.js] Firebase compat initialization warning (using native push listener):', err);
}

// Fallback native push event listener (active ONLY if Firebase compat script failed to initialize)
self.addEventListener('push', (event) => {
  if (isFirebaseMessagingActive) {
    // Avoid duplicate notifications since Firebase onBackgroundMessage handles it
    return;
  }
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.notification?.title || data.title || 'Manna Ride Alert';
    const body = data.notification?.body || data.body || 'You have a new notification.';
    const icon = data.notification?.icon || data.icon || '/icons/notification-icon.png';
    const clickAction = data.data?.click_action || data.click_action || '/';

    const options = {
      body,
      icon,
      badge: '/icons/notification-badge.png',
      tag: data.data?.orderReference || 'manna-notification',
      data: {
        click_action: clickAction,
        ...data.data
      },
      vibrate: [250, 100, 250, 100, 250],
      requireInteraction: true
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification('Manna', {
        body: text,
        icon: '/icons/notification-icon.png',
        badge: '/icons/notification-badge.png'
      })
    );
  }
});

// Handle notification click: focus existing window or open target route
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const rawTargetUrl = event.notification.data?.click_action || '/';
  const targetUrl = new URL(rawTargetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client && client.url.startsWith(self.location.origin)) {
          client.focus();
          if (rawTargetUrl && rawTargetUrl !== '/') {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
