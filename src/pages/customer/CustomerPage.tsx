import React from 'react';
import { CustomerBookingForm } from '../../components/customer/CustomerBookingForm';

export const CustomerPage: React.FC = () => {
  return (
    <div className="customer-page-container">
      <CustomerBookingForm />
    </div>
  );
};
