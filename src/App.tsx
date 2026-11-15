import React, { useState } from 'react';
import { AppLayout } from './layouts/AppLayout';
import { CustomerPage, RiderPage, AdminPage } from './pages';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'customer' | 'rider' | 'admin'>('customer');

  return (
    <AppLayout
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as 'customer' | 'rider' | 'admin')}
    >
      {activeTab === 'customer' && <CustomerPage />}
      {activeTab === 'rider' && <RiderPage />}
      {activeTab === 'admin' && <AdminPage />}
    </AppLayout>
  );
};

export default App;
