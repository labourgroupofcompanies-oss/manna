import { supabase, isSupabaseConfigured } from '../supabase';
import {
  validateGhanaPhone,
  matchStation,
  isOrderVisibleToRiderAtWave,
  MAX_STATION_CHANGES_PER_WEEK
} from '../../utils';
import { mediaUploadManager } from '../storage/mediaUploadManager';
import type {
  RiderProfile,
  RiderVerificationStatus,
  RiderRegistrationPayload,
  RiderLoginPayload,
  AvailableOrderSummary,
  ActiveRiderOrder,
  RiderMetrics,
  WalletTransaction
} from '../../types';

/**
 * Standardize Ghanaian phone number into canonical auth email identifier.
 * Ensures that "+233 24 566 0622", "0245660622", and "024-566-0622"
 * all resolve to the exact same deterministic authentication email.
 */
function phoneToAuthEmail(phone: string): string {
  const check = validateGhanaPhone(phone);
  let canonicalDigits = '';

  if (check.isValid && check.formatted) {
    // Standardized 10 digits (e.g. 0245660622)
    canonicalDigits = check.formatted.replace(/\D/g, '');
    if (canonicalDigits.startsWith('233')) {
      canonicalDigits = '0' + canonicalDigits.slice(3);
    }
  } else {
    canonicalDigits = phone.replace(/\D/g, '');
  }

  return `rider_${canonicalDigits}@okadabook.com`;
}

