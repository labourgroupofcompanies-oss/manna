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
  voiceNote?: OrderVoiceNote;
  status: OrderStatus;
  pickupLocation?: OrderLocation;
  dropoffLocation?: OrderLocation;
  riderId?: string;
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
 * Response returned from the submit-order Edge Function
 */
export interface SubmitOrderResponse {
  success: boolean;
  orderReference?: string;
  orderId?: string;
  status?: OrderStatus;
  createdAt?: string;
  message?: string;
  error?: string;
}
