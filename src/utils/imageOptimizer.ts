/**
 * Image Optimization Utility
 * Provides client-side image compression and resizing using HTML5 Canvas.
 * No external paid services or backend compute required.
 */

export interface ImageOptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0.1 to 1.0
  format?: 'image/webp' | 'image/jpeg';
  maxSizeBytes?: number;
}

export interface OptimizedImageResult {
  blob: Blob;
  width: number;
  height: number;
  originalSizeBytes: number;
  optimizedSizeBytes: number;
  format: string;
}

/**
 * Default preset for Rider Profile Avatars:
 * 512x512 pixels maximum, target size under 300 KB
 */
export const RIDER_AVATAR_OPTIONS: ImageOptimizationOptions = {
  maxWidth: 512,
  maxHeight: 512,
  quality: 0.82,
  format: 'image/webp',
  maxSizeBytes: 300 * 1024 // 300 KB
};

/**
 * Default preset for Customer Attached Images:
 * 1600 pixels longest side maximum, target size under 1 MB
 */
export const CUSTOMER_IMAGE_OPTIONS: ImageOptimizationOptions = {
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.80,
  format: 'image/webp',
  maxSizeBytes: 1024 * 1024 // 1 MB
};

/**
 * Check if the browser supports canvas.toBlob with WebP
 */
let supportsWebpCache: boolean | null = null;
function checkWebpSupport(): boolean {
  if (supportsWebpCache !== null) return supportsWebpCache;
  if (typeof document === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const uri = canvas.toDataURL('image/webp');
    supportsWebpCache = uri.startsWith('data:image/webp');
  } catch {
    supportsWebpCache = false;
  }
  return supportsWebpCache;
}

/**
 * Optimize an image file or blob on the client side
 */
export async function optimizeImage(
  file: File | Blob,
  options: ImageOptimizationOptions = {}
): Promise<OptimizedImageResult> {
  const originalSizeBytes = file.size;
  const maxWidth = options.maxWidth || 1600;
  const maxHeight = options.maxHeight || 1600;
  const initialQuality = options.quality ?? 0.82;
  const preferredFormat = options.format || 'image/webp';
  const targetMaxBytes = options.maxSizeBytes || 1024 * 1024;

  // Determine actual format based on browser support
  const targetFormat = (preferredFormat === 'image/webp' && checkWebpSupport())
    ? 'image/webp'
    : 'image/jpeg';

  // Load image into HTMLImageElement
  const img = await loadImage(file);
  const { naturalWidth, naturalHeight } = img;

  // Calculate scaled dimensions preserving aspect ratio
  let targetWidth = naturalWidth;
  let targetHeight = naturalHeight;

  if (targetWidth > maxWidth || targetHeight > maxHeight) {
    const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight);
    targetWidth = Math.round(targetWidth * ratio);
    targetHeight = Math.round(targetHeight * ratio);
  }

  // Draw onto canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: targetFormat === 'image/webp' });

  if (!ctx) {
    throw new Error('Canvas 2D context is not available for image optimization.');
  }

  // Fill white background for JPEG exports
  if (targetFormat === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Compress iteratively if the output exceeds maxSizeBytes
  let quality = initialQuality;
  let blob = await canvasToBlob(canvas, targetFormat, quality);

  // If still too large and quality is above 0.4, step down quality
  let iterations = 0;
  while (blob.size > targetMaxBytes && quality > 0.4 && iterations < 3) {
    iterations++;
    quality -= 0.15;
    blob = await canvasToBlob(canvas, targetFormat, quality);
  }

  return {
    blob,
    width: targetWidth,
    height: targetHeight,
    originalSizeBytes,
    optimizedSizeBytes: blob.size,
    format: targetFormat
  };
}

/**
 * Helper to load File/Blob into an Image
 */
function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to read and decode image file.'));
    };

    img.src = objectUrl;
  });
}

/**
 * Promise wrapper around canvas.toBlob
 */
function canvasToBlob(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create image blob from canvas.'));
        }
      },
      format,
      quality
    );
  });
}
