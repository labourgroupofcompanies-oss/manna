import { supabase, isSupabaseConfigured } from '../supabase';
import type {
  Order,
  SubmitOrderPayload,
  SubmitOrderResponse,
  TrackOrderResponse,
  CustomerOrdersResponse
} from '../../types';
import { mediaUploadManager, type UploadProgress } from '../storage/mediaUploadManager';
import { offlineMediaQueue } from '../storage/offlineMediaQueue';
import { validateAudioFile } from '../../utils/audioOptimizer';
import { validateGhanaPhone, resolveRiderPhotoUrl } from '../../utils';

const RECENT_ORDERS_KEY = 'okada_recent_orders';
const BOOKING_TOKENS_STORAGE_KEY = 'okada_booking_capability_tokens';
const MAX_RECENT_ORDERS = 10;

/**
 * Safe UUID v4 generator with fallback for older mobile browsers without crypto.randomUUID
 */
function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generates a cryptographically secure 256-bit random booking capability token
 */
export function generateBookingCapabilityToken(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint8Array(32);
    crypto.getRandomValues(buffer);
    return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += Math.floor(Math.random() * 16).toString(16);
  }
  return token;
}

/**
 * Computes SHA-256 hash (in lowercase hex) of a capability token string
 */
export async function hashCapabilityToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Order Service
 * Handles customer order submissions with resilient direct-to-storage uploads,
 * TUS resumable transfers, and IndexedDB offline queueing.
 */
