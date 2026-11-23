import React, { useState, useEffect } from 'react';
import { useRouter, Link } from '../router';
import { adminService, pushNotificationService } from '../services';
import type { AdminUser, PushNotificationRecord } from '../types';
import './AdminLayout.css';

interface AdminLayoutProps {
  children: React.ReactNode;
  adminUser: AdminUser;
  title?: string;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children, adminUser, title = 'Admin Console' }) => {
  const { currentPath, navigate } = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Push notifications state
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifs, setRecentNotifs] = useState<PushNotificationRecord[]>([]);
  const [pushEnabled, setPushEnabled] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );

  useEffect(() => {
    pushNotificationService.getNotificationHistory({ recipientType: 'admin', limit: 10 }).then((list) => {
      setRecentNotifs(list);
    });

    const unsubscribe = pushNotificationService.subscribe((n) => {
      setUnreadCount((c) => c + 1);
      setRecentNotifs((prev) => [
        {
          id: `toast-${Date.now()}`,
          recipientType: 'admin',
          title: n.title,
          body: n.body,
          orderReference: n.orderReference,
          status: 'sent',
          createdAt: new Date().toISOString()
        },
        ...prev
      ]);
    });

    return unsubscribe;
  }, []);

  const handleEnableAdminPush = async () => {
    const res = await pushNotificationService.registerAdminNotifications();
    if (res.success) {
      setPushEnabled(true);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await adminService.logoutAdmin();
      navigate('/portal/login', { replace: true });
    } catch {
      setIsLoggingOut(false);
    }
  };

  // 8 required navigation sections with Font Awesome icons
  const navItems = [
    { path: '/portal/dashboard', alias: '/portal', label: 'Dashboard', icon: 'fa-solid fa-gauge-high' },
    { path: '/portal/trips', alias: '/portal/orders', label: 'Trips & Analytics', icon: 'fa-solid fa-route' },
    { path: '/portal/riders', label: 'Riders', icon: 'fa-solid fa-motorcycle' },
    { path: '/portal/verification', label: 'Rider Verification', icon: 'fa-solid fa-shield-halved' },
    { path: '/portal/customers', label: 'Customers', icon: 'fa-solid fa-users' },
    { path: '/portal/disputes', label: 'Disputes & Complaints', icon: 'fa-solid fa-scale-balanced' },
    { path: '/portal/metrics', label: 'System Metrics', icon: 'fa-solid fa-chart-line' },
    { path: '/portal/settings', label: 'Settings', icon: 'fa-solid fa-gear' }
  ];

  // Mobile Bottom Bar Primary 4 items + "More"
  const mobilePrimaryTabs = [
    { path: '/portal/dashboard', alias: '/portal', label: 'Dashboard', icon: 'fa-solid fa-gauge-high' },
    { path: '/portal/trips', alias: '/portal/orders', label: 'Trips', icon: 'fa-solid fa-route' },
    { path: '/portal/riders', label: 'Riders', icon: 'fa-solid fa-motorcycle' },
    { path: '/portal/verification', label: 'Verify', icon: 'fa-solid fa-shield-halved' }
  ];

  // The remaining 4 secondary tabs shown in the "More" drawer
  const mobileSecondaryTabs = [
    { path: '/portal/customers', label: 'Customers', icon: 'fa-solid fa-users', desc: 'Registered passenger phone directory' },
    { path: '/portal/disputes', label: 'Disputes & Complaints', icon: 'fa-solid fa-scale-balanced', desc: 'Triage rider & customer issues' },
    { path: '/portal/metrics', label: 'System Metrics', icon: 'fa-solid fa-chart-line', desc: 'Real infrastructure health & audit log' },
    { path: '/portal/settings', label: 'Settings', icon: 'fa-solid fa-gear', desc: 'Access control & security audit' }
  ];

  const isNavActive = (itemPath: string, alias?: string) => {
    if (currentPath === itemPath) return true;
    if (alias && currentPath === alias) return true;
    if (currentPath.startsWith(itemPath + '/')) return true;
    return false;
  };

  const isMoreActive = mobileSecondaryTabs.some((tab) => isNavActive(tab.path));

  return (
    <div className={`admin-layout-root ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Mobile Backdrop for full sidebar or More drawer */}
      {(mobileMenuOpen || mobileMoreOpen) && (
        <div
          className="admin-mobile-backdrop"
          onClick={() => {
            setMobileMenuOpen(false);
            setMobileMoreOpen(false);
          }}
          aria-hidden="true"
        />
      )}

      {/* Admin Desktop/Tablet Sidebar */}
      <aside className={`admin-sidebar ${mobileMenuOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="admin-sidebar-header">
          <div className="admin-brand">
            <span className="admin-brand-icon">
              <img src="/manna-mark.png" alt="Manna" className="admin-brand-logo-img" />
            </span>
            {!sidebarCollapsed && (
              <div>
                <div className="admin-brand-title">Manna</div>
                <span className="admin-badge-owner">Admin Portal</span>
              </div>
            )}
          </div>
          {/* Mobile close button */}
          {mobileMenuOpen ? (
            <button
              type="button"
              className="admin-mobile-close-btn"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close Navigation"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          ) : (
            <button
              type="button"
              className="admin-desktop-collapse-btn"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label="Toggle sidebar collapse"
            >
              <i className={`fa-solid ${sidebarCollapsed ? 'fa-arrow-right' : 'fa-arrow-left'}`} />
            </button>
          )}
        </div>

        <nav className="admin-nav">
          {navItems.map((item) => {
            const active = isNavActive(item.path, item.alias);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`admin-nav-item ${active ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="admin-nav-icon">
                  <i className={item.icon} />
                </span>
                {!sidebarCollapsed && <span className="admin-nav-label">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user-info">
            <div className="admin-user-email" title={adminUser.email}>
              {sidebarCollapsed ? adminUser.email.charAt(0).toUpperCase() : adminUser.email}
            </div>
            {!sidebarCollapsed && (
              <div className="admin-user-role">
                {adminUser.role === 'super_admin' ? 'Owner / Super Admin' : 'Administrator'}
              </div>
            )}
          </div>

          <button
            type="button"
            className="admin-logout-btn"
            onClick={handleLogout}
            disabled={isLoggingOut}
            title="Sign Out"
          >
            <i className="fa-solid fa-arrow-right-from-bracket" />
            {!sidebarCollapsed && <span>{isLoggingOut ? 'Signing out...' : 'Sign Out'}</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="admin-main-wrap">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button
              type="button"
              className="admin-mobile-toggle"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Open Navigation Menu"
            >
              <i className="fa-solid fa-bars" />
            </button>
            <div className="admin-heading-wrap">
              <img src="/manna-mark.png" alt="Manna" className="admin-mobile-logo-icon" />
              <h1 className="admin-page-heading">{title}</h1>
            </div>
          </div>

          <div className="admin-topbar-right">
            <div className="admin-live-indicator" title="System operational in real-time">
              <span className="admin-pulse-dot" />
              <span className="admin-live-text">Live System</span>
            </div>

            {/* Notification Bell */}
            <div className="admin-notif-bell-wrap">
              <button
                type="button"
                className="admin-notif-bell-btn"
                onClick={() => {
                  setNotifDropdownOpen(!notifDropdownOpen);
                  setUnreadCount(0);
                }}
                title="Push Notifications"
                aria-label="View recent push notifications"
              >
                <i className="fa-solid fa-bell" />
                {unreadCount > 0 && <span className="admin-notif-count">{unreadCount}</span>}
              </button>

              {notifDropdownOpen && (
                <div className="admin-notif-dropdown">
                  <div className="admin-notif-header">
                    <strong>Recent Push Alerts</strong>
                    <button
                      type="button"
                      className="admin-notif-enable-btn"
                      onClick={handleEnableAdminPush}
                    >
                      {pushEnabled ? '🔔 Active' : 'Enable Push'}
                    </button>
                  </div>
                  <div className="admin-notif-list">
                    {recentNotifs.length === 0 ? (
                      <div className="admin-notif-empty">No recent notifications</div>
                    ) : (
                      recentNotifs.slice(0, 5).map((n) => (
                        <div key={n.id} className="admin-notif-item">
                          <div className="notif-item-title">{n.title}</div>
                          <div className="notif-item-body">{n.body}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="admin-profile-pill" onClick={() => setMobileMoreOpen(!mobileMoreOpen)} role="button" tabIndex={0} title="Account Details">
              <span className="admin-profile-avatar">
                {adminUser.email.charAt(0).toUpperCase()}
              </span>
              <span className="admin-profile-name">{adminUser.email}</span>
            </div>
          </div>
        </header>

        <main className="admin-content-body">{children}</main>

        {/* Mobile Human-Centric Bottom Navigation Bar */}
        <nav className="admin-mobile-bottom-nav" aria-label="Mobile Bottom Navigation">
          {mobilePrimaryTabs.map((item) => {
            const active = isNavActive(item.path, item.alias);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`admin-bottom-nav-item ${active ? 'active' : ''}`}
                onClick={() => {
                  setMobileMoreOpen(false);
                  setMobileMenuOpen(false);
                }}
              >
                <span className="admin-bottom-nav-icon">
                  <i className={item.icon} />
                </span>
                <span className="admin-bottom-nav-label">{item.label}</span>
              </Link>
            );
          })}

          {/* "More" Trigger Button */}
          <button
            type="button"
            className={`admin-bottom-nav-item ${isMoreActive || mobileMoreOpen ? 'active' : ''}`}
            onClick={() => setMobileMoreOpen(!mobileMoreOpen)}
            aria-label="More admin sections"
          >
            <span className="admin-bottom-nav-icon">
              <i className="fa-solid fa-bars" />
            </span>
            <span className="admin-bottom-nav-label">More</span>
            {isMoreActive && <span className="admin-bottom-more-dot" />}
          </button>
        </nav>

        {/* Mobile "More" Drawer / Action Sheet */}
        <div className={`admin-mobile-more-sheet ${mobileMoreOpen ? 'open' : ''}`}>
          <div className="admin-more-sheet-handle" onClick={() => setMobileMoreOpen(false)} />
          <div className="admin-more-sheet-header">
            <div>
              <div className="admin-more-sheet-title">Admin Workspaces</div>
              <div className="admin-more-sheet-subtitle">All sections of the Manna console</div>
            </div>
            <button
              type="button"
              className="admin-sheet-close-btn"
              onClick={() => setMobileMoreOpen(false)}
              aria-label="Close"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="admin-more-sheet-grid">
            {mobileSecondaryTabs.map((item) => {
              const active = isNavActive(item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`admin-more-grid-card ${active ? 'active' : ''}`}
                  onClick={() => setMobileMoreOpen(false)}
                >
                  <div className="admin-more-card-icon">
                    <i className={item.icon} />
                  </div>
                  <div className="admin-more-card-info">
                    <div className="admin-more-card-label">{item.label}</div>
                    <div className="admin-more-card-desc">{item.desc}</div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* User profile & Sign out inside More sheet */}
          <div className="admin-more-sheet-footer">
            <div className="admin-more-user-card">
              <span className="admin-profile-avatar large">
                {adminUser.email.charAt(0).toUpperCase()}
              </span>
              <div className="admin-more-user-meta">
                <div className="admin-more-user-email">{adminUser.email}</div>
                <div className="admin-more-user-role">
                  {adminUser.role === 'super_admin' ? 'Owner / Super Admin' : 'Administrator'}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="admin-more-logout-btn"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              <i className="fa-solid fa-arrow-right-from-bracket" />
              <span>{isLoggingOut ? 'Signing out...' : 'Sign Out of Admin'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
