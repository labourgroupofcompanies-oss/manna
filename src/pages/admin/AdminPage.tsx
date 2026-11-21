import React from 'react';
import { useRouter } from '../../router';
import { AdminProtectedRoute } from '../../components/admin/AdminProtectedRoute';
import { AdminLoginPage } from './AdminLoginPage';
import { AdminOverviewPage } from './AdminOverviewPage';
import { AdminTripsPage } from './AdminTripsPage';
import { AdminRidersPage } from './AdminRidersPage';
import { AdminVerificationPage } from './AdminVerificationPage';
import { AdminCustomersPage } from './AdminCustomersPage';
import { AdminDisputesPage } from './AdminDisputesPage';
import { AdminMetricsPage } from './AdminMetricsPage';
import { AdminSettingsPage } from './AdminSettingsPage';

export const AdminPage: React.FC = () => {
  const { currentPath } = useRouter();

  // 1. Dedicated Admin Login Route
  if (currentPath === '/admin/login') {
    return <AdminLoginPage />;
  }

  // 2. Trips & Analytics Route (/admin/trips and legacy /admin/orders)
  if (currentPath === '/admin/trips' || currentPath === '/admin/orders') {
    return (
      <AdminProtectedRoute pageTitle="Trips & Analytics">
        {() => <AdminTripsPage />}
      </AdminProtectedRoute>
    );
  }

  // 3. Rider Fleet Route (/admin/riders)
  if (currentPath === '/admin/riders') {
    return (
      <AdminProtectedRoute pageTitle="Rider Fleet Management">
        {() => <AdminRidersPage />}
      </AdminProtectedRoute>
    );
  }

  // 4. Dedicated Rider Verification Workspace (/admin/verification)
  if (currentPath === '/admin/verification') {
    return (
      <AdminProtectedRoute pageTitle="Rider Verification Workspace">
        {() => <AdminVerificationPage />}
      </AdminProtectedRoute>
    );
  }

  // 5. Customer Directory Route (/admin/customers)
  if (currentPath === '/admin/customers') {
    return (
      <AdminProtectedRoute pageTitle="Customer Directory">
        {() => <AdminCustomersPage />}
      </AdminProtectedRoute>
    );
  }

  // 6. Disputes & Complaints Management Route (/admin/disputes)
  if (currentPath === '/admin/disputes') {
    return (
      <AdminProtectedRoute pageTitle="Disputes & Complaints Resolution">
        {() => <AdminDisputesPage />}
      </AdminProtectedRoute>
    );
  }

  // 7. System Metrics & Audit Log Route (/admin/metrics)
  if (currentPath === '/admin/metrics') {
    return (
      <AdminProtectedRoute pageTitle="System Metrics & Telemetry">
        {() => <AdminMetricsPage />}
      </AdminProtectedRoute>
    );
  }

  // 8. Settings & Architecture Route (/admin/settings)
  if (currentPath === '/admin/settings') {
    return (
      <AdminProtectedRoute pageTitle="Settings & Access Control">
        {(adminUser) => <AdminSettingsPage adminUser={adminUser} />}
      </AdminProtectedRoute>
    );
  }

  // 9. Default Admin Dashboard (/admin or /admin/dashboard)
  return (
    <AdminProtectedRoute pageTitle="Operations Dashboard">
      {() => <AdminOverviewPage />}
    </AdminProtectedRoute>
  );
};

export {
  AdminLoginPage,
  AdminOverviewPage,
  AdminTripsPage,
  AdminRidersPage,
  AdminVerificationPage,
  AdminCustomersPage,
  AdminDisputesPage,
  AdminMetricsPage,
  AdminSettingsPage
};
