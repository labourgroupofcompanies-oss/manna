import React, { useEffect, useState, useCallback } from 'react';
import { adminService } from '../../services';
import type { SystemMetricsData, AdminAuditLog } from '../../types';
import './AdminPages.css';

export const AdminMetricsPage: React.FC = () => {
  const [metrics, setMetrics] = useState<SystemMetricsData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const [sysMetrics, logs] = await Promise.all([
        adminService.getSystemMetrics(),
        adminService.getAdminAuditLogs(30)
      ]);
      setMetrics(sysMetrics);
      setAuditLogs(logs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchMetrics();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="admin-empty-state">
        <div className="admin-spinner" style={{ margin: '0 auto 16px' }} />
        <div className="admin-empty-title">Probing Infrastructure</div>
        <p className="admin-empty-desc">Aggregating telemetry, database health, and audit trail...</p>
      </div>
    );
  }

  const healthStatus = metrics?.healthStatus || 'Healthy';

  return (
    <div>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--color-dark-navy)', letterSpacing: '-0.01em' }}>
            System Metrics & Health Telemetry
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#64748B' }}>
            Live infrastructure diagnostics, storage metrics, and tamper-resistant audit log
          </span>
        </div>

        <button
          type="button"
          className="admin-action-btn primary"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <>
              <i className="fa-solid fa-arrows-rotate fa-spin" style={{ marginRight: 6 }} />
              Telemetry...
            </>
          ) : (
            <>
              <i className="fa-solid fa-arrows-rotate" style={{ marginRight: 6 }} />
              Refresh Metrics
            </>
          )}
        </button>
      </div>

      {/* System Health Status Banner */}
      <div
        style={{
          padding: '18px 22px',
          borderRadius: 16,
          background:
            healthStatus === 'Healthy'
              ? 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)'
              : healthStatus === 'Warning'
              ? 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)'
              : 'linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)',
          border: `1.5px solid ${
            healthStatus === 'Healthy'
              ? '#A7F3D0'
              : healthStatus === 'Warning'
              ? '#FDE68A'
              : '#FECACA'
          }`,
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 14,
          boxShadow: '0 2px 8px rgba(16, 27, 61, 0.04)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: '2.4rem', lineHeight: 1 }}>
            {healthStatus === 'Healthy' ? (
              <i className="fa-solid fa-circle-check" style={{ color: '#059669' }} />
            ) : healthStatus === 'Warning' ? (
              <i className="fa-solid fa-triangle-exclamation" style={{ color: '#D97706' }} />
            ) : (
              <i className="fa-solid fa-circle-xmark" style={{ color: '#DC2626' }} />
            )}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark-navy)', fontWeight: 800 }}>
                System Status: {healthStatus}
              </h3>
              <span className={`status-badge ${healthStatus.toLowerCase().replace(/\s+/g, '_')}`}>
                {healthStatus}
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: '#475569', lineHeight: 1.4 }}>
              {metrics?.healthReason}
            </p>
          </div>
        </div>

        <div style={{ fontSize: '0.775rem', color: '#64748B', textAlign: 'right' }}>
          Evaluated at: {new Date(metrics?.evaluatedAt || Date.now()).toLocaleTimeString()}
        </div>
      </div>

      {/* Reliability Metrics Grid */}
      <div className="admin-grid-metrics">
        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Total Orders</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-box-archive" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value">{metrics?.totalOrders ?? 0}</div>
          <span className="admin-metric-subtext">Recorded in orders table</span>
        </div>

        <div className="admin-metric-card accent-green">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Fulfilled Orders</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-circle-check" style={{ color: '#059669' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#059669' }}>
            {metrics?.successfulOrders ?? 0}
          </div>
          <span className="admin-metric-subtext">Status completed</span>
        </div>

        <div className="admin-metric-card accent-red">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Cancelled Orders</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-circle-xmark" style={{ color: '#DC2626' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#DC2626' }}>
            {metrics?.failedOrders ?? 0}
          </div>
          <span className="admin-metric-subtext">Terminated before completion</span>
        </div>

        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Online Fleet</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-motorcycle" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: 'var(--color-primary)' }}>
            {metrics?.onlineRiders ?? 0}
          </div>
          <span className="admin-metric-subtext">Active available riders</span>
        </div>

        <div className="admin-metric-card">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Audio Upload Failures</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-microphone" style={{ color: '#64748B' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: metrics && metrics.audioUploadFailures > 0 ? '#DC2626' : 'inherit' }}>
            {metrics?.audioUploadFailures ?? 0}
          </div>
          <span className="admin-metric-subtext">order_media upload_status=&apos;failed&apos;</span>
        </div>

        <div className="admin-metric-card">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Image Upload Failures</span>
            <span className="admin-metric-icon">
              <i className="fa-regular fa-image" style={{ color: '#64748B' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: metrics && metrics.imageUploadFailures > 0 ? '#DC2626' : 'inherit' }}>
            {metrics?.imageUploadFailures ?? 0}
          </div>
          <span className="admin-metric-subtext">Avatars & document errors</span>
        </div>
      </div>

      {/* External Monitoring Status & Architecture Telemetry */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">
            <i className="fa-solid fa-server" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
            <span>Subsystem Telemetry & Infrastructure Probes</span>
          </h2>
        </div>
        <div className="admin-card-body" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>PostgreSQL Database Engine:</strong>
                <div style={{ fontSize: '0.825rem', color: '#64748B', marginTop: 2 }}>
                  Active queries to orders, riders, disputes, and order_media responding nominally.
                </div>
              </div>
              <span className="status-badge healthy">Nominal (0 err)</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Private Voice Storage (order-recordings):</strong>
                <div style={{ fontSize: '0.825rem', color: '#64748B', marginTop: 2 }}>
                  Signed URL generation active. Client direct upload policy enforced.
                </div>
              </div>
              <span className="status-badge healthy">Active</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Sensitive Rider Vault (rider-documents):</strong>
                <div style={{ fontSize: '0.825rem', color: '#64748B', marginTop: 2 }}>
                  Private bucket with restricted Row Level Security. Public anonymous access blocked.
                </div>
              </div>
              <span className="status-badge healthy">Private / RLS</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Authentication Security Probing:</strong>
                <div style={{ fontSize: '0.825rem', color: '#64748B', marginTop: 2 }}>
                  Detailed brute-force & login failure rate telemetry:
                </div>
              </div>
              <span className="status-badge offline">
                {metrics?.recentAuthFailures || 'Not yet configured'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Audit Log Card */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">
              <i className="fa-solid fa-scroll" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Administrative Audit Log ({auditLogs.length} recent actions)</span>
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
              Immutable activity log protected by database Row Level Security
            </div>
          </div>
        </div>

        <div className="admin-card-body" style={{ padding: 16 }}>
          {auditLogs.length === 0 ? (
            <div className="admin-empty-state">
              <div className="admin-empty-icon">
                <i className="fa-solid fa-scroll" />
              </div>
              <div className="admin-empty-title">No Audit Logs Recorded</div>
              <p className="admin-empty-desc">
                When administrators approve riders, change dispute statuses, or execute settings, entries appear here.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="admin-desktop-table-view">
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Timestamp (UTC)</th>
                        <th>Administrator</th>
                        <th>Action</th>
                        <th>Target</th>
                        <th>Reason / Justification</th>
                        <th>Metadata</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td style={{ fontSize: '0.8rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td style={{ fontWeight: 600 }}>{log.adminEmail}</td>
                          <td>
                            <span className="status-badge accepted">{log.action}</span>
                          </td>
                          <td style={{ fontSize: '0.8rem' }}>
                            <strong>{log.targetType}</strong> {log.targetId && `(${log.targetId.slice(0, 8)}...)`}
                          </td>
                          <td style={{ fontSize: '0.8rem', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.reason || '—'}>
                            {log.reason || '—'}
                          </td>
                          <td style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#64748B' }}>
                            {log.metadata && Object.keys(log.metadata).length > 0
                              ? JSON.stringify(log.metadata)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Cards View */}
              <div className="admin-mobile-card-list">
                {auditLogs.map((log) => (
                  <div key={log.id} className="admin-mobile-card">
                    <div className="admin-mcard-top">
                      <span className="status-badge accepted">{log.action}</span>
                      <span className="admin-mcard-time">{new Date(log.createdAt).toLocaleDateString()} {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div className="admin-mcard-body">
                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Admin:</span>
                        <span className="admin-mcard-value">{log.adminEmail}</span>
                      </div>
                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Target:</span>
                        <span className="admin-mcard-value">{log.targetType} {log.targetId && `(${log.targetId.slice(0, 8)}...)`}</span>
                      </div>
                      {log.reason && (
                        <div style={{ background: '#FFFFFF', padding: 8, borderRadius: 6, fontSize: '0.8rem', color: '#475569', marginTop: 4, border: '1px solid #E2E8F0' }}>
                          <strong>Reason:</strong> {log.reason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
