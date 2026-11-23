import React, { useEffect, useState, useCallback } from 'react';
import { adminService } from '../../services';
import { Link, useRouter } from '../../router';
import type { AdminOverviewStats, Order, RiderWithStats, Dispute, CustomerRecord } from '../../types';
import './AdminPages.css';

export const AdminOverviewPage: React.FC = () => {
  const { navigate } = useRouter();
  const [metrics, setMetrics] = useState<AdminOverviewStats | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [recentRiders, setRecentRiders] = useState<RiderWithStats[]>([]);
  const [recentDisputes, setRecentDisputes] = useState<Dispute[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer Numbers Modal
  const [showCustomersModal, setShowCustomersModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [stats, ordersData, ridersData, disputesData, customersData] = await Promise.all([
        adminService.getAdminMetrics(),
        adminService.getTrips({ page: 1, pageSize: 6 }),
        adminService.getAllRiders(),
        adminService.getAllDisputes({ status: 'all' }),
        adminService.getAllCustomers()
      ]);

      setMetrics(stats);
      setRecentOrders(ordersData.trips);
      setRecentRiders(ridersData.slice(0, 5));
      setRecentDisputes(disputesData.slice(0, 5));
      setCustomers(customersData);
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || 'Failed to load dashboard metrics.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCopyPhone = (phone: string) => {
    navigator.clipboard?.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  const filteredCustomers = customers.filter((c) =>
    c.customerPhone.toLowerCase().includes(customerSearch.trim().toLowerCase())
  );

  if (loading) {
    return (
      <div className="admin-empty-state">
        <div className="admin-spinner" style={{ margin: '0 auto 16px' }} />
        <div className="admin-empty-title">Loading Operations Data</div>
        <p className="admin-empty-desc">Connecting to Okada Book database and aggregating live telemetry...</p>
      </div>
    );
  }

  const onlineCount = metrics?.onlineRiders ?? 0;
  const pendingTrips = metrics?.pendingOrders ?? 0;
  const pendingVerificationCount = metrics?.pendingRiders ?? 0;
  const openDisputesCount = metrics?.openDisputes ?? 0;

  return (
    <div>
      {/* Human Welcome & Operations Status Hero */}
      <div className="admin-welcome-banner">
        <div className="admin-welcome-left">
          <div className="admin-welcome-avatar" role="img" aria-label="Motorcycle">
            <i className="fa-solid fa-motorcycle" />
          </div>
          <div>
            <h2 className="admin-welcome-greeting">Akwaaba, Operations Chief! 👋</h2>
            <div className="admin-welcome-subtext">
              {onlineCount > 0 ? (
                <span>
                  🟢 <strong>{onlineCount} riders online</strong> ready across Accra • {pendingTrips} trip{pendingTrips !== 1 ? 's' : ''} waiting
                </span>
              ) : (
                <span>
                  ⚠️ No riders currently online • {pendingTrips} pending order{pendingTrips !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="admin-welcome-actions">
          <button
            type="button"
            className="admin-action-btn primary"
            onClick={() => loadData(true)}
            disabled={refreshing}
          >
            <i className={`fa-solid fa-arrows-rotate ${refreshing ? 'fa-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh Live Data'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '14px 16px', borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', marginBottom: 20, fontSize: '0.875rem' }}>
          <strong>Error loading metrics:</strong> {error}
        </div>
      )}

      {/* Quick Action Chips Bar (Thumb-friendly on mobile) */}
      <div className="admin-quick-actions-bar" aria-label="Quick Actions">
        <button
          type="button"
          className="admin-quick-action-pill highlight"
          onClick={() => setShowCustomersModal(true)}
        >
          <i className="fa-solid fa-users" />
          <span>Registered Contacts</span>
          <span className="admin-action-counter">{metrics?.totalCustomers ?? customers.length}</span>
        </button>

        <Link href="/portal/verification" className="admin-quick-action-pill">
          <i className="fa-solid fa-shield-halved" />
          <span>Pending Verifications</span>
          {pendingVerificationCount > 0 && (
            <span className="admin-action-counter alert">{pendingVerificationCount}</span>
          )}
        </Link>

        <Link href="/portal/disputes" className="admin-quick-action-pill">
          <i className="fa-solid fa-scale-balanced" />
          <span>Open Disputes</span>
          {openDisputesCount > 0 && (
            <span className="admin-action-counter alert">{openDisputesCount}</span>
          )}
        </Link>

        <Link href="/portal/trips" className="admin-quick-action-pill">
          <i className="fa-solid fa-route" />
          <span>Trips Feed</span>
        </Link>

        <Link href="/portal/riders" className="admin-quick-action-pill">
          <i className="fa-solid fa-motorcycle" />
          <span>Rider Fleet</span>
        </Link>
      </div>

      {/* KPI Section 1: Trip & Customer Summary Cards */}
      <div className="admin-grid-metrics">
        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Total Trips</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-box-archive" />
            </span>
          </div>
          <div className="admin-metric-value">{metrics?.totalOrders ?? 0}</div>
          <span className="admin-metric-subtext">All-time booking requests</span>
        </div>

        <div className="admin-metric-card accent-amber">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Pending Trips</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-clock" />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#D97706' }}>
            {metrics?.pendingOrders ?? 0}
          </div>
          <span className="admin-metric-subtext">Awaiting rider acceptance</span>
        </div>

        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Active on Road</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-bolt" />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: 'var(--color-secondary)' }}>
            {metrics?.acceptedOrders ?? 0}
          </div>
          <span className="admin-metric-subtext">Accepted / In transit</span>
        </div>

        <div className="admin-metric-card accent-green">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Completed Rides</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-circle-check" />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#059669' }}>
            {metrics?.completedOrders ?? 0}
          </div>
          <span className="admin-metric-subtext">Safely arrived at destination</span>
        </div>

        <div className="admin-metric-card accent-red">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Cancelled Trips</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-circle-xmark" />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#DC2626' }}>
            {metrics?.cancelledOrders ?? 0}
          </div>
          <span className="admin-metric-subtext">Cancelled or timed out</span>
        </div>

        {/* CLICKABLE REGISTERED CUSTOMERS CARD (Test Contract Requirement) */}
        <div
          className="admin-metric-card accent-blue interactive"
          onClick={() => setShowCustomersModal(true)}
          style={{
            cursor: 'pointer',
            border: '2px solid var(--color-primary)',
            backgroundColor: '#F8FAFF'
          }}
          title="Click to view all registered customer phone numbers"
        >
          <div className="admin-metric-header">
            <span className="admin-metric-label" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
              Registered Customers
            </span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-users" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: 'var(--color-primary)' }}>
            {metrics?.totalCustomers ?? customers.length}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <span className="admin-metric-subtext">Client phone records</span>
            <span style={{ fontSize: '0.725rem', color: 'var(--color-primary)', fontWeight: 700, background: '#E0E7FF', padding: '2px 8px', borderRadius: 9999 }}>
              Tap to view →
            </span>
          </div>
        </div>
      </div>

      {/* KPI Section 2: Fleet & Verification Metrics */}
      <div className="admin-grid-metrics">
        <div className="admin-metric-card">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Registered Riders</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-motorcycle" />
            </span>
          </div>
          <div className="admin-metric-value">{metrics?.totalRiders ?? 0}</div>
          <span className="admin-metric-subtext">Total onboarded riders</span>
        </div>

        <div className="admin-metric-card accent-green">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Online Riders</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-circle-dot" style={{ color: '#059669' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#059669' }}>
            {metrics?.onlineRiders ?? 0}
          </div>
          <span className="admin-metric-subtext">On duty & available</span>
        </div>

        <div className="admin-metric-card">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Offline Riders</span>
            <span className="admin-metric-icon">
              <i className="fa-regular fa-circle" style={{ color: '#64748B' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#64748B' }}>
            {metrics?.offlineRiders ?? 0}
          </div>
          <span className="admin-metric-subtext">Currently resting</span>
        </div>

        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Verified Riders</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-shield-halved" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: 'var(--color-primary)' }}>
            {metrics?.verifiedRiders ?? 0}
          </div>
          <span className="admin-metric-subtext">Approved dispatch access</span>
        </div>

        <div className="admin-metric-card accent-amber">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Pending Verification</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-id-card" style={{ color: '#D97706' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#D97706' }}>
            {metrics?.pendingRiders ?? 0}
          </div>
          <span className="admin-metric-subtext">Awaiting document check</span>
        </div>

        <div className="admin-metric-card accent-red">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Active Disputes</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-scale-balanced" />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: openDisputesCount > 0 ? '#DC2626' : 'var(--color-dark-navy)' }}>
            {openDisputesCount}
          </div>
          <span className="admin-metric-subtext">Under investigation</span>
        </div>
      </div>

      {/* Speed & Operational Cadence Card */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">
            <i className="fa-solid fa-stopwatch" />
            <span>Dispatch Cadence & Speed</span>
          </h2>
        </div>
        <div className="admin-card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Today&apos;s Trips
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-dark-navy)', marginTop: 2 }}>
                {metrics?.todayOrders ?? 0}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Since midnight UTC</span>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                This Week&apos;s Trips
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-dark-navy)', marginTop: 2 }}>
                {metrics?.weekOrders ?? 0}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Past 7 days</span>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                This Month
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-dark-navy)', marginTop: 2 }}>
                {metrics?.monthOrders ?? 0}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Current calendar month</span>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Avg Acceptance Time
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-secondary)', marginTop: 2 }}>
                {metrics?.avgAcceptanceSeconds != null
                  ? `${Math.round(metrics.avgAcceptanceSeconds / 60)} min`
                  : 'N/A'}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Customer request to rider pick</span>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>
                Avg Transit Duration
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#059669', marginTop: 2 }}>
                {metrics?.avgCompletionSeconds != null
                  ? `${Math.round(metrics.avgCompletionSeconds / 60)} min`
                  : 'N/A'}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Transit to delivery</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Section: Recent Trips & Recent Riders */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {/* Recent Trips Card */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">
              <i className="fa-solid fa-route" />
              <span>Recent Trips</span>
            </h2>
            <Link href="/portal/trips" className="admin-action-btn">
              View All Trips →
            </Link>
          </div>

          <div className="admin-card-body" style={{ padding: 16 }}>
            {recentOrders.length === 0 ? (
              <div className="admin-empty-state">
                <div className="admin-empty-icon">
                  <i className="fa-regular fa-folder-open" />
                </div>
                <div className="admin-empty-title">No Trips Yet</div>
                <p className="admin-empty-desc">
                  When customers submit requests, they will populate here in real-time.
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
                          <th>Ref</th>
                          <th>Customer Phone</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentOrders.map((o) => (
                          <tr key={o.id}>
                            <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{o.orderReference}</td>
                            <td>
                              <button
                                type="button"
                                className="admin-copy-pill"
                                onClick={() => handleCopyPhone(o.customerPhone)}
                                title="Click to copy"
                              >
                                {o.customerPhone}
                                <i className={`fa-solid ${copiedPhone === o.customerPhone ? 'fa-check' : 'fa-copy'}`} />
                              </button>
                            </td>
                            <td>
                              <span>
                                <i className={`fa-solid ${o.orderType === 'voice' ? 'fa-microphone' : 'fa-comment-dots'}`} style={{ marginRight: 6 }} />
                                {o.orderType === 'voice' ? 'Voice' : 'Text'}
                              </span>
                            </td>
                            <td>
                              <span className={`status-badge ${o.status}`}>{o.status}</span>
                            </td>
                            <td style={{ color: '#64748B', fontSize: '0.8rem' }}>
                              {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile Cards View */}
                <div className="admin-mobile-card-list">
                  {recentOrders.map((o) => (
                    <div key={o.id} className="admin-mobile-card">
                      <div className="admin-mcard-top">
                        <div className="admin-mcard-title-group">
                          <span className="admin-mcard-title">{o.orderReference}</span>
                          <i className={`fa-solid ${o.orderType === 'voice' ? 'fa-microphone' : 'fa-comment-dots'}`} style={{ fontSize: '0.85rem', color: '#64748B' }} />
                        </div>
                        <span className={`status-badge ${o.status}`}>{o.status}</span>
                      </div>

                      <div className="admin-mcard-body">
                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Customer Contact:</span>
                          <button
                            type="button"
                            className="admin-copy-pill"
                            onClick={() => handleCopyPhone(o.customerPhone)}
                          >
                            {o.customerPhone}
                            <i className={`fa-solid ${copiedPhone === o.customerPhone ? 'fa-check' : 'fa-copy'}`} />
                          </button>
                        </div>
                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Created:</span>
                          <span className="admin-mcard-value">
                            {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Recent Riders Card */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">
              <i className="fa-solid fa-motorcycle" />
              <span>Recent Riders</span>
            </h2>
            <Link href="/portal/riders" className="admin-action-btn">
              Fleet Directory →
            </Link>
          </div>

          <div className="admin-card-body" style={{ padding: 16 }}>
            {recentRiders.length === 0 ? (
              <div className="admin-empty-state">
                <div className="admin-empty-icon">
                  <i className="fa-solid fa-motorcycle" />
                </div>
                <div className="admin-empty-title">No Registered Riders</div>
                <p className="admin-empty-desc">
                  Riders will be listed here upon completing registration.
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
                          <th>Rider</th>
                          <th>Contact</th>
                          <th>Plate</th>
                          <th>Verification</th>
                          <th>Duty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentRiders.map((r) => (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 700 }}>{r.fullName}</td>
                            <td>
                              <button
                                type="button"
                                className="admin-copy-pill"
                                onClick={() => handleCopyPhone(r.phoneNumber)}
                              >
                                {r.phoneNumber}
                                <i className={`fa-solid ${copiedPhone === r.phoneNumber ? 'fa-check' : 'fa-copy'}`} />
                              </button>
                            </td>
                            <td style={{ fontFamily: 'monospace' }}>{r.motorcycleRegistration}</td>
                            <td>
                              <span className={`status-badge ${r.verificationStatus}`}>
                                {r.verificationStatus}
                              </span>
                            </td>
                            <td>
                              <span className={`status-badge ${r.isAvailable ? 'online' : 'offline'}`}>
                                {r.isAvailable ? '● Online' : '○ Offline'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile Cards View */}
                <div className="admin-mobile-card-list">
                  {recentRiders.map((r) => (
                    <div key={r.id} className="admin-mobile-card">
                      <div className="admin-mcard-top">
                        <span className="admin-mcard-title">{r.fullName}</span>
                        <span className={`status-badge ${r.isAvailable ? 'online' : 'offline'}`}>
                          {r.isAvailable ? '● Online' : '○ Offline'}
                        </span>
                      </div>

                      <div className="admin-mcard-body">
                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Phone:</span>
                          <button
                            type="button"
                            className="admin-copy-pill"
                            onClick={() => handleCopyPhone(r.phoneNumber)}
                          >
                            {r.phoneNumber}
                            <i className={`fa-solid ${copiedPhone === r.phoneNumber ? 'fa-check' : 'fa-copy'}`} />
                          </button>
                        </div>
                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Plate / Bike:</span>
                          <span className="admin-mcard-value">{r.motorcycleRegistration}</span>
                        </div>
                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Verification:</span>
                          <span className={`status-badge ${r.verificationStatus}`}>
                            {r.verificationStatus}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Recent Disputes Row */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h2 className="admin-card-title">
            <i className="fa-solid fa-scale-balanced" />
            <span>Recent Disputes & Complaints</span>
          </h2>
          <Link href="/portal/disputes" className="admin-action-btn">
            Dispute Workspace →
          </Link>
        </div>

        <div className="admin-card-body" style={{ padding: 16 }}>
          {recentDisputes.length === 0 ? (
            <div className="admin-empty-state">
              <div className="admin-empty-icon">
                <i className="fa-solid fa-sparkles" />
              </div>
              <div className="admin-empty-title">All Clear! No Active Disputes</div>
              <p className="admin-empty-desc">
                No customer or rider complaints have been filed in the system. Everything is operating smoothly.
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
                        <th>Dispute Ref</th>
                        <th>Order</th>
                        <th>Reporter</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentDisputes.map((d) => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{d.disputeReference}</td>
                          <td style={{ fontFamily: 'monospace' }}>{d.orderReference || '—'}</td>
                          <td>
                            <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{d.reporterType}</span> ({d.reporterPhone})
                          </td>
                          <td>
                            <span style={{ textTransform: 'capitalize' }}>
                              {d.category.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge ${d.status}`}>{d.status}</span>
                          </td>
                          <td style={{ color: '#64748B', fontSize: '0.8rem' }}>
                            {new Date(d.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Cards View */}
              <div className="admin-mobile-card-list">
                {recentDisputes.map((d) => (
                  <div key={d.id} className="admin-mobile-card">
                    <div className="admin-mcard-top">
                      <span className="admin-mcard-title">{d.disputeReference}</span>
                      <span className={`status-badge ${d.status}`}>{d.status}</span>
                    </div>
                    <div className="admin-mcard-body">
                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Category:</span>
                        <span className="admin-mcard-value" style={{ textTransform: 'capitalize' }}>
                          {d.category.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Reporter:</span>
                        <span className="admin-mcard-value">{d.reporterType} ({d.reporterPhone})</span>
                      </div>
                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Date:</span>
                        <span className="admin-mcard-value">{new Date(d.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* =====================================================================
          REGISTERED CUSTOMERS NUMBERS MODAL / MOBILE BOTTOM SHEET
      ===================================================================== */}
      {showCustomersModal && (
        <div className="admin-modal-overlay" onClick={() => setShowCustomersModal(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 740 }}>
            <div className="admin-modal-header">
              <div>
                <h3 className="admin-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="fa-solid fa-users" />
                  <span>Registered Customer Contacts ({customers.length})</span>
                </h3>
                <span style={{ fontSize: '0.775rem', color: '#64748B' }}>
                  Recorded contact numbers from customer booking requests
                </span>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setShowCustomersModal(false)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="admin-modal-body">
              {/* Search filter input */}
              <div style={{ marginBottom: 16 }}>
                <div className="admin-search-wrap" style={{ maxWidth: '100%' }}>
                  <span className="admin-search-icon">
                    <i className="fa-solid fa-magnifying-glass" />
                  </span>
                  <input
                    type="text"
                    className="admin-search-input"
                    placeholder="Search phone number (e.g. 024...)..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              {filteredCustomers.length === 0 ? (
                <div className="admin-empty-state" style={{ padding: 24 }}>
                  <div className="admin-empty-icon">
                    <i className="fa-solid fa-users" />
                  </div>
                  <div className="admin-empty-title">No Customer Numbers Found</div>
                  <p className="admin-empty-desc">
                    {customers.length === 0
                      ? 'No orders have been submitted yet. Every new contact taken will be recorded here.'
                      : 'No numbers match your search.'}
                  </p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="admin-desktop-table-view">
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Phone Number</th>
                            <th>Total Orders</th>
                            <th>Completed</th>
                            <th>Channel</th>
                            <th>Last Active</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCustomers.map((cust) => (
                            <tr key={cust.customerPhone}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                                    {cust.customerPhone}
                                  </span>
                                  <button
                                    type="button"
                                    className="admin-copy-pill"
                                    onClick={() => handleCopyPhone(cust.customerPhone)}
                                    title="Copy phone number to clipboard"
                                  >
                                    <i className={`fa-solid ${copiedPhone === cust.customerPhone ? 'fa-check' : 'fa-copy'}`} />
                                    <span>{copiedPhone === cust.customerPhone ? 'Copied' : 'Copy'}</span>
                                  </button>
                                </div>
                              </td>
                              <td>
                                <strong>{cust.totalOrders}</strong> order{cust.totalOrders > 1 ? 's' : ''}
                              </td>
                              <td>
                                <span style={{ color: '#059669', fontWeight: 700 }}>
                                  {cust.completedOrders}
                                </span>
                              </td>
                              <td>
                                <span style={{ fontSize: '0.8rem' }}>
                                  <i className={`fa-solid ${cust.voiceOrdersCount >= cust.textOrdersCount ? 'fa-microphone' : 'fa-comment-dots'}`} style={{ marginRight: 6 }} />
                                  {cust.voiceOrdersCount >= cust.textOrdersCount
                                    ? `Voice (${cust.voiceOrdersCount})`
                                    : `Text (${cust.textOrdersCount})`}
                                </span>
                              </td>
                              <td style={{ color: '#64748B', fontSize: '0.8rem' }}>
                                {new Date(cust.lastOrderAt).toLocaleDateString()}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="admin-action-btn primary"
                                  onClick={() => {
                                    setShowCustomersModal(false);
                                    navigate('/portal/trips');
                                  }}
                                  style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                                >
                                  Trips →
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobile Cards */}
                  <div className="admin-mobile-card-list">
                    {filteredCustomers.map((cust) => (
                      <div key={cust.customerPhone} className="admin-mobile-card">
                        <div className="admin-mcard-top">
                          <span style={{ fontFamily: 'monospace', fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                            {cust.customerPhone}
                          </span>
                          <button
                            type="button"
                            className="admin-copy-pill"
                            onClick={() => handleCopyPhone(cust.customerPhone)}
                          >
                            <i className={`fa-solid ${copiedPhone === cust.customerPhone ? 'fa-check' : 'fa-copy'}`} />
                            <span>{copiedPhone === cust.customerPhone ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                        <div className="admin-mcard-body">
                          <div className="admin-mcard-row">
                            <span className="admin-mcard-label">Total Rides:</span>
                            <span className="admin-mcard-value">{cust.totalOrders} total ({cust.completedOrders} completed)</span>
                          </div>
                          <div className="admin-mcard-row">
                            <span className="admin-mcard-label">Booking Type:</span>
                            <span className="admin-mcard-value">
                              <i className={`fa-solid ${cust.voiceOrdersCount >= cust.textOrdersCount ? 'fa-microphone' : 'fa-comment-dots'}`} style={{ marginRight: 6 }} />
                              {cust.voiceOrdersCount >= cust.textOrdersCount ? `Voice (${cust.voiceOrdersCount})` : `Text (${cust.textOrdersCount})`}
                            </span>
                          </div>
                          <div className="admin-mcard-row">
                            <span className="admin-mcard-label">Last Active:</span>
                            <span className="admin-mcard-value">{new Date(cust.lastOrderAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="admin-modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="admin-action-btn primary"
                onClick={() => {
                  setShowCustomersModal(false);
                  navigate('/portal/customers');
                }}
              >
                Open Full Customer Directory →
              </button>
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => setShowCustomersModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