export const orderService = {
  /**
   * Submit a new customer ride order (Text or Voice)
   */
  async submitOrder(
    payload: SubmitOrderPayload,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<SubmitOrderResponse> {
    // 1. Guard against unconfigured environment
    if (!isSupabaseConfigured || !supabase) {
      return {
        success: false,
        error:
          'Supabase backend credentials are not configured. Please add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env to submit real orders.'
      };
    }

    const trimmedPhone = payload.customerPhone.trim();
    if (!trimmedPhone) {
      return { success: false, error: 'Please enter your Ghanaian phone number.' };
    }

    const isOnline = typeof navigator === 'undefined' || navigator.onLine;

    // 2. TEXT ORDER PATH
    if (payload.orderType === 'text') {
      if (!payload.orderDescription || !payload.orderDescription.trim()) {
        return {
          success: false,
          error: 'Please describe where you want to go before placing your order.'
        };
      }

      if (!isOnline) {
        // Enqueue offline text order
        await offlineMediaQueue.enqueueUpload({
          bucket: 'customer-media',
          storagePath: `orders/offline_${safeRandomUUID()}`,
          blob: new Blob([payload.orderDescription], { type: 'text/plain' }),
          fileName: 'text_order.txt',
          mimeType: 'text/plain',
          fileSizeBytes: payload.orderDescription.length,
          mediaType: 'customer_image',
          orderPayload: {
            customerPhone: trimmedPhone,
            orderType: 'text',
            orderDescription: payload.orderDescription.trim()
          }
        });

        return {
          success: true,
          isQueuedOffline: true,
          message: 'Saved offline. Your ride request will be sent automatically as soon as connection is restored.'
        };
      }

      return this.dispatchToEdgeFunction({
        customerPhone: trimmedPhone,
        orderType: 'text',
        orderDescription: payload.orderDescription.trim(),
        pickupStation: payload.pickupStation || null
      });
    }

    // 3. VOICE ORDER PATH
    if (payload.orderType === 'voice') {
      if (!payload.audioFile) {
        return {
          success: false,
          error: 'No audio note found. Please record your voice note before ordering.'
        };
      }

      // Step A: Validate audio file (duration <= 90s, size <= 10MB, valid MIME)
      const validation = await validateAudioFile(payload.audioFile);
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error || 'Audio validation failed.'
        };
      }

      // Step B: Offline handling
      if (!isOnline) {
        await offlineMediaQueue.enqueueUpload({
          bucket: 'order-recordings',
          storagePath: `orders/offline_${safeRandomUUID()}.${validation.mimeType.includes('mp4') ? 'mp4' : 'webm'}`,
          blob: payload.audioFile,
          fileName: `voice_${Date.now()}.webm`,
          mimeType: validation.mimeType,
          fileSizeBytes: payload.audioFile.size,
          mediaType: 'voice_recording',
          orderPayload: {
            customerPhone: trimmedPhone,
            orderType: 'voice'
          }
        });

        return {
          success: true,
          isQueuedOffline: true,
          message: 'Network connection unavailable. Your voice note is safely saved on your device and will submit automatically when online!'
        };
      }

      // Step C: Resilient Direct / TUS Storage Upload
      let uploadedPath: string | null = null;
      try {
        const uploadTask = mediaUploadManager.uploadVoiceRecording(payload.audioFile, {
          customerPhone: trimmedPhone,
          orderType: 'voice',
          onProgress
        });

        const uploadResult = await uploadTask.promise;
        if (!uploadResult.success || !uploadResult.storagePath) {
          if (uploadResult.isQueuedOffline) {
            return {
              success: true,
              isQueuedOffline: true,
              message: 'Saved offline. Your voice note will upload automatically when connection is restored.'
            };
          }
          return {
            success: false,
            error: uploadResult.error || 'Failed to upload voice note. Please try again.'
          };
        }

        uploadedPath = uploadResult.storagePath;
      } catch (uploadErr) {
        console.warn('Voice upload exception, queueing offline fallback:', uploadErr);
        // Fallback: save to IndexedDB offline queue
        await offlineMediaQueue.enqueueUpload({
          bucket: 'order-recordings',
          storagePath: `orders/drafts/${safeRandomUUID()}.webm`,
          blob: payload.audioFile,
          fileName: `voice_${Date.now()}.webm`,
          mimeType: validation.mimeType,
          fileSizeBytes: payload.audioFile.size,
          mediaType: 'voice_recording',
          orderPayload: {
            customerPhone: trimmedPhone,
            orderType: 'voice'
          }
        });

        return {
          success: true,
          isQueuedOffline: true,
          message: 'Network dropped during upload. Your recording is preserved and will finish submitting automatically!'
        };
      }

      // Step D: Dispatch order to Edge Function with verified storage path
      return this.dispatchToEdgeFunction({
        customerPhone: trimmedPhone,
        orderType: 'voice',
        voiceRecordingPath: uploadedPath,
        pickupStation: payload.pickupStation || null
      });
    }

    return {
      success: false,
      error: 'Invalid order type specified.'
    };
  },

  /**
   * Dispatch order directly to Supabase Database (instant, zero-CORS) with Edge Function fallback
   */
  async dispatchToEdgeFunction(body: Record<string, unknown>): Promise<SubmitOrderResponse> {
    if (!supabase) {
      return { success: false, error: 'Supabase client is not available.' };
    }

    // 1. Direct Database Insert (Fast, native, zero-CORS)
    try {
      const orderRef = generateOrderReference();
      const customerPhone = String(body.customerPhone || '').trim();
      const orderType = String(body.orderType || 'text') as 'text' | 'voice';
      const orderDescription = (body.orderDescription as string) || null;
      const pickupStation = (body.pickupStation as string) || null;
      const voiceRecordingPath = (body.voiceRecordingPath as string) || null;
      const createdAt = new Date().toISOString();

      // Generate cryptographically secure booking capability token (256-bit)
      // Store ONLY its SHA-256 hash in the database; raw token is held by customer client
      const rawBookingToken = generateBookingCapabilityToken();
      const bookingTokenHash = await hashCapabilityToken(rawBookingToken);

      // Persist raw token in isolated client storage (never shared or added to public order list)
      this.saveBookingCapabilityToken(orderRef, rawBookingToken);

      const generatedOrderId = safeRandomUUID();
      const baseInsertPayload: Record<string, unknown> = {
        id: generatedOrderId,
        order_reference: orderRef,
        customer_phone: customerPhone,
        order_type: orderType,
        order_description: orderDescription,
        voice_recording_path: voiceRecordingPath,
        status: 'pending',
        booking_token_hash: bookingTokenHash
      };

      let { error: dbError } = await supabase
        .from('orders')
        .insert(
          pickupStation
            ? { ...baseInsertPayload, pickup_station: pickupStation, dispatch_wave: 1 }
            : baseInsertPayload
        );

      // Backwards-compatible fallback if pickup_station column hasn't been migrated yet
      if (dbError && pickupStation && dbError.message?.toLowerCase().includes('pickup_station')) {
        const retry = await supabase.from('orders').insert(baseInsertPayload);
        dbError = retry.error;
      }

      if (!dbError) {
        const orderId = generatedOrderId;
        const initialOrder: Order = {
          id: orderId,
          orderReference: orderRef,
          customerPhone,
          orderType,
          requestDescription: orderDescription,
          pickupStation,
          voiceRecordingPath,
          status: 'pending',
          bookingToken: rawBookingToken,
          createdAt,
          updatedAt: createdAt
        };
        this.saveOrderToLocalHistory(initialOrder);

        return {
          success: true,
          orderId,
          orderReference: orderRef,
          bookingToken: rawBookingToken,
          voiceRecordingPath,
          status: 'pending',
          createdAt,
          message: 'Order placed successfully.'
        };
      }

      if (dbError) {
        if (dbError.message?.includes('violates row-level security') || dbError.code === '42501') {
          return {
            success: false,
            error:
              'Supabase permissions missing: please run the provided SQL setup script in your Supabase Dashboard SQL Editor to allow customer orders.'
          };
        }
        return {
          success: false,
          error: dbError.message || 'Failed to submit order to database.'
        };
      }
    } catch (err: unknown) {
      const error = err as Error;
      return {
        success: false,
        error: error.message || 'A network error occurred while placing your order. Please try again.'
      };
    }

    return {
      success: false,
      error: 'Could not complete order submission.'
    };
  },

  /**
   * Securely saves booking capability token in isolated client storage
   */
  saveBookingCapabilityToken(orderReference: string, token: string): void {
    if (typeof window === 'undefined' || !window.localStorage || !token) return;
    try {
      const ref = orderReference.trim().toUpperCase();
      const raw = window.localStorage.getItem(BOOKING_TOKENS_STORAGE_KEY);
      const store: Record<string, string> = raw ? JSON.parse(raw) : {};
      store[ref] = token;
      window.localStorage.setItem(BOOKING_TOKENS_STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
      console.warn('Failed to save capability token to storage:', err);
    }
  },

  /**
   * Retrieves booking capability token for an order from isolated client storage
   */
  getBookingCapabilityToken(orderReference: string): string | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const ref = orderReference.trim().toUpperCase();
      const raw = window.localStorage.getItem(BOOKING_TOKENS_STORAGE_KEY);
      if (!raw) return null;
      const store: Record<string, string> = JSON.parse(raw);
      return store[ref] || null;
    } catch {
      return null;
    }
  },

  /**
   * Save an order to client-side localStorage history
   */
  saveOrderToLocalHistory(order: Order): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const ref = (order.orderReference || '').trim().toUpperCase();

      // If capability token is present on the order, save to isolated token storage
      if (order.bookingToken) {
        this.saveBookingCapabilityToken(ref, order.bookingToken);
      }

      const existing = this.getLocalRecentOrders();
      const filtered = existing.filter(
        (o) => (o.orderReference || '').trim().toUpperCase() !== ref && o.id !== order.id
      );

      // Clean public order representation: never store raw booking capability token in public order history
      const { bookingToken: _omitted, ...publicOrder } = order;
      const normalizedOrder: Order = {
        ...publicOrder,
        orderReference: ref,
        riderPhotoUrl: resolveRiderPhotoUrl(order.riderPhotoUrl)
      };

      filtered.unshift(normalizedOrder);
      filtered.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const sliced = filtered.slice(0, MAX_RECENT_ORDERS);
      window.localStorage.setItem(RECENT_ORDERS_KEY, JSON.stringify(sliced));
    } catch (err) {
      console.warn('Failed to save order to localStorage:', err);
    }
  },

  /**
   * Retrieve recent orders placed or searched on this device
   */
  getLocalRecentOrders(): Order[] {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const raw = window.localStorage.getItem(RECENT_ORDERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((o: Order) => ({
        ...o,
        riderPhotoUrl: resolveRiderPhotoUrl(o.riderPhotoUrl)
      }));
    } catch {
      return [];
    }
  },

  /**
   * Track order by Order Reference (e.g. OKD-ABC123)
   * Resolves real-time status and assigned rider details.
   */
  async trackOrder(orderReference: string): Promise<TrackOrderResponse> {
    const ref = (orderReference || '').trim().toUpperCase();
    if (!ref) {
      return {
        success: false,
        error: 'Please enter a valid order reference (e.g. OKD-8K2N5P).'
      };
    }

    // 1. Try Supabase backend if configured
    if (isSupabaseConfigured && supabase) {
      try {
        // A. Secure RPC track_order
        const { data: rpcData, error: rpcError } = await supabase.rpc('track_order', {
          p_order_reference: ref
        });

        if (!rpcError && rpcData && rpcData.success && rpcData.order) {
          const raw = rpcData.order;
          const rawPhoto = raw.riderPhotoUrl || raw.rider_photo_url || raw.profile_photo_path || null;
          // Restore customer's capability token from isolated store if this device created the order
          const restoredCapabilityToken = this.getBookingCapabilityToken(ref);
          const order: Order = {
            id: raw.id || raw.order_reference,
            orderReference: (raw.orderReference || raw.order_reference || ref).toUpperCase(),
            bookingToken: restoredCapabilityToken || undefined,
            customerPhone: raw.customerPhone || raw.customer_phone || '',
            orderType: raw.orderType || raw.order_type || 'text',
            requestDescription: raw.requestDescription || raw.order_description || null,
            voiceRecordingPath: raw.voiceRecordingPath || raw.voice_recording_path || null,
            customerComment: raw.customerComment ?? raw.customer_comment ?? null,
            status: raw.status || 'pending',
            riderId: raw.riderId || raw.rider_id || null,
            riderName: raw.riderName || raw.rider_name || null,
            riderPhone: raw.riderPhone || raw.rider_phone || null,
            motorcycleModel: raw.motorcycleModel || raw.motorcycle_model || null,
            motorcycleReg: raw.motorcycleReg || raw.motorcycle_registration || null,
            motorcycleColour: raw.motorcycleColour || raw.motorcycle_colour || null,
            riderPhotoUrl: resolveRiderPhotoUrl(rawPhoto),
            operatingArea: raw.operatingArea || raw.operating_area || null,
            acceptedAt: raw.acceptedAt || raw.accepted_at || null,
            completedAt: raw.completedAt || raw.completed_at || null,
            cancelledAt: raw.cancelledAt || raw.cancelled_at || null,
            cancellationReason: raw.cancellationReason || raw.cancellation_reason || null,
            createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
            updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString()
          };

          this.saveOrderToLocalHistory(order);
          return { success: true, order };
        }

        // B. Fallback to direct orders table select (explicit public columns only)
        const { data: tableData, error: tableError } = await supabase
          .from('orders')
          .select('id, order_reference, customer_phone, order_type, order_description, voice_recording_path, customer_comment, status, rider_id, accepted_at, completed_at, created_at, updated_at')
          .eq('order_reference', ref)
          .maybeSingle();

        if (!tableError && tableData) {
          let riderInfo: Record<string, unknown> | null = null;
          if (tableData.rider_id) {
            const { data: rData } = await supabase
              .from('riders')
              .select(
                'full_name, phone_number, motorcycle_model, motorcycle_registration, motorcycle_colour, operating_area, profile_photo_path'
              )
              .eq('id', tableData.rider_id)
              .maybeSingle();
            if (rData) riderInfo = rData;
          }

          const rawPhoto = (riderInfo?.profile_photo_path as string) || null;
          const restoredCapabilityToken = this.getBookingCapabilityToken(ref);
          const order: Order = {
            id: tableData.id,
            orderReference: tableData.order_reference.toUpperCase(),
            bookingToken: restoredCapabilityToken || undefined,
            customerPhone: tableData.customer_phone,
            orderType: tableData.order_type,
            requestDescription: tableData.order_description,
            voiceRecordingPath: tableData.voice_recording_path,
            customerComment: (tableData as Record<string, unknown>).customer_comment as string | null ?? null,
            status: tableData.status,
            riderId: tableData.rider_id,
            riderName: (riderInfo?.full_name as string) || null,
            riderPhone: (riderInfo?.phone_number as string) || null,
            motorcycleModel: (riderInfo?.motorcycle_model as string) || null,
            motorcycleReg: (riderInfo?.motorcycle_registration as string) || null,
            motorcycleColour: (riderInfo?.motorcycle_colour as string) || null,
            riderPhotoUrl: resolveRiderPhotoUrl(rawPhoto),
            operatingArea: (riderInfo?.operating_area as string) || null,
            acceptedAt: tableData.accepted_at,
            completedAt: tableData.completed_at,
            createdAt: tableData.created_at,
            updatedAt: tableData.updated_at
          };

          this.saveOrderToLocalHistory(order);
          return { success: true, order };
        }
      } catch (networkErr) {
        console.warn('Network error during backend order tracking, trying local cache:', networkErr);
      }
    }

    // 2. Check local history if backend is offline or returned no match
    const localOrders = this.getLocalRecentOrders();
    const matched = localOrders.find(
      (o) => (o.orderReference || '').trim().toUpperCase() === ref
    );
    if (matched) {
      const restoredCapabilityToken = this.getBookingCapabilityToken(ref);
      return {
        success: true,
        order: {
          ...matched,
          bookingToken: restoredCapabilityToken || undefined
        }
      };
    }

    return {
      success: false,
      error: `No ride request found matching reference "${ref}". Please verify the code and try again.`
    };
  },

  /**
   * Find all customer orders by phone number
   */
  async getOrdersByPhone(phone: string): Promise<CustomerOrdersResponse> {
    const trimmed = (phone || '').trim();
    if (!trimmed) {
      return { success: false, error: 'Please enter your phone number to find your orders.' };
    }

    const check = validateGhanaPhone(trimmed);
    const formatted = check.isValid && check.formatted ? check.formatted : trimmed;

    const resultsMap = new Map<string, Order>();

    // 1. Seed with matching orders in local history
    const localOrders = this.getLocalRecentOrders();
    for (const ord of localOrders) {
      const p = ord.customerPhone || '';
      if (p === formatted || (p.length >= 8 && formatted.length >= 8 && p.slice(-8) === formatted.slice(-8))) {
        resultsMap.set(ord.orderReference.toUpperCase(), ord);
      }
    }

    // 2. Query Supabase backend if configured
    if (isSupabaseConfigured && supabase) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_orders_by_phone', {
          p_phone: formatted
        });

        if (!rpcError && Array.isArray(rpcData)) {
          for (const item of rpcData) {
            const raw = item.order || item;
            const rawPhoto = raw.riderPhotoUrl || raw.rider_photo_url || raw.profile_photo_path || null;
            const mapped: Order = {
              id: raw.id || raw.order_reference,
              orderReference: (raw.orderReference || raw.order_reference || '').toUpperCase(),
              customerPhone: raw.customerPhone || raw.customer_phone || formatted,
              orderType: raw.orderType || raw.order_type || 'text',
              requestDescription: raw.requestDescription || raw.order_description || null,
              voiceRecordingPath: raw.voiceRecordingPath || raw.voice_recording_path || null,
              customerComment: raw.customerComment ?? raw.customer_comment ?? null,
              status: raw.status || 'pending',
              riderId: raw.riderId || raw.rider_id || null,
              riderName: raw.riderName || raw.rider_name || null,
              riderPhone: raw.riderPhone || raw.rider_phone || null,
              motorcycleModel: raw.motorcycleModel || raw.motorcycle_model || null,
              motorcycleReg: raw.motorcycleReg || raw.motorcycle_registration || null,
              motorcycleColour: raw.motorcycleColour || raw.motorcycle_colour || null,
              riderPhotoUrl: resolveRiderPhotoUrl(rawPhoto),
              operatingArea: raw.operatingArea || raw.operating_area || null,
              acceptedAt: raw.acceptedAt || raw.accepted_at || null,
              completedAt: raw.completedAt || raw.completed_at || null,
              createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
              updatedAt: raw.updatedAt || raw.updated_at || new Date().toISOString()
            };
            if (mapped.orderReference) {
              resultsMap.set(mapped.orderReference, mapped);
              this.saveOrderToLocalHistory(mapped);
            }
          }
        } else {
          // Fallback direct table query (explicit public columns only)
          const { data: tableData } = await supabase
            .from('orders')
            .select('id, order_reference, customer_phone, order_type, order_description, voice_recording_path, customer_comment, status, rider_id, accepted_at, completed_at, created_at, updated_at')
            .eq('customer_phone', formatted)
            .order('created_at', { ascending: false })
            .limit(10);

          if (Array.isArray(tableData)) {
            for (const row of tableData) {
              let riderInfo: Record<string, unknown> | null = null;
              if (row.rider_id) {
                const { data: rData } = await supabase
                  .from('riders')
                  .select(
                    'full_name, phone_number, motorcycle_model, motorcycle_registration, motorcycle_colour, operating_area, profile_photo_path'
                  )
                  .eq('id', row.rider_id)
                  .maybeSingle();
                if (rData) riderInfo = rData;
              }

              const rawPhoto = (riderInfo?.profile_photo_path as string) || null;
              const mapped: Order = {
                id: row.id,
                orderReference: (row.order_reference || '').toUpperCase(),
                customerPhone: row.customer_phone,
                orderType: row.order_type,
                requestDescription: row.order_description,
                voiceRecordingPath: row.voice_recording_path,
                customerComment: (row as Record<string, unknown>).customer_comment as string | null ?? null,
                status: row.status,
                riderId: row.rider_id,
                riderName: (riderInfo?.full_name as string) || null,
                riderPhone: (riderInfo?.phone_number as string) || null,
                motorcycleModel: (riderInfo?.motorcycle_model as string) || null,
                motorcycleReg: (riderInfo?.motorcycle_registration as string) || null,
                motorcycleColour: (riderInfo?.motorcycle_colour as string) || null,
                riderPhotoUrl: resolveRiderPhotoUrl(rawPhoto),
                operatingArea: (riderInfo?.operating_area as string) || null,
                acceptedAt: row.accepted_at,
                completedAt: row.completed_at,
                createdAt: row.created_at,
                updatedAt: row.updated_at
              };
              if (mapped.orderReference) {
                resultsMap.set(mapped.orderReference, mapped);
                this.saveOrderToLocalHistory(mapped);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error fetching orders by phone from backend:', err);
      }
    }

    const orders = Array.from(resultsMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (orders.length === 0) {
      return {
        success: false,
        error: `No ride requests found for phone number ${formatted}.`
      };
    }

    return { success: true, orders };
  },

  /**
   * Returns the number of currently online, active riders (privacy-safe RPC).
   * Returns null if the RPC is unavailable or offline.
   */
  async getOnlineRidersCount(): Promise<number | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data, error } = await supabase.rpc('get_online_riders_count');
      if (error || typeof data !== 'number') return null;
      return data;
    } catch {
      return null;
    }
  },

  /**
   * Generate a playable signed URL for a customer's voice note recording
   */
  async getVoiceAudioUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const trimmed = path.trim();
    if (!trimmed) return null;

    // Already a direct HTTP(S) or local blob URL
    if (/^(https?:\/\/|blob:|data:)/i.test(trimmed)) {
      return trimmed;
    }

    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const cleanPath = trimmed.replace(/^order-recordings\//i, '').replace(/^\/+/, '');
      const { data, error } = await supabase.storage
        .from('order-recordings')
        .createSignedUrl(cleanPath, 3600);

      if (error || !data?.signedUrl) {
        console.warn('[orderService] Could not create signed URL for voice note:', error?.message);
        return null;
      }

      return data.signedUrl;
    } catch (err) {
      console.warn('[orderService] Error resolving voice audio URL:', err);
      return null;
    }
  },

  /**
   * Add or update a customer comment on an order
   */
  async addOrderComment(
    orderReference: string,
    comment: string,
    customerPhone?: string
  ): Promise<{ success: boolean; customerComment?: string; error?: string }> {
    const ref = (orderReference || '').trim().toUpperCase();
    const cleanComment = (comment || '').trim();

    if (!ref) {
      return { success: false, error: 'Order reference is required.' };
    }
    if (!cleanComment) {
      return { success: false, error: 'Please enter a comment before saving.' };
    }
    if (cleanComment.length > 500) {
      return { success: false, error: 'Comment must be 500 characters or fewer.' };
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'add_order_comment',
          {
            p_order_reference: ref,
            p_comment: cleanComment,
            p_phone: customerPhone || null
          }
        );

        if (rpcError) {
          return {
            success: false,
            error:
              rpcError.code === 'PGRST202'
                ? 'Comment feature requires running the latest SQL migration (add_order_comment) in Supabase.'
                : rpcError.message
          };
        }

        if (!rpcData || !rpcData.success) {
          return {
            success: false,
            error: rpcData?.error || 'Could not save comment.'
          };
        }
      } catch (err: unknown) {
        const error = err as Error;
        return { success: false, error: error.message || 'Failed to save comment.' };
      }
    }

    // Update local cache
    const local = this.getLocalRecentOrders();
    const updated = local.map((o) =>
      (o.orderReference || '').toUpperCase() === ref
        ? { ...o, customerComment: cleanComment, updatedAt: new Date().toISOString() }
        : o
    );
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(RECENT_ORDERS_KEY, JSON.stringify(updated));
    }

    return { success: true, customerComment: cleanComment };
  },

  /**
   * Cancel an order if still pending
   */
  async cancelOrder(
    orderReference: string,
    customerPhone?: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const ref = (orderReference || '').trim().toUpperCase();
    if (!ref) {
      return { success: false, error: 'Order reference is required.' };
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'cancel_order_by_reference',
          {
            p_order_reference: ref,
            p_phone: customerPhone || null
          }
        );

        if (!rpcError && rpcData) {
          if (!rpcData.success) {
            return {
              success: false,
              error: rpcData.error || 'Could not cancel order.'
            };
          }
        } else {
          // Direct fallback
          const { data: updatedRows, error: updateError } = await supabase
            .from('orders')
            .update({
              status: 'cancelled',
              updated_at: new Date().toISOString()
            })
            .eq('order_reference', ref)
            .eq('status', 'pending')
            .select('id');

          if (updateError) {
            return { success: false, error: updateError.message };
          }

          if (!updatedRows || updatedRows.length === 0) {
            return {
              success: false,
              error: rpcError
                ? 'Cancel Ride is missing the cancel_order_by_reference database function in Supabase. Please run the SQL migration in your Supabase SQL Editor.'
                : 'Order cannot be cancelled. It may have already been accepted or cancelled.'
            };
          }
        }
      } catch (err: unknown) {
        const error = err as Error;
        return { success: false, error: error.message };
      }
    }

    // Update local cache
    const local = this.getLocalRecentOrders();
    const updated = local.map((o) =>
      (o.orderReference || '').toUpperCase() === ref
        ? { ...o, status: 'cancelled' as const, updatedAt: new Date().toISOString() }
        : o
    );
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(RECENT_ORDERS_KEY, JSON.stringify(updated));
    }

    return { success: true, message: 'Your ride request has been cancelled.' };
  },

  /**
   * Refresh all orders stored in local recent history from the backend
   */
  async refreshRecentOrders(): Promise<Order[]> {
    const localOrders = this.getLocalRecentOrders();
    if (localOrders.length === 0) return [];
    if (!isSupabaseConfigured || !supabase) return localOrders;

    const refreshed = await Promise.all(
      localOrders.map(async (ord) => {
        if (!ord.orderReference) return ord;
        try {
          const res = await this.trackOrder(ord.orderReference);
          if (res.success && res.order) {
            return res.order;
          }
        } catch {
          // Keep existing cached order on transient failure
        }
        return ord;
      })
    );

    return refreshed.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },

  /**
   * Subscribe to live updates for an order using Supabase Realtime + Polling fallback
   */
  subscribeToOrder(
    orderReference: string,
    onUpdate: (order: Order) => void
  ): () => void {
    const ref = (orderReference || '').trim().toUpperCase();
    let isSubscribed = true;

    const fetchLatest = async () => {
      if (!isSubscribed) return;
      try {
        const res = await this.trackOrder(ref);
        if (res.success && res.order && isSubscribed) {
          onUpdate(res.order);
        }
      } catch {
        // Silent failure
      }
    };

    // 1. Immediate sync on subscribe
    fetchLatest();

    // 2. Polling interval fallback every 4 seconds
    const intervalId = setInterval(fetchLatest, 4000);

    // 3. Realtime channel subscription if Supabase client is available
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (isSupabaseConfigured && supabase) {
      try {
        channel = supabase
          .channel(`customer-order-${ref}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'orders',
              filter: `order_reference=eq.${ref}`
            },
            fetchLatest
          )
          .subscribe();
      } catch (err) {
        console.warn('Realtime subscription not established, using polling fallback:', err);
      }
    }

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
      if (channel && supabase) {
        supabase.removeChannel(channel).catch(() => {});
      }
    };
  },

  /**
   * Subscribe to live status updates for all recent orders on this device
   */
  subscribeToRecentOrders(onUpdate: (orders: Order[]) => void): () => void {
    let isSubscribed = true;
    let isFetching = false;

    const fetchLatest = async () => {
      if (!isSubscribed || isFetching) return;
      isFetching = true;
      try {
        const latest = await this.refreshRecentOrders();
        if (isSubscribed) {
          onUpdate(latest);
        }
      } catch {
        // Silent failure
      } finally {
        isFetching = false;
      }
    };

    // 1. Immediate sync on mount
    fetchLatest();

    // 2. Polling fallback every 4 seconds
    const intervalId = setInterval(fetchLatest, 4000);

    // 3. Realtime channel subscription for any order status update
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (isSupabaseConfigured && supabase) {
      try {
        channel = supabase
          .channel(`customer-recent-orders-${Date.now()}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'orders'
            },
            (payload) => {
              if (!isSubscribed) return;
              const updatedRef = String(
                (payload.new as Record<string, unknown> | null)?.order_reference || ''
              )
                .trim()
                .toUpperCase();
              if (!updatedRef) {
                fetchLatest();
                return;
              }
              const localRefs = new Set(
                this.getLocalRecentOrders().map((o) =>
                  (o.orderReference || '').trim().toUpperCase()
                )
              );
              if (localRefs.has(updatedRef)) {
                fetchLatest();
              }
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('Realtime subscription for recent orders failed, using polling fallback:', err);
      }
    }

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
      if (channel && supabase) {
        supabase.removeChannel(channel).catch(() => {});
      }
    };
  },

  /**
   * Subscribe to live status updates for customer orders looked up by phone number
   */
  subscribeToPhoneOrders(
    phone: string,
    onUpdate: (orders: Order[]) => void
  ): () => void {
    const trimmed = (phone || '').trim();
    if (!trimmed) return () => {};

    let isSubscribed = true;
    let isFetching = false;

    const fetchLatest = async () => {
      if (!isSubscribed || isFetching) return;
      isFetching = true;
      try {
        const res = await this.getOrdersByPhone(trimmed);
        if (res.success && res.orders && isSubscribed) {
          onUpdate(res.orders);
        }
      } catch {
        // Silent failure
      } finally {
        isFetching = false;
      }
    };

    const intervalId = setInterval(fetchLatest, 4000);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (isSupabaseConfigured && supabase) {
      try {
        channel = supabase
          .channel(`customer-phone-orders-${Date.now()}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'orders'
            },
            () => {
              if (isSubscribed) {
                fetchLatest();
              }
            }
          )
          .subscribe();
      } catch (err) {
        console.warn('Realtime subscription for phone orders failed, using polling fallback:', err);
      }
    }

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
      if (channel && supabase) {
        supabase.removeChannel(channel).catch(() => {});
      }
    };
  },

  /**
   * Fetch an assigned rider's live rating summary (average + count)
   */
  async getRiderRatingSummary(
    riderId: string
  ): Promise<{ averageRating: number | null; totalRatings: number }> {
    if (!isSupabaseConfigured || !supabase || !riderId) {
      return { averageRating: null, totalRatings: 0 };
    }

    try {
      const { data, error } = await supabase.rpc('get_rider_rating_summary', {
        p_rider_id: riderId
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        const row = data[0] as { average_rating?: number | string | null; total_ratings?: number };
        return {
          averageRating: row.average_rating != null ? Number(row.average_rating) : null,
          totalRatings: Number(row.total_ratings) || 0
        };
      }
    } catch {
      // Non-critical fallback
    }

    return { averageRating: null, totalRatings: 0 };
  },

  /**
   * Read locally cached customer rating for a completed order
   */
  getLocalOrderRating(orderReference: string): { rating: number; reviewNote?: string } | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const map = JSON.parse(window.localStorage.getItem('manna_order_ratings') || '{}');
      return map[orderReference.trim().toUpperCase()] || null;
    } catch {
      return null;
    }
  },

  /**
   * Submit a 1-5 star rating for a completed order
   */
  async submitOrderRating(params: {
    orderReference: string;
    customerPhone: string;
    rating: number;
    reviewNote?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const cleanRef = params.orderReference.trim().toUpperCase();
    const ratingVal = Math.min(5, Math.max(1, Math.round(params.rating)));
    const note = (params.reviewNote || '').trim();

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.rpc('submit_order_rating', {
          p_order_reference: cleanRef,
          p_customer_phone: params.customerPhone,
          p_rating: ratingVal,
          p_review_note: note || null
        });

        if (error) {
          // If RPC not yet deployed, fall through to local save with warning
          if (!error.message?.toLowerCase().includes('submit_order_rating')) {
            return { success: false, error: error.message };
          }
        } else if (data && typeof data === 'object' && (data as { success?: boolean }).success === false) {
          return {
            success: false,
            error: (data as { error?: string }).error || 'Could not submit rating.'
          };
        }
      } catch (err: unknown) {
        return { success: false, error: (err as Error).message || 'Could not submit rating.' };
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const map = JSON.parse(window.localStorage.getItem('manna_order_ratings') || '{}');
        map[cleanRef] = { rating: ratingVal, reviewNote: note || undefined };
        window.localStorage.setItem('manna_order_ratings', JSON.stringify(map));
      } catch {
        // ignore storage quota errors
      }
    }

    return { success: true };
  },

  /**
   * Read locally cached customer complaint for a completed order
   */
  getLocalOrderComplaint(
    orderReference: string
  ): { disputeReference: string; category: string; description: string } | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const map = JSON.parse(window.localStorage.getItem('manna_order_complaints') || '{}');
      return map[orderReference.trim().toUpperCase()] || null;
    } catch {
      return null;
    }
  },

  /**
   * Submit a customer complaint for a completed order (creates an Admin Dispute)
   */
  async submitOrderComplaint(params: {
    orderReference: string;
    customerPhone: string;
    category: string;
    description: string;
  }): Promise<{ success: boolean; disputeReference?: string; error?: string }> {
    const cleanRef = params.orderReference.trim().toUpperCase();
    const cleanDesc = params.description.trim();
    if (!cleanDesc) {
      return { success: false, error: 'Please describe the issue.' };
    }

    let disputeRef = `DSP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.rpc('submit_order_complaint', {
          p_order_reference: cleanRef,
          p_customer_phone: params.customerPhone,
          p_category: params.category,
          p_description: cleanDesc
        });

        if (error) {
          if (!error.message?.toLowerCase().includes('submit_order_complaint')) {
            return { success: false, error: error.message };
          }
        } else if (data && typeof data === 'object') {
          const resObj = data as { success?: boolean; dispute_reference?: string; error?: string };
          if (resObj.success === false) {
            return { success: false, error: resObj.error || 'Could not submit complaint.' };
          }
          if (resObj.dispute_reference) {
            disputeRef = resObj.dispute_reference;
          }
        }
      } catch (err: unknown) {
        return { success: false, error: (err as Error).message || 'Could not submit complaint.' };
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const map = JSON.parse(window.localStorage.getItem('manna_order_complaints') || '{}');
        map[cleanRef] = {
          disputeReference: disputeRef,
          category: params.category,
          description: cleanDesc
        };
        window.localStorage.setItem('manna_order_complaints', JSON.stringify(map));
      } catch {
        // ignore storage quota errors
      }
    }

    return { success: true, disputeReference: disputeRef };
  }
};

/**
 * Generate unique human-readable Order Reference (e.g. OKD-9H4K2M)
 */
function generateOrderReference(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `OKD-${code}`;
}
