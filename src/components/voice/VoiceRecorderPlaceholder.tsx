import React from 'react';
import { Card } from '../common/Card';

/**
 * Placeholder component prepared for Voice Recording
 */
export const VoiceRecorderPlaceholder: React.FC = () => {
  return (
    <Card className="voice-placeholder">
      <h3 style={{ marginBottom: 'var(--spacing-2)' }}>Voice Recording Facility</h3>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        Prepared area for audio recording, waveform preview, and voice request submission.
      </p>
    </Card>
  );
};
