-- ==============================================================================
-- MANNA (OKADA BOOK) — COMPLETED RIDE RATINGS & CUSTOMER COMPLAINTS
-- Migration: 20261122000001_order_ratings_and_complaints.sql
-- ==============================================================================

-- 1. Order Ratings Table (one rating per completed order)
CREATE TABLE IF NOT EXISTS public.order_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE UNIQUE,
  order_reference TEXT NOT NULL UNIQUE,
  rider_id UUID NULL REFERENCES public.riders(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_order_ratings_rider ON public.order_ratings(rider_id, created_at DESC);

ALTER TABLE public.order_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on order_ratings" ON public.order_ratings;
CREATE POLICY "Service role full access on order_ratings"
  ON public.order_ratings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view all order ratings" ON public.order_ratings;
CREATE POLICY "Admins can view all order ratings"
  ON public.order_ratings FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Riders can view their own ratings" ON public.order_ratings;
CREATE POLICY "Riders can view their own ratings"
  ON public.order_ratings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = order_ratings.rider_id
        AND r.user_id = auth.uid()
    )
  );

-- 2. Add Rating Aggregates to Riders Table
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3,2) NULL,
  ADD COLUMN IF NOT EXISTS total_ratings INTEGER NOT NULL DEFAULT 0;

-- 3. RPC: Submit Rating for a Completed Order
CREATE OR REPLACE FUNCTION public.submit_order_rating(
  p_order_reference TEXT,
  p_customer_phone TEXT,
  p_rating INTEGER,
  p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_clean_input_phone TEXT;
  v_clean_order_phone TEXT;
  v_avg NUMERIC(3,2);
  v_cnt INTEGER;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rating must be between 1 and 5 stars.');
  END IF;

  SELECT id, order_reference, customer_phone, rider_id, status
  INTO v_order
  FROM public.orders
  WHERE upper(order_reference) = upper(trim(p_order_reference))
  LIMIT 1;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found.');
  END IF;

  IF v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only rate completed rides.');
  END IF;

  v_clean_input_phone := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_order_phone := regexp_replace(coalesce(v_order.customer_phone, ''), '[^0-9]', '', 'g');
  IF right(v_clean_input_phone, 9) <> right(v_clean_order_phone, 9) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Phone number does not match this order.');
  END IF;

  INSERT INTO public.order_ratings (
    order_id,
    order_reference,
    rider_id,
    customer_phone,
    rating,
    review_note
  ) VALUES (
    v_order.id,
    v_order.order_reference,
    v_order.rider_id,
    v_order.customer_phone,
    p_rating,
    NULLIF(left(trim(coalesce(p_review_note, '')), 400), '')
  )
  ON CONFLICT (order_id) DO UPDATE SET
    rating = EXCLUDED.rating,
    review_note = EXCLUDED.review_note;

  -- Update rider aggregate rating
  IF v_order.rider_id IS NOT NULL THEN
    SELECT ROUND(AVG(rating)::numeric, 2), COUNT(*)::integer
    INTO v_avg, v_cnt
    FROM public.order_ratings
    WHERE rider_id = v_order.rider_id;

    UPDATE public.riders
    SET average_rating = v_avg, total_ratings = v_cnt
    WHERE id = v_order.rider_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rating', p_rating,
    'order_reference', v_order.order_reference
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_order_rating(TEXT, TEXT, INTEGER, TEXT) TO anon, authenticated;

-- 4. RPC: Submit Customer Complaint for a Completed Order (feeds directly into Admin Disputes)
CREATE OR REPLACE FUNCTION public.submit_order_complaint(
  p_order_reference TEXT,
  p_customer_phone TEXT,
  p_category TEXT,
  p_description TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_clean_input_phone TEXT;
  v_clean_order_phone TEXT;
  v_category TEXT;
  v_dispute_ref TEXT;
BEGIN
  IF trim(coalesce(p_description, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please describe your complaint.');
  END IF;

  SELECT id, order_reference, customer_phone, status
  INTO v_order
  FROM public.orders
  WHERE upper(order_reference) = upper(trim(p_order_reference))
  LIMIT 1;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found.');
  END IF;

  IF v_order.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Complaints can be submitted for completed rides.');
  END IF;

  v_clean_input_phone := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_order_phone := regexp_replace(coalesce(v_order.customer_phone, ''), '[^0-9]', '', 'g');
  IF right(v_clean_input_phone, 9) <> right(v_clean_order_phone, 9) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Phone number does not match this order.');
  END IF;

  -- Prevent duplicate complaint spam for the same order
  SELECT dispute_reference INTO v_dispute_ref
  FROM public.disputes
  WHERE order_id = v_order.id
    AND reporter_type = 'customer'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_dispute_ref IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'dispute_reference', v_dispute_ref,
      'order_reference', v_order.order_reference,
      'already_reported', true
    );
  END IF;

  v_category := CASE
    WHEN p_category IN (
      'rider_did_not_arrive',
      'payment_disagreement',
      'unsafe_driving',
      'wrong_destination',
      'service_quality',
      'other'
    ) THEN p_category
    ELSE 'other'
  END;

  v_dispute_ref := 'DSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.disputes (
    dispute_reference,
    order_id,
    order_reference,
    reporter_type,
    reporter_phone,
    category,
    description,
    status
  ) VALUES (
    v_dispute_ref,
    v_order.id,
    v_order.order_reference,
    'customer',
    v_order.customer_phone,
    v_category,
    left(trim(p_description), 1000),
    'open'
  );

  -- Notify Admin portal via push_notifications table
  BEGIN
    INSERT INTO public.push_notifications (
      recipient_type,
      title,
      body,
      order_reference,
      recipient_phone,
      data
    ) VALUES (
      'admin',
      'New Ride Complaint: ' || v_order.order_reference,
      left(trim(p_description), 140),
      v_order.order_reference,
      v_order.customer_phone,
      jsonb_build_object('type', 'customer_complaint', 'disputeReference', v_dispute_ref, 'category', v_category)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'dispute_reference', v_dispute_ref,
    'order_reference', v_order.order_reference
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_order_complaint(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- 5. Public RPC: Get Rider Rating Summary (used on customer tracking card when rider accepts)
CREATE OR REPLACE FUNCTION public.get_rider_rating_summary(p_rider_id UUID)
RETURNS TABLE(average_rating NUMERIC, total_ratings INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.average_rating, coalesce(r.total_ratings, 0)::integer
  FROM public.riders r
  WHERE r.id = p_rider_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_rider_rating_summary(UUID) TO anon, authenticated;

-- 6. Update admin_get_all_riders() to include average_rating and total_ratings
DROP FUNCTION IF EXISTS public.admin_get_all_riders();
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
  average_rating NUMERIC,
  total_ratings INTEGER,
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
    r.average_rating,
    coalesce(r.total_ratings, 0)::integer AS total_ratings,
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

-- 7. Security Fix: Harden public.fcm_tokens UPDATE/DELETE RLS (remove token = token tautology)
DROP POLICY IF EXISTS "Token owners or admins can update tokens" ON public.fcm_tokens;
CREATE POLICY "Token owners or admins can update tokens"
  ON public.fcm_tokens
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin() OR (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  )
  WITH CHECK (
    public.is_admin() OR (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  );

DROP POLICY IF EXISTS "Token owners or admins can delete tokens" ON public.fcm_tokens;
CREATE POLICY "Token owners or admins can delete tokens"
  ON public.fcm_tokens
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin() OR (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  );
