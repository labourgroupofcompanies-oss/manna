-- ==============================================================================
-- OKADA BOOK — IMMEDIATE FIX FOR 500 ERROR & REGISTERED CUSTOMERS AUTO-SYNC
-- ==============================================================================
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/bftlhbxhipbfmwbajcjf/sql/new
--
-- This script:
-- 1. Eliminates the 500 Internal Server Error (Postgres RLS infinite recursion)
-- 2. Sets up the non-recursive RLS policies on public.admin_users
-- 3. Creates public.customers table and auto-sync trigger trg_sync_order_customer
--    so EVERY new contact taken during orders is recorded as a Registered Customer
-- 4. Backfills all existing order customer phone numbers into public.customers
-- ==============================================================================

-- 1. Helper Function: is_super_admin() (SECURITY DEFINER runs without RLS recursion)
CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id UUID DEFAULT auth.uid())
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
    WHERE user_id = p_user_id AND role = 'super_admin'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO anon, authenticated, service_role;

-- 2. Drop all recursive & conflicting policies on public.admin_users
DROP POLICY IF EXISTS "Super admins can manage admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Super admins can view all admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Super admins can insert admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Super admins can update admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Super admins can delete admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Users can view own admin record" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can view admin_users" ON public.admin_users;

-- 3. Recreate Clean, Non-Recursive Policies on public.admin_users
CREATE POLICY "Admins can view admin_users"
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can insert admin_users"
  ON public.admin_users
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can update admin_users"
  ON public.admin_users
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can delete admin_users"
  ON public.admin_users
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- 4. Direct RPC Function: get_current_admin()
CREATE OR REPLACE FUNCTION public.get_current_admin()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_admin RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('isAdmin', false, 'error', 'Not authenticated');
  END IF;

  SELECT id, user_id, email, role, created_at, updated_at
  INTO v_admin
  FROM public.admin_users
  WHERE user_id = v_uid;

  IF v_admin.id IS NULL THEN
    RETURN jsonb_build_object('isAdmin', false, 'error', 'No admin record found');
  END IF;

  RETURN jsonb_build_object(
    'isAdmin', true,
    'adminUser', jsonb_build_object(
      'id', v_admin.id,
      'userId', v_admin.user_id,
      'email', v_admin.email,
      'role', v_admin.role,
      'createdAt', v_admin.created_at,
      'updatedAt', v_admin.updated_at
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_current_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_admin() TO anon, authenticated, service_role;

-- ==============================================================================
-- 5. CREATE public.customers TABLE & AUTO-SYNC TRIGGER
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL UNIQUE,
  total_orders INT NOT NULL DEFAULT 1,
  first_order_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_order_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chk_customer_phone_len CHECK (length(trim(phone_number)) >= 10)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone_number);
CREATE INDEX IF NOT EXISTS idx_customers_last_order ON public.customers(last_order_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_total_orders ON public.customers(total_orders DESC);

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on customers" ON public.customers;
CREATE POLICY "Service role full access on customers"
  ON public.customers FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view all customers" ON public.customers;
CREATE POLICY "Admins can view all customers"
  ON public.customers FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update customers" ON public.customers;
CREATE POLICY "Admins can update customers"
  ON public.customers FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete customers" ON public.customers;
CREATE POLICY "Admins can delete customers"
  ON public.customers FOR DELETE TO authenticated USING (public.is_admin());

-- Trigger to record every order contact into customers table automatically
CREATE OR REPLACE FUNCTION public.sync_order_customer()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_phone IS NOT NULL AND length(trim(NEW.customer_phone)) >= 10 THEN
    INSERT INTO public.customers (
      phone_number,
      total_orders,
      first_order_at,
      last_order_at
    ) VALUES (
      trim(NEW.customer_phone),
      1,
      COALESCE(NEW.created_at, timezone('utc'::text, now())),
      COALESCE(NEW.created_at, timezone('utc'::text, now()))
    )
    ON CONFLICT (phone_number) DO UPDATE SET
      total_orders = public.customers.total_orders + 1,
      last_order_at = COALESCE(NEW.created_at, timezone('utc'::text, now())),
      updated_at = timezone('utc'::text, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_order_customer ON public.orders;
CREATE TRIGGER trg_sync_order_customer
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_order_customer();

-- Backfill existing customers from orders
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    INSERT INTO public.customers (phone_number, total_orders, first_order_at, last_order_at)
    SELECT
      trim(customer_phone),
      COUNT(*)::INT,
      MIN(created_at),
      MAX(created_at)
    FROM public.orders
    WHERE customer_phone IS NOT NULL AND length(trim(customer_phone)) >= 10
    GROUP BY trim(customer_phone)
    ON CONFLICT (phone_number) DO UPDATE SET
      total_orders = EXCLUDED.total_orders,
      first_order_at = EXCLUDED.first_order_at,
      last_order_at = EXCLUDED.last_order_at;
  END IF;
END $$;
