/**
 * Audio Optimization & Validation Utility
 * Validates recording duration (max 90s), file size, and supported MIME formats.
 */

export const MAX_AUDIO_DURATION_SECONDS = 90;
export const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const SUPPORTED_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/aac',
  'audio/x-m4a',
  'audio/wav',
  'audio/mpeg',
  'audio/mp3'
];

export interface AudioValidationResult {
  isValid: boolean;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  error?: string;
}

/**
 * Detect the best supported audio recording format for the current browser
 */
export function getPreferredAudioMimeType(): string {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return 'audio/webm';
  }

  const candidateFormats = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/aac'
  ];

  for (const format of candidateFormats) {
    if (MediaRecorder.isTypeSupported(format)) {
      return format;
    }
  }

  return ''; // Browser default
}

/**
 * Measure duration of an audio blob in seconds using HTMLAudioElement or AudioContext
 */
export async function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    // Attempt using HTMLAudioElement first
    if (typeof Audio !== 'undefined') {
      const audio = new Audio();
      const objectUrl = URL.createObjectURL(blob);
      let settled = false;

      const finish = (duration: number) => {
        if (!settled) {
          settled = true;
          URL.revokeObjectURL(objectUrl);
          resolve(Math.max(0, Math.round(duration)));
        }
      };

      audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          finish(audio.duration);
        }
      });

      audio.addEventListener('error', () => {
        finish(0); // If audio element cannot decode, fallback to 0
      });

      // Timeout safety: if audio metadata doesn't load within 2 seconds
      setTimeout(() => finish(0), 2000);

      audio.src = objectUrl;
      return;
    }

    resolve(0);
  });
}

/**
 * Validate audio recording against duration, file size, and MIME constraints
 */
export async function validateAudioFile(
  blob: Blob,
  maxDurationSeconds = MAX_AUDIO_DURATION_SECONDS,
  maxSizeBytes = MAX_AUDIO_SIZE_BYTES
): Promise<AudioValidationResult> {
  const sizeBytes = blob.size;
  const mimeType = blob.type || 'audio/webm';

  if (sizeBytes === 0) {
    return {
      isValid: false,
      durationSeconds: 0,
      sizeBytes,
      mimeType,
      error: 'Audio recording is empty. Please record your message again.'
    };
  }

  if (sizeBytes > maxSizeBytes) {
    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    return {
      isValid: false,
      durationSeconds: 0,
      sizeBytes,
      mimeType,
      error: `Voice note size (${sizeMb} MB) exceeds the ${maxMb} MB maximum limit.`
    };
  }

  // Validate MIME type
  const baseMime = mimeType.split(';')[0].trim().toLowerCase();
  const isAllowed = SUPPORTED_AUDIO_MIME_TYPES.some((type) => {
    const allowedBase = type.split(';')[0].trim().toLowerCase();
    return baseMime === allowedBase || mimeType.startsWith(allowedBase);
  });

  if (!isAllowed && mimeType !== 'application/octet-stream') {
    return {
      isValid: false,
      durationSeconds: 0,
      sizeBytes,
      mimeType,
      error: `Unsupported audio format "${mimeType}". Supported formats: WebM, MP4, OGG, AAC, MP3, WAV.`
    };
  }

  // Validate duration
  const durationSeconds = await getAudioDuration(blob);
  if (durationSeconds > maxDurationSeconds + 1) { // 1s tolerance for rounding
    return {
      isValid: false,
      durationSeconds,
      sizeBytes,
      mimeType,
      error: `Voice note duration (${durationSeconds}s) exceeds the maximum allowed limit of ${maxDurationSeconds} seconds.`
    };
  }

  return {
    isValid: true,
    durationSeconds,
    sizeBytes,
    mimeType
  };
}
