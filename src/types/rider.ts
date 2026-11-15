/**
 * Rider domain models and authentication types for Okada Book
 */

export interface RiderProfile {
  id: string;
  userId: string;
  fullName: string;
  phoneNumber: string;
  motorcycleRegistration: string;
  motorcycleModel: string;
  motorcycleColour: string;
  operatingArea: string;
  profilePhotoPath?: string | null;
  profilePhotoUrl?: string | null;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RiderRegistrationPayload {
  fullName: string;
  phoneNumber: string;
  password: string;
  motorcycleRegistration: string;
  motorcycleModel: string;
  motorcycleColour: string;
  operatingArea: string;
  profilePhotoFile?: File | Blob;
}

export interface RiderLoginPayload {
  phoneNumber: string;
  password: string;
}

export interface AvailableOrderSummary {
  id: string;
  orderReference: string;
  orderType: 'text' | 'voice';
  orderDescription?: string | null;
  voiceRecordingPath?: string | null;
  voiceRecordingUrl?: string | null;
  pickupArea?: string;
  createdAt: string;
}

export interface ActiveRiderOrder {
  id: string;
  orderReference: string;
  customerPhone: string;
  orderType: 'text' | 'voice';
  orderDescription?: string | null;
  voiceRecordingPath?: string | null;
  voiceRecordingUrl?: string | null;
  status: 'accepted' | 'completed' | 'cancelled';
  createdAt: string;
  acceptedAt: string;
}

export interface RiderMetrics {
  todayCompletedCount: number;
  todayAcceptedCount: number;
  pendingEarnings?: number;
}
