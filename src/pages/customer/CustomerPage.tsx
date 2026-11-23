import React, { useState, useEffect } from 'react';
import { CustomerBookingForm } from '../../components/customer/CustomerBookingForm';
import { OrderTracker } from '../../components/customer/OrderTracker';
import { TrackOrderLookup } from '../../components/customer/TrackOrderLookup';
import { MannaHeroBanner } from '../../components/common/MannaHeroBanner';
import { orderService } from '../../services';
import type { Order } from '../../types';
import './CustomerPage.css';

export const CustomerPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'book' | 'track'>('book');
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [initialRefQuery, setInitialRefQuery] = useState<string>('');
  const [hasActiveOrder, setHasActiveOrder] = useState(false);

  // Check URL query parameters and local storage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    let refParam = urlParams.get('ref');
    const tabParam = urlParams.get('tab');
    const pathname = window.location.pathname;

    // Check if path is /track or /track/OKD-XXXXXX
    if (pathname.startsWith('/track')) {
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length > 1 && segments[1]) {
        refParam = segments[1];
      }
    }

    // 1. If URL has ref or path has ref, immediately switch to tracking
    if (refParam) {
      const cleanRef = refParam.trim().toUpperCase();
      setInitialRefQuery(cleanRef);
      setActiveTab('track');

      // Attempt to load order directly
      orderService.trackOrder(cleanRef).then((res) => {
        if (res.success && res.order) {
          setActiveOrder(res.order);
        }
      });
    } else if (tabParam === 'track' || pathname.startsWith('/track') || window.location.hash === '#track') {
      setActiveTab('track');
    }

    // 2. Check for active orders in local storage to light up indicator
    const recents = orderService.getLocalRecentOrders();
    const active = recents.some(
      (o) => o.status === 'pending' || o.status === 'assigned' || o.status === 'accepted'
    );
    setHasActiveOrder(active);
  }, []);

  // Sync URL when tracked order changes
  const handleSelectOrderToTrack = (order: Order) => {
    setActiveOrder(order);
    setActiveTab('track');
    if (typeof window !== 'undefined' && window.history) {
      const newUrl = `${window.location.pathname}?ref=${encodeURIComponent(order.orderReference)}`;
      window.history.replaceState(null, '', newUrl);
    }
  };

  const handleTabChange = (tab: 'book' | 'track') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined' && window.history) {
      if (tab === 'track' && activeOrder) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}?ref=${encodeURIComponent(activeOrder.orderReference)}`
        );
      } else if (tab === 'track') {
        window.history.replaceState(null, '', `${window.location.pathname}?tab=track`);
      } else {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  };

  const handleBookAnother = () => {
    setActiveOrder(null);
    setActiveTab('book');
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const handleTrackAnother = () => {
    setActiveOrder(null);
    setInitialRefQuery('');
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(null, '', `${window.location.pathname}?tab=track`);
    }
  };

  return (
    <div className="customer-page-container">
      {/* 1. Customer Navigation Segmented Bar */}
      <nav className="customer-top-bar" aria-label="Customer Navigation">
        <div className="customer-nav-segments" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'book'}
            className={`customer-nav-tab ${activeTab === 'book' ? 'active' : ''}`}
            onClick={() => handleTabChange('book')}
          >
            <span className="tab-icon" aria-hidden="true">🛵</span>
            <span>Book Ride</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'track'}
            className={`customer-nav-tab ${activeTab === 'track' ? 'active' : ''}`}
            onClick={() => handleTabChange('track')}
          >
            <span className="tab-icon" aria-hidden="true">📍</span>
            <span>Track Order</span>
            {hasActiveOrder && <span className="nav-active-dot" title="Active ride in progress" />}
          </button>
        </div>
      </nav>

      {/* 2. Main Tab View */}
      {activeTab === 'book' ? (
        <CustomerBookingForm
          onOrderSubmitted={(order) => {
            handleSelectOrderToTrack(order);
            setHasActiveOrder(true);
          }}
          onSwitchToTrack={() => handleTabChange('track')}
        />
      ) : (
        <div className="customer-track-sheet-wrapper">
          <MannaHeroBanner ariaLabel="Manna Hero Banner" />
          <div className="customer-track-content">
            {activeOrder ? (
              <>
                <div className="track-top-actions-bar">
                  <button
                    type="button"
                    className="btn-track-back"
                    onClick={handleTrackAnother}
                  >
                    &larr; Back
                  </button>
                </div>
                <OrderTracker
                  order={activeOrder}
                  onOrderUpdated={(updated) => {
                    setActiveOrder(updated);
                    if (updated.status === 'completed' || updated.status === 'cancelled') {
                      setHasActiveOrder(false);
                    }
                  }}
                  onBookAnother={handleBookAnother}
                  onTrackAnother={handleTrackAnother}
                />
              </>
            ) : (
              <TrackOrderLookup
                onSelectOrder={handleSelectOrderToTrack}
                onGoToBooking={() => handleTabChange('book')}
                initialSearchQuery={initialRefQuery}
              />
            )}

            {/* Bottom Skyline */}
            <div className="accra-skyline-footer" aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
};
