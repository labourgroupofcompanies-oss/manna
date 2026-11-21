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

  const isInsecureContext =
    typeof window !== 'undefined' && !window.isSecureContext;

  return (
    <div className="voice-recorder-container">
      {/* Unsupported browser or insecure context warning */}
      {!isSupported && (
        <div className="voice-alert voice-alert-warning" role="alert">
          <span className="voice-alert-icon">⚠️</span>
          <div>
            <strong>
              {isInsecureContext
                ? 'HTTPS required for voice recording'
                : 'Browser not supported'}
            </strong>
            <p>
              {isInsecureContext
                ? 'Microphone access requires a secure (HTTPS) connection. Open this app over HTTPS to record a voice order.'
                : 'Voice recording is not supported in this browser.'}
            </p>
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
                width="34"
                height="34"
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
            Speak your pickup spot and destination clearly.
            <span className="voice-example-quote">&ldquo;I am at Kadjebi station, heading to the border.&rdquo;</span>
          </p>
        </div>
      )}

      {/* State 2: Actively Recording */}
      {isRecording && (
        <div className="voice-active-box" aria-live="polite">
          <div className="recording-status-row">
            <span className="recording-dot-pulse" />
            <span className="recording-label-text">RECORDING AUDIO</span>
          </div>

          {/* Sound Wave Equalizer Bars */}
          <div className="voice-waveform-animation" aria-hidden="true">
            <span className="wave-bar wave-bar-1" />
            <span className="wave-bar wave-bar-2" />
            <span className="wave-bar wave-bar-3" />
            <span className="wave-bar wave-bar-4" />
            <span className="wave-bar wave-bar-5" />
            <span className="wave-bar wave-bar-6" />
            <span className="wave-bar wave-bar-7" />
          </div>

          <div className="recording-timer" aria-label={`Recording duration ${formatDuration(recordingDuration)}`}>
            {formatDuration(recordingDuration)}
          </div>

          <p className="recording-live-text">Listening... speak clearly into your phone</p>

          <div className="recording-actions-row">
            <button
              type="button"
              className="btn-cancel-recording"
              onClick={deleteRecording}
              aria-label="Cancel and discard recording"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-stop-recording"
              onClick={stopRecording}
              aria-label="Done recording"
            >
              <span className="stop-square-icon" />
              <span>Finish Recording</span>
            </button>
          </div>
        </div>
      )}

      {/* State 3: Recording Complete / Audio Playback */}
      {audioUrl && !isRecording && (
        <div className="voice-playback-box">
          <div className="playback-header">
            <div className="playback-badge">
              <span className="playback-check-icon">✓</span>
              <span>Voice Note Recorded</span>
            </div>
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

          {/* Clean, reassuring status pill — NO developer/debug metrics */}
          <div className="voice-ready-info">
            <span className="voice-ready-pill">
              <span className="voice-ready-dot" />
              Audio ready &bull; Your rider will hear these instructions
            </span>
          </div>

          <div className="playback-actions">
            <button
              type="button"
              className="btn-delete-voice"
              onClick={deleteRecording}
              aria-label="Delete voice note"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              <span>Delete Voice Note</span>
            </button>

            <button
              type="button"
              className="btn-delete-record"
              onClick={() => {
                deleteRecording();
                startRecording();
              }}
              aria-label="Re-record audio note"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span>Re-record</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
