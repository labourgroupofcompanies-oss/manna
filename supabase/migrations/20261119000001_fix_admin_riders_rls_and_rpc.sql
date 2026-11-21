-- ==============================================================================
-- OKADA BOOK — FIX ADMIN RIDERS VISIBILITY & RPC DIRECT RETRIEVAL
-- Migration: 20261119000001_fix_admin_riders_rls_and_rpc.sql
-- Description:
--   1. Creates admin_get_all_riders() SECURITY DEFINER RPC function to reliably
--      return all riders to administrators without being blocked by RLS policies.
--   2. Fixes RLS policies on public.riders so authenticated admins have unambiguous
--      SELECT and UPDATE access.
--   3. Grants explicit execute privileges on is_admin() and admin_get_all_riders().
-- ==============================================================================

-- 1. Ensure is_admin() function handles both 0 and 1 argument signatures
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

-- 2. Create admin_get_all_riders() SECURITY DEFINER RPC Function
CREATE OR REPLACE FUNCTION public.admin_get_all_riders()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  full_name TEXT,
  phone_number TEXT,
  motorcycle_registration TEXT,
  motorcycle_model TEXT,
  motorcycle_colour TEXT,
  operating_area TEXT,
  profile_photo_path TEXT,
  is_available BOOLEAN,
  verification_status TEXT,
  verification_submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  verification_notes TEXT,
  total_completed_rides BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR NOT public.is_admin(v_caller_uid) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.user_id,
    r.full_name,
    r.phone_number,
    r.motorcycle_registration,
    r.motorcycle_model,
    r.motorcycle_colour,
    r.operating_area,
    r.profile_photo_path,
    r.is_available,
    r.verification_status,
    r.verification_submitted_at,
    r.verified_at,
    r.verified_by,
    r.verification_notes,
    COALESCE(COUNT(o.id) FILTER (WHERE o.status = 'completed'), 0)::BIGINT AS total_completed_rides,
    r.created_at,
    r.updated_at
  FROM public.riders r
  LEFT JOIN public.orders o ON o.rider_id = r.id
  GROUP BY r.id
  ORDER BY r.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_all_riders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_all_riders() TO authenticated;

-- 3. Fix Row Level Security on public.riders table
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all riders" ON public.riders;
DROP POLICY IF EXISTS "Riders can view own profile" ON public.riders;

-- Unified SELECT policy: Riders can view own profile, Admins can view all profiles
CREATE POLICY "Riders and admins can view profiles"
  ON public.riders
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Admins can update all riders" ON public.riders;
DROP POLICY IF EXISTS "Riders can update own profile" ON public.riders;

-- Unified UPDATE policy: Riders can update own profile, Admins can update all profiles
CREATE POLICY "Riders and admins can update profiles"
  ON public.riders
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id OR public.is_admin(auth.uid())
  );

-- 4. Fix RLS on rider_verification_documents table
ALTER TABLE public.rider_verification_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all rider verification docs" ON public.rider_verification_documents;
CREATE POLICY "Admins can view all rider verification docs"
  ON public.rider_verification_documents
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = rider_verification_documents.rider_id
        AND r.user_id = auth.uid()
    )
  );
