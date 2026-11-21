-- ==============================================================================
-- OKADA BOOK — STAGE 5: DEDICATED CUSTOMERS TABLE & AUTO-SYNC TRIGGER
-- Migration: 20261117000001_create_customers_table_and_trigger.sql
-- Description: Creates public.customers table and an automatic trigger on
--              public.orders so every new contact phone taken during booking
--              is recorded as a Registered Customer in the system.
-- ==============================================================================

-- 1. Create public.customers Table
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

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 2. Row Level Security on customers table
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on customers" ON public.customers;
CREATE POLICY "Service role full access on customers"
  ON public.customers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view all customers" ON public.customers;
CREATE POLICY "Admins can view all customers"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update customers" ON public.customers;
CREATE POLICY "Admins can update customers"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete customers" ON public.customers;
CREATE POLICY "Admins can delete customers"
  ON public.customers
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 3. Automatic Trigger Function: Sync each new order contact to customers table
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

-- 4. Initial Backfill: Import all existing unique contacts from orders into customers
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
