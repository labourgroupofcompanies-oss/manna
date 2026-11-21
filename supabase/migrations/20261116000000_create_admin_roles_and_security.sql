-- ==============================================================================
-- OKADA BOOK — ADMIN ROLE SYSTEM & DATABASE RLS HARDENING MIGRATION
-- Migration: 20261116000000_create_admin_roles_and_security.sql
-- Description: Establishes a dedicated, owner-controlled administrator role table,
--              Row Level Security policies preventing customer/rider escalation,
--              and admin management functions.
-- ==============================================================================

-- 1. Create Dedicated Admin Users Table linked to auth.users(id)
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON public.admin_users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON public.admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users(email);

-- 2. Helper Security Definer Function: is_admin()
-- Verifies caller or specified user has an active admin record
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = p_user_id
  );
END;
$$;

-- Grant execution to all authenticated sessions so RLS policies and RPC callers can evaluate it
REVOKE EXECUTE ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO anon, authenticated, service_role;

-- 3. Row Level Security on admin_users table
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Service role has full uninhibited access
DROP POLICY IF EXISTS "Service role full access on admin_users" ON public.admin_users;
CREATE POLICY "Service role full access on admin_users"
  ON public.admin_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can ONLY view their own admin record (prevents discovering other admin emails)
DROP POLICY IF EXISTS "Users can view own admin record" ON public.admin_users;
CREATE POLICY "Users can view own admin record"
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Strictly protect INSERT, UPDATE, DELETE:
-- Only existing super_admin accounts can modify admin roles.
-- Regular authenticated customers/riders CANNOT insert or elevate themselves.
DROP POLICY IF EXISTS "Super admins can manage admin_users" ON public.admin_users;
CREATE POLICY "Super admins can manage admin_users"
  ON public.admin_users
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = auth.uid() AND au.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = auth.uid() AND au.role = 'super_admin'
    )
  );

-- 4. Row Level Security on orders table for Administrators
-- Allow authorized admins full view of all orders (pending, accepted, completed, cancelled)
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
CREATE POLICY "Admins can view all orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Allow authorized admins to update orders (e.g. status changes, cancellation, notes)
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Allow authorized admins to delete orders if needed
DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;
CREATE POLICY "Admins can delete orders"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 5. Row Level Security on riders table for Administrators
-- Allow authorized admins to view all riders across the platform
DROP POLICY IF EXISTS "Admins can view all riders" ON public.riders;
CREATE POLICY "Admins can view all riders"
  ON public.riders
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Allow authorized admins to update rider profiles (e.g. availability toggle, verification)
DROP POLICY IF EXISTS "Admins can update all riders" ON public.riders;
CREATE POLICY "Admins can update all riders"
  ON public.riders
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Allow authorized admins to delete rider accounts if necessary
DROP POLICY IF EXISTS "Admins can delete riders" ON public.riders;
CREATE POLICY "Admins can delete riders"
  ON public.riders
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 6. Row Level Security on order_media for Administrators
DROP POLICY IF EXISTS "Admins can view all order media" ON public.order_media;
CREATE POLICY "Admins can view all order media"
  ON public.order_media
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 7. Storage Policies for Administrators
-- Allow authorized admins to read any audio recording in order-recordings
DROP POLICY IF EXISTS "Admins can read all order recordings" ON storage.objects;
CREATE POLICY "Admins can read all order recordings"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'order-recordings' AND public.is_admin());

-- 8. Admin Metrics RPC Function (real data aggregation)
CREATE OR REPLACE FUNCTION public.get_admin_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_is_admin BOOLEAN;
  v_total_orders BIGINT;
  v_pending_orders BIGINT;
  v_accepted_orders BIGINT;
  v_completed_orders BIGINT;
  v_cancelled_orders BIGINT;
  v_total_riders BIGINT;
  v_online_riders BIGINT;
  v_total_customers BIGINT;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT public.is_admin(v_caller_uid) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator access required.');
  END IF;

  SELECT COUNT(*) INTO v_total_orders FROM public.orders;
  SELECT COUNT(*) INTO v_pending_orders FROM public.orders WHERE status = 'pending';
  SELECT COUNT(*) INTO v_accepted_orders FROM public.orders WHERE status = 'accepted';
  SELECT COUNT(*) INTO v_completed_orders FROM public.orders WHERE status = 'completed';
  SELECT COUNT(*) INTO v_cancelled_orders FROM public.orders WHERE status = 'cancelled';

  SELECT COUNT(*) INTO v_total_riders FROM public.riders;
  SELECT COUNT(*) INTO v_online_riders FROM public.riders WHERE is_available = true;

  SELECT COUNT(DISTINCT customer_phone) INTO v_total_customers FROM public.orders;

  RETURN jsonb_build_object(
    'success', true,
    'metrics', jsonb_build_object(
      'totalOrders', v_total_orders,
      'pendingOrders', v_pending_orders,
      'acceptedOrders', v_accepted_orders,
      'completedOrders', v_completed_orders,
      'cancelledOrders', v_cancelled_orders,
      'totalRiders', v_total_riders,
      'onlineRiders', v_online_riders,
      'totalCustomers', v_total_customers
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_metrics() TO authenticated;
