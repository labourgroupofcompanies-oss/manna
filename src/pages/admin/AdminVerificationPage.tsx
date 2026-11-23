import React, { useEffect, useState, useCallback } from 'react';
import { adminService, pushNotificationService } from '../../services';
import type { RiderWithStats, RiderVerificationStatus, RiderVerificationDocument } from '../../types';
import './AdminPages.css';

export const AdminVerificationPage: React.FC = () => {
  const [riders, setRiders] = useState<RiderWithStats[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all' | 'approved' | 'rejected' | 'suspended'>('pending');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Active rider inspection
  const [activeRider, setActiveRider] = useState<RiderWithStats | null>(null);
  const [activeDocs, setActiveDocs] = useState<RiderVerificationDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Action dialog state
  const [actionType, setActionType] = useState<RiderVerificationStatus | 'request_info' | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetchRiders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getAllRiders();
      setRiders(data);
      // Select the first pending rider by default if none selected
      const firstPending = data.find((r) => r.verificationStatus === 'pending') || data[0] || null;
      if (firstPending) {
        selectRiderForInspection(firstPending);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const selectRiderForInspection = async (rider: RiderWithStats) => {
    setActiveRider(rider);
    setLoadingDocs(true);
    try {
      const docs = await adminService.getRiderDocuments(rider.id);
      setActiveDocs(docs);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchRiders();
  }, [fetchRiders]);

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

  const handleExecuteAction = async () => {
    if (!activeRider || !actionType) return;

    setProcessing(true);
    try {
      let targetStatus: RiderVerificationStatus = activeRider.verificationStatus;
      let notesToSave = actionNotes;

      if (actionType === 'approved') targetStatus = 'approved';
      else if (actionType === 'rejected' || actionType === 'suspended') targetStatus = 'suspended';
      else if (actionType === 'request_info') {
        targetStatus = 'pending';
        notesToSave = `[Additional Info Requested]: ${actionNotes}`;
      }

      const res = await adminService.updateRiderVerification(activeRider.id, targetStatus, notesToSave);
      if (res.success) {
        setRiders((prev) =>
          prev.map((r) =>
            r.id === activeRider.id
              ? {
                  ...r,
                  verificationStatus: targetStatus,
                  isAvailable: targetStatus === 'suspended' ? false : r.isAvailable,
                  verificationNotes: notesToSave,
                  verifiedAt: targetStatus === 'approved' ? new Date().toISOString() : r.verifiedAt
                }
              : r
          )
        );
        setActiveRider((prev) =>
          prev
            ? {
                ...prev,
                verificationStatus: targetStatus,
                isAvailable: targetStatus === 'suspended' ? false : prev.isAvailable,
                verificationNotes: notesToSave,
                verifiedAt: targetStatus === 'approved' ? new Date().toISOString() : prev.verifiedAt
              }
            : null
        );
        setActionType(null);
        setActionNotes('');

        // Notify rider of verification status change
        pushNotificationService.notifyRiderStatusChanged({
          riderId: activeRider.id,
          riderUserId: activeRider.userId,
          riderName: activeRider.fullName,
          status: targetStatus,
          reason: notesToSave
        }).catch(() => {});
      } else {
        alert(`Verification action failed: ${res.error}`);
      }
    } finally {
      setProcessing(false);
    }
  };

  const filteredRiders = riders.filter((r) => {
    if (filter === 'all') return true;
    return r.verificationStatus === filter;
  });

  if (loading) {
    return (
      <div className="admin-empty-state">
        <div className="admin-spinner" style={{ margin: '0 auto 16px' }} />
        <div className="admin-empty-title">Loading Verification Workspace</div>
        <p className="admin-empty-desc">Connecting to private documents repository...</p>
      </div>
    );
  }

  const pendingCount = riders.filter((r) => r.verificationStatus === 'pending').length;

  return (
    <div>
      {/* Top Header & Metrics */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div className="admin-pill-group">
          {(['pending', 'approved', 'rejected', 'suspended', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`admin-pill ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
              style={{ textTransform: 'capitalize' }}
            >
              <span>
                {f === 'pending' ? (
                  <>
                    <i className="fa-solid fa-clock" style={{ color: '#D97706', marginRight: 4 }} /> Pending
                  </>
                ) : f === 'approved' ? (
                  <>
                    <i className="fa-solid fa-circle-check" style={{ color: '#059669', marginRight: 4 }} /> Approved
                  </>
                ) : f === 'rejected' ? (
                  <>
                    <i className="fa-solid fa-circle-xmark" style={{ color: '#DC2626', marginRight: 4 }} /> Rejected
                  </>
                ) : f === 'suspended' ? (
                  <>
                    <i className="fa-solid fa-triangle-exclamation" style={{ color: '#D97706', marginRight: 4 }} /> Suspended
                  </>
                ) : (
                  'All'
                )}
              </span>
              {f === 'pending' && pendingCount > 0 && (
                <span className="admin-action-counter alert" style={{ marginLeft: 4 }}>{pendingCount}</span>
              )}
            </button>
          ))}
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
              Refresh Queue
            </>
          )}
        </button>
      </div>

      {/* Workspace Grid (Mobile stacks nicely, Desktop is sleek two-column) */}
      <div className="admin-verification-layout">
        {/* Left Column / Mobile Top: Riders Queue */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">
              <i className="fa-solid fa-id-card" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Verification Queue ({filteredRiders.length})</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
              Tap a rider to inspect
            </span>
          </div>

          <div className="admin-card-body" style={{ padding: 12, maxHeight: 380, overflowY: 'auto' }}>
            {filteredRiders.length === 0 ? (
              <div className="admin-empty-state" style={{ padding: 24 }}>
                <div style={{ marginBottom: 8 }}>
                  <i className="fa-solid fa-inbox" style={{ fontSize: '2.5rem', color: '#CBD5E1' }} />
                </div>
                <div className="admin-empty-title">Queue Empty</div>
                <p className="admin-empty-desc">No riders in {filter} queue at this moment.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredRiders.map((r) => {
                  const isSelected = activeRider?.id === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => selectRiderForInspection(r)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        borderRadius: 12,
                        cursor: 'pointer',
                        border: isSelected ? '2px solid var(--color-primary)' : '1px solid #E2E8F0',
                        backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                        boxShadow: isSelected ? '0 2px 8px rgba(6, 58, 155, 0.12)' : 'none',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {r.profilePhotoUrl ? (
                        <img
                          src={r.profilePhotoUrl}
                          alt={r.fullName}
                          style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            backgroundColor: 'var(--color-primary)',
                            color: '#FFFFFF',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '1rem'
                          }}
                        >
                          {r.fullName.charAt(0).toUpperCase()}
                        </div>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-dark-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.fullName}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
                          {r.motorcycleRegistration} • {r.operatingArea}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <span className={`status-badge ${r.verificationStatus}`} style={{ fontSize: '0.675rem' }}>
                            {r.verificationStatus === 'pending' ? 'Auto-Approved (Pending Review)' : r.verificationStatus}
                          </span>
                        </div>
                      </div>

                      <span style={{ color: isSelected ? 'var(--color-primary)' : '#94A3B8', fontSize: '0.9rem' }}>
                        <i className="fa-solid fa-chevron-right" />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Detailed Verification Dossier */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h3 className="admin-card-title">
              <i className="fa-solid fa-shield-halved" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Dossier & Document Inspection</span>
            </h3>

            {activeRider && (
              <span className={`status-badge ${activeRider.verificationStatus}`}>
                Status: {activeRider.verificationStatus === 'pending' ? 'AUTO-APPROVED (PENDING REVIEW)' : activeRider.verificationStatus.toUpperCase()}
              </span>
            )}
          </div>

          <div className="admin-card-body">
            {!activeRider ? (
              <div className="admin-empty-state">
                <p>Select a rider from the queue to inspect identity documents and vehicle specs.</p>
              </div>
            ) : (
              <div>
                {/* Auto-Approval & Suspension Alerts */}
                {activeRider.verificationStatus === 'pending' && (
                  <div style={{ padding: 12, borderRadius: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', marginBottom: 16, fontSize: '0.85rem', color: '#1E40AF', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <i className="fa-solid fa-bolt" style={{ fontSize: '1.2rem', color: 'var(--color-primary)', flexShrink: 0 }} />
                    <div>
                      <strong>Provisional Dispatch Active:</strong> This rider was auto-approved upon registration and is currently taking orders. Audit their details below: <strong>Approve</strong> to keep active permanently, or <strong>Decline</strong> to suspend the account immediately.
                    </div>
                  </div>
                )}
                {activeRider.verificationStatus === 'suspended' && (
                  <div style={{ padding: 12, borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', marginBottom: 16, fontSize: '0.85rem', color: '#991B1B', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '1.2rem', color: '#DC2626', flexShrink: 0 }} />
                    <div>
                      <strong>Account Suspended:</strong> This rider's account was declined or suspended. The rider is taken offline and blocked from accepting customer orders.
                    </div>
                  </div>
                )}
                {/* Rider Identity Card */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', paddingBottom: 16, borderBottom: '1px solid #E2E8F0', marginBottom: 16, flexWrap: 'wrap' }}>
                  {activeRider.profilePhotoUrl ? (
                    <img
                      src={activeRider.profilePhotoUrl}
                      alt={activeRider.fullName}
                      style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--color-primary)' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-primary)',
                        color: '#FFFFFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.8rem',
                        fontWeight: 700
                      }}
                    >
                      {activeRider.fullName.charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--color-dark-navy)', fontWeight: 800 }}>
                      {activeRider.fullName}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: '0.85rem', color: '#64748B' }}>Phone:</span>
                      <button
                        type="button"
                        className="admin-copy-pill"
                        onClick={(e) => handleCopy(activeRider.phoneNumber, e)}
                      >
                        {activeRider.phoneNumber}
                        <span>{copiedPhone === activeRider.phoneNumber ? <i className="fa-solid fa-check" /> : <i className="fa-regular fa-copy" />}</span>
                      </button>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: 4 }}>
                      Submitted: {activeRider.verificationSubmittedAt ? new Date(activeRider.verificationSubmittedAt).toLocaleString() : new Date(activeRider.createdAt).toLocaleString()}
                    </div>
                    {activeRider.verifiedAt && (
                      <div style={{ fontSize: '0.75rem', color: '#059669', marginTop: 2, fontWeight: 600 }}>
                        <i className="fa-solid fa-circle-check" style={{ marginRight: 4 }} /> Verified on: {new Date(activeRider.verifiedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Motorcycle & Operating Spec */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, background: '#F8FAFC', padding: 14, borderRadius: 10, marginBottom: 20, fontSize: '0.85rem', border: '1px solid #EDF2F7' }}>
                  <div>
                    <span style={{ fontSize: '0.725rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                      Plate Number
                    </span>
                    <div style={{ fontWeight: 800, fontSize: '1rem', marginTop: 2 }}>
                      {activeRider.motorcycleRegistration}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.725rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                      Make & Model
                    </span>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>
                      {activeRider.motorcycleModel}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.725rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                      Bike Colour
                    </span>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>
                      {activeRider.motorcycleColour}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.725rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>
                      Operating Area
                    </span>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>
                      {activeRider.operatingArea}
                    </div>
                  </div>
                </div>

                {/* Verification Notes */}
                {activeRider.verificationNotes && (
                  <div style={{ padding: 12, borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A', marginBottom: 20, fontSize: '0.85rem' }}>
                    <strong>Administrative Audit Notes:</strong> {activeRider.verificationNotes}
                  </div>
                )}

                {/* Documents Vault (Private Bucket) */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-dark-navy)', fontWeight: 700 }}>
                      <i className="fa-solid fa-lock" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
                      <span>Sensitive Verification Documents (Private Bucket: rider-documents)</span>
                    </h4>
                    <span style={{ fontSize: '0.725rem', color: '#64748B' }}>
                      Signed 60-min URLs
                    </span>
                  </div>

                  {loadingDocs ? (
                    <p style={{ fontSize: '0.85rem', color: '#64748B' }}>
                      Authenticating and requesting private signed access tokens...
                    </p>
                  ) : activeDocs.length === 0 ? (
                    <div style={{ background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 12, padding: 24, textAlign: 'center' }}>
                      <div style={{ marginBottom: 6 }}>
                        <i className="fa-solid fa-folder-open" style={{ fontSize: '2rem', color: '#94A3B8' }} />
                      </div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#475569' }}>
                        No identity documents submitted in bucket
                      </div>
                      <p style={{ fontSize: '0.8rem', color: '#94A3B8', margin: '4px 0 0 0' }}>
                        Rider registered bike details, but has not uploaded national ID or DVLA roadworthy documents yet.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                      {activeDocs.map((doc) => (
                        <div
                          key={doc.id}
                          style={{
                            border: '1px solid #E2E8F0',
                            borderRadius: 10,
                            padding: 12,
                            background: '#FFFFFF',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 10
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.875rem', textTransform: 'capitalize' }}>
                              {doc.documentType.replace(/_/g, ' ')}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: 2 }}>
                              {doc.fileName} • {Math.round(doc.fileSizeBytes / 1024)} KB
                            </div>
                          </div>

                          {doc.documentUrl ? (
                            <a
                              href={doc.documentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="admin-action-btn primary"
                              style={{ textAlign: 'center', justifyContent: 'center', textDecoration: 'none' }}
                            >
                              Inspect Document <i className="fa-solid fa-arrow-up-right-from-square" style={{ marginLeft: 4 }} />
                            </a>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                              Signed URL could not be generated
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Administrator Action Bar */}
                <div style={{ borderTop: '2px solid #E2E8F0', paddingTop: 16 }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--color-dark-navy)', fontWeight: 700 }}>
                    Verification Decisions
                  </h4>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {activeRider.verificationStatus !== 'approved' && (
                      <button
                        type="button"
                        className="admin-action-btn success"
                        style={{ padding: '10px 18px', fontSize: '0.875rem', fontWeight: 700, flex: 1, minHeight: 44 }}
                        onClick={() => setActionType('approved')}
                      >
                        <i className="fa-solid fa-circle-check" style={{ marginRight: 6 }} />
                        {activeRider.verificationStatus === 'suspended' ? 'Reactivate & Approve' : 'Approve (Confirm Dispatch)'}
                      </button>
                    )}

                    {activeRider.verificationStatus !== 'suspended' && (
                      <button
                        type="button"
                        className="admin-action-btn danger"
                        style={{ padding: '10px 18px', fontSize: '0.875rem', fontWeight: 600, minHeight: 44 }}
                        onClick={() => setActionType('suspended')}
                      >
                        <i className="fa-solid fa-ban" style={{ marginRight: 6 }} />
                        {activeRider.verificationStatus === 'pending' ? 'Decline (Suspend Account)' : 'Suspend Account'}
                      </button>
                    )}

                    <button
                      type="button"
                      className="admin-action-btn"
                      style={{ padding: '10px 18px', fontSize: '0.875rem', fontWeight: 600, minHeight: 44 }}
                      onClick={() => setActionType('request_info')}
                    >
                      <i className="fa-solid fa-pen-to-square" style={{ marginRight: 6 }} /> Request Info
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Dialog Modal / Mobile Bottom Sheet */}
      {actionType && activeRider && (
        <div className="admin-modal-overlay" onClick={() => setActionType(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">
                {actionType === 'approved' && (activeRider.verificationStatus === 'suspended' ? `Reactivate & Approve: ${activeRider.fullName}` : `Approve Rider: ${activeRider.fullName}`)}
                {actionType === 'suspended' && (activeRider.verificationStatus === 'pending' ? `Decline & Suspend Account: ${activeRider.fullName}` : `Suspend Account: ${activeRider.fullName}`)}
                {actionType === 'request_info' && `Request Information: ${activeRider.fullName}`}
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setActionType(null)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>

            <div className="admin-modal-body">
              <p style={{ fontSize: '0.875rem', color: '#475569', marginBottom: 14, lineHeight: 1.5 }}>
                {actionType === 'approved'
                  ? 'Approving this rider confirms their verification status. The rider continues to take customer orders seamlessly.'
                  : actionType === 'suspended'
                  ? 'Declining or suspending this rider will immediately suspend their account, kick them offline, and prevent them from taking customer orders.'
                  : 'Specify what additional documents or information are required from the rider.'}
              </p>

              <div className="admin-form-group">
                <label className="admin-form-label">
                  Verification Notes & Justification (Logged to Permanent Audit Trail):
                </label>
                <textarea
                  className="admin-form-textarea"
                  placeholder="Enter administrator notes..."
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  required={actionType !== 'approved'}
                />
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-action-btn"
                onClick={() => setActionType(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`admin-action-btn ${actionType === 'approved' ? 'success' : 'danger'}`}
                disabled={processing || (actionType !== 'approved' && !actionNotes.trim())}
                onClick={handleExecuteAction}
              >
                {processing ? 'Saving...' : 'Confirm Decision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
