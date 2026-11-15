/**
 * Order domain types for Okada Book
 */
export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'rider_arrived'
  | 'in_transit'
  | 'completed'
  | 'cancelled';

export interface OrderLocation {
  address?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
}

export interface OrderVoiceNote {
  audioUrl?: string;
  durationSeconds?: number;
  transcription?: string;
}

export interface Order {
  id: string;
  customerPhone: string;
  requestDescription: string;
  voiceNote?: OrderVoiceNote;
  status: OrderStatus;
  pickupLocation?: OrderLocation;
  dropoffLocation?: OrderLocation;
  riderId?: string;
  createdAt: string;
  updatedAt: string;
}
