import React, { useEffect, useState, useCallback } from 'react';
import { adminService, pushNotificationService } from '../../services';
import type { Dispute, DisputeStatus, DisputeCategory, DisputeUpdate } from '../../types';
import './AdminPages.css';

export const AdminDisputesPage: React.FC = () => {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | DisputeStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | DisputeCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Detail Modal State
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [disputeUpdates, setDisputeUpdates] = useState<DisputeUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);

  // Status Change Dialog State
  const [newStatus, setNewStatus] = useState<DisputeStatus>('investigating');
  const [statusComment, setStatusComment] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  // Create Dispute Dialog State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<{
    orderReference: string;
    reporterType: 'customer' | 'rider' | 'admin';
    reporterPhone: string;
    category: DisputeCategory;
    description: string;
  }>({
    orderReference: '',
    reporterType: 'customer',
    reporterPhone: '',
    category: 'rider_did_not_arrive',
    description: ''
  });
  const [submittingCreate, setSubmittingCreate] = useState(false);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getAllDisputes({
        status: statusFilter,
        category: categoryFilter,
        search: searchQuery
      });
      setDisputes(data);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, searchQuery]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDisputes();
    setRefreshing(false);
  };

  const handleCopy = (phone: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard?.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  const handleOpenDispute = async (dispute: Dispute) => {
    setSelectedDispute(dispute);
    setNewStatus(dispute.status);
    setStatusComment('');
    setResolutionNotes(dispute.resolutionNotes || '');
    setLoadingUpdates(true);
    try {
      const { updates } = await adminService.getDisputeDetails(dispute.id);
      setDisputeUpdates(updates);
    } finally {
      setLoadingUpdates(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedDispute) return;

    setSavingStatus(true);
    try {
      const res = await adminService.updateDisputeStatus(
        selectedDispute.id,
        newStatus,
        statusComment || `Status changed to ${newStatus}`,
        resolutionNotes
      );

      if (res.success) {
        // Refresh dispute details and list
        const { dispute, updates } = await adminService.getDisputeDetails(selectedDispute.id);
        if (dispute) setSelectedDispute(dispute);
        setDisputeUpdates(updates);
        setStatusComment('');

        setDisputes((prev) =>
          prev.map((d) => (d.id === selectedDispute.id ? { ...d, status: newStatus } : d))
        );
      } else {
        alert(`Failed to update dispute status: ${res.error}`);
      }
    } finally {
      setSavingStatus(false);
    }
  };

  const handleCreateDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.reporterPhone || !createForm.description) {
      alert('Please fill in reporter phone and description.');
      return;
    }

    setSubmittingCreate(true);
    try {
      const res = await adminService.createDispute(createForm);
      if (res.success) {
        // Dispatch push notification to admins
        pushNotificationService.dispatchNotification({
          recipientType: 'admin',
          title: `⚠️ New Dispute: ${createForm.orderReference || createForm.reporterPhone}`,
          body: `${createForm.category.replace(/_/g, ' ')}: ${createForm.description}`,
          clickAction: '/admin/disputes',
          data: {
            type: 'dispute_created',
            orderReference: createForm.orderReference || ''
          }
        }).catch(() => {});

        setShowCreateModal(false);
        setCreateForm({
          orderReference: '',
          reporterType: 'customer',
          reporterPhone: '',
          category: 'rider_did_not_arrive',
          description: ''
        });
        await fetchDisputes();
      } else {
        alert(`Failed to create dispute: ${res.error}`);
      }
    } finally {
      setSubmittingCreate(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-empty-state">
        <div className="admin-spinner" style={{ margin: '0 auto 16px' }} />
        <div className="admin-empty-title">Loading Disputes Workspace</div>
        <p className="admin-empty-desc">Connecting to customer complaints & resolution logs...</p>
      </div>
    );
  }

  const openCount = disputes.filter((d) => d.status === 'open').length;
  const investigatingCount = disputes.filter((d) => d.status === 'investigating').length;
  const resolvedCount = disputes.filter((d) => d.status === 'resolved' || d.status === 'closed').length;

  return (
    <div>
      {/* Metric Cards */}
      <div className="admin-grid-metrics">
        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Total Disputes</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-scale-balanced" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value">{disputes.length}</div>
          <span className="admin-metric-subtext">All filed cases</span>
        </div>

        <div className="admin-metric-card accent-red">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Open Cases</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-triangle-exclamation" style={{ color: '#DC2626' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: openCount > 0 ? '#DC2626' : 'inherit' }}>
            {openCount}
          </div>
          <span className="admin-metric-subtext">Awaiting initial action</span>
        </div>

        <div className="admin-metric-card accent-amber">
          <div className="admin-metric-header">
            <span className="admin-metric-label">In Investigation</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-magnifying-glass" style={{ color: '#D97706' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#D97706' }}>
            {investigatingCount}
          </div>
          <span className="admin-metric-subtext">Active dispute review</span>
        </div>

        <div className="admin-metric-card accent-green">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Resolved / Closed</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-circle-check" style={{ color: '#059669' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#059669' }}>
            {resolvedCount}
          </div>
          <span className="admin-metric-subtext">Settled & resolved</span>
        </div>
      </div>

      {/* Main Dispute Card */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">
              <i className="fa-solid fa-scale-balanced" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Disputes & Complaints Directory ({disputes.length})</span>
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
              Resolve customer and rider grievances with full audit trail logging
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="admin-action-btn primary"
              onClick={() => setShowCreateModal(true)}
            >
              <i className="fa-solid fa-plus" style={{ marginRight: 6 }} /> File Dispute Ticket
            </button>
            <button
              type="button"
              className="admin-action-btn"
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
                  Refresh
                </>
              )}
            </button>
          </div>
        </div>

        <div className="admin-card-body">
          {/* Quick Status Pill Bar */}
          <div className="admin-pill-group" style={{ marginBottom: 16 }}>
            {(['all', 'open', 'investigating', 'awaiting_response', 'resolved', 'closed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                className={`admin-filter-btn ${statusFilter === st ? 'active' : ''}`}
                onClick={() => setStatusFilter(st)}
                style={{ textTransform: 'capitalize' }}
              >
                {st.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="admin-toolbar">
            <div className="admin-search-wrap">
              <span className="admin-search-icon">
                <i className="fa-solid fa-magnifying-glass" />
              </span>
              <input
                type="text"
                className="admin-search-input"
                placeholder="Search reference, phone, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="admin-filter-group">
              <select
                className="admin-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as 'all' | DisputeCategory)}
                title="Filter by category"
              >
                <option value="all">Category: All</option>
                <option value="rider_did_not_arrive">Rider did not arrive</option>
                <option value="customer_unavailable">Customer unavailable</option>
                <option value="payment_disagreement">Payment disagreement</option>
                <option value="unsafe_driving">Unsafe driving complaint</option>
                <option value="wrong_destination">Wrong destination</option>
                <option value="service_quality">Service quality</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Table or Mobile Cards */}
          {disputes.length === 0 ? (
            <div className="admin-empty-state">
              <div className="admin-empty-icon">
                <i className="fa-solid fa-shield-halved" style={{ fontSize: '2rem', color: '#059669' }} />
              </div>
              <div className="admin-empty-title">No Disputes Found</div>
              <p className="admin-empty-desc">
                No dispute or complaint records match the search or filter criteria. Everything is peaceful!
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
                        <th>Dispute Ref</th>
                        <th>Related Order</th>
                        <th>Reporter</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disputes.map((d) => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 700 }}>
                            <button
                              type="button"
                              onClick={() => handleOpenDispute(d)}
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
                              {d.disputeReference}
                            </button>
                          </td>
                          <td style={{ fontFamily: 'monospace' }}>{d.orderReference || '—'}</td>
                          <td>
                            <div style={{ textTransform: 'capitalize', fontWeight: 600 }}>{d.reporterType}</div>
                            <button
                              type="button"
                              className="admin-copy-pill"
                              style={{ marginTop: 2 }}
                              onClick={(e) => handleCopy(d.reporterPhone, e)}
                            >
                              {d.reporterPhone}
                              <span>{copiedPhone === d.reporterPhone ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}</span>
                            </button>
                          </td>
                          <td>
                            <span style={{ textTransform: 'capitalize' }}>
                              {d.category.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.description}>
                            {d.description}
                          </td>
                          <td>
                            <span className={`status-badge ${d.status}`}>{d.status}</span>
                          </td>
                          <td style={{ color: '#64748B', fontSize: '0.8rem' }}>
                            {new Date(d.createdAt).toLocaleDateString()}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="admin-action-btn primary"
                              onClick={() => handleOpenDispute(d)}
                            >
                              Manage Case <i className="fa-solid fa-chevron-right" style={{ marginLeft: 4 }} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Cards View (< 769px) */}
              <div className="admin-mobile-card-list">
                {disputes.map((d) => (
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{d.reporterType}</span>
                          <button
                            type="button"
                            className="admin-copy-pill"
                            onClick={(e) => handleCopy(d.reporterPhone, e)}
                          >
                            {d.reporterPhone}
                            <span>{copiedPhone === d.reporterPhone ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}</span>
                          </button>
                        </div>
                      </div>

                      {d.orderReference && (
                        <div className="admin-mcard-row">
                          <span className="admin-mcard-label">Order:</span>
                          <span className="admin-mcard-value">{d.orderReference}</span>
                        </div>
                      )}

                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Date:</span>
                        <span className="admin-mcard-value">{new Date(d.createdAt).toLocaleDateString()}</span>
                      </div>

                      <div style={{ background: '#FFFFFF', padding: 8, borderRadius: 6, fontSize: '0.8rem', color: '#475569', lineHeight: 1.4, border: '1px solid #E2E8F0', marginTop: 4 }}>
                        &ldquo;{d.description}&rdquo;
                      </div>
                    </div>

                    <div className="admin-mcard-actions">
                      <button
                        type="button"
                        className="admin-action-btn primary"
                        style={{ width: '100%', minHeight: 44 }}
                        onClick={() => handleOpenDispute(d)}
                      >
                        <i className="fa-solid fa-scale-balanced" style={{ marginRight: 6 }} />
                        Review & Resolve Case
                        <i className="fa-solid fa-chevron-right" style={{ marginLeft: 6 }} />
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
          DISPUTE DETAIL & AUDIT TIMELINE MODAL / BOTTOM SHEET
      ===================================================================== */}
      {selectedDispute && (
        <div className="admin-modal-overlay" onClick={() => setSelectedDispute(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">
                Dispute Case: {selectedDispute.disputeReference}
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setSelectedDispute(null)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="admin-modal-body">
              {/* Header meta */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, background: '#F8FAFC', padding: 12, borderRadius: 10, marginBottom: 16, fontSize: '0.85rem', border: '1px solid #EDF2F7' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Reporter
                  </span>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize', marginTop: 2 }}>
                    {selectedDispute.reporterType} ({selectedDispute.reporterPhone})
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Related Order
                  </span>
                  <div style={{ fontWeight: 600, marginTop: 2, fontFamily: 'monospace' }}>
                    {selectedDispute.orderReference || 'None linked'}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Category
                  </span>
                  <div style={{ fontWeight: 600, textTransform: 'capitalize', marginTop: 2 }}>
                    {selectedDispute.category.replace(/_/g, ' ')}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                    Current Status
                  </span>
                  <div style={{ marginTop: 2 }}>
                    <span className={`status-badge ${selectedDispute.status}`}>
                      {selectedDispute.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize: '0.85rem', margin: '0 0 6px 0', color: 'var(--color-dark-navy)', fontWeight: 700 }}>
                  Issue Description
                </h4>
                <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', padding: 12, borderRadius: 8, fontSize: '0.875rem', lineHeight: 1.5 }}>
                  {selectedDispute.description}
                </div>
              </div>

              {/* Resolution Notes if Resolved */}
              {selectedDispute.resolutionNotes && (
                <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: '#ECFDF5', border: '1px solid #A7F3D0', fontSize: '0.85rem' }}>
                  <strong>Resolution Notes:</strong> {selectedDispute.resolutionNotes}
                  {selectedDispute.resolvedAt && (
                    <div style={{ fontSize: '0.75rem', color: '#065F46', marginTop: 4 }}>
                      Resolved at: {new Date(selectedDispute.resolvedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {/* Audit Trail Updates */}
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: '0.85rem', margin: '0 0 10px 0', color: 'var(--color-dark-navy)', fontWeight: 700 }}>
                  <i className="fa-solid fa-scroll" style={{ color: 'var(--color-primary)', marginRight: 6 }} />
                  <span>Administrative Audit Trail & Notes</span>
                </h4>

                {loadingUpdates ? (
                  <p style={{ fontSize: '0.8rem', color: '#64748B' }}>
                    Loading audit updates...
                  </p>
                ) : disputeUpdates.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: '#64748B' }}>
                    No administrative notes logged yet. Use the status control below to record actions.
                  </p>
                ) : (
                  <div className="admin-timeline">
                    {disputeUpdates.map((u) => (
                      <div key={u.id} className="admin-timeline-item">
                        <div className="admin-timeline-dot" />
                        <div className="admin-timeline-header">
                          <span className="admin-timeline-author">{u.authorEmail}</span>
                          <span className="admin-timeline-date">
                            {new Date(u.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="admin-timeline-content">
                          {u.updateType === 'status_change' && (
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 2 }}>
                              Status changed: {u.oldStatus} → {u.newStatus}
                            </div>
                          )}
                          {u.comment}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Update Status Form */}
              <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 16 }}>
                <h4 style={{ fontSize: '0.9rem', margin: '0 0 10px 0', color: 'var(--color-dark-navy)', fontWeight: 700 }}>
                  Record Action / Change Case Status
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label className="admin-form-label">New Status:</label>
                    <select
                      className="admin-form-select"
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value as DisputeStatus)}
                    >
                      <option value="open">Open</option>
                      <option value="investigating">Investigating</option>
                      <option value="awaiting_response">Awaiting Response</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  <div>
                    <label className="admin-form-label">Action Log Note:</label>
                    <input
                      type="text"
                      className="admin-form-input"
                      placeholder="e.g. Contacted rider regarding delayed pickup..."
                      value={statusComment}
                      onChange={(e) => setStatusComment(e.target.value)}
                    />
                  </div>
                </div>

                {newStatus === 'resolved' && (
                  <div style={{ marginBottom: 12 }}>
                    <label className="admin-form-label">Final Resolution Summary:</label>
                    <textarea
                      className="admin-form-textarea"
                      placeholder="Explain how this issue was resolved..."
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                    />
                  </div>
                )}

                <button
                  type="button"
                  className="admin-action-btn primary"
                  disabled={savingStatus}
                  onClick={handleUpdateStatus}
                  style={{ width: '100%', minHeight: 44, fontSize: '0.9rem', fontWeight: 600 }}
                >
                  {savingStatus ? 'Saving Audit Record...' : 'Save Status Update & Audit Log'}
                </button>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => setSelectedDispute(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FILE NEW DISPUTE MODAL / BOTTOM SHEET
      ===================================================================== */}
      {showCreateModal && (
        <div className="admin-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">File Dispute Ticket</h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setShowCreateModal(false)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <form onSubmit={handleCreateDispute}>
              <div className="admin-modal-body">
                <div className="admin-form-group">
                  <label className="admin-form-label">Reporter Type:</label>
                  <select
                    className="admin-form-select"
                    value={createForm.reporterType}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        reporterType: e.target.value as 'customer' | 'rider' | 'admin'
                      })
                    }
                  >
                    <option value="customer">Customer / Passenger</option>
                    <option value="rider">Okada Rider</option>
                    <option value="admin">Administrator / Dispatcher</option>
                  </select>
                </div>

                <div className="admin-form-group">
                  <label className="admin-form-label">Reporter Phone Number:</label>
                  <input
                    type="text"
                    className="admin-form-input"
                    placeholder="e.g. 0245660622"
                    value={createForm.reporterPhone}
                    onChange={(e) => setCreateForm({ ...createForm, reporterPhone: e.target.value })}
                    required
                  />
                </div>

                <div className="admin-form-group">
                  <label className="admin-form-label">Related Order Reference (Optional):</label>
                  <input
                    type="text"
                    className="admin-form-input"
                    placeholder="e.g. OKD-ABC123"
                    value={createForm.orderReference}
                    onChange={(e) => setCreateForm({ ...createForm, orderReference: e.target.value })}
                  />
                </div>

                <div className="admin-form-group">
                  <label className="admin-form-label">Dispute Category:</label>
                  <select
                    className="admin-form-select"
                    value={createForm.category}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        category: e.target.value as DisputeCategory
                      })
                    }
                  >
                    <option value="rider_did_not_arrive">Rider did not arrive</option>
                    <option value="customer_unavailable">Customer unavailable</option>
                    <option value="payment_disagreement">Payment disagreement</option>
                    <option value="unsafe_driving">Unsafe driving complaint</option>
                    <option value="wrong_destination">Wrong destination</option>
                    <option value="service_quality">Service quality</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="admin-form-group">
                  <label className="admin-form-label">Description of Issue:</label>
                  <textarea
                    className="admin-form-textarea"
                    placeholder="Details about what happened..."
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="admin-action-btn"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-action-btn primary"
                  disabled={submittingCreate}
                >
                  {submittingCreate ? 'Filing...' : 'Create Dispute Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
