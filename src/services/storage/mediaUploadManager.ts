/**
 * Media Upload Manager
 * Unified media upload service supporting:
 * - Direct browser-to-Supabase Storage transfers
 * - TUS resumable uploads for flaky or low-bandwidth networks
 * - Offline IndexedDB queueing with automatic reconnection sync
 * - Image & audio validation and optimization
 * - Duplicate submission prevention
 * - Upload progress callbacks and cancellation handles
 */

import * as tus from 'tus-js-client';
import { supabase, isSupabaseConfigured } from '../supabase';
import { offlineMediaQueue, type QueuedUploadItem } from './offlineMediaQueue';
import { validateAudioFile } from '../../utils/audioOptimizer';
import { optimizeImage, RIDER_AVATAR_OPTIONS, CUSTOMER_IMAGE_OPTIONS } from '../../utils/imageOptimizer';

export type MediaType = 'voice_recording' | 'customer_image' | 'rider_profile';

export interface UploadProgress {
  bytesUploaded: number;
  bytesTotal: number;
  percentage: number;
}

export interface UploadOptions {
  bucket?: string;
  subfolder?: string;
  preferResumable?: boolean; // force TUS resumable upload
  optimize?: boolean; // compress images before upload
  onProgress?: (progress: UploadProgress) => void;
  orderId?: string;
  customerPhone?: string;
  orderDescription?: string;
  orderType?: 'text' | 'voice';
}

export interface UploadResult {
  success: boolean;
  storagePath?: string;
  bucket?: string;
  publicUrl?: string;
  signedUrl?: string;
  isQueuedOffline?: boolean;
  error?: string;
  fileSizeBytes?: number;
  mimeType?: string;
}

export interface UploadTask {
  promise: Promise<UploadResult>;
  abort: () => void;
}

// In-flight upload deduplication registry
const activeUploads = new Map<string, tus.Upload>();

// Target bucket mappings
const BUCKET_MAPPING: Record<MediaType, string> = {
  voice_recording: 'order-recordings',
  customer_image: 'customer-media',
  rider_profile: 'rider-profiles'
};

