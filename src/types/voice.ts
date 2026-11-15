/**
 * Voice recording state and payload types
 */
export interface VoiceRecordingState {
  isRecording: boolean;
  isPaused: boolean;
  recordingDuration: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
  error: string | null;
  isSupported?: boolean;
}
