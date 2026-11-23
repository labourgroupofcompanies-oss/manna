import React, { useEffect, useState } from 'react';
import { adminService } from '../../services';
import { useRouter } from '../../router';
import type { CustomerRecord } from '../../types';
import './AdminPages.css';

export const AdminCustomersPage: React.FC = () => {
  const { navigate } = useRouter();
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<CustomerRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadCustomers() {
      try {
        const data = await adminService.getAllCustomers();
        if (isMounted) setCustomers(data);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadCustomers();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      setFilteredCustomers(customers.filter((c) => c.customerPhone.toLowerCase().includes(q)));
    } else {
      setFilteredCustomers(customers);
    }
  }, [customers, searchQuery]);

  const handleCopyPhone = (phone: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard?.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  if (loading) {
    return (
      <div className="admin-empty-state">
        <div className="admin-spinner" style={{ margin: '0 auto 16px' }} />
        <div className="admin-empty-title">Aggregating Customer Records</div>
        <p className="admin-empty-desc">Cataloguing passenger contacts from orders database...</p>
      </div>
    );
  }

  const totalRidesTaken = customers.reduce((acc, c) => acc + c.totalOrders, 0);
  const completedRidesTaken = customers.reduce((acc, c) => acc + c.completedOrders, 0);
  const repeatCustomersCount = customers.filter((c) => c.totalOrders > 1).length;

  return (
    <div>
      {/* Metric Cards Row */}
      <div className="admin-grid-metrics">
        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Registered Contacts</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-users" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value">{customers.length}</div>
          <span className="admin-metric-subtext">Unique phone numbers</span>
        </div>

        <div className="admin-metric-card accent-green">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Total Bookings</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-box-archive" style={{ color: '#059669' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#059669' }}>{totalRidesTaken}</div>
          <span className="admin-metric-subtext">Cumulative requests</span>
        </div>

        <div className="admin-metric-card accent-green">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Completed Trips</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-circle-check" style={{ color: '#059669' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: '#059669' }}>{completedRidesTaken}</div>
          <span className="admin-metric-subtext">Fulfilled deliveries</span>
        </div>

        <div className="admin-metric-card accent-blue">
          <div className="admin-metric-header">
            <span className="admin-metric-label">Repeat Customers</span>
            <span className="admin-metric-icon">
              <i className="fa-solid fa-repeat" style={{ color: 'var(--color-primary)' }} />
            </span>
          </div>
          <div className="admin-metric-value" style={{ color: 'var(--color-primary)' }}>
            {repeatCustomersCount}
          </div>
          <span className="admin-metric-subtext">2+ bookings</span>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">
              <i className="fa-solid fa-users" style={{ color: 'var(--color-primary)', marginRight: 8 }} />
              <span>Registered Customers Directory ({filteredCustomers.length})</span>
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: 2 }}>
              Every contact taken during customer booking is catalogued in real-time
            </div>
          </div>
        </div>

        <div className="admin-card-body">
          {/* Toolbar */}
          <div className="admin-toolbar">
            <div className="admin-search-wrap" style={{ maxWidth: 420 }}>
              <span className="admin-search-icon">
                <i className="fa-solid fa-magnifying-glass" />
              </span>
              <input
                type="text"
                className="admin-search-input"
                placeholder="Search phone number (e.g. 024, 055)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Table or Mobile Cards */}
          {filteredCustomers.length === 0 ? (
            <div className="admin-empty-state">
              <div className="admin-empty-icon">
                <i className="fa-solid fa-users" />
              </div>
              <div className="admin-empty-title">No Customer Records Found</div>
              <p className="admin-empty-desc">
                {customers.length === 0
                  ? 'No customer orders have been placed yet. Every new contact number will appear here automatically.'
                  : 'No customers match the phone number searched.'}
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
                        <th>Customer Phone Number</th>
                        <th>Total Requests</th>
                        <th>Completed Rides</th>
                        <th>Cancelled</th>
                        <th>Preferred Channel</th>
                        <th>First Order</th>
                        <th>Most Recent</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCustomers.map((c) => (
                        <tr key={c.customerPhone}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontFamily: 'monospace', fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                {c.customerPhone}
                              </span>
                              <button
                                type="button"
                                className="admin-copy-pill"
                                onClick={(e) => handleCopyPhone(c.customerPhone, e)}
                                title="Copy phone number to clipboard"
                              >
                                {copiedPhone === c.customerPhone ? (
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
                          </td>
                          <td>
                            <strong>{c.totalOrders}</strong> requests
                          </td>
                          <td>
                            <span style={{ color: '#059669', fontWeight: 700 }}>
                              {c.completedOrders}
                            </span>
                          </td>
                          <td>
                            <span style={{ color: c.cancelledOrders > 0 ? '#DC2626' : 'inherit', fontWeight: c.cancelledOrders > 0 ? 600 : 400 }}>
                              {c.cancelledOrders}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '0.85rem' }}>
                              {c.voiceOrdersCount >= c.textOrdersCount ? (
                                <>
                                  <i className="fa-solid fa-microphone" style={{ color: '#2563EB', marginRight: 4 }} />
                                  Voice ({c.voiceOrdersCount})
                                </>
                              ) : (
                                <>
                                  <i className="fa-solid fa-comment-dots" style={{ color: '#059669', marginRight: 4 }} />
                                  Text ({c.textOrdersCount})
                                </>
                              )}
                            </span>
                          </td>
                          <td style={{ color: '#64748B', fontSize: '0.8rem' }}>
                            {new Date(c.firstOrderAt).toLocaleDateString()}
                          </td>
                          <td style={{ color: '#64748B', fontSize: '0.8rem' }}>
                            {new Date(c.lastOrderAt).toLocaleDateString()}{' '}
                            {new Date(c.lastOrderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="admin-action-btn primary"
                              onClick={() => navigate('/portal/trips')}
                              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                            >
                              View Trips <i className="fa-solid fa-chevron-right" style={{ marginLeft: 4 }} />
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
                {filteredCustomers.map((c) => (
                  <div key={c.customerPhone} className="admin-mobile-card">
                    <div className="admin-mcard-top">
                      <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                        {c.customerPhone}
                      </span>
                      <button
                        type="button"
                        className="admin-copy-pill"
                        onClick={(e) => handleCopyPhone(c.customerPhone, e)}
                      >
                        {copiedPhone === c.customerPhone ? (
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

                    <div className="admin-mcard-body">
                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Rides:</span>
                        <span className="admin-mcard-value">
                          <strong>{c.totalOrders} total</strong> • <span style={{ color: '#059669' }}>{c.completedOrders} completed</span>
                        </span>
                      </div>

                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Booking Channel:</span>
                        <span className="admin-mcard-value">
                          {c.voiceOrdersCount >= c.textOrdersCount ? (
                            <>
                              <i className="fa-solid fa-microphone" style={{ color: '#2563EB', marginRight: 4 }} />
                              Voice ({c.voiceOrdersCount})
                            </>
                          ) : (
                            <>
                              <i className="fa-solid fa-comment-dots" style={{ color: '#059669', marginRight: 4 }} />
                              Text ({c.textOrdersCount})
                            </>
                          )}
                        </span>
                      </div>

                      <div className="admin-mcard-row">
                        <span className="admin-mcard-label">Last Order:</span>
                        <span className="admin-mcard-value">
                          {new Date(c.lastOrderAt).toLocaleDateString()} {new Date(c.lastOrderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>

                    <div className="admin-mcard-actions">
                      <button
                        type="button"
                        className="admin-action-btn primary"
                        style={{ width: '100%', minHeight: 44 }}
                        onClick={() => navigate('/portal/trips')}
                      >
                        <i className="fa-solid fa-route" style={{ marginRight: 6 }} />
                        View Customer Trips
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
    </div>
  );
};
