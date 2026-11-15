import React from 'react';
import { Card } from '../../components/common/Card';
import { isSupabaseConfigured } from '../../services/supabase';

export const CustomerPage: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-2)' }}>
          <span style={{ fontSize: '1.25rem' }}>📱</span>
          <h2>Book an Okada</h2>
        </div>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-4)' }}>
          Fast and reliable motorcycle transport in Ghana.
        </p>

        {/* Environmental Readiness Card */}
        <div
          style={{
            backgroundColor: 'var(--color-bg-light)',
            padding: 'var(--spacing-3)',
            borderRadius: 'var(--radius-md)',
            borderLeft: '4px solid var(--color-primary)',
            fontSize: 'var(--font-size-xs)',
            lineHeight: '1.6'
          }}
        >
          <strong>Environment Readiness:</strong>
          <br />
          &bull; PWA Support: <span style={{ color: 'var(--color-success)', fontWeight: 'bold' }}>Configured</span>
          <br />
          &bull; Supabase Backend:{' '}
          <span style={{ color: isSupabaseConfigured ? 'var(--color-success)' : 'var(--color-text-light)', fontWeight: 'bold' }}>
            {isSupabaseConfigured ? 'Connected' : 'Ready (Awaiting Credentials)'}
          </span>
          <br />
          &bull; Voice Service Area: <span style={{ color: 'var(--color-success)', fontWeight: 'bold' }}>Initialized</span>
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: 'var(--font-size-base)', marginBottom: 'var(--spacing-2)' }}>
          Future Customer Journey
        </h3>
        <ol style={{ paddingLeft: 'var(--spacing-5)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', lineHeight: '1.8' }}>
          <li>Enter phone number</li>
          <li>Type request or record a voice note</li>
          <li>Submit order and connect with nearby Okada riders</li>
        </ol>
      </Card>
    </div>
  );
};
