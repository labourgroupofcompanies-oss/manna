import { supabase, isSupabaseConfigured } from '../supabase';
import type { SubmitOrderPayload, SubmitOrderResponse } from '../../types';

/**
 * Order Service
 * Handles customer order submissions to the secure Supabase Edge Function 'submit-order'.
 */
export const orderService = {
  /**
   * Submit a new customer ride order (Text or Voice)
   * Dispatches the payload to the server-side Edge Function.
   */
  async submitOrder(payload: SubmitOrderPayload): Promise<SubmitOrderResponse> {
    // 1. Guard against unconfigured environment
    if (!isSupabaseConfigured || !supabase) {
      return {
        success: false,
        error:
          'Supabase backend credentials are not configured. Please add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env to submit real orders.'
      };
    }

    try {
      // 2. Build FormData payload for atomic submission
      const formData = new FormData();
      formData.append('customerPhone', payload.customerPhone.trim());
      formData.append('orderType', payload.orderType);

      if (payload.orderType === 'text') {
        if (!payload.orderDescription || !payload.orderDescription.trim()) {
          return {
            success: false,
            error: 'Please describe where you want to go before placing your order.'
          };
        }
        formData.append('orderDescription', payload.orderDescription.trim());
      } else if (payload.orderType === 'voice') {
        if (!payload.audioFile) {
          return {
            success: false,
            error: 'No audio note found. Please record your voice note before ordering.'
          };
        }

        // Determine appropriate extension from blob mimeType
        const mime = payload.audioFile.type || 'audio/webm';
        let extension = 'webm';
        if (mime.includes('mp4')) extension = 'mp4';
        else if (mime.includes('ogg')) extension = 'ogg';
        else if (mime.includes('wav')) extension = 'wav';

        formData.append('audioFile', payload.audioFile, `voicenote_${Date.now()}.${extension}`);
      }

      // 3. Dispatch to Supabase Edge Function 'submit-order'
      const { data, error } = await supabase.functions.invoke('submit-order', {
        body: formData
      });

      // 4. Handle Edge Function error response
      if (error) {
        let serverErrorMsg = error.message || 'Failed to submit order. Please check your connection and try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errJson = await error.context.json();
            if (errJson?.error) serverErrorMsg = errJson.error;
          } catch {
            // fallback to error.message
          }
        }

        // Friendly detection for undeployed Edge Function (404)
        if (serverErrorMsg.includes('404') || error.message?.includes('404')) {
          serverErrorMsg =
            "The 'submit-order' Edge Function has not been deployed to your Supabase project (bftlhbxhipbfmwbajcjf) yet. Please deploy it with: npx supabase functions deploy submit-order --no-verify-jwt";
        }

        return {
          success: false,
          error: serverErrorMsg
        };
      }

      // 5. Handle response returned from function
      if (!data) {
        return {
          success: false,
          error: 'No response received from the dispatch service. Please try again.'
        };
      }

      if (!data.success) {
        return {
          success: false,
          error: data.error || 'The dispatch server could not process your order.'
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
      console.error('Order submission exception:', error);
      return {
        success: false,
        error: error.message || 'A network error occurred while placing your order. Please try again.'
      };
    }
  }
};
