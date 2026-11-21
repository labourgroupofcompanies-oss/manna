import { supabase, isSupabaseConfigured } from '../supabase/client';
import { mediaUploadManager, type UploadProgress, type UploadResult } from '../storage/mediaUploadManager';
import {
  validateAudioFile,
  calculateCompressionStats,
  getPreferredAudioMimeType,
  type AudioCompressionStats
} from '../../utils/audioOptimizer';

/**
 * Voice Audio Storage and Processing Service
 * Handles Opus audio compression verification, Supabase Storage uploads,
 * and signed URL generation for rider playback.
 */
export const voiceService = {
  /**
   * Check if Opus audio recording is supported by the current browser
   */
  isOpusSupported(): boolean {
    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      return false;
    }
    return (
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ||
      MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
    );
  },

  /**
   * Validate and calculate compression efficiency for an Opus voice note
   */
  async processVoiceRecording(
    blob: Blob,
    durationSeconds: number
  ): Promise<{
    isValid: boolean;
    error?: string;
    compressionStats: AudioCompressionStats;
  }> {
    const validation = await validateAudioFile(blob);
    const compressionStats = calculateCompressionStats(blob, durationSeconds);

    if (!validation.isValid) {
      return {
        isValid: false,
        error: validation.error,
        compressionStats
      };
    }

    return {
      isValid: true,
      compressionStats
    };
  },

  /**
   * Upload an Opus-compressed voice recording directly to Supabase Storage
   * Target bucket: 'order-recordings' (Private, authenticated signed URLs)
   */
  async uploadVoiceNote(
    blob: Blob,
    options: {
      orderId?: string;
      customerPhone?: string;
      onProgress?: (progress: UploadProgress) => void;
    } = {}
  ): Promise<UploadResult> {
    const uploadTask = mediaUploadManager.uploadVoiceRecording(blob, {
      orderId: options.orderId,
      customerPhone: options.customerPhone,
      orderType: 'voice',
      onProgress: options.onProgress
    });

    return uploadTask.promise;
  },

  /**
   * Generate secure signed URL for rider playback from Supabase Storage
   * Valid for 1 hour (3600 seconds)
   */
  async getVoicePlaybackUrl(storagePath: string): Promise<string | null> {
    if (!isSupabaseConfigured || !supabase || !storagePath) return null;

    try {
      const { data, error } = await supabase.storage
        .from('order-recordings')
        .createSignedUrl(storagePath, 3600);

      if (error || !data) {
        console.warn('Failed to generate signed URL for voice playback:', error);
        return null;
      }

      return data.signedUrl;
    } catch (err) {
      console.warn('Exception generating voice playback URL:', err);
      return null;
    }
  },

  /**
   * Return preferred audio format string (e.g. 'audio/webm;codecs=opus')
   */
  getPreferredFormat(): string {
    return getPreferredAudioMimeType();
  }
};
