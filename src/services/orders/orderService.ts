import type { Order } from '../../types';

/**
 * Order Service (Stub / Prepared for Supabase integration)
 * Future implementation will connect to Supabase orders table.
 */
export const orderService = {
  async createOrder(_orderPayload: Partial<Order>): Promise<Order | null> {
    console.info('Order creation will be implemented here when Supabase is connected.');
    return null;
  },

  async getOrderById(_id: string): Promise<Order | null> {
    console.info('Fetch order will be implemented here.');
    return null;
  }
};
