import React, { useEffect, useState, useCallback } from 'react';
import { adminService, pushNotificationService } from '../../services';
import type { RiderWithStats, RiderVerificationStatus, RiderVerificationDocument, Order } from '../../types';
import './AdminPages.css';

export const AdminRidersPage: React.FC = () => {
  const [riders, setRiders] = useState<RiderWithStats[]>([]);
  const [filteredRiders, setFilteredRiders] = useState<RiderWithStats[]>([]);
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [verificationFilter, setVerificationFilter] = useState<'all' | RiderVerificationStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Modal & Action State
  const [selectedRider, setSelectedRider] = useState<RiderWithStats | null>(null);
  const [riderDocs, setRiderDocs] = useState<RiderVerificationDocument[]>([]);
  const [riderTrips, setRiderTrips] = useState<Order[]>([]);
  const [loadingModalData, setLoadingModalData] = useState(false);

  // Status Change Dialog
  const [promptAction, setPromptAction] = useState<{
    rider: RiderWithStats;
    targetStatus: RiderVerificationStatus;
    title: string;
  } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [togglingAvailabilityId, setTogglingAvailabilityId] = useState<string | null>(null);

  const fetchRiders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getAllRiders();
      setRiders(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRiders();
  }, [fetchRiders]);

  // Filter logic
  useEffect(() => {
    let result = [...riders];

    if (availabilityFilter === 'online') {
      result = result.filter((r) => r.isAvailable);
    } else if (availabilityFilter === 'offline') {
      result = result.filter((r) => !r.isAvailable);
    }

    if (verificationFilter !== 'all') {
      result = result.filter((r) => r.verificationStatus === verificationFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          r.phoneNumber.toLowerCase().includes(q) ||
          r.motorcycleRegistration.toLowerCase().includes(q) ||
          r.operatingArea.toLowerCase().includes(q) ||
          r.motorcycleModel.toLowerCase().includes(q)
      );
    }

    setFilteredRiders(result);
  }, [riders, availabilityFilter, verificationFilter, searchQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchRiders();
    setRefreshing(false);
  };

  const handleCopy = (phone: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard?.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  const handleOpenProfile = async (rider: RiderWithStats) => {
    setSelectedRider(rider);
    setLoadingModalData(true);
    try {
      const [docs, tripsResult] = await Promise.all([
        adminService.getRiderDocuments(rider.id),
        adminService.getTrips({ riderId: rider.id, pageSize: 10 })
      ]);
      setRiderDocs(docs);
      setRiderTrips(tripsResult.trips);
    } finally {
      setLoadingModalData(false);
    }
  };

  const handleToggleAvailability = async (rider: RiderWithStats) => {
    const nextState = !rider.isAvailable;
    setTogglingAvailabilityId(rider.id);
    try {
      const res = await adminService.toggleRiderAvailability(rider.id, nextState);
      if (res.success) {
        setRiders((prev) =>
          prev.map((r) => (r.id === rider.id ? { ...r, isAvailable: nextState } : r))
        );
        if (selectedRider && selectedRider.id === rider.id) {
          setSelectedRider((prev) => (prev ? { ...prev, isAvailable: nextState } : null));
        }
      } else {
        alert(`Failed to update rider status: ${res.error}`);
      }
    } finally {
      setTogglingAvailabilityId(null);
    }
  };

  const executeStatusChange = async () => {
    if (!promptAction) return;
    const { rider, targetStatus } = promptAction;

    setSubmittingAction(true);
    try {
      const res = await adminService.updateRiderVerification(rider.id, targetStatus, actionReason);
      if (res.success) {
        setRiders((prev) =>
          prev.map((r) =>
            r.id === rider.id
              ? {
                  ...r,
                  verificationStatus: targetStatus,
                  isAvailable: targetStatus === 'suspended' ? false : r.isAvailable,
                  verificationNotes: actionReason,
                  verifiedAt: targetStatus === 'approved' ? new Date().toISOString() : r.verifiedAt
                }
              : r
          )
        );
        if (selectedRider && selectedRider.id === rider.id) {
          setSelectedRider((prev) =>
            prev
              ? {
                  ...prev,
                  verificationStatus: targetStatus,
                  isAvailable: targetStatus === 'suspended' ? false : prev.isAvailable,
                  verificationNotes: actionReason
                }
              : null
          );
        }
        setPromptAction(null);
        setActionReason('');

        // Notify only the specific rider whose status changed
        pushNotificationService.notifyRiderStatusChanged({
          riderId: rider.id,
          riderUserId: rider.userId,
          riderName: rider.fullName,
          status: targetStatus,
          reason: actionReason
        }).catch(() => {});
      } else {
        alert(`Failed to update verification status: ${res.error}`);
      }
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-empty-state">
        <div className="admin-spinner" style={{ margin: '0 auto 16px' }} />
        <div className="admin-empty-title">Loading Fleet Directory</div>
        <p className="admin-empty-desc">Connecting to Okada Book rider database...</p>
      </div>
    );
  }

  const onlineCount = riders.filter((r) => r.isAvailable).length;
  const approvedCount = riders.filter((r) => r.verificationStatus === 'approved').length;
  const pendingCount = riders.filter((r) => r.verificationStatus === 'pending').length;

  return (
    <div>
      {/* Fleet Metric Strip */}
      <div className="admin-grid-metrics">
        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Total Fleet</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-motorcycle" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value">{riders.length}</div>
          <span className="admin-metric-subtext">Registered riders</span>
        </div>

        <div className="admin-metric-card accent-green">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Verified & Approved</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-shield-halved" style={{ color: '#059669' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#059669' }}>
            {approvedCount}
          </div>
          <span className="admin-metric-subtext">Eligible for order dispatch</span>
        </div>

        <div className="admin-metric-card accent-amber">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Pending Verification</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-clock" style={{ color: '#D97706' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#D97706' }}>
            {pendingCount}
          </div>
          <span className="admin-metric-subtext">Needs admin document review</span>
        </div>

        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Online on Roads</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-circle-dot" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: 'var(--color-primary)' }}>
            {onlineCount}
          </div>
          <span className="admin-metric-subtext">Available for bookings</span>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">
              <i className="fa-solid fa-motorcycle" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Rider Fleet Directory ({filteredRiders.length})</span>
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
              Manage rider identity, document approvals, and on-duty dispatch status
            </div>
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
                Refresh Fleet
              </>
            )}
          </button>
        </div>

        <div className="admin-card-body">
          {/* Quick Filter Pill Chips */}
          <div className="admin-pill-group" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={`admin-filter-btn ${verificationFilter === 'all' && availabilityFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setVerificationFilter('all');
                setAvailabilityFilter('all');
              }}
            >
              All Riders ({riders.length})
            </button>
            <button
              type="button"
              className={`admin-filter-btn ${availabilityFilter === 'online' ? 'active' : ''}`}
              onClick={() => setAvailabilityFilter(availabilityFilter === 'online' ? 'all' : 'online')}
            >
              <i className="fa-solid fa-circle-dot" style={{ color: '#059669', marginRight: 4 }} />
              Online ({onlineCount})
            </button>
            <button
              type="button"
              className={`admin-filter-btn ${availabilityFilter === 'offline' ? 'active' : ''}`}
              onClick={() => setAvailabilityFilter(availabilityFilter === 'offline' ? 'all' : 'offline')}
            >
              <i className="fa-regular fa-circle" style={{ color: '#94A3B8', marginRight: 4 }} />
              Offline ({riders.length - onlineCount})
            </button>
            <button
              type="button"
              className={`admin-filter-btn ${verificationFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setVerificationFilter(verificationFilter === 'pending' ? 'all' : 'pending')}
            >
              <i className="fa-solid fa-clock" style={{ color: '#D97706', marginRight: 4 }} />
              Pending ({pendingCount})
            </button>
            <button
              type="button"
              className={`admin-filter-btn ${verificationFilter === 'approved' ? 'active' : ''}`}
              onClick={() => setVerificationFilter(verificationFilter === 'approved' ? 'all' : 'approved')}
            >
              <i className="fa-solid fa-circle-check" style={{ color: '#059669', marginRight: 4 }} />
              Approved ({approvedCount})
            </button>
          </div>

          {/* Search Toolbar */}
          <div className="admin-toolbar">
            <div className="admin-search-wrap">
              <span className="admin-search-icon">
                <i className="fa-solid fa-magnifying-glass" />
              </span>
              <input
                type="text"
                className="admin-search-input"
                placeholder="Search by name, phone, plate, or area..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="admin-filter-group">
              <select
                className="admin-select"
                value={verificationFilter}
                onChange={(e) => setVerificationFilter(e.target.value as 'all' | RiderVerificationStatus)}
                title="Filter by verification"
              >
                <option value="all">Verification: All</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
                <option value="suspended">Suspended</option>
              </select>

              <select
                className="admin-select"
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value as 'all' | 'online' | 'offline')}
                title="Filter by availability"
              >
                <option value="all">Duty: All</option>
                <option value="online">Online Only</option>
                <option value="offline">Offline Only</option>
              </select>
            </div>
          </div>

          {/* Table or Cards */}
          {filteredRiders.length === 0 ? (
            <div className="admin-empty-state">
              <div className="admin-empty-icon">
                <i className="fa-solid fa-motorcycle" />
              </div>
              <div className="admin-empty-title">No Riders Found</div>
              <p className="admin-empty-desc">
                {riders.length === 0
                  ? 'No riders have registered in the database yet.'
                  : 'No riders match your search or filter criteria.'}
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
                        <th>Rider Profile</th>
                        <th>Contact Phone</th>
                        <th>Motorcycle Details</th>
                        <th>Operating Area</th>
                        <th>Duty</th>
                        <th>Verification</th>
                        <th>Rides</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRiders.map((rider) => (
                        <tr key={rider.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {rider.profilePhotoUrl ? (
                                <img
                                  src={rider.profilePhotoUrl}
                                  alt={rider.fullName}
                                  style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: '50%',
                                    backgroundColor: 'var(--color-primary)',
                                    color: '#FFFFFF',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  {rider.fullName.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <button
                                  type="button"
                                  onClick={() => handleOpenProfile(rider)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    fontWeight: 700,
                                    color: 'var(--color-dark-navy)',
                                    cursor: 'pointer',
                                    padding: 0,
                                    textAlign: 'left'
                                  }}
                                >
                                  {rider.fullName}
                                </button>
                                <div style={{ fontSize: '0.725rem', color: '#64748B' }}>
                                  Reg: {new Date(rider.createdAt).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="admin-copy-pill"
                              onClick={(e) => handleCopy(rider.phoneNumber, e)}
                            >
                              {rider.phoneNumber}
                              <span>{copiedPhone === rider.phoneNumber ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}</span>
                            </button>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{rider.motorcycleRegistration}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                              {rider.motorcycleModel} ({rider.motorcycleColour})
                            </div>
                          </td>
                          <td>{rider.operatingArea}</td>
                          <td>
                            <span className={`status-badge ${rider.isAvailable ? 'online' : 'offline'}`}>
                              {rider.isAvailable ? (
                                <>
                                  <i className="fa-solid fa-circle-dot" style={{ marginRight: 4 }} /> Online
                                </>
                              ) : (
                                <>
                                  <i className="fa-regular fa-circle" style={{ marginRight: 4 }} /> Offline
                                </>
                              )}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge ${rider.verificationStatus}`}>
                              {rider.verificationStatus === 'pending' ? 'Auto-Approved (Pending)' : rider.verificationStatus}
                            </span>
                          </td>
                          <td>
                            <strong style={{ color: '#059669' }}>
                              {rider.totalCompletedRides}
                            </strong>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="admin-action-btn"
                                onClick={() => handleOpenProfile(rider)}
                              >
                                Profile
                              </button>

                              {rider.verificationStatus !== 'approved' && (
                                <button
                                  type="button"
                                  className="admin-action-btn success"
                                  onClick={() =>
                                    setPromptAction({
                                      rider,
                                      targetStatus: 'approved',
                                      title: rider.verificationStatus === 'suspended'
                                        ? `Reactivate & Approve Rider: ${rider.fullName}`
                                        : `Approve Rider: ${rider.fullName}`
                                    })
                                  }
                                >
                                  <i className="fa-solid fa-check" style={{ marginRight: 4 }} />
                                  {rider.verificationStatus === 'suspended' ? 'Reactivate' : 'Approve'}
                                </button>
                              )}

                              {rider.verificationStatus === 'pending' && (
                                <button
                                  type="button"
                                  className="admin-action-btn danger"
                                  onClick={() =>
                                    setPromptAction({
                                      rider,
                                      targetStatus: 'suspended',
                                      title: `Decline & Suspend Rider: ${rider.fullName}`
                                    })
                                  }
                                >
                                  <i className="fa-solid fa-ban" style={{ marginRight: 4 }} /> Decline
                                </button>
                              )}

                              {rider.verificationStatus === 'approved' && (
                                <button
                                  type="button"
                                  className="admin-action-btn danger"
                                  onClick={() =>
                                    setPromptAction({
                                      rider,
                                      targetStatus: 'suspended',
                                      title: `Suspend Rider: ${rider.fullName}`
                                    })
                                  }
                                >
                                  <i className="fa-solid fa-pause" style={{ marginRight: 4 }} /> Suspend
                                </button>
                              )}

                              <button
                                type="button"
                                className={`admin-action-btn ${rider.isAvailable ? 'danger' : 'success'}`}
                                disabled={togglingAvailabilityId === rider.id}
                                onClick={() => handleToggleAvailability(rider)}
                                title={rider.isAvailable ? 'Toggle Offline' : 'Toggle Online'}
                              >
                                {rider.isAvailable ? 'Set Off' : 'Set On'}
                              </button>
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
                {filteredRiders.map((rider) => (
                  <div key={rider.id} className="admin-mobile-card">
                    <div className="admin-mcard-top">
                      <div className="admin-mcard-title-group">
                        <span className="admin-mcard-title">{rider.fullName}</span>
                      </div>
                      <span className={`status-badge ${rider.isAvailable ? 'online' : 'offline'}`}>
                        {rider.isAvailable ? (
                          <>
                            <i className="fa-solid fa-circle-dot" style={{ marginRight: 4 }} /> Online
                          </>
                        ) : (
                          <>
                            <i className="fa-regular fa-circle" style={{ marginRight: 4 }} /> Offline
                          </>
                        )}
                      </span>
                    </div>

                    <div className="admin-mcard-body">
                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Contact:</span>
                        <button
                          type="button"
                          className="admin-copy-pill"
                          onClick={(e) => handleCopy(rider.phoneNumber, e)}
                        >
                          {rider.phoneNumber}
                          <span>{copiedPhone === rider.phoneNumber ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}</span>
                        </button>
                      </div>

                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Plate & Bike:</span>
                        <span className="admin-mcard-value">
                          {rider.motorcycleRegistration} ({rider.motorcycleModel})
                        </span>
                      </div>

                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Verification:</span>
                        <span className={`status-badge ${rider.verificationStatus}`}>
                          {rider.verificationStatus === 'pending' ? 'Auto-Approved (Pending)' : rider.verificationStatus}
                        </span>
                      </div>

                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Area & Rides:</span>
                        <span className="admin-mcard-value">
                          {rider.operatingArea} • <strong>{rider.totalCompletedRides} rides</strong>
                        </span>
                      </div>
                    </div>

                    {/* Mobile Touch Action Row */}
                    <div className="admin-mcard-actions">
                      <button
                        type="button"
                        className="admin-action-btn primary"
                        style={{ flex: 1 }}
                        onClick={() => handleOpenProfile(rider)}
                      >
                        <i className="fa-solid fa-user" style={{ marginRight: 4 }} /> Profile
                      </button>

                      {rider.verificationStatus !== 'approved' && (
                        <button
                          type="button"
                          className="admin-action-btn success"
                          onClick={() =>
                            setPromptAction({
                              rider,
                              targetStatus: 'approved',
                              title: rider.verificationStatus === 'suspended'
                                ? `Reactivate & Approve Rider: ${rider.fullName}`
                                : `Approve Rider: ${rider.fullName}`
                            })
                          }
                        >
                          <i className="fa-solid fa-check" style={{ marginRight: 4 }} />
                          {rider.verificationStatus === 'suspended' ? 'Reactivate' : 'Approve'}
                        </button>
                      )}

                      {rider.verificationStatus === 'pending' && (
                        <button
                          type="button"
                          className="admin-action-btn danger"
                          onClick={() =>
                            setPromptAction({
                              rider,
                              targetStatus: 'suspended',
                              title: `Decline & Suspend Rider: ${rider.fullName}`
                            })
                          }
                        >
                          <i className="fa-solid fa-ban" style={{ marginRight: 4 }} /> Decline
                        </button>
                      )}

                      {rider.verificationStatus === 'approved' && (
                        <button
                          type="button"
                          className="admin-action-btn danger"
                          onClick={() =>
                            setPromptAction({
                              rider,
                              targetStatus: 'suspended',
                              title: `Suspend Rider: ${rider.fullName}`
                            })
                          }
                        >
                          <i className="fa-solid fa-pause" style={{ marginRight: 4 }} /> Suspend
                        </button>
                      )}

                      <button
                        type="button"
                        className={`admin-action-btn ${rider.isAvailable ? 'danger' : 'success'}`}
                        disabled={togglingAvailabilityId === rider.id}
                        onClick={() => handleToggleAvailability(rider)}
                      >
                        {rider.isAvailable ? 'Set Off' : 'Set On'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* =====================================================================
          ACTION PROMPT MODAL / BOTTOM SHEET (APPROVE / REJECT / SUSPEND)
      ===================================================================== */}
      {promptAction && (
        <div className="admin-modal-overlay" onClick={() => setPromptAction(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{promptAction.title}</h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setPromptAction(null)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="admin-modal-body">
              <p style={{ fontSize: '0.9rem', color: '#475569', marginBottom: 14, lineHeight: 1.5 }}>
                Confirm changing verification status for <strong>{promptAction.rider.fullName}</strong> to{' '}
                <strong style={{ textTransform: 'uppercase' }}>{promptAction.targetStatus}</strong>.
              </p>

              {promptAction.targetStatus !== 'approved' && (
                <div className="admin-form-group">
                  <label className="admin-form-label">
                    Reason / Notes (recorded in permanent audit log):
                  </label>
                  <textarea
                    className="admin-form-textarea"
                    placeholder="Provide justification for rejection or suspension..."
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => setPromptAction(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`admin-action-btn ${promptAction.targetStatus === 'approved' ? 'success' : 'danger'}`}
                disabled={submittingAction}
                onClick={executeStatusChange}
              >
                {submittingAction ? 'Updating...' : `Confirm ${promptAction.targetStatus.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          RIDER PROFILE & VERIFICATION DOCUMENTS MODAL / BOTTOM SHEET
      ===================================================================== */}
      {selectedRider && (
        <div className="admin-modal-overlay" onClick={() => setSelectedRider(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 660 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">
                Rider Profile: {selectedRider.fullName}
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setSelectedRider(null)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="admin-modal-body">
              {/* Header profile info */}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
                {selectedRider.profilePhotoUrl ? (
                  <img
                    src={selectedRider.profilePhotoUrl}
                    alt={selectedRider.fullName}
                    style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-primary)',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.5rem',
                      fontWeight: 700
                    }}
                  >
                    {selectedRider.fullName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-dark-navy)' }}>
                    {selectedRider.fullName}
                  </h3>
                  <div style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 3 }}>
                    Phone: <strong>{selectedRider.phoneNumber}</strong> • ID: {selectedRider.id.slice(0, 8)}...
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`status-badge ${selectedRider.verificationStatus}`}>
                      Verification: {selectedRider.verificationStatus}
                    </span>
                    <span className={`status-badge ${selectedRider.isAvailable ? 'online' : 'offline'}`}>
                      {selectedRider.isAvailable ? (
                        <>
                          <i className="fa-solid fa-circle-dot" style={{ marginRight: 4 }} /> Online
                        </>
                      ) : (
                        <>
                          <i className="fa-regular fa-circle" style={{ marginRight: 4 }} /> Offline
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Motorcycle Details Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, background: '#F8FAFC', padding: 14, borderRadius: 10, marginBottom: 20, fontSize: '0.85rem', border: '1px solid #EDF2F7' }}>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Plate Number</div>
                  <strong>{selectedRider.motorcycleRegistration}</strong>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Model & Colour</div>
                  <strong>{selectedRider.motorcycleModel} ({selectedRider.motorcycleColour})</strong>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Operating Area</div>
                  <strong>{selectedRider.operatingArea}</strong>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Completed Rides</div>
                  <strong style={{ color: '#059669' }}>{selectedRider.totalCompletedRides} rides</strong>
                </div>
              </div>

              {/* Verification Notes */}
              {selectedRider.verificationNotes && (
                <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: '0.85rem' }}>
                  <strong>Verification Notes:</strong> {selectedRider.verificationNotes}
                </div>
              )}

              {/* Submitted Documents Section */}
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: '0.95rem', margin: '0 0 10px 0', color: 'var(--color-dark-navy)' }}>
                  <i className="fa-solid fa-file-shield" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
                  <span>Sensitive Verification Documents (Private Bucket)</span>
                </h4>

                {loadingModalData ? (
                  <p style={{ fontSize: '0.85rem', color: '#64748B' }}>
                    Generating signed document access tokens...
                  </p>
                ) : riderDocs.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#64748B' }}>
                    No identity or vehicle documents submitted yet for this rider.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {riderDocs.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: '1px solid #E2E8F0',
                          fontSize: '0.85rem',
                          background: '#FAFCFF'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>
                            {doc.documentType.replace(/_/g, ' ')}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                            {doc.fileName} ({Math.round(doc.fileSizeBytes / 1024)} KB)
                          </div>
                        </div>

                        {doc.documentUrl ? (
                          <a
                            href={doc.documentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="admin-action-btn primary"
                            style={{ textDecoration: 'none' }}
                          >
                            View Document <i className="fa-solid fa-arrow-up-right-from-square" style={{ marginLeft: 4 }} />
                          </a>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                            Signed URL expired
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Trips Section */}
              <div>
                <h4 style={{ fontSize: '0.95rem', margin: '0 0 10px 0', color: 'var(--color-dark-navy)' }}>
                  <i className="fa-solid fa-motorcycle" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
                  <span>Recent Fulfilled Trips</span>
                </h4>

                {riderTrips.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#64748B' }}>
                    No trips completed by this rider yet.
                  </p>
                ) : (
                  <div className="admin-table-wrap">
                    <table className="admin-table" style={{ fontSize: '0.8rem' }}>
                      <thead>
                        <tr>
                          <th>Ref</th>
                          <th>Status</th>
                          <th>Accepted</th>
                          <th>Completed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {riderTrips.map((t) => (
                          <tr key={t.id}>
                            <td style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{t.orderReference}</td>
                            <td>
                              <span className={`status-badge ${t.status}`}>{t.status}</span>
                            </td>
                            <td>{t.acceptedAt ? new Date(t.acceptedAt).toLocaleDateString() : '—'}</td>
                            <td>{t.completedAt ? new Date(t.completedAt).toLocaleDateString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => setSelectedRider(null)}
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
