import React from 'react';
import { Card } from '../common/Card';

/**
 * Placeholder component prepared for Order Management
 */
export const OrderListPlaceholder: React.FC = () => {
  return (
    <Card className="orders-placeholder">
      <h3 style={{ marginBottom: 'var(--spacing-2)' }}>Order Management</h3>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        Prepared area for lifecycle tracking of incoming and active motorcycle ride orders.
      </p>
    </Card>
  );
};
