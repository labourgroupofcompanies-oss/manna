import { useState, useCallback, useRef, useEffect } from 'react';
import type { VoiceRecordingState } from '../types';

export interface UseVoiceRecorderReturn extends VoiceRecordingState {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  deleteRecording: () => void;
  resetRecording: () => void;
  isSupported: boolean;
}

/**
 * useVoiceRecorder Hook
 * Robust wrapper around the browser MediaRecorder API
 * Supports audio capture, live duration tracking, error handling, and audio playback URLs.
 */
export const useVoiceRecorder = (): UseVoiceRecorderReturn => {
  const isSupported = typeof window !== 'undefined' &&
    Boolean(navigator?.mediaDevices?.getUserMedia) &&
    typeof window.MediaRecorder !== 'undefined';

  const [state, setState] = useState<VoiceRecordingState>({
    isRecording: false,
    isPaused: false,
    recordingDuration: 0,
    audioBlob: null,
    audioUrl: null,
    error: null,
    isSupported
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Keep audioUrlRef in sync for cleanup
  useEffect(() => {
    audioUrlRef.current = state.audioUrl;
  }, [state.audioUrl]);

  // Clean up tracks and timers
  const cleanupMediaResources = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      cleanupMediaResources();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, [cleanupMediaResources]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setState((prev) => ({
        ...prev,
        error: 'Voice recording is not supported in this browser. Please type your order instead.'
      }));
      return;
    }

    // Clean up any existing recording and object URLs
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    cleanupMediaResources();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

      // Select supported audio mimeType
      let mimeType = '';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: finalMimeType });
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;

        cleanupMediaResources();

        setState((prev) => ({
          ...prev,
          isRecording: false,
          isPaused: false,
          audioBlob: blob,
          audioUrl: url,
          error: null
        }));
      };

      recorder.onerror = (_event) => {
        cleanupMediaResources();
        setState((prev) => ({
          ...prev,
          isRecording: false,
          error: 'An error occurred during audio recording. Please try again or type your order.'
        }));
      };

      // Reset timer and state
      setState({
        isRecording: true,
        isPaused: false,
        recordingDuration: 0,
        audioBlob: null,
        audioUrl: null,
        error: null,
        isSupported: true
      });

      recorder.start(250); // collect chunks every 250ms

      // Start duration counter
      const startTime = Date.now();
      timerIntervalRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setState((prev) => ({
          ...prev,
          recordingDuration: elapsed
        }));
      }, 500);
    } catch (err: unknown) {
      cleanupMediaResources();
      const error = err as { name?: string; message?: string };
      let errorMessage = 'Could not access microphone.';

      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        errorMessage = 'Microphone permission was denied. Please allow microphone access in your browser or switch to "Type Order".';
      } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
        errorMessage = 'No microphone was found on this device. Please use "Type Order" instead.';
      } else if (error?.message) {
        errorMessage = error.message;
      }

      setState((prev) => ({
        ...prev,
        isRecording: false,
        error: errorMessage
      }));
    }
  }, [cleanupMediaResources, isSupported]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.warn('Error stopping media recorder:', err);
      }
    }
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const deleteRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }

    cleanupMediaResources();

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    setState({
      isRecording: false,
      isPaused: false,
      recordingDuration: 0,
      audioBlob: null,
      audioUrl: null,
      error: null,
      isSupported
    });
  }, [cleanupMediaResources, isSupported]);

  const resetRecording = deleteRecording;

  return {
    ...state,
    isSupported,
    startRecording,
    stopRecording,
    deleteRecording,
    resetRecording
  };
};
