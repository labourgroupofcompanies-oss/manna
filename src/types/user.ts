import type { RiderVerificationStatus } from './rider';

/**
 * User and Actor role types for Okada Book
 */
export type UserRole = 'customer' | 'rider' | 'admin';

export interface UserProfile {
  id: string;
  phoneNumber: string;
  fullName?: string;
  role: UserRole;
  createdAt: string;
}

export type AdminRole = 'super_admin' | 'admin';

export interface AdminUser {
  id: string;
  userId: string;
  email: string;
  role: AdminRole;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOverviewStats {
  totalOrders: number;
  pendingOrders: number;
  acceptedOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  todayOrders: number;
  weekOrders: number;
  monthOrders: number;
  totalRiders: number;
  onlineRiders: number;
  offlineRiders: number;
  verifiedRiders: number;
  pendingRiders: number;
  rejectedRiders: number;
  suspendedRiders: number;
  totalCustomers: number;
  totalDisputes: number;
  openDisputes: number;
  avgAcceptanceSeconds?: number | null;
  avgCompletionSeconds?: number | null;
}

export interface CustomerRecord {
  customerPhone: string;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  textOrdersCount: number;
  voiceOrdersCount: number;
  firstOrderAt: string;
  lastOrderAt: string;
}

export interface RiderWithStats {
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
  profilePhotoPath?: string | null;
  profilePhotoUrl?: string | null;
  isAvailable: boolean;
  verificationStatus: RiderVerificationStatus;
  verificationSubmittedAt?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  verificationNotes?: string | null;
  totalCompletedRides: number;
  createdAt: string;
  updatedAt: string;
}

export type DisputeStatus = 'open' | 'investigating' | 'awaiting_response' | 'resolved' | 'closed';

export type DisputeCategory =
  | 'rider_did_not_arrive'
  | 'customer_unavailable'
  | 'payment_disagreement'
  | 'unsafe_driving'
  | 'wrong_destination'
  | 'service_quality'
  | 'other';

export interface Dispute {
  id: string;
  disputeReference: string;
  orderId?: string | null;
  orderReference?: string | null;
  reporterType: 'customer' | 'rider' | 'admin';
  reporterPhone: string;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisputeUpdate {
  id: string;
  disputeId: string;
  authorId: string;
  authorEmail: string;
  updateType: 'status_change' | 'note' | 'resolution';
  oldStatus?: string | null;
  newStatus?: string | null;
  comment: string;
  createdAt: string;
}

export interface AdminAuditLog {
  id: string;
  adminUserId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type SystemHealthStatus = 'Healthy' | 'Warning' | 'Needs attention';

export interface SystemMetricsData {
  healthStatus: SystemHealthStatus;
  healthReason: string;
  totalOrders: number;
  successfulOrders: number;
  failedOrders: number;
  avgAcceptanceSeconds?: number | null;
  onlineRiders: number;
  audioUploadFailures: number;
  imageUploadFailures: number;
  databaseErrorsCount: number;
  recentAuthFailures: string; // "Not yet configured — requires external monitoring"
  recentAdminActionsCount: number;
  recentAuditLogs: AdminAuditLog[];
  evaluatedAt: string;
}
