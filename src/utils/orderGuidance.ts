/**
 * Guided Customer Order System — formatting, validation, prompts, and recent places
 */

export type ServiceType = 'ride' | 'delivery';

export interface GuidedTextOrder {
  serviceType: ServiceType;
  pickup: string;
  destination: string;
  extraNote?: string;
}

export interface GuidedTextValidation {
  isValid: boolean;
  pickupValid: boolean;
  destinationValid: boolean;
  pickupHint?: string;
  destinationHint?: string;
}

export interface VoiceGuideStep {
  id: string;
  icon: string;
  label: string;
  detail: string;
}

export interface VoiceGuideConfig {
  title: string;
  steps: VoiceGuideStep[];
  example: string;
}

const RECENT_PLACES_KEY = 'okada_recent_places';
const MAX_RECENT_PLACES = 5;

export const QUICK_NOTE_CHIPS: Record<ServiceType, string[]> = {
  ride: ['2 passengers', 'With luggage', 'Call on arrival', 'At main junction'],
  delivery: ['Small bag', 'Fragile item', 'Call receiver', 'Pay on delivery']
};

export const VOICE_GUIDE_CONFIG: Record<ServiceType, VoiceGuideConfig> = {
  ride: {
    title: 'Say these 3 quick things',
    steps: [
      {
        id: 'pickup',
        icon: '📍',
        label: 'Where you are now',
        detail: 'Exact spot or nearest landmark'
      },
      {
        id: 'destination',
        icon: '🎯',
        label: 'Where you are going',
        detail: 'Your drop-off destination'
      },
      {
        id: 'extra',
        icon: '📝',
        label: 'Any extra detail',
        detail: 'e.g. 2 people, luggage, or shirt color'
      }
    ],
    example:
      'Hello, I am at Kadjebi Station near the junction. Please take me to the Market. I am wearing a blue shirt.'
  },
  delivery: {
    title: 'Say these 3 quick things',
    steps: [
      {
        id: 'pickup',
        icon: '📍',
        label: 'Pickup spot',
        detail: 'Where to collect the parcel'
      },
      {
        id: 'destination',
        icon: '🎯',
        label: 'Drop-off spot',
        detail: 'Where to deliver & landmark'
      },
      {
        id: 'extra',
        icon: '📦',
        label: 'What the item is',
        detail: 'e.g. small bag, food, or fragile'
      }
    ],
    example:
      'Hello, please pick up a small bag at Kadjebi Station and deliver it to the Hospital gate.'
  }
};

/**
 * Validates guided text fields so customers cannot send vague/incomplete requests
 */
export function validateGuidedTextOrder(input: GuidedTextOrder): GuidedTextValidation {
  const pickup = (input.pickup || '').trim();
  const destination = (input.destination || '').trim();

  const pickupValid = pickup.length >= 2;
  const destinationValid = destination.length >= 2;

  return {
    isValid: pickupValid && destinationValid,
    pickupValid,
    destinationValid,
    pickupHint: !pickupValid ? 'Enter your pickup location or nearest landmark' : undefined,
    destinationHint: !destinationValid
      ? input.serviceType === 'delivery'
        ? 'Enter where the parcel should be delivered'
        : 'Enter where you are going'
      : undefined
  };
}

/**
 * Formats guided order fields into a clear, structured description for riders and tracking
 */
export function formatGuidedOrderDescription(input: GuidedTextOrder): string {
  const pickup = (input.pickup || '').trim();
  const destination = (input.destination || '').trim();
  const extraNote = (input.extraNote || '').trim();

  if (!pickup && !destination) return '';

  const tag = input.serviceType === 'delivery' ? 'Parcel Delivery' : 'Ride';
  const fromLabel = input.serviceType === 'delivery' ? 'Pickup' : 'From';
  const toLabel = input.serviceType === 'delivery' ? 'Drop-off' : 'To';

  const parts: string[] = [`[${tag}]`];
  if (pickup) parts.push(`${fromLabel}: ${pickup}`);
  if (destination) parts.push(`→ ${toLabel}: ${destination}`);
  if (extraNote) parts.push(`| Note: ${extraNote}`);

  return parts.join(' ');
}

/**
 * Retrieves recent pickup/destination places stored locally on the customer's device
 */
export function getRecentPlaces(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PLACES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length >= 2)
      .slice(0, MAX_RECENT_PLACES);
  } catch {
    return [];
  }
}

/**
 * Saves one or more places to the customer's recent places list (most recent first)
 */
export function saveRecentPlaces(places: string[]): string[] {
  const existing = getRecentPlaces();
  const cleanedNew = places
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 80);

  const merged: string[] = [];
  for (const place of [...cleanedNew, ...existing]) {
    if (!merged.some((m) => m.toLowerCase() === place.toLowerCase())) {
      merged.push(place);
    }
    if (merged.length >= MAX_RECENT_PLACES) break;
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(merged));
    } catch {
      // ignore storage quota errors
    }
  }
  return merged;
}
