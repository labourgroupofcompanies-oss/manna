import React, { useState, useEffect, useRef, useCallback } from 'react';
import './LivePhotoGuide.css';

interface LivePhotoGuideProps {
  onPhotoCaptured: (file: File) => void;
  onClose: () => void;
}

type LightingState = 'good' | 'dark' | 'bright';

export const LivePhotoGuide: React.FC<LivePhotoGuideProps> = ({
  onPhotoCaptured,
  onClose
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const capturedPreviewRef = useRef<string | null>(null);

  // Component state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lighting, setLighting] = useState<{ state: LightingState; text: string }>({
    state: 'good',
    text: 'Detecting lighting...'
  });
  const [useCountdown, setUseCountdown] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Stop camera tracks helper
  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Start front camera with graceful fallback
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCapturedBlob(null);
    if (capturedPreviewRef.current) {
      URL.revokeObjectURL(capturedPreviewRef.current);
      capturedPreviewRef.current = null;
      setCapturedPreview(null);
    }

    try {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw new Error(
          'Live camera requires a secure (HTTPS) connection. Use the buttons below to take or upload a photo.'
        );
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Live camera is not supported in this browser. Upload a photo below instead.');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 720 },
            height: { ideal: 720 }
          },
          audio: false
        });
      } catch (constraintErr: unknown) {
        const name = (constraintErr as DOMException)?.name || '';
        if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw constraintErr;
        }
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err: unknown) {
      const domErr = err as DOMException;
      const errName = domErr?.name || '';
      let friendlyMsg: string;

      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        friendlyMsg =
          'Camera permission was denied. Allow camera access in your browser settings and tap Try Again, or upload a clear photo below.';
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        friendlyMsg = 'No camera was found on this device. Upload a clear headshot photo below.';
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        friendlyMsg = 'Your camera is currently in use by another app. Close it and tap Try Again, or upload a photo below.';
      } else {
        friendlyMsg =
          err instanceof Error
            ? err.message
            : 'Could not open the live camera. Allow camera access or upload a photo below.';
      }

      setCameraError(friendlyMsg);
      setCameraActive(false);
    }
  }, []);

  // Initial camera startup (runs once on mount)
  useEffect(() => {
    startCamera();
    return () => {
      stopCameraStream();
      if (capturedPreviewRef.current) {
        URL.revokeObjectURL(capturedPreviewRef.current);
        capturedPreviewRef.current = null;
      }
    };
  }, [startCamera, stopCameraStream]);

  // Periodic lighting analysis using hidden canvas
  useEffect(() => {
    if (!cameraActive || capturedBlob) return;

    const interval = setInterval(() => {
      if (!videoRef.current || !analysisCanvasRef.current || videoRef.current.readyState < 2) return;

      const video = videoRef.current;
      const canvas = analysisCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx || video.videoWidth === 0) return;

      canvas.width = 48;
      canvas.height = 48;
      ctx.drawImage(video, 0, 0, 48, 48);

      try {
        const imgData = ctx.getImageData(0, 0, 48, 48);
        const data = imgData.data;
        let totalBrightness = 0;
        for (let i = 0; i < data.length; i += 4) {
          totalBrightness += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        const avg = totalBrightness / (48 * 48);

        if (avg < 55) {
          setLighting({
            state: 'dark',
            text: '⚠️ Too dark — move to a brighter spot'
          });
        } else if (avg > 215) {
          setLighting({
            state: 'bright',
            text: '⚠️ Strong glare / backlighting detected'
          });
        } else {
          setLighting({
            state: 'good',
            text: '✓ Good lighting — Face centered'
          });
        }
      } catch {
        // Ignore cross-origin context read issues if any
      }
    }, 600);

    return () => clearInterval(interval);
  }, [cameraActive, capturedBlob]);

  // Trigger snapshot logic
  const captureFrame = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    const captureCanvas = document.createElement('canvas');
    const width = video.videoWidth || 720;
    const height = video.videoHeight || 720;
    captureCanvas.width = width;
    captureCanvas.height = height;

    const ctx = captureCanvas.getContext('2d');
    if (!ctx) return;

    // Mirror horizontally so image matches the selfie view
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);

    // Stop live stream once photo is taken
    stopCameraStream();

    captureCanvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedBlob(blob);
          const previewUrl = URL.createObjectURL(blob);
          capturedPreviewRef.current = previewUrl;
          setCapturedPreview(previewUrl);
        }
      },
      'image/jpeg',
      0.92
    );
  }, [stopCameraStream]);

  // Handle countdown before snap
  const handleInitiateCapture = () => {
    if (!useCountdown) {
      captureFrame();
      return;
    }

    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          captureFrame();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Retake photo
  const handleRetake = () => {
    startCamera();
  };

  // Confirm photo and send to parent form
  const handleConfirmPhoto = () => {
    if (!capturedBlob) return;
    setIsProcessing(true);

    const file = new File(
      [capturedBlob],
      `rider-headshot-${Date.now()}.jpg`,
      { type: 'image/jpeg' }
    );

    onPhotoCaptured(file);
    setIsProcessing(false);
    onClose();
  };

  // Fallback for file upload if live stream fails
  const handleFallbackFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      onPhotoCaptured(file);
      onClose();
    }
  };

  return (
    <div className="live-photo-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="live-photo-modal-title">
      <div className="live-photo-card">
        {/* Header */}
        <div className="live-photo-header">
          <div className="live-photo-title-wrap">
            <h3 id="live-photo-modal-title" className="live-photo-title">Live Rider Photo Guide</h3>
            <p className="live-photo-subtitle">Clear headshot required for passenger trust & verification</p>
          </div>
          <button
            type="button"
            className="live-photo-close-btn"
            onClick={onClose}
            aria-label="Close photo guide"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Viewport Area */}
        <div className="camera-viewport-wrap">
          {cameraError ? (
            <div className="camera-error-wrap">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h4 className="camera-error-title">Camera Unavailable</h4>
              <p className="camera-error-desc">{cameraError}</p>
              <div className="camera-error-actions">
                <button
                  type="button"
                  className="btn-retry-camera"
                  onClick={startCamera}
                >
                  Try Again
                </button>
                <label className="btn-fallback-camera">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>Device Camera</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={handleFallbackFile}
                    style={{ display: 'none' }}
                  />
                </label>
                <label className="btn-upload-gallery">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>Upload Photo from Device</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFallbackFile}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
          ) : capturedPreview ? (
            <img src={capturedPreview} alt="Captured Rider Preview" className="camera-captured-preview" />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="camera-video-stream"
              />

              {/* Dynamic Lighting Feedback */}
              <div className={`lighting-badge ${lighting.state}`}>
                {lighting.text}
              </div>

              {/* Framing Overlay Guide */}
              <div className="camera-frame-overlay">
                <div className={`oval-guide-cutout ${lighting.state === 'good' ? 'good-light' : 'warn-light'}`}>
                  <div className="guide-crosshair-h" />
                  <div className="guide-crosshair-v" />
                </div>
              </div>

              {/* Countdown Overlay */}
              {countdown !== null && (
                <div className="countdown-overlay">
                  <span className="countdown-number">{countdown}</span>
                  <span className="countdown-hint">Hold still & look at the camera...</span>
                </div>
              )}
            </>
          )}

          {/* Hidden canvas for real-time luminance calculations */}
          <canvas ref={analysisCanvasRef} style={{ display: 'none' }} />
        </div>

        {/* Instructions & Controls */}
        <div className="live-photo-body">
          {capturedPreview ? (
            /* Review Mode */
            <div className="live-photo-actions">
              <div className="checklist-item" style={{ color: '#166534', fontWeight: 600 }}>
                <svg className="checklist-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Live photo captured! Verify your face is clear and well-lit.</span>
              </div>
              <div className="review-actions-row">
                <button
                  type="button"
                  className="btn-retake"
                  onClick={handleRetake}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Retake Photo
                </button>
                <button
                  type="button"
                  className="btn-accept-photo"
                  onClick={handleConfirmPhoto}
                  disabled={isProcessing}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {isProcessing ? 'Saving...' : 'Use This Photo'}
                </button>
              </div>
            </div>
          ) : !cameraError ? (
            /* Active Live Capture Mode */
            <>
              {/* Guidance Checklist */}
              <div className="guide-checklist">
                <div className="checklist-item">
                  <svg className="checklist-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="10" r="3" />
                    <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
                  </svg>
                  <span>Center face in oval</span>
                </div>
                <div className="checklist-item">
                  <svg className="checklist-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                  </svg>
                  <span>Facing bright light</span>
                </div>
                <div className="checklist-item">
                  <svg className="checklist-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>Eyes open & clear</span>
                </div>
                <div className="checklist-item">
                  <svg className="checklist-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  <span>No sunglasses / cap</span>
                </div>
              </div>

              <div className="live-photo-actions">
                <button
                  type="button"
                  className="btn-snap-photo"
                  onClick={handleInitiateCapture}
                  disabled={!cameraActive || countdown !== null}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>{countdown !== null ? 'Taking Photo...' : 'Take Live Photo'}</span>
                </button>

                <div className="capture-options-row">
                  <label className="countdown-toggle-label">
                    <input
                      type="checkbox"
                      checked={useCountdown}
                      onChange={(e) => setUseCountdown(e.target.checked)}
                    />
                    <span>3-second countdown (prevents motion blur)</span>
                  </label>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
