/**
 * Order domain types for Okada Book
 */
export type OrderStatus =
  | 'pending'
  | 'assigned'
  | 'accepted'
  | 'completed'
  | 'cancelled';

export type OrderType = 'text' | 'voice';

export interface OrderLocation {
  address?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
}

export interface OrderVoiceNote {
  audioUrl?: string;
  durationSeconds?: number;
  storagePath?: string;
}

export interface Order {
  id: string;
  orderReference: string;
  customerPhone: string;
  orderType: OrderType;
  requestDescription?: string | null;
  voiceRecordingPath?: string | null;
  customerComment?: string | null;
  voiceNote?: OrderVoiceNote;
  bookingToken?: string;
  status: OrderStatus;
  pickupLocation?: OrderLocation;
  dropoffLocation?: OrderLocation;
  riderId?: string | null;
  riderName?: string | null;
  riderPhone?: string | null;
  motorcycleModel?: string | null;
  motorcycleReg?: string | null;
  motorcycleColour?: string | null;
  riderPhotoUrl?: string | null;
  operatingArea?: string | null;
  acceptedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload sent by the customer booking interface
 */
export interface SubmitOrderPayload {
  customerPhone: string;
  orderType: OrderType;
  orderDescription?: string;
  audioFile?: Blob;
  durationSeconds?: number;
}

/**
 * Response returned from tracking query
 */
export interface TrackOrderResponse {
  success: boolean;
  order?: Order;
  error?: string;
}

/**
 * Response returned from customer phone order list query
 */
export interface CustomerOrdersResponse {
  success: boolean;
  orders?: Order[];
  error?: string;
}

/**
 * Response returned from the submit-order Edge Function
 */
export interface SubmitOrderResponse {
  success: boolean;
  orderReference?: string;
  orderId?: string;
  bookingToken?: string;
  voiceRecordingPath?: string | null;
  status?: OrderStatus;
  createdAt?: string;
  message?: string;
  error?: string;
  isQueuedOffline?: boolean;
}
