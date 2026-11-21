import React, { useEffect, useState, useCallback } from 'react';
import { adminService, type AnalyticsSummary } from '../../services';
import type { Order, OrderStatus, RiderWithStats } from '../../types';
import './AdminPages.css';

export const AdminTripsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'trips' | 'analytics'>('trips');

  // Trips List State
  const [trips, setTrips] = useState<Order[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize] = useState(12);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [riderFilter, setRiderFilter] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [riders, setRiders] = useState<RiderWithStats[]>([]);

  // Analytics State
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);

  // UI States
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<Order | null>(null);
  const [activeAudioUrl, setActiveAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [updatingTripId, setUpdatingTripId] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Load riders for rider filter
  useEffect(() => {
    adminService.getAllRiders().then(setRiders);
  }, []);

  // Fetch Trips
  const fetchTrips = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminService.getTrips({
        page: currentPage,
        pageSize,
        status: statusFilter,
        riderId: riderFilter !== 'all' ? riderFilter : undefined,
        search: searchQuery,
        dateRange: dateRangeFilter
      });
      setTrips(result.trips);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, statusFilter, riderFilter, searchQuery, dateRangeFilter]);

  // Fetch Analytics
  const fetchAnalytics = useCallback(async () => {
    const data = await adminService.getTripAnalytics();
    setAnalytics(data);
  }, []);

  useEffect(() => {
    if (activeTab === 'trips') {
      fetchTrips();
    } else {
      fetchAnalytics();
    }
  }, [activeTab, fetchTrips, fetchAnalytics]);

  const handleRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'trips') {
      await fetchTrips();
    } else {
      await fetchAnalytics();
    }
    setRefreshing(false);
  };

  const handleCopy = (phone: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard?.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  const handleOpenDetails = async (trip: Order) => {
    setSelectedTrip(trip);
    setActiveAudioUrl(null);
    if (trip.orderType === 'voice' && trip.voiceRecordingPath) {
      setLoadingAudio(true);
      const url = await adminService.getVoiceAudioSignedUrl(trip.voiceRecordingPath);
      setActiveAudioUrl(url);
      setLoadingAudio(false);
    }
  };

  const handleUpdateStatus = async (tripId: string, newStatus: OrderStatus) => {
    setUpdatingTripId(tripId);
    try {
      const res = await adminService.updateOrderStatus(tripId, newStatus);
      if (res.success) {
        setTrips((prev) =>
          prev.map((t) => (t.id === tripId ? { ...t, status: newStatus } : t))
        );
        if (selectedTrip && selectedTrip.id === tripId) {
          setSelectedTrip((prev) => (prev ? { ...prev, status: newStatus } : null));
        }
      } else {
        alert(`Failed to update status: ${res.error}`);
      }
    } finally {
      setUpdatingTripId(null);
    }
  };

  return (
    <div>
      {/* Top Header & Tab Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div className="admin-pill-group">
          <button
            type="button"
            className={`admin-pill ${activeTab === 'trips' ? 'active' : ''}`}
            onClick={() => setActiveTab('trips')}
          >
            <i className="fa-solid fa-route" style={{ marginRight: 6 }} />
            <span>Trips Feed</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>({totalCount})</span>
          </button>
          <button
            type="button"
            className={`admin-pill ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <i className="fa-solid fa-chart-pie" style={{ marginRight: 6 }} />
            <span>Fleet Analytics</span>
          </button>
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
              Refreshing...
            </>
          ) : (
            <>
              <i className="fa-solid fa-arrows-rotate" style={{ marginRight: 6 }} />
              Refresh Trips
            </>
          )}
        </button>
      </div>

      {/* =====================================================================
          TAB 1: TRIPS MANAGEMENT WITH PAGINATION & FILTERS
      ===================================================================== */}
      {activeTab === 'trips' && (
        <div className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2 className="admin-card-title">
                <i className="fa-solid fa-box-archive" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
                <span>Dispatch & Booking Requests</span>
              </h2>
              <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                Page {currentPage} of {totalPages || 1} • {totalCount} total trips in database
              </div>
            </div>

            {/* Quick Status Pill Bar */}
            <div className="admin-pill-group">
              {(['all', 'pending', 'accepted', 'completed', 'cancelled'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`admin-filter-btn ${statusFilter === st ? 'active' : ''}`}
                  onClick={() => {
                    setStatusFilter(st);
                    setCurrentPage(1);
                  }}
                  style={{ textTransform: 'capitalize' }}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-card-body">
            {/* Toolbar Filters */}
            <div className="admin-toolbar">
              <div className="admin-search-wrap">
                <span className="admin-search-icon">
                  <i className="fa-solid fa-magnifying-glass" />
                </span>
                <input
                  type="text"
                  className="admin-search-input"
                  placeholder="Search ref (OKD-XXXX) or phone..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>

              <div className="admin-filter-group">
                <select
                  className="admin-select"
                  value={riderFilter}
                  onChange={(e) => {
                    setRiderFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  title="Filter by rider"
                >
                  <option value="all">Rider: All Riders</option>
                  {riders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} ({r.motorcycleRegistration})
                    </option>
                  ))}
                </select>

                <select
                  className="admin-select"
                  value={dateRangeFilter}
                  onChange={(e) => {
                    setDateRangeFilter(e.target.value as 'all' | 'today' | '7days' | '30days');
                    setCurrentPage(1);
                  }}
                  title="Filter by date range"
                >
                  <option value="all">Range: All Time</option>
                  <option value="today">Today</option>
                  <option value="7days">Last 7 Days</option>
                  <option value="30days">Last 30 Days</option>
                </select>
              </div>
            </div>

            {/* Table or Cards */}
            {loading ? (
              <div className="admin-empty-state">
                <div className="admin-spinner" style={{ margin: '0 auto 16px' }} />
                <div className="admin-empty-title">Loading Trips</div>
                <p className="admin-empty-desc">Querying Supabase orders table...</p>
              </div>
            ) : trips.length === 0 ? (
              <div className="admin-empty-state">
                <div className="admin-empty-icon">
                  <i className="fa-solid fa-magnifying-glass" />
                </div>
                <div className="admin-empty-title">No Matching Trips Found</div>
                <p className="admin-empty-desc">
                  Try clearing your search or filter pills to view available trips.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Table View (>= 769px) */}
                <div className="admin-desktop-table-view">
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Customer Phone</th>
                          <th>Type</th>
                          <th>Assigned Rider</th>
                          <th>Area</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trips.map((trip) => (
                          <tr key={trip.id}>
                            <td>
                              <button
                                type="button"
                                onClick={() => handleOpenDetails(trip)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--color-primary)',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  padding: 0,
                                  textDecoration: 'underline'
                                }}
                              >
                                {trip.orderReference}
                              </button>
                              {trip.customerComment && (
                                <div
                                  title={trip.customerComment}
                                  style={{
                                    fontSize: '0.72rem',
                                    color: '#92400E',
                                    background: '#FEFCE8',
                                    border: '1px solid #FDE68A',
                                    borderRadius: 6,
                                    padding: '2px 6px',
                                    marginTop: 4,
                                    maxWidth: 180,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  💬 {trip.customerComment}
                                </div>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="admin-copy-pill"
                                onClick={(e) => handleCopy(trip.customerPhone, e)}
                              >
                                {trip.customerPhone}
                                <span>{copiedPhone === trip.customerPhone ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}</span>
                              </button>
                            </td>
                            <td>
                              <span>
                                {trip.orderType === 'voice' ? (
                                  <>
                                    <i className="fa-solid fa-microphone" style={{ color: '#2563EB', marginRight: 4 }} />
                                    Voice
                                  </>
                                ) : (
                                  <>
                                    <i className="fa-solid fa-comment-dots" style={{ color: '#059669', marginRight: 4 }} />
                                    Text
                                  </>
                                )}
                              </span>
                            </td>
                            <td>
                              {trip.riderName ? (
                                <div>
                                  <div style={{ fontWeight: 600 }}>{trip.riderName}</div>
                                  <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                                    {trip.riderPhone}
                                  </div>
                                </div>
                              ) : (
                                <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>
                                  Unassigned
                                </span>
                              )}
                            </td>
                            <td>{trip.operatingArea || 'Accra Central'}</td>
                            <td>
                              <span className={`status-badge ${trip.status}`}>{trip.status}</span>
                            </td>
                            <td style={{ color: '#64748B', fontSize: '0.8rem' }}>
                              {new Date(trip.createdAt).toLocaleDateString()}{' '}
                              {new Date(trip.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="admin-action-btn"
                                  onClick={() => handleOpenDetails(trip)}
                                >
                                  Details
                                </button>
                                {trip.status !== 'completed' && trip.status !== 'cancelled' && (
                                  <button
                                    type="button"
                                    className="admin-action-btn success"
                                    disabled={updatingTripId === trip.id}
                                    onClick={() => handleUpdateStatus(trip.id, 'completed')}
                                  >
                                    <i className="fa-solid fa-check" style={{ marginRight: 4 }} /> Complete
                                  </button>
                                )}
                                {trip.status !== 'cancelled' && trip.status !== 'completed' && (
                                  <button
                                    type="button"
                                    className="admin-action-btn danger"
                                    disabled={updatingTripId === trip.id}
                                    onClick={() => handleUpdateStatus(trip.id, 'cancelled')}
                                  >
                                    <i className="fa-solid fa-xmark" style={{ marginRight: 4 }} /> Cancel
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile Cards View (< 769px) */}
                <div className="admin-mobile-card-list">
                  {trips.map((trip) => (
                    <div key={trip.id} className="admin-mobile-card">
                      <div className="admin-mcard-top">
                        <div className="admin-mcard-title-group">
                          <span className="admin-mcard-title">{trip.orderReference}</span>
                          <span>
                            {trip.orderType === 'voice' ? (
                              <i className="fa-solid fa-microphone" style={{ color: '#2563EB' }} />
                            ) : (
                              <i className="fa-solid fa-comment-dots" style={{ color: '#059669' }} />
                            )}
                          </span>
                        </div>
                        <span className={`status-badge ${trip.status}`}>{trip.status}</span>
                      </div>

                      <div className="admin-mcard-body">
                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Customer:</span>
                          <button
                            type="button"
                            className="admin-copy-pill"
                            onClick={(e) => handleCopy(trip.customerPhone, e)}
                          >
                            {trip.customerPhone}
                            <span>{copiedPhone === trip.customerPhone ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}</span>
                          </button>
                        </div>

                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Rider:</span>
                          <span className="admin-mcard-value">
                            {trip.riderName || 'Awaiting assignment'}
                          </span>
                        </div>

                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Area:</span>
                          <span className="admin-mcard-value">{trip.operatingArea || 'Accra Central'}</span>
                        </div>

                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Time:</span>
                          <span className="admin-mcard-value">
                            {new Date(trip.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {/* Mobile Touch Action Row */}
                      <div className="admin-mcard-actions">
                        <button
                          type="button"
                          className="admin-action-btn primary"
                          style={{ flex: 1 }}
                          onClick={() => handleOpenDetails(trip)}
                        >
                          <i className="fa-solid fa-magnifying-glass" style={{ marginRight: 4 }} /> View Details
                        </button>
                        {trip.status !== 'completed' && trip.status !== 'cancelled' && (
                          <button
                            type="button"
                            className="admin-action-btn success"
                            disabled={updatingTripId === trip.id}
                            onClick={() => handleUpdateStatus(trip.id, 'completed')}
                          >
                            <i className="fa-solid fa-check" style={{ marginRight: 4 }} /> Complete
                          </button>
                        )}
                        {trip.status !== 'cancelled' && trip.status !== 'completed' && (
                          <button
                            type="button"
                            className="admin-action-btn danger"
                            disabled={updatingTripId === trip.id}
                            onClick={() => handleUpdateStatus(trip.id, 'cancelled')}
                          >
                            <i className="fa-solid fa-xmark" style={{ marginRight: 4 }} /> Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="admin-pagination">
                <span className="admin-pagination-info">
                  Showing {(currentPage - 1) * pageSize + 1} to{' '}
                  {Math.min(currentPage * pageSize, totalCount)} of {totalCount} trips
                </span>

                <div className="admin-pagination-controls">
                  <button
                    type="button"
                    className="admin-page-btn"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <i className="fa-solid fa-chevron-left" style={{ marginRight: 4 }} /> Prev
                  </button>
                  <span style={{ padding: '0 8px', fontSize: '0.8rem', fontWeight: 600 }}>
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="admin-page-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next <i className="fa-solid fa-chevron-right" style={{ marginLeft: 4 }} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: ANALYTICS & FLEET INTELLIGENCE
      ===================================================================== */}
      {activeTab === 'analytics' && (
        <div>
          {/* Summary KPIs Row */}
          <div className="admin-grid-metrics">
            <div className="admin-metric-card accent-green">
              <div className="admin-metric-header">
                <span className="admin-metric-label">Completed Rides</span>
                <span className="admin-metric-icon">
                  <i className="fa-solid fa-circle-check" style={{ color: '#059669' }} />
                </span>
              </div>
              <div className="admin-metric-value" style={{ color: '#059669' }}>
                {analytics?.completedCount ?? 0}
              </div>
              <span className="admin-metric-subtext">Successfully fulfilled</span>
            </div>

            <div className="admin-metric-card accent-red">
              <div className="admin-metric-header">
                <span className="admin-metric-label">Cancelled Rides</span>
                <span className="admin-metric-icon">
                  <i className="fa-solid fa-circle-xmark" style={{ color: '#DC2626' }} />
                </span>
              </div>
              <div className="admin-metric-value" style={{ color: '#DC2626' }}>
                {analytics?.cancelledCount ?? 0}
              </div>
              <span className="admin-metric-subtext">Customer / dispatcher cancelled</span>
            </div>

            <div className="admin-metric-card accent-blue">
              <div className="admin-metric-header">
                <span className="admin-metric-label">Completion Ratio</span>
                <span className="admin-metric-icon">
                  <i className="fa-solid fa-chart-line" style={{ color: 'var(--color-primary)' }} />
                </span>
              </div>
              <div className="admin-metric-value" style={{ color: 'var(--color-primary)' }}>
                {analytics?.completionRatePercent ?? 100}%
              </div>
              <span className="admin-metric-subtext">Fulfillment effectiveness</span>
            </div>

            <div className="admin-metric-card accent-amber">
              <div className="admin-metric-header">
                <span className="admin-metric-label">Avg Pickup Speed</span>
                <span className="admin-metric-icon">
                  <i className="fa-solid fa-stopwatch" style={{ color: '#D97706' }} />
                </span>
              </div>
              <div className="admin-metric-value" style={{ color: '#D97706' }}>
                {analytics?.avgAcceptanceTimeMinutes != null ? `${analytics.avgAcceptanceTimeMinutes} min` : 'N/A'}
              </div>
              <span className="admin-metric-subtext">Booking to rider pickup</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            {/* Operating Areas Breakdown */}
            <div className="admin-card">
              <div className="admin-card-header">
                <h3 className="admin-card-title">
                  <i className="fa-solid fa-location-dot" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
                  <span>Top Operating Areas</span>
                </h3>
              </div>
              <div className="admin-card-body">
                {analytics?.tripsByArea && analytics.tripsByArea.length > 0 ? (
                  <div className="admin-chart-container">
                    <div className="admin-chart-bar-group">
                      {analytics.tripsByArea.map((a) => {
                        const maxCount = Math.max(...analytics.tripsByArea.map((item) => item.count), 1);
                        return (
                          <div key={a.area} className="admin-chart-bar-row">
                            <span className="admin-chart-bar-label">{a.area}</span>
                            <div className="admin-chart-bar-track">
                              <div
                                className="admin-chart-bar-fill"
                                style={{ width: `${Math.round((a.count / maxCount) * 100)}%` }}
                              />
                            </div>
                            <span className="admin-chart-bar-value">{a.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p style={{ color: '#64748B', fontSize: '0.85rem' }}>No operating area data recorded yet.</p>
                )}
              </div>
            </div>

            {/* Top Riders Leaderboard */}
            <div className="admin-card">
              <div className="admin-card-header">
                <h3 className="admin-card-title">
                  <i className="fa-solid fa-trophy" style={{ color: '#D97706', marginRight: 8 }} />
                  <span>Top Performing Riders</span>
                </h3>
              </div>
              <div className="admin-card-body">
                {analytics?.topRiders && analytics.topRiders.length > 0 ? (
                  <div className="admin-chart-container">
                    <div className="admin-chart-bar-group">
                      {analytics.topRiders.map((r) => {
                        const maxCount = Math.max(...analytics.topRiders.map((item) => item.completedCount), 1);
                        return (
                          <div key={r.riderName} className="admin-chart-bar-row">
                            <span className="admin-chart-bar-label">{r.riderName}</span>
                            <div className="admin-chart-bar-track">
                              <div
                                className="admin-chart-bar-fill success"
                                style={{ width: `${Math.round((r.completedCount / maxCount) * 100)}%` }}
                              />
                            </div>
                            <span className="admin-chart-bar-value">{r.completedCount}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p style={{ color: '#64748B', fontSize: '0.85rem' }}>No completed rider stats available yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TRIP DETAILS MODAL / BOTTOM SHEET
      ===================================================================== */}
      {selectedTrip && (
        <div className="admin-modal-overlay" onClick={() => setSelectedTrip(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">
                Trip Details — {selectedTrip.orderReference}
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setSelectedTrip(null)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="admin-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Status
                  </div>
                  <span className={`status-badge ${selectedTrip.status}`} style={{ marginTop: 4 }}>
                    {selectedTrip.status}
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Booking Channel
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>
                    {selectedTrip.orderType === 'voice' ? (
                      <>
                        <i className="fa-solid fa-microphone" style={{ color: '#2563EB', marginRight: 6 }} />
                        Voice Note
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-comment-dots" style={{ color: '#059669', marginRight: 6 }} />
                        Text Message
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Customer Contact
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <button
                      type="button"
                      className="admin-copy-pill"
                      onClick={(e) => handleCopy(selectedTrip.customerPhone, e)}
                    >
                      {selectedTrip.customerPhone}
                      <span>{copiedPhone === selectedTrip.customerPhone ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Assigned Rider
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>
                    {selectedTrip.riderName || 'Unassigned'}
                    {selectedTrip.riderPhone && ` (${selectedTrip.riderPhone})`}
                  </div>
                </div>
              </div>

              {/* Timestamps */}
              <div style={{ background: '#F8FAFC', padding: 14, borderRadius: 10, marginBottom: 16, fontSize: '0.825rem', border: '1px solid #EDF2F7' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: '#64748B' }}>Created:</span>
                  <strong>{new Date(selectedTrip.createdAt).toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: '#64748B' }}>Accepted:</span>
                  <strong>{selectedTrip.acceptedAt ? new Date(selectedTrip.acceptedAt).toLocaleString() : '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Completed:</span>
                  <strong>{selectedTrip.completedAt ? new Date(selectedTrip.completedAt).toLocaleString() : '—'}</strong>
                </div>
              </div>

              {/* Order Content */}
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748B', marginBottom: 8 }}>
                  Order Description / Voice Playback
                </div>
                {selectedTrip.orderType === 'voice' ? (
                  <div>
                    {loadingAudio ? (
                      <p style={{ fontSize: '0.85rem', color: '#64748B' }}>Generating secure signed playback URL...</p>
                    ) : activeAudioUrl ? (
                      <audio src={activeAudioUrl} controls style={{ width: '100%', height: 44 }} />
                    ) : (
                      <p style={{ fontSize: '0.85rem', color: '#64748B' }}>
                        Voice file: {selectedTrip.voiceRecordingPath || 'No audio uploaded.'}
                      </p>
                    )}
                  </div>
                ) : (
                  <div style={{ background: '#F8FAFC', padding: 14, borderRadius: 10, fontSize: '0.9rem', border: '1px solid #EDF2F7', lineHeight: 1.5 }}>
                    {selectedTrip.requestDescription || 'No description provided.'}
                  </div>
                )}
              </div>

              {/* Customer Comment */}
              {selectedTrip.customerComment && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#92400E', marginBottom: 8 }}>
                    💬 Customer Comment
                  </div>
                  <div
                    style={{
                      background: '#FEFCE8',
                      padding: 14,
                      borderRadius: 10,
                      fontSize: '0.9rem',
                      border: '1px solid #FDE68A',
                      color: '#713F12',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {selectedTrip.customerComment}
                  </div>
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              {selectedTrip.status !== 'completed' && selectedTrip.status !== 'cancelled' && (
                <button
                  type="button"
                  className="admin-action-btn success"
                  disabled={updatingTripId === selectedTrip.id}
                  onClick={() => handleUpdateStatus(selectedTrip.id, 'completed')}
                >
                  <i className="fa-solid fa-check" style={{ marginRight: 6 }} /> Mark Completed
                </button>
              )}
              {selectedTrip.status !== 'cancelled' && selectedTrip.status !== 'completed' && (
                <button
                  type="button"
                  className="admin-action-btn danger"
                  disabled={updatingTripId === selectedTrip.id}
                  onClick={() => handleUpdateStatus(selectedTrip.id, 'cancelled')}
                >
                  <i className="fa-solid fa-xmark" style={{ marginRight: 6 }} /> Cancel Trip
                </button>
              )}
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => setSelectedTrip(null)}
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
