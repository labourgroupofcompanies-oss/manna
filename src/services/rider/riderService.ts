import { supabase, isSupabaseConfigured } from '../supabase';
import { validateGhanaPhone } from '../../utils';
import { mediaUploadManager } from '../storage/mediaUploadManager';
import type {
  RiderProfile,
  RiderRegistrationPayload,
  RiderLoginPayload,
  AvailableOrderSummary,
  ActiveRiderOrder,
  RiderMetrics
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
        if (authError.message.includes('already registered')) {
          return { success: false, error: 'An account with this phone number already exists. Please log in.' };
        }
        return { success: false, error: authError.message };
      }

      const user = authData.user;
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
          is_available: false
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
        profilePhotoPath: riderRecord.profile_photo_path,
        profilePhotoUrl,
        isAvailable: riderRecord.is_available,
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
        profilePhotoPath: riderRecord.profile_photo_path,
        profilePhotoUrl,
        isAvailable: riderRecord.is_available,
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
        profilePhotoPath: riderRecord.profile_photo_path,
        profilePhotoUrl,
        isAvailable: riderRecord.is_available,
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
   * Fetch available customer orders for online riders (Privacy-Safe)
   */
  async getAvailableOrders(): Promise<AvailableOrderSummary[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      // 1. Try secure RPC function (omits phone numbers, verifies rider is online)
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_available_orders');

      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData.map((o: Record<string, unknown>) => ({
          id: o.id as string,
          orderReference: o.order_reference as string,
          orderType: o.order_type as 'text' | 'voice',
          orderDescription: (o.order_description as string) || null,
          voiceRecordingPath: (o.voice_recording_path as string) || null,
          createdAt: o.created_at as string
        }));
      }

      // 2. Direct fallback query (protects customer phone by selecting only needed fields)
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_reference, order_type, order_description, voice_recording_path, created_at')
        .eq('status', 'pending')
        .is('rider_id', null)
        .order('created_at', { ascending: false })
        .limit(25);

      if (error || !data) return [];

      return data.map((o) => ({
        id: o.id,
        orderReference: o.order_reference,
        orderType: o.order_type as 'text' | 'voice',
        orderDescription: o.order_description,
        voiceRecordingPath: o.voice_recording_path,
        createdAt: o.created_at
      }));
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
  async acceptOrder(orderId: string): Promise<{ success: boolean; order?: ActiveRiderOrder; error?: string }> {
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
          error: data?.error || 'Order could not be accepted. It may have already been taken by another rider.'
        };
      }

      return {
        success: true,
        order: {
          id: data.order.id,
          orderReference: data.order.orderReference,
          customerPhone: data.order.customerPhone,
          orderType: data.order.orderType,
          orderDescription: data.order.orderDescription,
          voiceRecordingPath: data.order.voiceRecordingPath,
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
  }
};
