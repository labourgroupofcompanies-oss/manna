/**
 * Rider domain models and authentication types for Okada Book
 */

export type RiderVerificationStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface RiderVerificationDocument {
  id: string;
  riderId: string;
  documentType: 'national_id' | 'drivers_license' | 'motorcycle_insurance' | 'roadworthiness' | 'other';
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  uploadedAt: string;
  verifiedAt?: string | null;
  notes?: string | null;
  documentUrl?: string | null; // Signed URL generated for admins
}

export interface RiderProfile {
  id: string;
  userId: string;
  fullName: string;
  phoneNumber: string;
  motorcycleRegistration: string;
  motorcycleModel: string;
  motorcycleColour: string;
  operatingArea: string;
  averageRating?: number | null;
  totalRatings?: number;
  walletBalance?: number;
  freeRidesRemaining?: number;
  stationChangeCount?: number;
  stationChangeWeekStart?: string | null;
  profilePhotoPath?: string | null;
  profilePhotoUrl?: string | null;
  isAvailable: boolean;
  verificationStatus: RiderVerificationStatus;
  verificationSubmittedAt?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  verificationNotes?: string | null;
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
  customerComment?: string | null;
  pickupStation?: string | null;
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
  customerComment?: string | null;
  status: 'accepted' | 'completed' | 'cancelled';
  createdAt: string;
  acceptedAt: string;
}

export interface RiderMetrics {
  todayCompletedCount: number;
  todayAcceptedCount: number;
  pendingEarnings?: number;
}

export interface WalletTransaction {
  id: string;
  riderId: string;
  orderReference?: string | null;
  type: 'topup' | 'order_commission' | 'free_ride' | 'refund' | 'adjustment';
  amount: number;
  balanceAfter: number;
  paystackReference?: string | null;
  description: string;
  createdAt: string;
}

export interface RefundRequestRecord {
  id: string;
  orderId: string;
  orderReference: string;
  riderId: string;
  riderName?: string;
  riderPhone?: string;
  reason: string;
  chargeType: 'wallet' | 'free_ride';
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  reviewNotes?: string | null;
  createdAt: string;
}
