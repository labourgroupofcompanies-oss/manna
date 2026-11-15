import React from 'react';
import { formatDuration } from '../../utils';
import type { UseVoiceRecorderReturn } from '../../hooks/useVoiceRecorder';
import './VoiceRecorder.css';

interface VoiceRecorderProps {
  recorder: UseVoiceRecorderReturn;
  onSwitchToText?: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  recorder,
  onSwitchToText
}) => {
  const {
    isRecording,
    recordingDuration,
    audioUrl,
    error,
    isSupported,
    startRecording,
    stopRecording,
    deleteRecording
  } = recorder;

  return (
    <div className="voice-recorder-container">
      {/* Unsupported browser warning */}
      {!isSupported && (
        <div className="voice-alert voice-alert-warning" role="alert">
          <span className="voice-alert-icon">⚠️</span>
          <div>
            <strong>Browser not supported</strong>
            <p>Voice recording is not supported in this browser.</p>
            {onSwitchToText && (
              <button
                type="button"
                className="btn-switch-text"
                onClick={onSwitchToText}
              >
                Switch to Type Order
              </button>
            )}
          </div>
        </div>
      )}

      {/* Permission or capture error warning */}
      {error && (
        <div className="voice-alert voice-alert-error" role="alert">
          <span className="voice-alert-icon">⚠️</span>
          <div className="voice-alert-content">
            <strong>Microphone Issue</strong>
            <p>{error}</p>
            {onSwitchToText && (
              <button
                type="button"
                className="btn-switch-text"
                onClick={onSwitchToText}
              >
                Switch to Type Order
              </button>
            )}
          </div>
        </div>
      )}

      {/* State 1: Ready to record (no recording in progress, no recording saved yet) */}
      {!isRecording && !audioUrl && (
        <div className="voice-prompt-box">
          <button
            type="button"
            className="mic-record-btn"
            onClick={startRecording}
            aria-label="Tap to record voice request"
            disabled={!isSupported}
          >
            <div className="mic-icon-wrapper">
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <span className="mic-label">Tap to Record Voice Note</span>
          </button>
          <p className="voice-hint">
            Say where you are and where you are going. (e.g. &ldquo;I am at Circle, going to Kaneshie&rdquo;)
          </p>
        </div>
      )}

      {/* State 2: Actively Recording */}
      {isRecording && (
        <div className="voice-active-box" aria-live="polite">
          <div className="recording-indicator-pulse">
            <div className="pulse-ring pulse-ring-1" />
            <div className="pulse-ring pulse-ring-2" />
            <div className="recording-badge">
              <span className="recording-dot" />
              <span>RECORDING</span>
            </div>
          </div>

          <div className="recording-timer" aria-label={`Recording duration ${formatDuration(recordingDuration)}`}>
            {formatDuration(recordingDuration)}
          </div>

          <p className="recording-live-text">Speak clearly into your microphone...</p>

          <button
            type="button"
            className="btn btn-stop-recording"
            onClick={stopRecording}
            aria-label="Stop recording"
          >
            <span className="stop-square-icon" />
            <span>Stop Recording</span>
          </button>
        </div>
      )}

      {/* State 3: Recording Complete / Audio Playback */}
      {audioUrl && !isRecording && (
        <div className="voice-playback-box">
          <div className="playback-header">
            <span className="playback-badge">
              <span className="playback-check-icon">✓</span>
              Voice Note Recorded
            </span>
            <span className="playback-duration">
              {formatDuration(recordingDuration)}
            </span>
          </div>

          <div className="audio-player-wrapper">
            <audio
              src={audioUrl}
              controls
              preload="metadata"
              className="voice-audio-element"
            >
              Your browser does not support audio playback.
            </audio>
          </div>

          <div className="playback-actions">
            <button
              type="button"
              className="btn-delete-record"
              onClick={deleteRecording}
              aria-label="Delete and re-record audio note"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Delete &amp; Re-record</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
