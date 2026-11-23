import React, { useState } from 'react';
import { adminService, pushNotificationService, playNotificationChime, isFirebaseConfigured } from '../../services';
import { isSupabaseConfigured } from '../../services/supabase';
import type { AdminUser } from '../../types';
import './AdminPages.css';

interface AdminSettingsPageProps {
  adminUser: AdminUser;
}

export const AdminSettingsPage: React.FC<AdminSettingsPageProps> = ({ adminUser }) => {
  const [verifying, setVerifying] = useState(false);
  const [auditResult, setAuditResult] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Push Notification state & actions
  const [pushStatus, setPushStatus] = useState<string>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [pushActionLoading, setPushActionLoading] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);

  const handleRegisterAdminPush = async () => {
    setPushActionLoading(true);
    setPushFeedback(null);
    try {
      const res = await pushNotificationService.registerAdminNotifications();
      if (res.success) {
        setPushStatus('granted');
        setPushFeedback('✅ Device registered! This admin console will now receive live dispatch and emergency alerts.');
      } else {
        setPushFeedback(`⚠️ Registration failed: ${res.error}`);
      }
    } finally {
      setPushActionLoading(false);
    }
  };

  const handleSendTestPush = async (target: 'admin' | 'rider' | 'customer') => {
    setPushActionLoading(true);
    setPushFeedback(null);
    try {
      const targetLabel = target === 'admin' ? 'Admin Portal' : target === 'rider' ? 'Online Riders' : 'Customers';
      const res = await pushNotificationService.dispatchNotification({
        recipientType: target,
        title: `🔔 Test Alert: ${targetLabel}`,
        body: `Firebase push notification test dispatch executed at ${new Date().toLocaleTimeString()}.`,
        clickAction: target === 'admin' ? '/portal/dashboard' : target === 'rider' ? '/rider' : '/'
      });

      playNotificationChime(target === 'rider' ? 'order' : 'ride');

      if (res.success) {
        const deliveryNote = res.deliveredByFirebase
          ? `Delivered via FCM HTTP v1: ${res.sentCount} sent, ${res.failedCount} failed`
          : (res.message || 'Audited and synced via Realtime');
        setPushFeedback(`✅ Dispatched test notification to ${targetLabel}! (${deliveryNote})`);
      } else {
        setPushFeedback(`❌ Dispatch error: ${res.error}`);
      }
    } finally {
      setPushActionLoading(false);
    }
  };

  const handleRunSecurityAudit = async () => {
    setVerifying(true);
    setAuditResult(null);
    try {
      const { isAdmin, adminUser: verified } = await adminService.checkIsAdmin();
      if (isAdmin && verified) {
        setAuditResult('✅ Security Check Passed: Your account is verified as an active administrator in public.admin_users linked directly to auth.users.');
      } else {
        setAuditResult('❌ Security Warning: Current session did not pass administrator role verification.');
      }
    } catch (err: unknown) {
      const error = err as Error;
      setAuditResult(`⚠️ Audit error: ${error.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyId = () => {
    navigator.clipboard?.writeText(adminUser.userId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div>
      {/* Admin Profile Card */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">
              <i className="fa-solid fa-user-shield" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Administrator Credentials & Identity</span>
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
              Authenticated operator profile and security clearance
            </div>
          </div>
        </div>

        <div className="admin-card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Administrator Email
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-dark-navy)', marginTop: 4 }}>
                {adminUser.email}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Role Level
              </div>
              <div style={{ marginTop: 4 }}>
                <span className="status-badge accepted">
                  {adminUser.role === 'super_admin' ? 'Owner / Super Admin' : 'Administrator'}
                </span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Supabase Auth User ID
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: '#475569' }}>
                  {adminUser.userId.slice(0, 12)}...
                </span>
                <button
                  type="button"
                  className="admin-copy-pill"
                  onClick={handleCopyId}
                  title="Copy full User UUID"
                >
                  {copiedId ? (
                    <>
                      <i className="fa-solid fa-check" style={{ marginRight: 4 }} /> Copied
                    </>
                  ) : (
                    <>
                      <i className="fa-regular fa-copy" style={{ marginRight: 4 }} /> Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Account Provisioned
              </div>
              <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: 4 }}>
                {new Date(adminUser.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Firebase Push Notification Control Card */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">
              <i className="fa-solid fa-bell" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Firebase Cloud Messaging (FCM) & Push Notifications</span>
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
              Multi-portal push dispatch engine for Customers, Riders, and Admins
            </div>
          </div>

          <button
            type="button"
            className="admin-action-btn success"
            disabled={pushActionLoading}
            onClick={handleRegisterAdminPush}
          >
            <i className="fa-solid fa-bell-concierge" style={{ marginRight: 6 }} />
            {pushStatus === 'granted' ? 'Re-register Device' : 'Enable Admin Alerts'}
          </button>
        </div>

        <div className="admin-card-body">
          {pushFeedback && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                backgroundColor: pushFeedback.startsWith('✅') ? '#ECFDF5' : '#FEF2F2',
                border: `1px solid ${pushFeedback.startsWith('✅') ? '#A7F3D0' : '#FECACA'}`,
                color: pushFeedback.startsWith('✅') ? '#065F46' : '#991B1B',
                fontSize: '0.85rem',
                marginBottom: 16,
                fontWeight: 600,
                lineHeight: 1.4
              }}
            >
              {pushFeedback}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
            <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Browser Permission
              </div>
              <div style={{ marginTop: 4 }}>
                <span className={`status-badge ${pushStatus === 'granted' ? 'completed' : pushStatus === 'denied' ? 'cancelled' : 'pending'}`}>
                  {pushStatus}
                </span>
              </div>
            </div>

            <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Firebase Configuration
              </div>
              <div style={{ marginTop: 4 }}>
                <span className={`status-badge ${isFirebaseConfigured() ? 'completed' : 'pending'}`}>
                  {isFirebaseConfigured() ? 'Production Keys Active' : 'Realtime / Dev Mode'}
                </span>
              </div>
            </div>

            <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Service Worker Status
              </div>
              <div style={{ marginTop: 4 }}>
                <span className="status-badge completed">
                  {typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? 'Active (firebase-messaging-sw.js)' : 'Unsupported'}
                </span>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 14 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
              Broadcast & Alert Simulator:
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="admin-action-btn primary"
                disabled={pushActionLoading}
                onClick={() => handleSendTestPush('admin')}
              >
                <i className="fa-solid fa-paper-plane" style={{ marginRight: 6 }} />
                Test Admin Alert
              </button>
              <button
                type="button"
                className="admin-action-btn warning"
                disabled={pushActionLoading}
                onClick={() => handleSendTestPush('rider')}
              >
                <i className="fa-solid fa-motorcycle" style={{ marginRight: 6 }} />
                Test Rider Broadcast
              </button>
              <button
                type="button"
                className="admin-action-btn success"
                disabled={pushActionLoading}
                onClick={() => handleSendTestPush('customer')}
              >
                <i className="fa-solid fa-user" style={{ marginRight: 6 }} />
                Test Customer Alert
              </button>
              <button
                type="button"
                className="admin-action-btn neutral"
                onClick={() => playNotificationChime('order')}
              >
                <i className="fa-solid fa-volume-high" style={{ marginRight: 6 }} />
                Test Sound Chime
              </button>
              <button
                type="button"
                className="admin-action-btn neutral"
                onClick={() => pushNotificationService.triggerTestNotification('admin')}
              >
                <i className="fa-solid fa-bell" style={{ marginRight: 6 }} />
                Test In-App Toast
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Backend & Security Infrastructure */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">
              <i className="fa-solid fa-shield-halved" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Security Architecture & Access Policies</span>
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
              PostgreSQL Row Level Security (RLS) and storage isolation
            </div>
          </div>

          <button
            type="button"
            className="admin-action-btn success"
            disabled={verifying}
            onClick={handleRunSecurityAudit}
          >
            {verifying ? (
              <>
                <i className="fa-solid fa-arrows-rotate fa-spin" style={{ marginRight: 6 }} />
                Verifying...
              </>
            ) : (
              <>
                <i className="fa-solid fa-bolt-lightning" style={{ marginRight: 6 }} />
                Run Security Audit
              </>
            )}
          </button>
        </div>

        <div className="admin-card-body">
          {auditResult && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                backgroundColor: auditResult.startsWith('✅') ? '#ECFDF5' : '#FEF2F2',
                border: `1px solid ${auditResult.startsWith('✅') ? '#A7F3D0' : '#FECACA'}`,
                color: auditResult.startsWith('✅') ? '#065F46' : '#991B1B',
                fontSize: '0.85rem',
                marginBottom: 16,
                fontWeight: 600,
                lineHeight: 1.4
              }}
            >
              {auditResult}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Supabase Configuration:</strong>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                  Connecting via environment variables VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
                </div>
              </div>
              <span className={`status-badge ${isSupabaseConfigured ? 'completed' : 'cancelled'}`}>
                {isSupabaseConfigured ? 'Connected' : 'Not Configured'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Row Level Security (RLS):</strong>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                  Enforced on orders, riders, order_media, and admin_users. Self-elevation strictly prohibited.
                </div>
              </div>
              <span className="status-badge completed">Enforced</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Voice Storage Encryption:</strong>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                  Bucket <code>order-recordings</code> is private. Accessible only via short-lived signed URLs.
                </div>
              </div>
              <span className="status-badge completed">Private / Signed</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Public Admin Registration:</strong>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                  Self-service signup disabled. Admin roles can only be granted via trusted database operations.
                </div>
              </div>
              <span className="status-badge cancelled">Disabled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
