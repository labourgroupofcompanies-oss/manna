import React from 'react';
import { Card } from '../common/Card';

/**
 * Placeholder component prepared for Customer Interface
 * Future implementation will contain:
 * 1. Phone number input
 * 2. Text description / Voice recording trigger
 * 3. Order submission button
 */
export const CustomerRequestPlaceholder: React.FC = () => {
  return (
    <Card className="customer-placeholder">
      <h2 style={{ marginBottom: 'var(--spacing-2)' }}>Customer Booking Portal</h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        Prepared area for customer phone input, text request, voice note recording, and order dispatch.
      </p>
    </Card>
  );
};
