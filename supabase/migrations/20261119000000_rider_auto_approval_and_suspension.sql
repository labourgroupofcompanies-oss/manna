-- ==============================================================================
-- OKADA BOOK — RIDER AUTO-APPROVAL ON REGISTRATION & ADMINISTRATIVE SUSPENSION
-- Migration: 20261119000000_rider_auto_approval_and_suspension.sql
-- Description:
--   1. New riders are auto-approved on registration and eligible to accept orders
--      while their profile remains available for verification in the Admin Portal.
--   2. In the Admin Portal, approving a rider marks them as verified ('approved')
--      so they continue taking orders seamlessly.
--   3. Declining a rider marks their account as suspended ('suspended'), immediately
--      takes them offline (is_available = false), and blocks order acceptance.
-- ==============================================================================

-- 1. Ensure verification_status column defaults to 'pending'
ALTER TABLE public.riders
  ALTER COLUMN verification_status SET DEFAULT 'pending';

-- 2. Update accept_order() RPC Function
-- Allows riders with 'pending' (auto-approved on signup) and 'approved' (verified)
-- to accept orders. Strictly blocks 'suspended' and 'rejected' riders.
CREATE OR REPLACE FUNCTION public.accept_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_rider_id UUID;
  v_is_available BOOLEAN;
  v_verification_status TEXT;
  v_order RECORD;
BEGIN
  -- A. Verify caller is authenticated
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- B. Resolve rider record from public.riders using auth.uid()
  SELECT r.id, r.is_available, r.verification_status
  INTO v_rider_id, v_is_available, v_verification_status
  FROM public.riders r
  WHERE r.user_id = v_caller_uid;

  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No registered rider profile found for this account.');
  END IF;

  -- C. Enforce Account Suspension / Rejection Check:
  -- Auto-approved ('pending') and fully verified ('approved') riders CAN take orders.
  -- Suspended or rejected riders are strictly blocked.
  IF v_verification_status IN ('suspended', 'rejected') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Your rider account has been suspended by administration. You are not authorized to accept orders.'
    );
  END IF;

  -- D. Enforce Online Status: Rider must be online
  IF NOT v_is_available THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be Online to accept orders.');
  END IF;

  -- E. Concurrency-Safe Atomic Update with Postgres Exclusive Row Lock
  UPDATE public.orders
  SET status = 'accepted',
      rider_id = v_rider_id,
      accepted_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id
    AND status = 'pending'
    AND rider_id IS NULL
  RETURNING id, order_reference, customer_phone, order_type, order_description, voice_recording_path, status, created_at, accepted_at
  INTO v_order;

  -- F. If 0 rows updated, order was already taken or cancelled
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order has already been taken by another rider or cancelled.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'orderReference', v_order.order_reference,
      'customerPhone', v_order.customer_phone,
      'orderType', v_order.order_type,
      'orderDescription', v_order.order_description,
      'voiceRecordingPath', v_order.voice_recording_path,
      'status', v_order.status,
      'createdAt', v_order.created_at,
      'acceptedAt', v_order.accepted_at
    )
  );
END;
$$;

-- 3. Update get_available_orders() RPC Function
-- Auto-approved ('pending') and verified ('approved') riders who are online can see pending orders.
-- Suspended and rejected riders receive zero orders.
CREATE OR REPLACE FUNCTION public.get_available_orders()
RETURNS TABLE (
  id UUID,
  order_reference TEXT,
  order_type TEXT,
  order_description TEXT,
  voice_recording_path TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_rider_id UUID;
  v_is_available BOOLEAN;
  v_verification_status TEXT;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT r.id, r.is_available, r.verification_status
  INTO v_rider_id, v_is_available, v_verification_status
  FROM public.riders r
  WHERE r.user_id = v_caller_uid;

  -- Strictly require rider to exist, be online, and NOT be suspended or rejected
  IF v_rider_id IS NULL OR v_is_available IS NOT TRUE OR v_verification_status IN ('suspended', 'rejected') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_reference,
    o.order_type,
    o.order_description,
    o.voice_recording_path,
    o.created_at
  FROM public.orders o
  WHERE o.status = 'pending'
    AND o.rider_id IS NULL
  ORDER BY o.created_at DESC
  LIMIT 50;
END;
$$;

-- 4. Update admin_set_rider_verification() Helper Function
-- When an admin declines/suspends a rider, automatically sets is_available = false
-- to kick them offline immediately and records full audit log.
CREATE OR REPLACE FUNCTION public.admin_set_rider_verification(
  p_rider_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_admin_email TEXT;
  v_prev_status TEXT;
  v_rider_name TEXT;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR NOT public.is_admin(v_caller_uid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator access required.');
  END IF;

  IF p_status NOT IN ('pending', 'approved', 'rejected', 'suspended') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid verification status: ' || p_status);
  END IF;

  SELECT email INTO v_admin_email FROM auth.users WHERE id = v_caller_uid;
  SELECT verification_status, full_name INTO v_prev_status, v_rider_name FROM public.riders WHERE id = p_rider_id;

  IF v_prev_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider record not found.');
  END IF;

  -- Update verification status and force offline if suspended or rejected
  UPDATE public.riders
  SET verification_status = p_status,
      is_available = CASE WHEN p_status IN ('suspended', 'rejected') THEN false ELSE is_available END,
      verified_at = CASE WHEN p_status = 'approved' THEN timezone('utc'::text, now()) ELSE verified_at END,
      verified_by = v_caller_uid,
      verification_notes = p_notes,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_rider_id;

  -- Write to immutable admin audit log
  INSERT INTO public.admin_audit_logs (
    admin_user_id, admin_email, action, target_type, target_id, reason, metadata
  ) VALUES (
    v_caller_uid,
    COALESCE(v_admin_email, 'admin'),
    'rider_verification_' || p_status,
    'rider',
    p_rider_id::text,
    p_notes,
    jsonb_build_object(
      'riderName', v_rider_name,
      'previousStatus', v_prev_status,
      'newStatus', p_status
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'riderId', p_rider_id,
    'status', p_status,
    'message', 'Rider verification status updated to ' || p_status || CASE WHEN p_status IN ('suspended', 'rejected') THEN ' (Account Suspended, Taken Offline)' ELSE '' END
  );
END;
$$;

-- Grant permissions to authenticated users for RPC dispatch
REVOKE EXECUTE ON FUNCTION public.accept_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_order(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_available_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_orders() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_set_rider_verification(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_rider_verification(UUID, TEXT, TEXT) TO authenticated;
