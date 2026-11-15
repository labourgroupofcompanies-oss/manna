import { supabase, isSupabaseConfigured } from '../supabase';
import type { SubmitOrderPayload, SubmitOrderResponse } from '../../types';
import { mediaUploadManager, type UploadProgress } from '../storage/mediaUploadManager';
import { offlineMediaQueue } from '../storage/offlineMediaQueue';
import { validateAudioFile } from '../../utils/audioOptimizer';

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
          storagePath: `orders/offline_${crypto.randomUUID()}`,
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
        orderDescription: payload.orderDescription.trim()
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
          storagePath: `orders/offline_${crypto.randomUUID()}.${validation.mimeType.includes('mp4') ? 'mp4' : 'webm'}`,
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
          storagePath: `orders/drafts/${crypto.randomUUID()}.webm`,
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
        voiceRecordingPath: uploadedPath
      });
    }

    return {
      success: false,
      error: 'Invalid order type specified.'
    };
  },

  /**
   * Dispatch payload to 'submit-order' Edge Function
   */
  async dispatchToEdgeFunction(body: Record<string, unknown>): Promise<SubmitOrderResponse> {
    if (!supabase) {
      return { success: false, error: 'Supabase client is not available.' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('submit-order', {
        body
      });

      if (error) {
        let serverErrorMsg = error.message || 'Failed to submit order. Please check your connection and try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errJson = await error.context.json();
            if (errJson?.error) serverErrorMsg = errJson.error;
          } catch {
            // fallback
          }
        }

        return {
          success: false,
          error: serverErrorMsg
        };
      }

      if (!data || !data.success) {
        return {
          success: false,
          error: data?.error || 'The dispatch server could not process your order.'
        };
      }

      return {
        success: true,
        orderReference: data.orderReference,
        status: data.status,
        createdAt: data.createdAt,
        message: data.message || 'Order placed successfully.'
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        success: false,
        error: error.message || 'A network error occurred while placing your order. Please try again.'
      };
    }
  }
};
