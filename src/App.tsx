import React, { useEffect, Suspense, lazy } from 'react';
import { RouterProvider, useRouter } from './router';
import { AppLayout } from './layouts/AppLayout';
import { CustomerPage } from './pages/customer/CustomerPage';
import { NotificationToast } from './components';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { pushNotificationService } from './services';

const RiderPage = lazy(() =>
  import('./pages/rider/RiderPage').then((m) => ({ default: m.RiderPage }))
);
const AdminPage = lazy(() =>
  import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage }))
);

const RouteLoadingFallback: React.FC = () => (
  <div
    style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#475569',
      fontSize: '0.95rem',
      fontWeight: 600
    }}
  >
    Loading...
  </div>
);

const AppRoutes: React.FC = () => {
  const { currentPath } = useRouter();

  useEffect(() => {
    // Initialize global Realtime push notification listener
    const unsubscribe = pushNotificationService.initRealtimeSubscription();
    return unsubscribe;
  }, []);

  // 1. ADMIN ROUTES (/admin, /admin/login, /admin/dashboard, /admin/orders, /admin/riders, /admin/customers, /admin/settings)
  if (currentPath.startsWith('/admin')) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <AdminPage />
      </Suspense>
    );
  }

  // 2. RIDER ROUTE (/rider)
  if (currentPath === '/rider' || currentPath.startsWith('/rider/')) {
    return (
      <AppLayout activeSection="rider">
        <Suspense fallback={<RouteLoadingFallback />}>
          <RiderPage />
        </Suspense>
      </AppLayout>
    );
  }

  // 3. CUSTOMER ROUTE (/)
  return (
    <AppLayout activeSection="customer">
      <CustomerPage />
    </AppLayout>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <RouterProvider>
        <AppRoutes />
        <NotificationToast />
      </RouterProvider>
    </ErrorBoundary>
  );
};

export default App;
