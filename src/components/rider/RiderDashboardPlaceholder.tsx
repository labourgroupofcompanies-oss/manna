import React from 'react';
import { Card } from '../common/Card';

/**
 * Placeholder component prepared for Rider Interface
 * Future implementation will contain:
 * - Available orders stream
 * - Accept/Decline actions
 * - Rider availability toggle
 */
export const RiderDashboardPlaceholder: React.FC = () => {
  return (
    <Card className="rider-placeholder">
      <h2 style={{ marginBottom: 'var(--spacing-2)' }}>Rider Dispatch Terminal</h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        Prepared area for independent motorcycle riders to toggle availability and accept customer rides.
      </p>
    </Card>
  );
};
