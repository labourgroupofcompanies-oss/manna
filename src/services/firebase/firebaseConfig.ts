/**
 * Firebase Client Configuration for KABA
 * Supports environment variables or fallback project values
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
  vapidKey?: string;
}

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env || {};

export const firebaseConfig: FirebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyOkadaBookPlaceholderKey',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'kababooking.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'kababooking',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'kababooking.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '478088933991',
  appId: env.VITE_FIREBASE_APP_ID || '1:478088933991:web:cab60628930f106233dac2',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-CDGT5JDTV9',
  vapidKey: env.VITE_FIREBASE_VAPID_KEY || ''
};

/**
 * Checks whether custom production Firebase environment variables or project config are active.
 */
export function isFirebaseConfigured(): boolean {
  const hasValidApiKey =
    Boolean(firebaseConfig.apiKey) &&
    firebaseConfig.apiKey !== 'AIzaSyOkadaBookPlaceholderKey' &&
    !firebaseConfig.apiKey.includes('Placeholder');

  return Boolean(
    hasValidApiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId
  );
}
