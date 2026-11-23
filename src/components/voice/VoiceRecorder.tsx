import React from 'react';
import { formatDuration, VOICE_GUIDE_CONFIG, type ServiceType } from '../../utils';
import type { UseVoiceRecorderReturn } from '../../hooks/useVoiceRecorder';
import './VoiceRecorder.css';

interface VoiceRecorderProps {
  recorder: UseVoiceRecorderReturn;
  onSwitchToText?: () => void;
  serviceType?: ServiceType;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  recorder,
  onSwitchToText,
  serviceType = 'ride'
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

  const isDelivery = serviceType === 'delivery';
  const shortCues = isDelivery
    ? ['Exact pickup spot', 'Drop-off spot', 'Item details']
    : ['Your exact location', 'Destination', 'Landmark / note'];

  const shortExample = isDelivery
    ? '"Pick up a bag at Kadjebi Station and deliver to Hospital gate."'
    : '"I am at Kadjebi Station near the junction, going to the Market."';

  const isShortRecording = recordingDuration > 0 && recordingDuration < 2;
  const isInsecureContext =
    typeof window !== 'undefined' && !window.isSecureContext;

  void VOICE_GUIDE_CONFIG[serviceType];

  return (
    <div className="voice-recorder-container">
      {/* Unsupported browser or insecure context warning */}
      {!isSupported && (
        <div className="voice-alert voice-alert-warning" role="alert">
          <span className="voice-alert-icon">⚠️</span>
          <div>
            <strong>
              {isInsecureContext ? 'HTTPS required' : 'Not supported'}
            </strong>
            <p>
              {isInsecureContext
                ? 'Open over HTTPS to record audio.'
                : 'Voice recording is not supported in this browser.'}
            </p>
            {onSwitchToText && (
              <button
                type="button"
                className="btn-switch-text"
                onClick={onSwitchToText}
              >
                Use Type Order
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
                Use Type Order
              </button>
            )}
          </div>
        </div>
      )}

      {/* State 1: Ready to record — Sleek Professional Speaking Guide + Mic */}
      {!isRecording && !audioUrl && (
        <div className="voice-prompt-box">
          <div className="voice-pro-guide" aria-label="Speaking guide">
            <div className="voice-pro-guide-label">SPEAKING GUIDE</div>
            <div className="voice-pro-steps">
              {shortCues.map((cue, idx) => (
                <div key={cue} className="voice-pro-step">
                  <span className="voice-pro-num">{idx + 1}</span>
                  <span className="voice-pro-text">{cue}</span>
                </div>
              ))}
            </div>
            <p className="voice-short-example">Example: {shortExample}</p>
          </div>

          <button
            type="button"
            className="mic-record-btn"
            onClick={startRecording}
            aria-label="Tap to record voice request"
            disabled={!isSupported}
          >
            <div className="mic-icon-wrapper">
              <svg
                width="30"
                height="30"
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
            <span className="mic-label">Tap to Record</span>
          </button>
        </div>
      )}

      {/* State 2: Actively Recording — Speaking cues stay neatly visible */}
      {isRecording && (
        <div className="voice-active-box" aria-live="polite">
          <div className="recording-status-row">
            <span className="recording-dot-pulse" />
            <span className="recording-label-text">RECORDING</span>
          </div>

          <div className="voice-waveform-animation" aria-hidden="true">
            <span className="wave-bar wave-bar-1" />
            <span className="wave-bar wave-bar-2" />
            <span className="wave-bar wave-bar-3" />
            <span className="wave-bar wave-bar-4" />
            <span className="wave-bar wave-bar-5" />
            <span className="wave-bar wave-bar-6" />
            <span className="wave-bar wave-bar-7" />
          </div>

          <div
            className="recording-timer"
            aria-label={`Recording duration ${formatDuration(recordingDuration)}`}
          >
            {formatDuration(recordingDuration)}
          </div>

          <div className="voice-pro-steps voice-pro-steps-recording" aria-label="Say these points">
            {shortCues.map((cue, idx) => (
              <div key={cue} className="voice-pro-step recording">
                <span className="voice-pro-num recording">{idx + 1}</span>
                <span className="voice-pro-text">{cue}</span>
              </div>
            ))}
          </div>

          <div className="recording-actions-row">
            <button
              type="button"
              className="btn-cancel-recording"
              onClick={deleteRecording}
              aria-label="Cancel recording"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-stop-recording"
              onClick={stopRecording}
              aria-label="Finish recording"
            >
              <span className="stop-square-icon" />
              <span>Done</span>
            </button>
          </div>
        </div>
      )}

      {/* State 3: Recording Complete / Playback */}
      {audioUrl && !isRecording && (
        <div className="voice-playback-box">
          <div className="playback-header">
            <div className="playback-badge">
              <span className="playback-check-icon">✓</span>
              <span>Voice Note Ready</span>
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

          {isShortRecording ? (
            <div className="voice-short-warning" role="status">
              <span>⚠️ Short recording ({recordingDuration}s) — play back to check it is clear.</span>
            </div>
          ) : (
            <div className="voice-ready-info">
              <span className="voice-ready-pill">
                <span className="voice-ready-dot" />
                Play back to confirm your pickup &amp; destination
              </span>
            </div>
          )}

          <div className="playback-actions">
            <button
              type="button"
              className="btn-delete-voice"
              onClick={deleteRecording}
              aria-label="Delete voice note"
            >
              <span>Delete</span>
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
              <span>Re-record</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