export const riderService = {
  /**
   * Register a new independent Okada Rider
   */
  async registerRider(payload: RiderRegistrationPayload): Promise<{ success: boolean; rider?: RiderProfile; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        success: false,
        error: 'Supabase credentials are not configured in .env. Please connect Supabase to register riders.'
      };
    }

    // 1. Validate Ghana phone
    const phoneCheck = validateGhanaPhone(payload.phoneNumber);
    if (!phoneCheck.isValid || !phoneCheck.formatted) {
      return {
        success: false,
        error: phoneCheck.error || 'Please enter a valid 10-digit Ghanaian phone number.'
      };
    }
    const normalizedPhone = phoneCheck.formatted;

    // 2. Validate Password
    if (!payload.password || payload.password.length < 6) {
      return {
        success: false,
        error: 'Password must be at least 6 characters long.'
      };
    }

    // 3. Validate Motorcycle Details
    if (!payload.fullName.trim() || !payload.motorcycleRegistration.trim() || !payload.motorcycleModel.trim()) {
      return {
        success: false,
        error: 'Please complete all required motorcycle and personal details.'
      };
    }

    try {
      const authEmail = phoneToAuthEmail(normalizedPhone);

      // 4. Duplicate Check in riders table
      const { data: existingRider } = await supabase
        .from('riders')
        .select('id')
        .eq('phone_number', normalizedPhone)
        .maybeSingle();

      if (existingRider) {
        return {
          success: false,
          error: 'This phone number is already registered as a rider. Please log in.'
        };
      }

      // 5. Sign up rider with Supabase Auth
      let authUser = null;
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: authEmail,
        password: payload.password,
        options: {
          data: {
            role: 'rider',
            full_name: payload.fullName.trim(),
            phone: normalizedPhone
          }
        }
      });

      if (authError) {
        // Self-healing recovery: if auth user already exists (e.g. from an earlier attempt where profile creation failed),
        // try signing in to recover and finish setting up the rider profile.
        if (authError.message.toLowerCase().includes('already registered')) {
          const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
            email: authEmail,
            password: payload.password
          });

          if (loginErr || !loginData.user) {
            return {
              success: false,
              error: 'An account with this phone number already exists. Please log in with your password.'
            };
          }

          // Check if profile actually exists
          const { data: existingProfile } = await supabase
            .from('riders')
            .select('id')
            .eq('user_id', loginData.user.id)
            .maybeSingle();

          if (existingProfile) {
            return {
              success: false,
              error: 'This phone number is already registered as a rider. Please log in.'
            };
          }

          // Found orphaned auth user without rider profile, resume registration
          authUser = loginData.user;
        } else {
          return { success: false, error: authError.message };
        }
      } else {
        authUser = authData.user;

        // If email confirmation is enabled in Supabase, session will be null and RLS will fail
        if (!authData.session) {
          // Attempt immediate password login in case user was confirmed
          const { data: loginData } = await supabase.auth.signInWithPassword({
            email: authEmail,
            password: payload.password
          });

          if (!loginData?.session) {
            return {
              success: false,
              error: 'Supabase email confirmation is enabled. Please disable "Confirm email" in Supabase Dashboard (Authentication -> Providers -> Email) because Okada Book uses phone-based login.'
            };
          }
        }
      }

      const user = authUser;
      if (!user) {
        return { success: false, error: 'Registration failed. Could not create rider account.' };
      }

      // 6. Upload profile photo if provided
      let profilePhotoPath: string | null = null;
      let profilePhotoUrl: string | null = null;

      if (payload.profilePhotoFile) {
        try {
          const uploadRes = await mediaUploadManager.uploadRiderProfilePhoto(payload.profilePhotoFile, user.id);
          if (uploadRes.success && uploadRes.storagePath) {
            profilePhotoPath = uploadRes.storagePath;
            const { data: pubUrl } = supabase.storage.from('rider-profiles').getPublicUrl(uploadRes.storagePath);
            profilePhotoUrl = pubUrl.publicUrl;
          }
        } catch {
          // non-fatal, proceed with profile creation
        }
      }

      // 7. Insert record into public.riders
      const { data: riderRecord, error: riderErr } = await supabase
        .from('riders')
        .insert({
          user_id: user.id,
          full_name: payload.fullName.trim(),
          phone_number: normalizedPhone,
          motorcycle_registration: payload.motorcycleRegistration.trim().toUpperCase(),
          motorcycle_model: payload.motorcycleModel.trim(),
          motorcycle_colour: payload.motorcycleColour.trim(),
          operating_area: payload.operatingArea.trim(),
          profile_photo_path: profilePhotoPath,
          is_available: false,
          verification_status: 'pending'
        })
        .select()
        .single();

      if (riderErr) {
        return {
          success: false,
          error: `Profile creation error: ${riderErr.message}. Make sure migration 20261115000001 is applied.`
        };
      }

      const profile: RiderProfile = {
        id: riderRecord.id,
        userId: riderRecord.user_id,
        fullName: riderRecord.full_name,
        phoneNumber: riderRecord.phone_number,
        motorcycleRegistration: riderRecord.motorcycle_registration,
        motorcycleModel: riderRecord.motorcycle_model,
        motorcycleColour: riderRecord.motorcycle_colour,
        operatingArea: riderRecord.operating_area,
        averageRating:
          (riderRecord as Record<string, unknown>).average_rating != null
            ? Number((riderRecord as Record<string, unknown>).average_rating)
            : null,
        totalRatings: Number((riderRecord as Record<string, unknown>).total_ratings) || 0,
        walletBalance: Number((riderRecord as Record<string, unknown>).wallet_balance) || 0,
        freeRidesRemaining:
          (riderRecord as Record<string, unknown>).free_rides_remaining != null
            ? Number((riderRecord as Record<string, unknown>).free_rides_remaining)
            : 2,
        stationChangeCount: (riderRecord as Record<string, unknown>).station_change_count as number | undefined ?? 0,
        stationChangeWeekStart: (riderRecord as Record<string, unknown>).station_change_week_start as string | null ?? null,
        profilePhotoPath: riderRecord.profile_photo_path,
        profilePhotoUrl,
        isAvailable: riderRecord.is_available,
        verificationStatus: (riderRecord.verification_status || 'pending') as RiderVerificationStatus,
        verificationSubmittedAt: riderRecord.verification_submitted_at,
        verifiedAt: riderRecord.verified_at,
        verifiedBy: riderRecord.verified_by,
        verificationNotes: riderRecord.verification_notes,
        createdAt: riderRecord.created_at,
        updatedAt: riderRecord.updated_at
      };

      return { success: true, rider: profile };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message || 'An error occurred during registration.' };
    }
  },

  /**
   * Log in an existing rider using phone number and password
   */
  async loginRider(payload: RiderLoginPayload): Promise<{ success: boolean; rider?: RiderProfile; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        success: false,
        error: 'Supabase credentials are not configured. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.'
      };
    }

    const phoneCheck = validateGhanaPhone(payload.phoneNumber);
    if (!phoneCheck.isValid || !phoneCheck.formatted) {
      return { success: false, error: 'Please enter a valid Ghanaian phone number (e.g. 0245660622).' };
    }

    try {
      const authEmail = phoneToAuthEmail(phoneCheck.formatted);

      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: payload.password
      });

      if (authErr) {
        return {
          success: false,
          error: 'Incorrect phone number or password. Please verify and try again.'
        };
      }

      const user = authData.user;
      if (!user) {
        return { success: false, error: 'Login failed. Please try again.' };
      }

      // Fetch rider profile
      const { data: riderRecord, error: profileErr } = await supabase
        .from('riders')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileErr || !riderRecord) {
        return {
          success: false,
          error: 'Rider profile not found. If you have not registered, please complete registration first.'
        };
      }

      let profilePhotoUrl: string | null = null;
      if (riderRecord.profile_photo_path) {
        const { data: pUrl } = supabase.storage.from('rider-profiles').getPublicUrl(riderRecord.profile_photo_path);
        profilePhotoUrl = pUrl.publicUrl;
      }

      const profile: RiderProfile = {
        id: riderRecord.id,
        userId: riderRecord.user_id,
        fullName: riderRecord.full_name,
        phoneNumber: riderRecord.phone_number,
        motorcycleRegistration: riderRecord.motorcycle_registration,
        motorcycleModel: riderRecord.motorcycle_model,
        motorcycleColour: riderRecord.motorcycle_colour,
        operatingArea: riderRecord.operating_area,
        averageRating:
          (riderRecord as Record<string, unknown>).average_rating != null
            ? Number((riderRecord as Record<string, unknown>).average_rating)
            : null,
        totalRatings: Number((riderRecord as Record<string, unknown>).total_ratings) || 0,
        walletBalance: Number((riderRecord as Record<string, unknown>).wallet_balance) || 0,
        freeRidesRemaining:
          (riderRecord as Record<string, unknown>).free_rides_remaining != null
            ? Number((riderRecord as Record<string, unknown>).free_rides_remaining)
            : 2,
        stationChangeCount: (riderRecord as Record<string, unknown>).station_change_count as number | undefined ?? 0,
        stationChangeWeekStart: (riderRecord as Record<string, unknown>).station_change_week_start as string | null ?? null,
        profilePhotoPath: riderRecord.profile_photo_path,
        profilePhotoUrl,
        isAvailable: riderRecord.is_available,
        verificationStatus: (riderRecord.verification_status || 'pending') as RiderVerificationStatus,
        verificationSubmittedAt: riderRecord.verification_submitted_at,
        verifiedAt: riderRecord.verified_at,
        verifiedBy: riderRecord.verified_by,
        verificationNotes: riderRecord.verification_notes,
        createdAt: riderRecord.created_at,
        updatedAt: riderRecord.updated_at
      };

      return { success: true, rider: profile };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message || 'An error occurred during rider login.' };
    }
  },

  /**
   * Log out rider
   */
  async logoutRider(): Promise<void> {
    if (supabase) {
      await supabase.auth.signOut();
    }
  },

  /**
   * Get current authenticated rider profile
   */
  async getCurrentRider(): Promise<RiderProfile | null> {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) return null;

      const { data: riderRecord } = await supabase
        .from('riders')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!riderRecord) return null;

      let profilePhotoUrl: string | null = null;
      if (riderRecord.profile_photo_path) {
        const { data: pUrl } = supabase.storage.from('rider-profiles').getPublicUrl(riderRecord.profile_photo_path);
        profilePhotoUrl = pUrl.publicUrl;
      }

      return {
        id: riderRecord.id,
        userId: riderRecord.user_id,
        fullName: riderRecord.full_name,
        phoneNumber: riderRecord.phone_number,
        motorcycleRegistration: riderRecord.motorcycle_registration,
        motorcycleModel: riderRecord.motorcycle_model,
        motorcycleColour: riderRecord.motorcycle_colour,
        operatingArea: riderRecord.operating_area,
        averageRating:
          (riderRecord as Record<string, unknown>).average_rating != null
            ? Number((riderRecord as Record<string, unknown>).average_rating)
            : null,
        totalRatings: Number((riderRecord as Record<string, unknown>).total_ratings) || 0,
        walletBalance: Number((riderRecord as Record<string, unknown>).wallet_balance) || 0,
        freeRidesRemaining:
          (riderRecord as Record<string, unknown>).free_rides_remaining != null
            ? Number((riderRecord as Record<string, unknown>).free_rides_remaining)
            : 2,
        stationChangeCount: (riderRecord as Record<string, unknown>).station_change_count as number | undefined ?? 0,
        stationChangeWeekStart: (riderRecord as Record<string, unknown>).station_change_week_start as string | null ?? null,
        profilePhotoPath: riderRecord.profile_photo_path,
        profilePhotoUrl,
        isAvailable: riderRecord.is_available,
        verificationStatus: (riderRecord.verification_status || 'pending') as RiderVerificationStatus,
        verificationSubmittedAt: riderRecord.verification_submitted_at,
        verifiedAt: riderRecord.verified_at,
        verifiedBy: riderRecord.verified_by,
        verificationNotes: riderRecord.verification_notes,
        createdAt: riderRecord.created_at,
        updatedAt: riderRecord.updated_at
      };
    } catch {
      return null;
    }
  },

  /**
   * Toggle rider online/offline availability
   */
  async toggleAvailability(isAvailable: boolean): Promise<{ success: boolean; isAvailable: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, isAvailable, error: 'Supabase is not configured.' };
    }

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        return { success: false, isAvailable, error: 'Authentication session expired.' };
      }

      // Check if rider account is suspended before going online
      if (isAvailable) {
        const { data: riderRec } = await supabase
          .from('riders')
          .select('verification_status')
          .eq('user_id', userData.user.id)
          .maybeSingle();

        if (riderRec?.verification_status && ['suspended', 'rejected'].includes(riderRec.verification_status)) {
          return {
            success: false,
            isAvailable: false,
            error: 'Your rider account has been suspended by administration. You cannot go online.'
          };
        }
      }

      const { error } = await supabase
        .from('riders')
        .update({ is_available: isAvailable })
        .eq('user_id', userData.user.id);

      if (error) {
        return { success: false, isAvailable: !isAvailable, error: error.message };
      }

      return { success: true, isAvailable };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, isAvailable: !isAvailable, error: error.message };
    }
  },

  /**
   * Change rider's current moto station (max 2 changes per 7-day rolling week)
   */
  async changeStation(newStationName: string): Promise<{
    success: boolean;
    operatingArea?: string;
    changesRemaining?: number;
    error?: string;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Supabase is not configured.' };
    }

    const matched = matchStation(newStationName);
    if (!matched) {
      return { success: false, error: 'Please select a valid Kadjebi moto station.' };
    }

    try {
      // 1. Prefer server-enforced RPC (strictly enforces 2/week limit in Postgres)
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('change_rider_station', {
        p_new_station: matched.name
      });

      if (!rpcErr && rpcRes && typeof rpcRes === 'object') {
        const resObj = rpcRes as {
          success?: boolean;
          operating_area?: string;
          changes_remaining?: number;
          error?: string;
        };
        if (resObj.success) {
          return {
            success: true,
            operatingArea: resObj.operating_area || matched.name,
            changesRemaining: resObj.changes_remaining
          };
        }
        return {
          success: false,
          changesRemaining: resObj.changes_remaining,
          error: resObj.error || 'Could not change station.'
        };
      }

      // 2. Client-guarded fallback if SQL migration hasn't been run yet
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        return { success: false, error: 'Authentication session expired.' };
      }

      const storageKey = `manna_rider_station_changes_${userData.user.id}`;
      let count = 0;
      let weekStartMs = Date.now();
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const saved = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
          if (saved && typeof saved.weekStartMs === 'number' && Date.now() - saved.weekStartMs < 7 * 86400 * 1000) {
            count = Number(saved.count) || 0;
            weekStartMs = saved.weekStartMs;
          }
        } catch {
          // ignore
        }
      }

      if (count >= MAX_STATION_CHANGES_PER_WEEK) {
        return {
          success: false,
          changesRemaining: 0,
          error: `You have used your ${MAX_STATION_CHANGES_PER_WEEK} station changes for this week.`
        };
      }

      const { error: updateErr } = await supabase
        .from('riders')
        .update({ operating_area: matched.name })
        .eq('user_id', userData.user.id);

      if (updateErr) {
        return { success: false, error: updateErr.message };
      }

      const nextCount = count + 1;
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify({ count: nextCount, weekStartMs }));
        } catch {
          // ignore
        }
      }

      return {
        success: true,
        operatingArea: matched.name,
        changesRemaining: Math.max(0, MAX_STATION_CHANGES_PER_WEEK - nextCount)
      };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message || 'Failed to update station.' };
    }
  },

  /**
   * Fetch available customer orders for online riders (Privacy-Safe)
   */
  async getAvailableOrders(): Promise<AvailableOrderSummary[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      // 1. Try secure RPC function (omits phone numbers, verifies rider is online, applies wave filter)
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_available_orders');

      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData.map((o: Record<string, unknown>) => ({
          id: o.id as string,
          orderReference: o.order_reference as string,
          orderType: o.order_type as 'text' | 'voice',
          orderDescription: (o.order_description as string) || null,
          voiceRecordingPath: (o.voice_recording_path as string) || null,
          customerComment: (o.customer_comment as string) || null,
          pickupStation:
            (o.pickup_station as string | null) ||
            matchStation((o.order_description as string) || '')?.name ||
            null,
          createdAt: o.created_at as string
        }));
      }

      // 2. Direct fallback query (protects customer phone and applies station wave filter client-side)
      const currentRider = await this.getCurrentRider();
      if (!currentRider || !currentRider.isAvailable || ['suspended', 'rejected'].includes(currentRider.verificationStatus)) {
        return [];
      }

      const { data, error } = await supabase
        .from('orders')
        .select('id, order_reference, order_type, order_description, voice_recording_path, customer_comment, created_at')
        .eq('status', 'pending')
        .is('rider_id', null)
        .order('created_at', { ascending: false })
        .limit(25);

      if (error || !data) return [];

      return data
        .map((o) => {
          const rec = o as Record<string, unknown>;
          const pickupStation =
            (rec.pickup_station as string | null) ||
            matchStation(o.order_description || '')?.name ||
            null;
          return {
            id: o.id,
            orderReference: o.order_reference,
            orderType: o.order_type as 'text' | 'voice',
            orderDescription: o.order_description,
            voiceRecordingPath: o.voice_recording_path,
            customerComment: (rec.customer_comment as string | null) ?? null,
            pickupStation,
            createdAt: o.created_at
          };
        })
        .filter((o) =>
          isOrderVisibleToRiderAtWave(o.pickupStation, currentRider.operatingArea, o.createdAt)
        );
    } catch {
      return [];
    }
  },

  /**
   * Fetch orders currently assigned to this rider
   * Uses resolved rider.id (public.riders.id)
   */
  async getActiveOrders(): Promise<ActiveRiderOrder[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const rider = await this.getCurrentRider();
      if (!rider) return [];

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('rider_id', rider.id)
        .eq('status', 'accepted')
        .order('accepted_at', { ascending: false });

      if (error || !data) return [];

      return data.map((o) => ({
        id: o.id,
        orderReference: o.order_reference,
        customerPhone: o.customer_phone,
        orderType: o.order_type as 'text' | 'voice',
        orderDescription: o.order_description,
        voiceRecordingPath: o.voice_recording_path,
        customerComment: (o as Record<string, unknown>).customer_comment as string | null ?? null,
        status: o.status,
        createdAt: o.created_at,
        acceptedAt: o.accepted_at || o.created_at
      }));
    } catch {
      return [];
    }
  },

  /**
   * Concurrency-safe Order Acceptance (Atomic database row-lock update)
   */
  async acceptOrder(orderId: string): Promise<{
    success: boolean;
    order?: ActiveRiderOrder;
    insufficientBalance?: boolean;
    walletBalance?: number;
    freeRidesRemaining?: number;
    chargedAmount?: number;
    error?: string;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Backend is not configured.' };
    }

    try {
      // Invoke atomic accept_order RPC
      const { data, error } = await supabase.rpc('accept_order', {
        p_order_id: orderId
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data || !data.success) {
        return {
          success: false,
          insufficientBalance: data?.code === 'INSUFFICIENT_BALANCE',
          walletBalance: data?.wallet_balance != null ? Number(data.wallet_balance) : undefined,
          error: data?.error || 'Order could not be accepted. It may have already been taken by another rider.'
        };
      }

      return {
        success: true,
        walletBalance: data.walletBalance != null ? Number(data.walletBalance) : undefined,
        freeRidesRemaining: data.freeRidesRemaining != null ? Number(data.freeRidesRemaining) : undefined,
        chargedAmount: data.chargedAmount != null ? Number(data.chargedAmount) : undefined,
        order: {
          id: data.order.id,
          orderReference: data.order.orderReference,
          customerPhone: data.order.customerPhone,
          orderType: data.order.orderType,
          orderDescription: data.order.orderDescription,
          voiceRecordingPath: data.order.voiceRecordingPath,
          customerComment: data.order.customerComment ?? data.order.customer_comment ?? null,
          status: data.order.status,
          createdAt: data.order.createdAt,
          acceptedAt: data.order.acceptedAt
        }
      };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message || 'Error accepting order.' };
    }
  },

  /**
   * Mark an accepted order as completed
   */
  async completeOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Backend is not configured.' };
    }

    try {
      const { data, error } = await supabase.rpc('complete_order', {
        p_order_id: orderId
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data || !data.success) {
        return { success: false, error: data?.error || 'Could not complete order.' };
      }

      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message };
    }
  },

  /**
   * Get metrics for today's rides
   * Uses resolved rider.id (public.riders.id)
   */
  async getTodayMetrics(): Promise<RiderMetrics> {
    if (!isSupabaseConfigured || !supabase) {
      return { todayCompletedCount: 0, todayAcceptedCount: 0 };
    }

    try {
      const rider = await this.getCurrentRider();
      if (!rider) return { todayCompletedCount: 0, todayAcceptedCount: 0 };

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: completedData } = await supabase
        .from('orders')
        .select('id')
        .eq('rider_id', rider.id)
        .eq('status', 'completed')
        .gte('created_at', todayStart.toISOString());

      const { data: activeData } = await supabase
        .from('orders')
        .select('id')
        .eq('rider_id', rider.id)
        .eq('status', 'accepted');

      return {
        todayCompletedCount: completedData ? completedData.length : 0,
        todayAcceptedCount: activeData ? activeData.length : 0
      };
    } catch {
      return { todayCompletedCount: 0, todayAcceptedCount: 0 };
    }
  },

  /**
   * Generate temporary signed URL to listen to customer voice request
   */
  async getVoiceAudioUrl(path: string): Promise<string | null> {
    if (!isSupabaseConfigured || !supabase || !path) return null;
    try {
      const { data, error } = await supabase.storage.from('order-recordings').createSignedUrl(path, 3600);
      if (error || !data) return null;
      return data.signedUrl;
    } catch {
      return null;
    }
  },

  /**
   * Fetch recent wallet transactions for the logged-in rider
   */
  async getWalletTransactions(limit = 20): Promise<WalletTransaction[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    try {
      const rider = await this.getCurrentRider();
      if (!rider) return [];

      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('rider_id', rider.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !data) return [];

      return data.map((tx: Record<string, unknown>) => ({
        id: tx.id as string,
        riderId: tx.rider_id as string,
        orderReference: (tx.order_reference as string) || null,
        type: tx.type as WalletTransaction['type'],
        amount: Number(tx.amount) || 0,
        balanceAfter: Number(tx.balance_after) || 0,
        paystackReference: (tx.paystack_reference as string) || null,
        description: (tx.description as string) || '',
        createdAt: tx.created_at as string
      }));
    } catch {
      return [];
    }
  },

  /**
   * Initialize a Paystack MoMo/Card wallet top-up via secure Edge Function
   */
  async initializePaystackTopup(amountGhs: number): Promise<{
    success: boolean;
    authorizationUrl?: string;
    reference?: string;
    error?: string;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Backend is not configured.' };
    }
    try {
      const callbackUrl =
        typeof window !== 'undefined' ? `${window.location.origin}/rider` : undefined;

      const { data, error } = await supabase.functions.invoke('paystack-initialize', {
        body: { amount: amountGhs, callbackUrl }
      });

      if (error) {
        return { success: false, error: error.message || 'Could not start Paystack payment.' };
      }
      if (!data?.success || !data?.authorizationUrl) {
        return { success: false, error: data?.error || 'Could not start Paystack payment.' };
      }

      return {
        success: true,
        authorizationUrl: data.authorizationUrl,
        reference: data.reference
      };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message || 'Payment initialization failed.' };
    }
  },

  /**
   * Verify a completed Paystack top-up and credit the rider's wallet
   */
  async verifyPaystackTopup(reference: string): Promise<{
    success: boolean;
    amountCredited?: number;
    walletBalance?: number;
    error?: string;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Backend is not configured.' };
    }
    try {
      const { data, error } = await supabase.functions.invoke('paystack-verify', {
        body: { reference }
      });

      if (error) {
        return { success: false, error: error.message || 'Could not verify payment.' };
      }
      if (!data?.success) {
        return { success: false, error: data?.error || 'Payment verification failed.' };
      }

      return {
        success: true,
        amountCredited: Number(data.amountCredited) || 0,
        walletBalance: Number(data.walletBalance) || 0
      };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message || 'Payment verification failed.' };
    }
  },

  /**
   * Submit a refund request for a cancelled / no-show accepted order (reviewed by Support)
   */
  async requestOrderRefund(orderId: string, reason: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Backend is not configured.' };
    }
    try {
      const { data, error } = await supabase.rpc('request_order_refund', {
        p_order_id: orderId,
        p_reason: reason.trim()
      });

      if (error) {
        return { success: false, error: error.message || 'Could not submit request.' };
      }
      if (!data?.success) {
        return { success: false, error: data?.error || 'Could not submit request.' };
      }

      return {
        success: true,
        message: data.message || 'Request submitted. Support will review and update your wallet.'
      };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message || 'Could not submit request.' };
    }
  },

  /**
   * Fetch Manna's official MoMo payment details for manual top-up
   */
  async getPaymentSettings(): Promise<{
    momoNumber: string;
    momoName: string;
    momoNetwork: string;
    feePerRide: number;
  }> {
    const fallback = {
      momoNumber: '0245660622',
      momoName: 'Labour App Enterprise',
      momoNetwork: 'MTN MoMo',
      feePerRide: 3
    };
    if (!isSupabaseConfigured || !supabase) return fallback;
    try {
      const { data, error } = await supabase
        .from('platform_payment_settings')
        .select('momo_number, momo_name, momo_network, fee_per_ride')
        .eq('id', 1)
        .maybeSingle();

      if (error || !data) return fallback;
      return {
        momoNumber: data.momo_number || fallback.momoNumber,
        momoName: data.momo_name || fallback.momoName,
        momoNetwork: data.momo_network || fallback.momoNetwork,
        feePerRide: Number(data.fee_per_ride) || 3
      };
    } catch {
      return fallback;
    }
  },

  /**
   * Fetch the rider's recent manual MoMo top-up requests (pending/approved/rejected)
   */
  async getManualTopupRequests(limit = 5): Promise<
    Array<{
      id: string;
      amount: number;
      momoNetwork: string;
      transactionId: string;
      status: 'pending' | 'approved' | 'rejected';
      createdAt: string;
    }>
  > {
    if (!isSupabaseConfigured || !supabase) return [];
    try {
      const rider = await this.getCurrentRider();
      if (!rider) return [];

      const { data, error } = await supabase
        .from('manual_topup_requests')
        .select('id, amount, momo_network, transaction_id, status, created_at')
        .eq('rider_id', rider.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !data) return [];
      return data.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        amount: Number(row.amount) || 0,
        momoNetwork: (row.momo_network as string) || 'MTN MoMo',
        transactionId: (row.transaction_id as string) || '',
        status: (row.status as 'pending' | 'approved' | 'rejected') || 'pending',
        createdAt: row.created_at as string
      }));
    } catch {
      return [];
    }
  },

  /**
   * Submit a manual MoMo top-up with the rider's MoMo SMS Transaction ID
   */
  async submitManualTopup(params: {
    amount: number;
    momoNetwork: string;
    senderPhone: string;
    transactionId: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Backend is not configured.' };
    }
    try {
      const { data, error } = await supabase.rpc('submit_manual_topup_request', {
        p_amount: params.amount,
        p_momo_network: params.momoNetwork,
        p_sender_phone: params.senderPhone,
        p_transaction_id: params.transactionId
      });

      if (error) {
        return { success: false, error: error.message || 'Could not submit top-up.' };
      }
      if (!data?.success) {
        return { success: false, error: data?.error || 'Could not submit top-up.' };
      }

      return {
        success: true,
        message:
          data.message ||
          'Top-up submitted! Manna Support will confirm your MoMo payment and credit your wallet shortly.'
      };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message || 'Could not submit top-up.' };
    }
  }
};
