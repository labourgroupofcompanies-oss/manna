import React from 'react';
import { Card } from '../../components/common/Card';

export const AdminPage: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-2)' }}>
          <span style={{ fontSize: '1.25rem' }}>⚙️</span>
          <h2>Admin Dashboard</h2>
        </div>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-4)' }}>
          Operations & dispatch oversight.
        </p>

        <div
          style={{
            backgroundColor: 'var(--color-bg-light)',
            padding: 'var(--spacing-3)',
            borderRadius: 'var(--radius-md)',
            borderLeft: '4px solid var(--color-dark-navy)',
            fontSize: 'var(--font-size-xs)',
            lineHeight: '1.6'
          }}
        >
          <strong>Status:</strong> Area prepared for trip analytics, rider verification, dispute resolution, and system metrics.
        </div>
      </Card>
    </div>
  );
};
