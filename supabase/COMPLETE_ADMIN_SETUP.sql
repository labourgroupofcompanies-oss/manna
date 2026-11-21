-- ==============================================================================
-- OKADA BOOK — 1-CLICK ALL-IN-ONE ADMIN SETUP & OWNER PROVISIONING
-- ==============================================================================
-- Run this ENTIRE script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/bftlhbxhipbfmwbajcjf/sql/new
--
-- This script:
-- 1. Creates the public.admin_users table & RLS policies
-- 2. Creates the is_admin() verification function
-- 3. Enables admin access to orders, riders, media & storage
-- 4. Creates your Owner Auth account with your chosen password (or links existing)
-- 5. Authorizes you as SUPER_ADMIN
-- ==============================================================================

-- 1. Ensure pgcrypto extension is active for password hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create the public.admin_users Table
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON public.admin_users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON public.admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users(email);

-- 4. Create is_admin() Helper Function
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

REVOKE EXECUTE ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO anon, authenticated, service_role;

-- 5. Enable Row Level Security (RLS) on admin_users
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on admin_users" ON public.admin_users;
CREATE POLICY "Service role full access on admin_users"
  ON public.admin_users FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view own admin record" ON public.admin_users;
CREATE POLICY "Users can view own admin record"
  ON public.admin_users FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Super admins can manage admin_users" ON public.admin_users;
CREATE POLICY "Super admins can manage admin_users"
  ON public.admin_users FOR ALL TO authenticated
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

-- 6. Add Admin Policies to Orders, Riders, Media & Storage
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
    CREATE POLICY "Admins can view all orders" ON public.orders FOR SELECT TO authenticated USING (public.is_admin());

    DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
    CREATE POLICY "Admins can update orders" ON public.orders FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

    DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;
    CREATE POLICY "Admins can delete orders" ON public.orders FOR DELETE TO authenticated USING (public.is_admin());
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'riders') THEN
    DROP POLICY IF EXISTS "Admins can view all riders" ON public.riders;
    CREATE POLICY "Admins can view all riders" ON public.riders FOR SELECT TO authenticated USING (public.is_admin());

    DROP POLICY IF EXISTS "Admins can update all riders" ON public.riders;
    CREATE POLICY "Admins can update all riders" ON public.riders FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

    DROP POLICY IF EXISTS "Admins can delete riders" ON public.riders;
    CREATE POLICY "Admins can delete riders" ON public.riders FOR DELETE TO authenticated USING (public.is_admin());
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_media') THEN
    DROP POLICY IF EXISTS "Admins can view all order media" ON public.order_media;
    CREATE POLICY "Admins can view all order media" ON public.order_media FOR SELECT TO authenticated USING (public.is_admin());
  END IF;
END $$;

-- 7. Admin Metrics RPC Function
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

-- ==============================================================================
-- 8. PROVISION THE OWNER ACCOUNT & SET THE PASSWORD
-- ==============================================================================
-- CHANGE THESE TWO VALUES TO YOUR DESIRED CREDENTIALS:
-- ==============================================================================
DO $$
DECLARE
  v_owner_email TEXT := 'owner@okadabook.com';       -- <<< YOUR ADMIN EMAIL
  v_owner_password TEXT := 'OkadaOwner2026!';       -- <<< YOUR ADMIN PASSWORD
  v_user_id UUID;
  v_encrypted_pw TEXT;
BEGIN
  v_owner_email := LOWER(TRIM(v_owner_email));
  v_encrypted_pw := crypt(v_owner_password, gen_salt('bf'));

  -- A. Check if the user already exists in auth.users
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_owner_email;

  IF v_user_id IS NOT NULL THEN
    -- User exists: update password & ensure email confirmed
    UPDATE auth.users
    SET encrypted_password = v_encrypted_pw,
        email_confirmed_at = COALESCE(email_confirmed_at, timezone('utc'::text, now())),
        updated_at = timezone('utc'::text, now())
    WHERE id = v_user_id;
  ELSE
    -- User does not exist: create in auth.users
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_owner_email,
      v_encrypted_pw,
      timezone('utc'::text, now()),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"role":"admin"}'::jsonb,
      timezone('utc'::text, now()),
      timezone('utc'::text, now())
    );

    -- Insert into auth.identities with id as UUID and provider_id as text
    INSERT INTO auth.identities (
      id, provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_user_id, v_user_id::text, v_user_id,
      json_build_object('sub', v_user_id::text, 'email', v_owner_email),
      'email', timezone('utc'::text, now()), timezone('utc'::text, now()), timezone('utc'::text, now())
    );
  END IF;

  -- B. Insert or update role in public.admin_users
  INSERT INTO public.admin_users (user_id, email, role)
  VALUES (v_user_id, v_owner_email, 'super_admin')
  ON CONFLICT (user_id) DO UPDATE SET
    role = 'super_admin',
    email = EXCLUDED.email,
    updated_at = timezone('utc'::text, now());

  RAISE NOTICE 'SUCCESS: Account % provisioned with role SUPER_ADMIN and password set.', v_owner_email;
END $$;

-- 9. Verification Query
SELECT
  a.id AS admin_record_id,
  a.user_id,
  a.email,
  a.role,
  a.created_at
FROM public.admin_users a;
