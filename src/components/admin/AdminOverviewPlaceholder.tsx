import React from 'react';
import { Card } from '../common/Card';

/**
 * Placeholder component prepared for Admin Dashboard
 * Future implementation will contain:
 * - Real-time metrics
 * - Active orders monitor
 * - Rider verification and fleet tracking
 */
export const AdminOverviewPlaceholder: React.FC = () => {
  return (
    <Card className="admin-placeholder">
      <h2 style={{ marginBottom: 'var(--spacing-2)' }}>Administration Console</h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        Prepared area for operations monitoring, fleet management, and system auditing.
      </p>
    </Card>
  );
};
