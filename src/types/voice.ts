/**
 * Voice recording state and payload types
 */
export interface VoiceCompressionStats {
  codec: string;
  bitrateKbps: number;
  compressedSizeBytes: number;
  estimatedRawSizeBytes: number;
  savingsPercent: number;
  isOpus: boolean;
}

export interface VoiceRecordingState {
  isRecording: boolean;
  isPaused: boolean;
  recordingDuration: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
  error: string | null;
  isSupported?: boolean;
  compressionStats?: VoiceCompressionStats | null;
}
