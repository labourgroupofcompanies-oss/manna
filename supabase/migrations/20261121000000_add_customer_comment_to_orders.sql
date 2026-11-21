-- ==============================================================================
-- OKADA BOOK — CUSTOMER ORDER COMMENTS MIGRATION
-- Migration: 20261121000000_add_customer_comment_to_orders.sql
-- Description: Adds customer_comment column to orders, add_order_comment RPC,
--              and updates tracking + rider RPCs so comments reflect across
--              Customer, Rider, and Admin portals.
-- ==============================================================================

-- 1. Add customer_comment column to public.orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_comment TEXT NULL;

-- 2. RPC: Add or update customer comment on an order
CREATE OR REPLACE FUNCTION public.add_order_comment(
  p_order_reference TEXT,
  p_comment TEXT,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref TEXT;
  v_clean_comment TEXT;
  v_updated_id UUID;
BEGIN
  v_ref := upper(trim(p_order_reference));
  v_clean_comment := trim(coalesce(p_comment, ''));

  IF v_ref IS NULL OR length(v_ref) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order reference is required.');
  END IF;

  IF length(v_clean_comment) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please enter a comment before saving.');
  END IF;

  IF length(v_clean_comment) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment must be 500 characters or fewer.');
  END IF;

  UPDATE public.orders
  SET customer_comment = v_clean_comment,
      updated_at = timezone('utc'::text, now())
  WHERE upper(order_reference) = v_ref
    AND (p_phone IS NULL OR customer_phone = trim(p_phone) OR customer_phone LIKE '%' || right(trim(p_phone), 8))
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order not found or phone number does not match.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customerComment', v_clean_comment,
    'message', 'Comment saved.'
  );
END;
$$;

-- 3. Update track_order to include customerComment
CREATE OR REPLACE FUNCTION public.track_order(
  p_order_reference TEXT,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref TEXT;
  v_order RECORD;
BEGIN
  v_ref := upper(trim(p_order_reference));

  IF v_ref IS NULL OR length(v_ref) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order reference is required.');
  END IF;

  SELECT
    o.id,
    o.order_reference,
    o.customer_phone,
    o.order_type,
    o.order_description,
    o.voice_recording_path,
    o.customer_comment,
    o.status,
    o.rider_id,
    o.created_at,
    o.accepted_at,
    o.completed_at,
    o.updated_at,
    r.full_name AS rider_name,
    r.phone_number AS rider_phone,
    r.motorcycle_model,
    r.motorcycle_registration AS motorcycle_reg,
    r.motorcycle_colour,
    r.operating_area,
    r.profile_photo_path AS rider_photo_url
  INTO v_order
  FROM public.orders o
  LEFT JOIN public.riders r ON r.id = o.rider_id
  WHERE upper(o.order_reference) = v_ref
    AND (p_phone IS NULL OR o.customer_phone = trim(p_phone) OR o.customer_phone LIKE '%' || right(trim(p_phone), 8));

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No order found matching reference ' || v_ref || '.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'orderReference', v_order.order_reference,
      'customerPhone', v_order.customer_phone,
      'orderType', v_order.order_type,
      'requestDescription', v_order.order_description,
      'voiceRecordingPath', v_order.voice_recording_path,
      'customerComment', v_order.customer_comment,
      'status', v_order.status,
      'createdAt', v_order.created_at,
      'acceptedAt', v_order.accepted_at,
      'completedAt', v_order.completed_at,
      'updatedAt', v_order.updated_at,
      'riderId', v_order.rider_id,
      'riderName', v_order.rider_name,
      'riderPhone', v_order.rider_phone,
      'motorcycleModel', v_order.motorcycle_model,
      'motorcycleReg', v_order.motorcycle_reg,
      'motorcycleColour', v_order.motorcycle_colour,
      'operatingArea', v_order.operating_area,
      'riderPhotoUrl', v_order.rider_photo_url,
      'profilePhotoPath', v_order.rider_photo_url
    )
  );
END;
$$;

-- 4. Update get_orders_by_phone to include customerComment
CREATE OR REPLACE FUNCTION public.get_orders_by_phone(
  p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT;
  v_orders JSONB;
BEGIN
  v_phone := trim(p_phone);

  IF v_phone IS NULL OR length(v_phone) < 8 THEN
    RETURN jsonb_build_array();
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'orderReference', o.order_reference,
      'customerPhone', o.customer_phone,
      'orderType', o.order_type,
      'requestDescription', o.order_description,
      'voiceRecordingPath', o.voice_recording_path,
      'customerComment', o.customer_comment,
      'status', o.status,
      'createdAt', o.created_at,
      'acceptedAt', o.accepted_at,
      'completedAt', o.completed_at,
      'updatedAt', o.updated_at,
      'riderId', o.rider_id,
      'riderName', r.full_name,
      'riderPhone', r.phone_number,
      'motorcycleModel', r.motorcycle_model,
      'motorcycleReg', r.motorcycle_registration,
      'motorcycleColour', r.motorcycle_colour,
      'operatingArea', r.operating_area,
      'riderPhotoUrl', r.profile_photo_path,
      'profilePhotoPath', r.profile_photo_path
    )
    ORDER BY o.created_at DESC
  ), '[]'::jsonb)
  INTO v_orders
  FROM public.orders o
  LEFT JOIN public.riders r ON r.id = o.rider_id
  WHERE o.customer_phone = v_phone
     OR o.customer_phone LIKE '%' || right(v_phone, 8)
  LIMIT 15;

  RETURN v_orders;
END;
$$;

-- 5. Update accept_order to include customerComment
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
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT r.id, r.is_available, r.verification_status
  INTO v_rider_id, v_is_available, v_verification_status
  FROM public.riders r
  WHERE r.user_id = v_caller_uid;

  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No registered rider profile found for this account.');
  END IF;

  IF v_verification_status IN ('suspended', 'rejected') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Your rider account has been suspended by administration. You are not authorized to accept orders.'
    );
  END IF;

  IF NOT v_is_available THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be Online to accept orders.');
  END IF;

  UPDATE public.orders
  SET status = 'accepted',
      rider_id = v_rider_id,
      accepted_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id
    AND status = 'pending'
    AND rider_id IS NULL
  RETURNING id, order_reference, customer_phone, order_type, order_description, voice_recording_path, customer_comment, status, created_at, accepted_at
  INTO v_order;

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
      'customerComment', v_order.customer_comment,
      'status', v_order.status,
      'createdAt', v_order.created_at,
      'acceptedAt', v_order.accepted_at
    )
  );
END;
$$;

-- 6. Update get_available_orders to include customer_comment
DROP FUNCTION IF EXISTS public.get_available_orders();
CREATE OR REPLACE FUNCTION public.get_available_orders()
RETURNS TABLE (
  id UUID,
  order_reference TEXT,
  order_type TEXT,
  order_description TEXT,
  voice_recording_path TEXT,
  customer_comment TEXT,
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
    o.customer_comment,
    o.created_at
  FROM public.orders o
  WHERE o.status = 'pending'
    AND o.rider_id IS NULL
  ORDER BY o.created_at DESC
  LIMIT 50;
END;
$$;

-- 7. Permissions & Schema Cache Reload
GRANT EXECUTE ON FUNCTION public.add_order_comment(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.track_order(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_by_phone(TEXT) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.accept_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_order(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_available_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_orders() TO authenticated;

NOTIFY pgrst, 'reload schema';
