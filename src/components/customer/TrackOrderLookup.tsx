import React, { useState, useEffect } from 'react';
import type { Order } from '../../types';
import { orderService } from '../../services';
import { validateGhanaPhone } from '../../utils';
import './TrackOrderLookup.css';

interface TrackOrderLookupProps {
  onSelectOrder: (order: Order) => void;
  onGoToBooking: () => void;
  initialSearchQuery?: string;
}

export const TrackOrderLookup: React.FC<TrackOrderLookupProps> = ({
  onSelectOrder,
  onGoToBooking,
  initialSearchQuery = ''
}) => {
  const [searchMode, setSearchMode] = useState<'ref' | 'phone'>('phone');
  const [query, setQuery] = useState(initialSearchQuery);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [phoneOrders, setPhoneOrders] = useState<Order[] | null>(null);
  const [activePhoneQuery, setActivePhoneQuery] = useState<string | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);

  // Load local recent orders on mount and subscribe to live backend updates
  useEffect(() => {
    const list = orderService.getLocalRecentOrders();
    setRecentOrders(list);

    if (list.length === 0) return;

    const unsubscribe = orderService.subscribeToRecentOrders((updatedList) => {
      setRecentOrders(updatedList);
    });

    return unsubscribe;
  }, []);

  // Keep phone search results live while the list is displayed
  useEffect(() => {
    if (!activePhoneQuery || !phoneOrders || phoneOrders.length === 0) return;

    const unsubscribe = orderService.subscribeToPhoneOrders(
      activePhoneQuery,
      (updatedOrders) => {
        setPhoneOrders(updatedOrders);
      }
    );

    return unsubscribe;
  }, [activePhoneQuery, phoneOrders !== null]);

  // Auto-search if initial query is provided
  useEffect(() => {
    if (initialSearchQuery) {
      const trimmed = initialSearchQuery.trim();
      setQuery(trimmed);
      if (trimmed.toUpperCase().startsWith('OKD-')) {
        setSearchMode('ref');
        executeSearch(trimmed, 'ref');
      } else {
        executeSearch(trimmed, searchMode);
      }
    }
  }, [initialSearchQuery]);

  const executeSearch = async (searchTerm: string, mode: 'ref' | 'phone') => {
    const term = searchTerm.trim();
    if (!term) {
      setSearchError(mode === 'ref' ? 'Please enter your order reference (e.g. OKD-ABC123)' : 'Please enter your phone number');
      return;
    }

    // Smart fallback: if a customer pastes an OKD- reference while on the Phone Number tab,
    // automatically switch to Order Reference lookup instead of failing phone validation.
    let effectiveMode = mode;
    if (mode === 'phone' && term.toUpperCase().startsWith('OKD-')) {
      effectiveMode = 'ref';
      setSearchMode('ref');
    }

    setIsSearching(true);
    setSearchError(null);
    setPhoneOrders(null);
    setActivePhoneQuery(null);

    try {
      if (effectiveMode === 'ref') {
        const res = await orderService.trackOrder(term);
        if (res.success && res.order) {
          onSelectOrder(res.order);
        } else {
          setSearchError(res.error || `No order found for reference "${term}".`);
        }
      } else {
        const phoneCheck = validateGhanaPhone(term);
        if (!phoneCheck.isValid) {
          setSearchError('Please enter a valid 10-digit Ghanaian phone number (e.g. 0245660622)');
          setIsSearching(false);
          return;
        }

        const res = await orderService.getOrdersByPhone(term);
        if (res.success && res.orders && res.orders.length > 0) {
          if (res.orders.length === 1) {
            onSelectOrder(res.orders[0]);
          } else {
            setActivePhoneQuery(term);
            setPhoneOrders(res.orders);
          }
        } else {
          setSearchError(res.error || `No orders found for phone number ${term}.`);
        }
      }
    } catch (err: unknown) {
      const error = err as Error;
      setSearchError(error.message || 'Error looking up your order.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(query, searchMode);
  };

  return (
    <div className="track-lookup-container">
      {/* 1. Header Card */}
      <div className="track-lookup-card">
        <div className="lookup-header">
          <div className="lookup-icon-wrap" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <div className="lookup-text-group">
            <h2 className="lookup-title">Track Your Ride</h2>
            <p className="lookup-subtitle">Check real-time status, assigned rider details, and ETA</p>
          </div>
        </div>

        {/* 2. Mode Selector: Phone (default) or Reference */}
        <div className="lookup-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={searchMode === 'phone'}
            className={`lookup-tab-btn ${searchMode === 'phone' ? 'active' : ''}`}
            onClick={() => {
              setSearchMode('phone');
              setSearchError(null);
            }}
          >
            Phone Number
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={searchMode === 'ref'}
            className={`lookup-tab-btn ${searchMode === 'ref' ? 'active' : ''}`}
            onClick={() => {
              setSearchMode('ref');
              setSearchError(null);
            }}
          >
            Order Reference
          </button>
        </div>

        {/* 3. Search Form */}
        <form onSubmit={handleSubmit} className="lookup-form">
          <div className="lookup-input-wrap">
            <input
              type={searchMode === 'phone' ? 'tel' : 'text'}
              className="lookup-input"
              placeholder={searchMode === 'ref' ? 'e.g. OKD-9H4K2M' : 'e.g. 0245660622'}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (searchError) setSearchError(null);
              }}
              autoFocus
              aria-label={searchMode === 'ref' ? 'Order reference' : 'Customer phone'}
            />
            <button
              type="submit"
              className="btn-lookup-submit"
              disabled={isSearching || !query.trim()}
            >
              {isSearching ? (
                <span className="spinner-dots">Checking...</span>
              ) : (
                <span>Track Ride</span>
              )}
            </button>
          </div>

          {searchError && (
            <div className="lookup-error-banner" role="alert">
              <span>⚠️ {searchError}</span>
            </div>
          )}
        </form>
      </div>

      {/* 4. Multiple Orders List (If search returned list for phone) */}
      {phoneOrders && phoneOrders.length > 0 && (
        <div className="lookup-results-section">
          <h3 className="section-title">Your Ride Requests ({phoneOrders.length})</h3>
          <div className="orders-list-grid">
            {phoneOrders.map((ord) => (
              <button
                key={ord.orderReference}
                type="button"
                className="order-card-row"
                onClick={() => onSelectOrder(ord)}
              >
                <div className="order-row-main">
                  <div className="order-row-ref">{ord.orderReference}</div>
                  <div className="order-row-desc">
                    {ord.orderType === 'voice' ? '🎙️ Voice Note Order' : ord.requestDescription || 'Text Ride Request'}
                  </div>
                  <div className="order-row-date">
                    {new Date(ord.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} at{' '}
                    {new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <div className="order-row-side">
                  <span className={`status-badge-mini status-${ord.status}`}>
                    {ord.status.toUpperCase()}
                  </span>
                  <span className="arrow-tap">View Track &rarr;</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 5. Recent Orders on This Device */}
      {!phoneOrders && recentOrders.length > 0 && (
        <div className="recent-orders-section">
          <div className="recent-header">
            <h3 className="section-title">Recent Requests on This Device</h3>
            <span className="recent-count">{recentOrders.length}</span>
          </div>

          <div className="recent-cards-list">
            {recentOrders.map((ord) => (
              <button
                key={ord.orderReference}
                type="button"
                className="recent-order-pill"
                onClick={() => onSelectOrder(ord)}
              >
                <div className="pill-top">
                  <span className="pill-ref">{ord.orderReference}</span>
                  <span className={`pill-status-dot dot-${ord.status}`} />
                  <span className={`pill-status-text text-${ord.status}`}>
                    {ord.status}
                  </span>
                </div>
                <div className="pill-bottom">
                  <span className="pill-type">
                    {ord.orderType === 'voice' ? '🎙️ Voice' : '📝 Text'}
                  </span>
                  <span className="pill-time">
                    {new Date(ord.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 6. Quick Action: Book a New Ride */}
      <div className="lookup-footer-action">
        <button
          type="button"
          className="btn-book-new-ride"
          onClick={onGoToBooking}
        >
          <span>Need a Ride? Book an Okada Now</span>
        </button>
      </div>
    </div>
  );
};
