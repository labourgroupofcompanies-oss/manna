import { supabase, isSupabaseConfigured } from '../supabase';
import type {
  AdminUser,
  AdminOverviewStats,
  CustomerRecord,
  RiderWithStats,
  RiderVerificationStatus,
  RiderVerificationDocument,
  Order,
  OrderStatus,
  Dispute,
  DisputeStatus,
  DisputeCategory,
  DisputeUpdate,
  AdminAuditLog,
  SystemMetricsData
} from '../../types';

export interface TripFilterOptions {
  page?: number;
  pageSize?: number;
  status?: 'all' | OrderStatus;
  riderId?: string;
  search?: string;
  dateRange?: 'all' | 'today' | '7days' | '30days';
}

export interface TripsQueryResult {
  trips: Order[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AnalyticsSummary {
  dailyTrips: { date: string; label: string; count: number; completed: number; cancelled: number }[];
  weeklyTrips: { week: string; label: string; count: number }[];
  monthlyTrips: { month: string; label: string; count: number }[];
  completedCount: number;
  cancelledCount: number;
  completionRatePercent: number;
  tripsByArea: { area: string; count: number }[];
  topRiders: { riderName: string; completedCount: number }[];
  avgAcceptanceTimeMinutes: number | null;
  avgCompletionTimeMinutes: number | null;
}

export const adminService = {
  /**
   * Check whether current Supabase session belongs to an authorized administrator
   */
  async checkIsAdmin(): Promise<{ isAdmin: boolean; adminUser: AdminUser | null; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { isAdmin: false, adminUser: null, error: 'Supabase is not configured.' };
    }

    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !sessionData?.session?.user) {
        return { isAdmin: false, adminUser: null };
      }

      const user = sessionData.session.user;

      // 1. Try get_current_admin RPC first (SECURITY DEFINER, immune to RLS recursion)
      try {
        const { data: rpcAdminData, error: rpcAdminErr } = await supabase.rpc('get_current_admin');
        if (!rpcAdminErr && rpcAdminData?.isAdmin && rpcAdminData.adminUser) {
          const u = rpcAdminData.adminUser;
          return {
            isAdmin: true,
            adminUser: {
              id: u.id,
              userId: u.userId || u.user_id,
              email: u.email,
              role: u.role,
              createdAt: u.createdAt || u.created_at,
              updatedAt: u.updatedAt || u.updated_at
            }
          };
        }
      } catch {
        // RPC not deployed yet, continue
      }

      // 2. Direct query against admin_users table
      const { data: adminRecord, error: adminErr } = await supabase
        .from('admin_users')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (adminRecord) {
        return {
          isAdmin: true,
          adminUser: {
            id: adminRecord.id,
            userId: adminRecord.user_id,
            email: adminRecord.email,
            role: adminRecord.role,
            createdAt: adminRecord.created_at,
            updatedAt: adminRecord.updated_at
          }
        };
      }

      // 3. Fallback: verify via is_admin RPC function
      try {
        const { data: rpcIsAdmin, error: rpcErr } = await supabase.rpc('is_admin', { p_user_id: user.id });
        if (!rpcErr && rpcIsAdmin) {
          return {
            isAdmin: true,
            adminUser: {
              id: user.id,
              userId: user.id,
              email: user.email || '',
              role: 'super_admin',
              createdAt: user.created_at,
              updatedAt: new Date().toISOString()
            }
          };
        }
      } catch {
        // RPC check failed or not deployed
      }

      if (adminErr) {
        console.error('checkIsAdmin error:', adminErr);
      }

      return { isAdmin: false, adminUser: null };
    } catch (err: unknown) {
      const error = err as Error;
      return { isAdmin: false, adminUser: null, error: error.message };
    }
  },

  /**
   * Dedicated Admin Login
   * Strictly validates that the authenticated account exists in public.admin_users
   */
  async loginAdmin(
    email: string,
    password: string
  ): Promise<{ success: boolean; admin?: AdminUser; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        success: false,
        error: 'Backend is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
      };
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      return { success: false, error: 'Please enter both your administrator email and password.' };
    }

    if (cleanEmail.startsWith('rider_') && cleanEmail.endsWith('@okadabook.com')) {
      return {
        success: false,
        error: 'Rider phone-based accounts cannot be used for administrative access. Please log in via the Rider Portal.'
      };
    }

    try {
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password
      });

      if (authErr) {
        return {
          success: false,
          error: authErr.message || 'Invalid administrator email or password.'
        };
      }

      const user = authData.user;
      if (!user) {
        return { success: false, error: 'Authentication failed. Please try again.' };
      }

      let adminUser: AdminUser | null = null;

      // Try get_current_admin RPC first (bypasses RLS recursion)
      try {
        const { data: rpcAdminData, error: rpcAdminErr } = await supabase.rpc('get_current_admin');
        if (!rpcAdminErr && rpcAdminData?.isAdmin && rpcAdminData.adminUser) {
          const u = rpcAdminData.adminUser;
          adminUser = {
            id: u.id,
            userId: u.userId || u.user_id,
            email: u.email,
            role: u.role,
            createdAt: u.createdAt || u.created_at,
            updatedAt: u.updatedAt || u.updated_at
          };
        }
      } catch {
        // Continue
      }

      let lastAdminErr: { message: string } | null = null;
      if (!adminUser) {
        const { data: adminRecord, error: adminErr } = await supabase
          .from('admin_users')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        lastAdminErr = adminErr;

        if (adminRecord) {
          adminUser = {
            id: adminRecord.id,
            userId: adminRecord.user_id,
            email: adminRecord.email,
            role: adminRecord.role,
            createdAt: adminRecord.created_at,
            updatedAt: adminRecord.updated_at
          };
        } else {
          try {
            const { data: rpcIsAdmin, error: rpcErr } = await supabase.rpc('is_admin', { p_user_id: user.id });
            if (!rpcErr && rpcIsAdmin) {
              adminUser = {
                id: user.id,
                userId: user.id,
                email: user.email || cleanEmail,
                role: 'super_admin',
                createdAt: user.created_at,
                updatedAt: new Date().toISOString()
              };
            }
          } catch {
            // RPC check failed
          }
        }
      }

      if (!adminUser) {
        await supabase.auth.signOut();
        return {
          success: false,
          error: lastAdminErr
            ? `Database Verification Error: ${lastAdminErr.message}`
            : `Access Denied: Account ${cleanEmail} is authenticated, but not found in the public.admin_users table.`
        };
      }

      return { success: true, admin: adminUser };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message || 'An unexpected login error occurred.' };
    }
  },

  /**
   * Admin Logout
   */
  async logoutAdmin(): Promise<void> {
    if (supabase) {
      await supabase.auth.signOut();
    }
  },

  /**
   * Log administrative action to public.admin_audit_logs
   */
  async logAdminAction(
    action: string,
    targetType: string,
    targetId?: string | null,
    reason?: string | null,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) return;

      await supabase.from('admin_audit_logs').insert({
        admin_user_id: user.id,
        admin_email: user.email || 'admin@okadabook.com',
        action,
        target_type: targetType,
        target_id: targetId || null,
        reason: reason || null,
        metadata: metadata || {}
      });
    } catch {
      // Audit log failures should not block the main workflow
    }
  },

  /**
   * Fetch comprehensive Admin Overview Metrics
   */
  async getAdminMetrics(): Promise<AdminOverviewStats> {
    const defaultStats: AdminOverviewStats = {
      totalOrders: 0,
      pendingOrders: 0,
      acceptedOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      todayOrders: 0,
      weekOrders: 0,
      monthOrders: 0,
      totalRiders: 0,
      onlineRiders: 0,
      offlineRiders: 0,
      verifiedRiders: 0,
      pendingRiders: 0,
      rejectedRiders: 0,
      suspendedRiders: 0,
      totalCustomers: 0,
      totalDisputes: 0,
      openDisputes: 0,
      avgAcceptanceSeconds: null,
      avgCompletionSeconds: null
    };

    if (!isSupabaseConfigured || !supabase) return defaultStats;

    try {
      // 1. Try RPC function
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_admin_metrics');
      if (!rpcErr && rpcData?.success && rpcData.metrics) {
        const m = rpcData.metrics;
        return {
          totalOrders: Number(m.totalOrders) || 0,
          pendingOrders: Number(m.pendingOrders) || 0,
          acceptedOrders: Number(m.acceptedOrders) || 0,
          completedOrders: Number(m.completedOrders) || 0,
          cancelledOrders: Number(m.cancelledOrders) || 0,
          todayOrders: Number(m.todayOrders) || 0,
          weekOrders: Number(m.weekOrders) || 0,
          monthOrders: Number(m.monthOrders) || 0,
          totalRiders: Number(m.totalRiders) || 0,
          onlineRiders: Number(m.onlineRiders) || 0,
          offlineRiders: Number(m.offlineRiders) || 0,
          verifiedRiders: Number(m.verifiedRiders) || 0,
          pendingRiders: Number(m.pendingRiders) || 0,
          rejectedRiders: Number(m.rejectedRiders) || 0,
          suspendedRiders: Number(m.suspendedRiders) || 0,
          totalCustomers: Number(m.totalCustomers) || 0,
          totalDisputes: Number(m.totalDisputes) || 0,
          openDisputes: Number(m.openDisputes) || 0,
          avgAcceptanceSeconds: m.avgAcceptanceSeconds ? Number(m.avgAcceptanceSeconds) : null,
          avgCompletionSeconds: m.avgCompletionSeconds ? Number(m.avgCompletionSeconds) : null
        };
      }

      // 2. Direct aggregation fallback
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const weekStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [ordersRes, ridersRes, disputesRes] = await Promise.all([
        supabase.from('orders').select('id, status, customer_phone, created_at, accepted_at, completed_at'),
        supabase.from('riders').select('id, is_available, verification_status'),
        supabase.from('disputes').select('id, status').maybeSingle()
      ]);

      const orders = ordersRes.data || [];
      const riders = ridersRes.data || [];
      const disputes = disputesRes.data ? [disputesRes.data] : [];

      const uniqueCustomers = new Set(orders.map((o) => o.customer_phone)).size;
      const verifiedRiders = riders.filter((r) => r.verification_status === 'approved').length;
      const pendingRiders = riders.filter((r) => !r.verification_status || r.verification_status === 'pending').length;
      const rejectedRiders = riders.filter((r) => r.verification_status === 'rejected').length;
      const suspendedRiders = riders.filter((r) => r.verification_status === 'suspended').length;
      const onlineRiders = riders.filter((r) => r.is_available).length;

      // Acceptance & completion time calculation
      let totalAcceptanceSec = 0;
      let acceptanceCount = 0;
      let totalCompletionSec = 0;
      let completionCount = 0;

      orders.forEach((o) => {
        if (o.accepted_at && o.created_at) {
          const diff = (new Date(o.accepted_at).getTime() - new Date(o.created_at).getTime()) / 1000;
          if (diff >= 0 && diff < 86400) {
            totalAcceptanceSec += diff;
            acceptanceCount++;
          }
        }
        if (o.completed_at && o.accepted_at) {
          const diff = (new Date(o.completed_at).getTime() - new Date(o.accepted_at).getTime()) / 1000;
          if (diff >= 0 && diff < 86400) {
            totalCompletionSec += diff;
            completionCount++;
          }
        }
      });

      return {
        totalOrders: orders.length,
        pendingOrders: orders.filter((o) => o.status === 'pending').length,
        acceptedOrders: orders.filter((o) => o.status === 'accepted').length,
        completedOrders: orders.filter((o) => o.status === 'completed').length,
        cancelledOrders: orders.filter((o) => o.status === 'cancelled').length,
        todayOrders: orders.filter((o) => o.created_at >= todayStart).length,
        weekOrders: orders.filter((o) => o.created_at >= weekStart).length,
        monthOrders: orders.filter((o) => o.created_at >= monthStart).length,
        totalRiders: riders.length,
        onlineRiders,
        offlineRiders: riders.length - onlineRiders,
        verifiedRiders,
        pendingRiders,
        rejectedRiders,
        suspendedRiders,
        totalCustomers: uniqueCustomers,
        totalDisputes: disputes.length,
        openDisputes: disputes.filter((d) => d.status === 'open' || d.status === 'investigating').length,
        avgAcceptanceSeconds: acceptanceCount > 0 ? Math.round(totalAcceptanceSec / acceptanceCount) : null,
        avgCompletionSeconds: completionCount > 0 ? Math.round(totalCompletionSec / completionCount) : null
      };
    } catch {
      return defaultStats;
    }
  },

  /**
   * Fetch paginated trips with advanced filters
   */
  async getTrips(options: TripFilterOptions = {}): Promise<TripsQueryResult> {
    const {
      page = 1,
      pageSize = 15,
      status = 'all',
      riderId,
      search,
      dateRange = 'all'
    } = options;

    if (!isSupabaseConfigured || !supabase) {
      return { trips: [], totalCount: 0, page, pageSize, totalPages: 0 };
    }

    try {
      let query = supabase
        .from('orders')
        .select(`
          id,
          order_reference,
          customer_phone,
          order_type,
          order_description,
          voice_recording_path,
          customer_comment,
          status,
          rider_id,
          accepted_at,
          completed_at,
          created_at,
          updated_at
        `, { count: 'exact' });

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      if (riderId) {
        query = query.eq('rider_id', riderId);
      }

      if (search && search.trim()) {
        const q = search.trim();
        query = query.or(`order_reference.ilike.%${q}%,customer_phone.ilike.%${q}%`);
      }

      if (dateRange !== 'all') {
        const now = new Date();
        let startDate: Date;
        if (dateRange === 'today') {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (dateRange === '7days') {
          startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
        } else {
          startDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        }
        query = query.gte('created_at', startDate.toISOString());
      }

      const offset = (page - 1) * pageSize;
      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      const { data, count, error } = await query;

      if (error || !data) {
        return { trips: [], totalCount: 0, page, pageSize, totalPages: 0 };
      }

      // Fetch rider metadata for mapped riders in this batch
      const riderIds = Array.from(new Set(data.map((d) => d.rider_id).filter(Boolean)));
      const riderMap = new Map<string, { name: string; phone: string; area: string }>();

      if (riderIds.length > 0) {
        const { data: ridersData } = await supabase
          .from('riders')
          .select('id, full_name, phone_number, operating_area')
          .in('id', riderIds);

        ridersData?.forEach((r) => {
          riderMap.set(r.id, {
            name: r.full_name,
            phone: r.phone_number,
            area: r.operating_area
          });
        });
      }

      const trips: Order[] = data.map((o) => {
        const riderInfo = o.rider_id ? riderMap.get(o.rider_id) : undefined;
        return {
          id: o.id,
          orderReference: o.order_reference,
          customerPhone: o.customer_phone,
          orderType: o.order_type as 'text' | 'voice',
          requestDescription: o.order_description,
          voiceRecordingPath: o.voice_recording_path,
          customerComment: (o as Record<string, unknown>).customer_comment as string | null ?? null,
          status: o.status,
          riderId: o.rider_id,
          riderName: riderInfo?.name,
          riderPhone: riderInfo?.phone,
          operatingArea: riderInfo?.area,
          acceptedAt: o.accepted_at,
          completedAt: o.completed_at,
          createdAt: o.created_at,
          updatedAt: o.updated_at
        };
      });

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        trips,
        totalCount,
        page,
        pageSize,
        totalPages
      };
    } catch {
      return { trips: [], totalCount: 0, page, pageSize, totalPages: 0 };
    }
  },

  /**
   * Fetch all orders (backward compatibility)
   */
  async getAllOrders(): Promise<Order[]> {
    const res = await this.getTrips({ page: 1, pageSize: 100 });
    return res.trips;
  },

  /**
   * Compute comprehensive trip analytics from real database orders
   */
  async getTripAnalytics(): Promise<AnalyticsSummary> {
    const emptySummary: AnalyticsSummary = {
      dailyTrips: [],
      weeklyTrips: [],
      monthlyTrips: [],
      completedCount: 0,
      cancelledCount: 0,
      completionRatePercent: 0,
      tripsByArea: [],
      topRiders: [],
      avgAcceptanceTimeMinutes: null,
      avgCompletionTimeMinutes: null
    };

    if (!isSupabaseConfigured || !supabase) return emptySummary;

    try {
      const [ordersRes, ridersRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, status, rider_id, created_at, accepted_at, completed_at')
          .order('created_at', { ascending: true }),
        supabase.from('riders').select('id, full_name, operating_area')
      ]);

      const orders = ordersRes.data || [];
      const riders = ridersRes.data || [];

      const riderMap = new Map<string, { name: string; area: string }>();
      riders.forEach((r) => riderMap.set(r.id, { name: r.full_name, area: r.operating_area }));

      // 1. Completion & Cancellation
      let completedCount = 0;
      let cancelledCount = 0;
      let totalAcceptanceSec = 0;
      let acceptanceCount = 0;
      let totalCompletionSec = 0;
      let completionCount = 0;

      const riderCompletedMap = new Map<string, number>();
      const areaCountMap = new Map<string, number>();
      const dailyMap = new Map<string, { count: number; completed: number; cancelled: number }>();
      const weeklyMap = new Map<string, number>();
      const monthlyMap = new Map<string, number>();

      orders.forEach((o) => {
        if (o.status === 'completed') completedCount++;
        if (o.status === 'cancelled') cancelledCount++;

        // Rider performance
        if (o.rider_id && o.status === 'completed') {
          riderCompletedMap.set(o.rider_id, (riderCompletedMap.get(o.rider_id) || 0) + 1);
        }

        // Operating area
        if (o.rider_id) {
          const area = riderMap.get(o.rider_id)?.area || 'Unassigned';
          areaCountMap.set(area, (areaCountMap.get(area) || 0) + 1);
        }

        // Acceptance time
        if (o.accepted_at && o.created_at) {
          const diff = (new Date(o.accepted_at).getTime() - new Date(o.created_at).getTime()) / 1000;
          if (diff >= 0 && diff < 86400) {
            totalAcceptanceSec += diff;
            acceptanceCount++;
          }
        }

        // Completion time
        if (o.completed_at && o.accepted_at) {
          const diff = (new Date(o.completed_at).getTime() - new Date(o.accepted_at).getTime()) / 1000;
          if (diff >= 0 && diff < 86400) {
            totalCompletionSec += diff;
            completionCount++;
          }
        }

        // Daily grouping (YYYY-MM-DD)
        const dateKey = o.created_at.slice(0, 10);
        const dayStats = dailyMap.get(dateKey) || { count: 0, completed: 0, cancelled: 0 };
        dayStats.count++;
        if (o.status === 'completed') dayStats.completed++;
        if (o.status === 'cancelled') dayStats.cancelled++;
        dailyMap.set(dateKey, dayStats);

        // Monthly grouping (YYYY-MM)
        const monthKey = o.created_at.slice(0, 7);
        monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + 1);

        // Weekly grouping (approximate week)
        const dateObj = new Date(o.created_at);
        const weekKey = `${dateObj.getFullYear()}-W${Math.ceil(dateObj.getDate() / 7)}`;
        weeklyMap.set(weekKey, (weeklyMap.get(weekKey) || 0) + 1);
      });

      // Daily list: last 7 days or existing entries
      const dailyTrips = Array.from(dailyMap.entries())
        .slice(-14)
        .map(([date, stats]) => ({
          date,
          label: new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' }),
          count: stats.count,
          completed: stats.completed,
          cancelled: stats.cancelled
        }));

      // Weekly list
      const weeklyTrips = Array.from(weeklyMap.entries())
        .slice(-8)
        .map(([week, count]) => ({
          week,
          label: week,
          count
        }));

      // Monthly list
      const monthlyTrips = Array.from(monthlyMap.entries())
        .slice(-6)
        .map(([month, count]) => ({
          month,
          label: new Date(month + '-01').toLocaleDateString([], { month: 'short', year: 'numeric' }),
          count
        }));

      // Area distribution
      const tripsByArea = Array.from(areaCountMap.entries())
        .map(([area, count]) => ({ area, count }))
        .sort((a, b) => b.count - a.count);

      // Top riders
      const topRiders = Array.from(riderCompletedMap.entries())
        .map(([riderId, count]) => ({
          riderName: riderMap.get(riderId)?.name || `Rider ${riderId.slice(0, 6)}`,
          completedCount: count
        }))
        .sort((a, b) => b.completedCount - a.completedCount)
        .slice(0, 5);

      const totalFinished = completedCount + cancelledCount;
      const completionRatePercent = totalFinished > 0 ? Math.round((completedCount / totalFinished) * 100) : 0;

      return {
        dailyTrips,
        weeklyTrips,
        monthlyTrips,
        completedCount,
        cancelledCount,
        completionRatePercent,
        tripsByArea,
        topRiders,
        avgAcceptanceTimeMinutes: acceptanceCount > 0 ? Math.round(totalAcceptanceSec / acceptanceCount / 60) : null,
        avgCompletionTimeMinutes: completionCount > 0 ? Math.round(totalCompletionSec / completionCount / 60) : null
      };
    } catch {
      return emptySummary;
    }
  },

  /**
   * Fetch all registered riders with verification status & statistics
   */
  async getAllRiders(): Promise<RiderWithStats[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      // 1. Try secure RPC function first (SECURITY DEFINER, immune to RLS restrictions)
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_get_all_riders');
        if (!rpcErr && Array.isArray(rpcData)) {
          return rpcData.map((r: Record<string, unknown>) => {
            let photoUrl: string | null = null;
            if (r.profile_photo_path) {
              const { data } = supabase!.storage.from('rider-profiles').getPublicUrl(r.profile_photo_path as string);
              photoUrl = data.publicUrl;
            }

            return {
              id: r.id as string,
              userId: r.user_id as string,
              fullName: r.full_name as string,
              phoneNumber: r.phone_number as string,
              motorcycleRegistration: r.motorcycle_registration as string,
              motorcycleModel: r.motorcycle_model as string,
              motorcycleColour: r.motorcycle_colour as string,
              operatingArea: r.operating_area as string,
              profilePhotoPath: (r.profile_photo_path as string) || null,
              profilePhotoUrl: photoUrl,
              isAvailable: Boolean(r.is_available),
              verificationStatus: ((r.verification_status as string) || 'pending') as RiderVerificationStatus,
              verificationSubmittedAt: (r.verification_submitted_at as string) || null,
              verifiedAt: (r.verified_at as string) || null,
              verifiedBy: (r.verified_by as string) || null,
              verificationNotes: (r.verification_notes as string) || null,
              totalCompletedRides: Number(r.total_completed_rides) || 0,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string
            };
          });
        }
        if (rpcErr) {
          console.warn('admin_get_all_riders RPC notice (falling back to direct query):', rpcErr.message);
        }
      } catch (rpcEx) {
        console.warn('admin_get_all_riders RPC error:', rpcEx);
      }

      // 2. Direct fallback query against public.riders
      const [ridersRes, ordersRes] = await Promise.all([
        supabase.from('riders').select('*').order('created_at', { ascending: false }),
        supabase.from('orders').select('rider_id, status').eq('status', 'completed')
      ]);

      if (ridersRes.error) {
        console.error('Failed to fetch public.riders:', ridersRes.error);
        return [];
      }
      if (!ridersRes.data) return [];

      const completedOrders = ordersRes.data || [];
      const completedCountMap = new Map<string, number>();

      completedOrders.forEach((o) => {
        if (o.rider_id) {
          completedCountMap.set(o.rider_id, (completedCountMap.get(o.rider_id) || 0) + 1);
        }
      });

      return ridersRes.data.map((r) => {
        let photoUrl: string | null = null;
        if (r.profile_photo_path) {
          const { data } = supabase!.storage.from('rider-profiles').getPublicUrl(r.profile_photo_path);
          photoUrl = data.publicUrl;
        }

        return {
          id: r.id,
          userId: r.user_id,
          fullName: r.full_name,
          phoneNumber: r.phone_number,
          motorcycleRegistration: r.motorcycle_registration,
          motorcycleModel: r.motorcycle_model,
          motorcycleColour: r.motorcycle_colour,
          operatingArea: r.operating_area,
          profilePhotoPath: r.profile_photo_path,
          profilePhotoUrl: photoUrl,
          isAvailable: r.is_available,
          verificationStatus: (r.verification_status || 'pending') as RiderVerificationStatus,
          verificationSubmittedAt: r.verification_submitted_at,
          verifiedAt: r.verified_at,
          verifiedBy: r.verified_by,
          verificationNotes: r.verification_notes,
          totalCompletedRides: completedCountMap.get(r.id) || 0,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        };
      });
    } catch (err) {
      console.error('getAllRiders exception:', err);
      return [];
    }
  },

  /**
   * Update a rider's verification status (approve, reject, suspend)
   */
  async updateRiderVerification(
    riderId: string,
    status: RiderVerificationStatus,
    notes?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database connection unavailable.' };
    }

    try {
      // 1. Try RPC function
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('admin_set_rider_verification', {
        p_rider_id: riderId,
        p_status: status,
        p_notes: notes || null
      });

      if (!rpcErr && rpcRes?.success) {
        return { success: true };
      }

      // 2. Direct fallback update
      const { data: sessionData } = await supabase.auth.getSession();
      const adminUserId = sessionData?.session?.user?.id;

      const updatePayload: Record<string, unknown> = {
        verification_status: status,
        verification_notes: notes || null,
        updated_at: new Date().toISOString()
      };

      if (status === 'approved') {
        updatePayload.verified_at = new Date().toISOString();
        if (adminUserId) updatePayload.verified_by = adminUserId;
      } else if (status === 'suspended' || status === 'rejected') {
        updatePayload.is_available = false;
      }

      const { error } = await supabase
        .from('riders')
        .update(updatePayload)
        .eq('id', riderId);

      if (error) {
        return { success: false, error: error.message };
      }

      // Record audit log
      await this.logAdminAction(
        `rider_verification_${status}`,
        'rider',
        riderId,
        notes,
        { newStatus: status }
      );

      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message };
    }
  },

  /**
   * Fetch documents submitted by a rider for verification
   */
  async getRiderDocuments(riderId: string): Promise<RiderVerificationDocument[]> {
    if (!isSupabaseConfigured || !supabase || !riderId) return [];

    try {
      const { data, error } = await supabase
        .from('rider_verification_documents')
        .select('*')
        .eq('rider_id', riderId)
        .order('uploaded_at', { ascending: false });

      if (error || !data) return [];

      const documents: RiderVerificationDocument[] = [];
      for (const doc of data) {
        let signedUrl: string | null = null;
        if (doc.storage_path) {
          signedUrl = await this.getRiderDocumentSignedUrl(doc.storage_path);
        }

        documents.push({
          id: doc.id,
          riderId: doc.rider_id,
          documentType: doc.document_type,
          storagePath: doc.storage_path,
          fileName: doc.file_name,
          mimeType: doc.mime_type,
          fileSizeBytes: doc.file_size_bytes || 0,
          verificationStatus: doc.verification_status || 'pending',
          uploadedAt: doc.uploaded_at,
          verifiedAt: doc.verified_at,
          notes: doc.notes,
          documentUrl: signedUrl
        });
      }

      return documents;
    } catch {
      return [];
    }
  },

  /**
   * Generate temporary signed URL for sensitive rider document
   */
  async getRiderDocumentSignedUrl(storagePath: string): Promise<string | null> {
    if (!isSupabaseConfigured || !supabase || !storagePath) return null;
    try {
      const { data, error } = await supabase.storage
        .from('rider-documents')
        .createSignedUrl(storagePath, 3600);

      if (error || !data) return null;
      return data.signedUrl;
    } catch {
      return null;
    }
  },

  /**
   * Fetch customer records derived from orders and dedicated customers table
   */
  async getAllCustomers(): Promise<CustomerRecord[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const [ordersRes, customersRes] = await Promise.all([
        supabase
          .from('orders')
          .select('customer_phone, order_type, status, created_at')
          .order('created_at', { ascending: true }),
        supabase
          .from('customers')
          .select('*')
      ]);

      const orders = ordersRes.data || [];
      const dbCustomers = customersRes.data || [];

      const customerMap = new Map<string, CustomerRecord>();

      // 1. Seed from customers table if present
      dbCustomers.forEach((c) => {
        const phone = c.phone_number?.trim();
        if (!phone) return;
        customerMap.set(phone, {
          customerPhone: phone,
          totalOrders: c.total_orders || 1,
          completedOrders: 0,
          cancelledOrders: 0,
          textOrdersCount: 0,
          voiceOrdersCount: 0,
          firstOrderAt: c.first_order_at || c.created_at,
          lastOrderAt: c.last_order_at || c.created_at
        });
      });

      // 2. Aggregate & enrich from real orders (every order contact is recorded as a customer)
      orders.forEach((row) => {
        const phone = row.customer_phone?.trim();
        if (!phone) return;

        const isVoice = row.order_type === 'voice';
        const isCompleted = row.status === 'completed';
        const isCancelled = row.status === 'cancelled';

        const existing = customerMap.get(phone);
        if (existing) {
          if (dbCustomers.length === 0) {
            existing.totalOrders += 1;
          }
          if (isCompleted) existing.completedOrders += 1;
          if (isCancelled) existing.cancelledOrders += 1;
          if (isVoice) existing.voiceOrdersCount += 1;
          else existing.textOrdersCount += 1;
          if (new Date(row.created_at) > new Date(existing.lastOrderAt)) {
            existing.lastOrderAt = row.created_at;
          }
          if (new Date(row.created_at) < new Date(existing.firstOrderAt)) {
            existing.firstOrderAt = row.created_at;
          }
        } else {
          customerMap.set(phone, {
            customerPhone: phone,
            totalOrders: 1,
            completedOrders: isCompleted ? 1 : 0,
            cancelledOrders: isCancelled ? 1 : 0,
            voiceOrdersCount: isVoice ? 1 : 0,
            textOrdersCount: isVoice ? 0 : 1,
            firstOrderAt: row.created_at,
            lastOrderAt: row.created_at
          });
        }
      });

      return Array.from(customerMap.values()).sort(
        (a, b) => new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime()
      );
    } catch {
      return [];
    }
  },

  /**
   * Fetch all disputes with filtering
   */
  async getAllDisputes(filters?: {
    status?: 'all' | DisputeStatus;
    category?: 'all' | DisputeCategory;
    search?: string;
  }): Promise<Dispute[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      let query = supabase.from('disputes').select('*').order('created_at', { ascending: false });

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters?.category && filters.category !== 'all') {
        query = query.eq('category', filters.category);
      }

      if (filters?.search && filters.search.trim()) {
        const q = filters.search.trim();
        query = query.or(`dispute_reference.ilike.%${q}%,reporter_phone.ilike.%${q}%,description.ilike.%${q}%`);
      }

      const { data, error } = await query;
      if (error || !data) return [];

      return data.map((d) => ({
        id: d.id,
        disputeReference: d.dispute_reference,
        orderId: d.order_id,
        orderReference: d.order_reference,
        reporterType: d.reporter_type,
        reporterPhone: d.reporter_phone,
        category: d.category,
        description: d.description,
        status: d.status,
        resolutionNotes: d.resolution_notes,
        resolvedAt: d.resolved_at,
        resolvedBy: d.resolved_by,
        createdAt: d.created_at,
        updatedAt: d.updated_at
      }));
    } catch {
      return [];
    }
  },

  /**
   * Fetch single dispute with its full audit trail
   */
  async getDisputeDetails(disputeId: string): Promise<{ dispute: Dispute | null; updates: DisputeUpdate[] }> {
    if (!isSupabaseConfigured || !supabase || !disputeId) {
      return { dispute: null, updates: [] };
    }

    try {
      const [disputeRes, updatesRes] = await Promise.all([
        supabase.from('disputes').select('*').eq('id', disputeId).maybeSingle(),
        supabase.from('dispute_updates').select('*').eq('dispute_id', disputeId).order('created_at', { ascending: true })
      ]);

      if (disputeRes.error || !disputeRes.data) {
        return { dispute: null, updates: [] };
      }

      const d = disputeRes.data;
      const dispute: Dispute = {
        id: d.id,
        disputeReference: d.dispute_reference,
        orderId: d.order_id,
        orderReference: d.order_reference,
        reporterType: d.reporter_type,
        reporterPhone: d.reporter_phone,
        category: d.category,
        description: d.description,
        status: d.status,
        resolutionNotes: d.resolution_notes,
        resolvedAt: d.resolved_at,
        resolvedBy: d.resolved_by,
        createdAt: d.created_at,
        updatedAt: d.updated_at
      };

      const updates: DisputeUpdate[] = (updatesRes.data || []).map((u) => ({
        id: u.id,
        disputeId: u.dispute_id,
        authorId: u.author_id,
        authorEmail: u.author_email,
        updateType: u.update_type,
        oldStatus: u.old_status,
        newStatus: u.new_status,
        comment: u.comment,
        createdAt: u.created_at
      }));

      return { dispute, updates };
    } catch {
      return { dispute: null, updates: [] };
    }
  },

  /**
   * Log a new dispute
   */
  async createDispute(payload: {
    orderReference?: string;
    reporterType: 'customer' | 'rider' | 'admin';
    reporterPhone: string;
    category: DisputeCategory;
    description: string;
  }): Promise<{ success: boolean; disputeReference?: string; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database connection unavailable.' };
    }

    try {
      const ref = `DSP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // Resolve order ID if reference provided
      let orderId: string | null = null;
      if (payload.orderReference) {
        const { data: orderData } = await supabase
          .from('orders')
          .select('id')
          .eq('order_reference', payload.orderReference)
          .maybeSingle();
        if (orderData) orderId = orderData.id;
      }

      const { data, error } = await supabase
        .from('disputes')
        .insert({
          dispute_reference: ref,
          order_id: orderId,
          order_reference: payload.orderReference || null,
          reporter_type: payload.reporterType,
          reporter_phone: payload.reporterPhone,
          category: payload.category,
          description: payload.description,
          status: 'open'
        })
        .select('id, dispute_reference')
        .single();

      if (error || !data) {
        return { success: false, error: error?.message || 'Failed to create dispute.' };
      }

      await this.logAdminAction(
        'dispute_created',
        'dispute',
        data.id,
        payload.description.slice(0, 100),
        { disputeReference: data.dispute_reference, category: payload.category }
      );

      return { success: true, disputeReference: data.dispute_reference };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message };
    }
  },

  /**
   * Update dispute status and add note / resolution
   */
  async updateDisputeStatus(
    disputeId: string,
    newStatus: DisputeStatus,
    comment: string,
    resolutionNotes?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database connection unavailable.' };
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) {
        return { success: false, error: 'Administrator authentication required.' };
      }

      // Fetch current dispute status
      const { data: currentDispute } = await supabase
        .from('disputes')
        .select('status, dispute_reference')
        .eq('id', disputeId)
        .single();

      const oldStatus = currentDispute?.status || 'open';

      const updateData: Record<string, unknown> = {
        status: newStatus,
        updated_at: new Date().toISOString()
      };

      if (resolutionNotes) {
        updateData.resolution_notes = resolutionNotes;
      }

      if (newStatus === 'resolved' || newStatus === 'closed') {
        updateData.resolved_at = new Date().toISOString();
        updateData.resolved_by = user.id;
      }

      const { error: disputeErr } = await supabase
        .from('disputes')
        .update(updateData)
        .eq('id', disputeId);

      if (disputeErr) {
        return { success: false, error: disputeErr.message };
      }

      // Insert into dispute_updates
      await supabase.from('dispute_updates').insert({
        dispute_id: disputeId,
        author_id: user.id,
        author_email: user.email || 'admin@okadabook.com',
        update_type: newStatus === 'resolved' ? 'resolution' : 'status_change',
        old_status: oldStatus,
        new_status: newStatus,
        comment: comment.trim() || `Status updated from ${oldStatus} to ${newStatus}`
      });

      // Insert audit log
      await this.logAdminAction(
        `dispute_status_${newStatus}`,
        'dispute',
        disputeId,
        comment,
        { oldStatus, newStatus, disputeReference: currentDispute?.dispute_reference }
      );

      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message };
    }
  },

  /**
   * Fetch recent admin audit logs
   */
  async getAdminAuditLogs(limit = 30): Promise<AdminAuditLog[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !data) return [];

      return data.map((l) => ({
        id: l.id,
        adminUserId: l.admin_user_id,
        adminEmail: l.admin_email,
        action: l.action,
        targetType: l.target_type,
        targetId: l.target_id,
        reason: l.reason,
        metadata: l.metadata,
        createdAt: l.created_at
      }));
    } catch {
      return [];
    }
  },

  /**
   * Fetch system health & infrastructure metrics
   */
  async getSystemMetrics(): Promise<SystemMetricsData> {
    const defaultData: SystemMetricsData = {
      healthStatus: 'Healthy',
      healthReason: 'System is operating within expected parameters.',
      totalOrders: 0,
      successfulOrders: 0,
      failedOrders: 0,
      avgAcceptanceSeconds: null,
      onlineRiders: 0,
      audioUploadFailures: 0,
      imageUploadFailures: 0,
      databaseErrorsCount: 0,
      recentAuthFailures: 'Not yet configured — requires external monitoring',
      recentAdminActionsCount: 0,
      recentAuditLogs: [],
      evaluatedAt: new Date().toISOString()
    };

    if (!isSupabaseConfigured || !supabase) {
      return {
        ...defaultData,
        healthStatus: 'Needs attention',
        healthReason: 'Supabase credentials are not configured.'
      };
    }

    try {
      const [ordersRes, mediaRes, ridersRes, auditRes] = await Promise.all([
        supabase.from('orders').select('id, status, created_at, accepted_at'),
        supabase.from('order_media').select('id, media_type, upload_status'),
        supabase.from('riders').select('id, is_available'),
        supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(10)
      ]);

      const orders = ordersRes.data || [];
      const media = mediaRes.data || [];
      const riders = ridersRes.data || [];
      const auditLogs = auditRes.data || [];

      const totalOrders = orders.length;
      const completedOrders = orders.filter((o) => o.status === 'completed').length;
      const cancelledOrders = orders.filter((o) => o.status === 'cancelled').length;

      const audioUploadFailures = media.filter(
        (m) => m.media_type === 'voice_recording' && m.upload_status === 'failed'
      ).length;

      const imageUploadFailures = media.filter(
        (m) => m.media_type !== 'voice_recording' && m.upload_status === 'failed'
      ).length;

      const onlineRiders = riders.filter((r) => r.is_available).length;

      // Acceptance time calculation
      let totalAcceptanceSec = 0;
      let acceptanceCount = 0;
      orders.forEach((o) => {
        if (o.accepted_at && o.created_at) {
          const diff = (new Date(o.accepted_at).getTime() - new Date(o.created_at).getTime()) / 1000;
          if (diff >= 0 && diff < 86400) {
            totalAcceptanceSec += diff;
            acceptanceCount++;
          }
        }
      });
      const avgAcceptanceSec = acceptanceCount > 0 ? Math.round(totalAcceptanceSec / acceptanceCount) : null;

      // Determine health status
      let healthStatus: 'Healthy' | 'Warning' | 'Needs attention' = 'Healthy';
      let healthReason = 'All database operations and fleet dispatch metrics are nominal.';

      const failureCount = audioUploadFailures + imageUploadFailures;
      if (failureCount > 5 || (totalOrders >= 10 && cancelledOrders / totalOrders > 0.4)) {
        healthStatus = 'Needs attention';
        healthReason = 'Elevated cancellation rate or media upload failures detected.';
      } else if (failureCount > 0 || (onlineRiders === 0 && orders.some((o) => o.status === 'pending'))) {
        healthStatus = 'Warning';
        healthReason = 'No riders online while pending customer orders exist.';
      }

      return {
        healthStatus,
        healthReason,
        totalOrders,
        successfulOrders: completedOrders,
        failedOrders: cancelledOrders,
        avgAcceptanceSeconds: avgAcceptanceSec,
        onlineRiders,
        audioUploadFailures,
        imageUploadFailures,
        databaseErrorsCount: ordersRes.error ? 1 : 0,
        recentAuthFailures: 'Not yet configured — requires external monitoring',
        recentAdminActionsCount: auditLogs.length,
        recentAuditLogs: auditLogs.map((l) => ({
          id: l.id,
          adminUserId: l.admin_user_id,
          adminEmail: l.admin_email,
          action: l.action,
          targetType: l.target_type,
          targetId: l.target_id,
          reason: l.reason,
          metadata: l.metadata,
          createdAt: l.created_at
        })),
        evaluatedAt: new Date().toISOString()
      };
    } catch {
      return defaultData;
    }
  },

  /**
   * Update an order status from admin console (e.g. Cancel or Complete)
   */
  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database connection unavailable.' };
    }

    try {
      const updateData: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString()
      };

      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

      if (error) {
        return { success: false, error: error.message };
      }

      await this.logAdminAction(
        `order_status_${status}`,
        'order',
        orderId,
        `Status set to ${status}`,
        { newStatus: status }
      );

      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message };
    }
  },

  /**
   * Toggle a rider's active online availability from admin console
   */
  async toggleRiderAvailability(riderId: string, isAvailable: boolean): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database connection unavailable.' };
    }

    try {
      const { error } = await supabase
        .from('riders')
        .update({
          is_available: isAvailable,
          updated_at: new Date().toISOString()
        })
        .eq('id', riderId);

      if (error) {
        return { success: false, error: error.message };
      }

      await this.logAdminAction(
        isAvailable ? 'rider_set_online' : 'rider_set_offline',
        'rider',
        riderId,
        `Availability toggled to ${isAvailable ? 'online' : 'offline'}`
      );

      return { success: true };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, error: error.message };
    }
  },

  /**
   * Generate signed audio URL for private recordings
   */
  async getVoiceAudioSignedUrl(storagePath: string): Promise<string | null> {
    if (!isSupabaseConfigured || !supabase || !storagePath) return null;
    try {
      const { data, error } = await supabase.storage
        .from('order-recordings')
        .createSignedUrl(storagePath, 3600);

      if (error || !data) return null;
      return data.signedUrl;
    } catch {
      return null;
    }
  }
};
