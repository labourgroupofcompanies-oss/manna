-- ==============================================================================
-- MIGRATION: 20261119000002_fix_tracking_rider_photo_url.sql
-- Description: Ensures customer order tracking RPCs (track_order and get_orders_by_phone)
--              properly expose the assigned rider's profile_photo_path and riderPhotoUrl
--              so the customer tracking page displays the rider's verification image.
-- ==============================================================================

-- 1. Ensure track_order includes both riderPhotoUrl and profilePhotoPath
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

-- 2. Ensure get_orders_by_phone includes riderPhotoUrl and profilePhotoPath
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

-- 3. Grant execute permissions to anon and authenticated callers
GRANT EXECUTE ON FUNCTION public.track_order(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_by_phone(TEXT) TO anon, authenticated, service_role;
