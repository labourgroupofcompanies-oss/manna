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

export interface RiderProfile extends UserProfile {
  role: 'rider';
  isAvailable: boolean;
  motorcycleNumberPlate?: string;
  currentLocation?: {
    latitude: number;
    longitude: number;
    updatedAt: string;
  };
}
