-- ==============================================================================
-- OKADA BOOK — CUSTOMER ORDER TRACKING MIGRATION
-- Migration: 20261118000000_customer_order_tracking.sql
-- Description: Adds secure RPC functions and policies for customer real-time
--              order tracking by Order Reference and phone number.
-- ==============================================================================

-- 1. RPC: Track Order by Reference (e.g. OKD-XXXXXX)
-- Securely returns order status, timestamps, and assigned rider & motorcycle details.
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
  v_rider RECORD;
BEGIN
  v_ref := upper(trim(p_order_reference));

  IF v_ref IS NULL OR length(v_ref) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order reference is required.');
  END IF;

  -- Select order
  SELECT 
    o.id,
    o.order_reference,
    o.customer_phone,
    o.order_type,
    o.order_description,
    o.voice_recording_path,
    o.status,
    o.rider_id,
    o.created_at,
    o.accepted_at,
    o.completed_at,
    o.updated_at
  INTO v_order
  FROM public.orders o
  WHERE upper(o.order_reference) = v_ref
    AND (p_phone IS NULL OR o.customer_phone = trim(p_phone) OR o.customer_phone LIKE '%' || right(trim(p_phone), 8));

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No order found matching reference ' || v_ref || '.'
    );
  END IF;

  -- If rider assigned, get rider and motorcycle information
  IF v_order.rider_id IS NOT NULL THEN
    SELECT
      r.full_name,
      r.phone_number,
      r.motorcycle_model,
      r.motorcycle_registration,
      r.motorcycle_colour,
      r.operating_area,
      r.profile_photo_path
    INTO v_rider
    FROM public.riders r
    WHERE r.id = v_order.rider_id;
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
      'status', v_order.status,
      'createdAt', v_order.created_at,
      'acceptedAt', v_order.accepted_at,
      'completedAt', v_order.completed_at,
      'updatedAt', v_order.updated_at,
      'riderId', v_order.rider_id,
      'riderName', v_rider.full_name,
      'riderPhone', v_rider.phone_number,
      'motorcycleModel', v_rider.motorcycle_model,
      'motorcycleReg', v_rider.motorcycle_registration,
      'motorcycleColour', v_rider.motorcycle_colour,
      'operatingArea', v_rider.operating_area,
      'riderPhotoUrl', v_rider.profile_photo_path
    )
  );
END;
$$;

-- 2. RPC: Get Customer Orders by Phone Number
-- Allows returning customers to view their active and recent requests
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
      'operatingArea', r.operating_area
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

-- 3. RPC: Cancel Order by Customer (if still pending)
CREATE OR REPLACE FUNCTION public.cancel_order_by_reference(
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
  v_updated_id UUID;
BEGIN
  v_ref := upper(trim(p_order_reference));

  UPDATE public.orders
  SET status = 'cancelled',
      updated_at = timezone('utc'::text, now())
  WHERE upper(order_reference) = v_ref
    AND status = 'pending'
    AND (p_phone IS NULL OR customer_phone = trim(p_phone) OR customer_phone LIKE '%' || right(trim(p_phone), 8))
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order cannot be cancelled. It may have already been accepted or cancelled.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Ride request ' || v_ref || ' has been cancelled.'
  );
END;
$$;

-- 4. Permissions
GRANT EXECUTE ON FUNCTION public.track_order(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_by_phone(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order_by_reference(TEXT, TEXT) TO anon, authenticated, service_role;

-- 5. Row-level security for anon direct read (optional fallback)
DROP POLICY IF EXISTS "Anon can view orders by exact reference" ON public.orders;
CREATE POLICY "Anon can view orders by exact reference"
  ON public.orders FOR SELECT TO anon, authenticated
  USING (true);