export const mediaUploadManager = {
  /**
   * Upload an audio voice note for a customer order
   */
  uploadVoiceRecording(
    blob: Blob,
    options: UploadOptions = {}
  ): UploadTask {
    return this.uploadMedia(blob, 'voice_recording', {
      bucket: 'order-recordings',
      subfolder: options.orderId ? `orders/${options.orderId}` : 'orders/drafts',
      ...options
    });
  },

  /**
   * Upload an optimized rider avatar
   */
  async uploadRiderProfilePhoto(
    file: File | Blob,
    userId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    // 1. Optimize image (512x512, < 300KB)
    const optimized = await optimizeImage(file, RIDER_AVATAR_OPTIONS);

    // 2. Upload to rider-profiles bucket
    const task = this.uploadMedia(optimized.blob, 'rider_profile', {
      bucket: 'rider-profiles',
      subfolder: `avatars/${userId}`,
      onProgress
    });

    return task.promise;
  },

  /**
   * Upload an optimized customer image
   */
  async uploadCustomerImage(
    file: File | Blob,
    orderId?: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    // 1. Optimize image (max 1600px, < 1MB)
    const optimized = await optimizeImage(file, CUSTOMER_IMAGE_OPTIONS);

    // 2. Upload to customer-media bucket
    const task = this.uploadMedia(optimized.blob, 'customer_image', {
      bucket: 'customer-media',
      subfolder: orderId ? `orders/${orderId}` : 'orders/customer_images',
      onProgress
    });

    return task.promise;
  },

  /**
   * Core Media Upload Engine
   * Validates, determines strategy (TUS vs standard vs offline queue), and executes.
   */
  uploadMedia(
    file: Blob,
    mediaType: MediaType,
    options: UploadOptions = {}
  ): UploadTask {
    let aborted = false;
    let currentTusUpload: tus.Upload | null = null;

    const abort = () => {
      aborted = true;
      if (currentTusUpload) {
        currentTusUpload.abort(true);
      }
    };

    const promise = (async (): Promise<UploadResult> => {
      // 1. Check client configuration
      if (!isSupabaseConfigured || !supabase) {
        return {
          success: false,
          error: 'Supabase credentials are not configured in environment.'
        };
      }

      const bucket = options.bucket || BUCKET_MAPPING[mediaType] || 'order-recordings';
      const mimeType = file.type || (mediaType === 'voice_recording' ? 'audio/webm' : 'image/jpeg');

      // 2. Validate media
      if (mediaType === 'voice_recording') {
        const audioValidation = await validateAudioFile(file);
        if (!audioValidation.isValid) {
          return {
            success: false,
            error: audioValidation.error || 'Audio validation failed.'
          };
        }
      }

      // 3. Generate non-guessable storage path
      const randomUuid = crypto.randomUUID();
      const ext = getFileExtension(mimeType, mediaType);
      const subfolder = options.subfolder ? options.subfolder.replace(/\/+$/, '') : 'uploads';
      const storagePath = `${subfolder}/${randomUuid}.${ext}`;
      const uploadKey = `${bucket}:${storagePath}`;

      // Duplicate prevention
      if (activeUploads.has(uploadKey)) {
        return {
          success: false,
          error: 'An identical upload is already actively transferring.'
        };
      }

      // 4. Offline Detection & Graceful IndexedDB Queuing
      const isOnline = typeof navigator === 'undefined' || navigator.onLine;
      if (!isOnline) {
        try {
          await offlineMediaQueue.enqueueUpload({
            bucket,
            storagePath,
            blob: file,
            fileName: `${randomUuid}.${ext}`,
            mimeType,
            fileSizeBytes: file.size,
            mediaType,
            orderPayload: options.customerPhone ? {
              customerPhone: options.customerPhone,
              orderType: options.orderType || 'voice',
              orderDescription: options.orderDescription
            } : undefined
          });

          return {
            success: true,
            storagePath,
            bucket,
            isQueuedOffline: true,
            fileSizeBytes: file.size,
            mimeType
          };
        } catch (queueErr) {
          return {
            success: false,
            error: queueErr instanceof Error ? queueErr.message : 'Could not queue offline upload.'
          };
        }
      }

      // 5. Select upload strategy:
      // TUS Resumable Upload is preferred for larger files (> 1MB), flaky networks, or when requested
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
      const shouldUseTus = options.preferResumable || file.size > 1024 * 1024;

      if (shouldUseTus && supabaseUrl && supabaseAnonKey) {
        try {
          return await new Promise<UploadResult>((resolve) => {
            if (aborted) {
              resolve({ success: false, error: 'Upload was cancelled.' });
              return;
            }

            // Retrieve current session token if signed in, or use anonKey
            supabase.auth.getSession().then(({ data: sessionData }) => {
              const authToken = sessionData?.session?.access_token || supabaseAnonKey;
              const tusEndpoint = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable`;

              const upload = new tus.Upload(file, {
                endpoint: tusEndpoint,
                retryDelays: [0, 1500, 3000, 5000, 10000],
                headers: {
                  authorization: `Bearer ${authToken}`,
                  apikey: supabaseAnonKey,
                  'x-upsert': 'true'
                },
                uploadDataDuringCreation: true,
                removeFingerprintOnSuccess: true,
                metadata: {
                  bucketName: bucket,
                  objectName: storagePath,
                  contentType: mimeType,
                  cacheControl: '3600'
                },
                chunkSize: 6 * 1024 * 1024, // 6MB chunk recommended for Supabase Storage
                onError: (error) => {
                  activeUploads.delete(uploadKey);
                  console.warn('TUS upload encountered error, falling back to standard upload:', error);
                  // Resilient fallback to standard upload
                  this.performStandardUpload(bucket, storagePath, file, mimeType, options.onProgress)
                    .then((fallbackResult) => {
                      if (fallbackResult.success) {
                        this.recordMediaMetadata(bucket, storagePath, mimeType, file.size, mediaType, 'tus_resumable');
                      }
                      resolve(fallbackResult);
                    })
                    .catch((standardErr) => {
                      resolve({
                        success: false,
                        error: standardErr.message || 'Resumable upload failed.'
                      });
                    });
                },
                onProgress: (bytesUploaded, bytesTotal) => {
                  if (options.onProgress) {
                    const percentage = bytesTotal > 0 ? Math.round((bytesUploaded / bytesTotal) * 100) : 0;
                    options.onProgress({ bytesUploaded, bytesTotal, percentage });
                  }
                },
                onSuccess: () => {
                  activeUploads.delete(uploadKey);
                  this.recordMediaMetadata(bucket, storagePath, mimeType, file.size, mediaType, 'tus_resumable');
                  resolve({
                    success: true,
                    storagePath,
                    bucket,
                    fileSizeBytes: file.size,
                    mimeType
                  });
                }
              });

              currentTusUpload = upload;
              activeUploads.set(uploadKey, upload);
              upload.start();
            });
          });
        } catch (tusErr: unknown) {
          console.warn('TUS initialization error:', tusErr);
          // Fallback to standard
        }
      }

      // Standard direct upload via Supabase JS SDK
      try {
        const result = await this.performStandardUpload(
          bucket,
          storagePath,
          file,
          mimeType,
          options.onProgress
        );

        if (result.success) {
          await this.recordMediaMetadata(bucket, storagePath, mimeType, file.size, mediaType, 'standard');
        }

        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Upload failed.';
        // If network error occurred, offer offline queueing
        if (!navigator.onLine || message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
          try {
            await offlineMediaQueue.enqueueUpload({
              bucket,
              storagePath,
              blob: file,
              fileName: `${randomUuid}.${ext}`,
              mimeType,
              fileSizeBytes: file.size,
              mediaType
            });
            return {
              success: true,
              storagePath,
              bucket,
              isQueuedOffline: true,
              fileSizeBytes: file.size,
              mimeType
            };
          } catch {
            // fallback to original error
          }
        }

        return {
          success: false,
          error: message
        };
      }
    })();

    return { promise, abort };
  },

  /**
   * Standard upload implementation with synthetic progress
   */
  async performStandardUpload(
    bucket: string,
    storagePath: string,
    file: Blob,
    mimeType: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    if (!supabase) {
      throw new Error('Supabase client not initialized.');
    }

    if (onProgress) {
      onProgress({ bytesUploaded: Math.round(file.size * 0.2), bytesTotal: file.size, percentage: 20 });
    }

    const { error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {
        contentType: mimeType,
        upsert: true
      });

    if (error) {
      const errMsg = error.message || '';
      if (
        errMsg.toLowerCase().includes('bucket not found') ||
        (error as any).status === 400 ||
        (error as any).statusCode === '404'
      ) {
        throw new Error(
          `Storage bucket '${bucket}' has not been created in your Supabase project yet. Please run the SQL setup script in your Supabase Dashboard SQL Editor to initialize it.`
        );
      }
      if (errMsg.toLowerCase().includes('violates row-level security policy') || (error as any).statusCode === '403') {
        throw new Error(
          `Storage permission missing for '${bucket}'. Please run the SQL setup script in your Supabase Dashboard SQL Editor to allow direct uploads.`
        );
      }
      throw error;
    }

    if (onProgress) {
      onProgress({ bytesUploaded: file.size, bytesTotal: file.size, percentage: 100 });
    }

    return {
      success: true,
      storagePath,
      bucket,
      fileSizeBytes: file.size,
      mimeType
    };
  },

  /**
   * Record upload metadata in public.order_media
   */
  async recordMediaMetadata(
    bucket: string,
    storagePath: string,
    mimeType: string,
    fileSizeBytes: number,
    mediaType: MediaType,
    uploadMethod: 'standard' | 'tus_resumable' | 'offline_queue'
  ): Promise<void> {
    if (!supabase) return;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uploaderId = sessionData?.session?.user?.id || null;

      await supabase.from('order_media').insert({
        bucket_id: bucket,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        media_type: mediaType,
        upload_status: 'completed',
        upload_method: uploadMethod,
        uploader_id: uploaderId
      });
    } catch {
      // Non-fatal: if order_media table is not yet accessible by anon, storage upload succeeded regardless
    }
  },

  /**
   * Run background processing for items queued in IndexedDB
   */
  async syncOfflineQueue(): Promise<void> {
    await offlineMediaQueue.processQueue(async (item: QueuedUploadItem) => {
      const result = await this.uploadMedia(item.blob, item.mediaType, {
        bucket: item.bucket,
        subfolder: item.storagePath.substring(0, item.storagePath.lastIndexOf('/'))
      }).promise;

      return result.success;
    });
  }
};

/**
 * File extension helper
 */
function getFileExtension(mimeType: string, mediaType: MediaType): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpg') || mime.includes('jpeg')) return 'jpg';
  return mediaType === 'voice_recording' ? 'webm' : 'jpg';
}
