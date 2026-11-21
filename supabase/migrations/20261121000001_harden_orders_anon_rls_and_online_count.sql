-- ==============================================================================
-- OKADA BOOK — HARDEN ANON ORDERS RLS & ONLINE RIDERS COUNT RPC
-- Migration: 20261121000001_harden_orders_anon_rls_and_online_count.sql
-- Description:
--   1. Drops the overly permissive anon SELECT USING (true) policy on orders
--      so customer phone numbers cannot be scraped via the public REST API.
--      Customer tracking, phone lookup, cancel, and comments all use
--      SECURITY DEFINER RPCs and continue working seamlessly.
--   2. Adds get_online_riders_count() RPC so the customer booking screen can
--      show how many riders are currently online without exposing rider PII.
-- ==============================================================================

-- 1. Remove open anon SELECT policy on public.orders
DROP POLICY IF EXISTS "Anon can view orders by exact reference" ON public.orders;

-- 2. Privacy-safe RPC: count of currently online, non-suspended riders
CREATE OR REPLACE FUNCTION public.get_online_riders_count()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  SELECT count(*)::INTEGER
  INTO v_count
  FROM public.riders r
  WHERE r.is_available = true
    AND coalesce(r.verification_status, 'pending') NOT IN ('suspended', 'rejected');

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_online_riders_count() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
