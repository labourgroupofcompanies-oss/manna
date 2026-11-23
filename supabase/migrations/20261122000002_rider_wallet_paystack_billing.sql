-- ==============================================================================
-- MANNA (OKADA BOOK) — RIDER PREPAID WALLET, PAYSTACK TOP-UP & GH₵ 3.00 BILLING
-- Migration: 20261122000002_rider_wallet_paystack_billing.sql
-- Business Rules:
--   • Every new rider starts with 2 FREE customer approvals (GH₵ 0.00).
--   • Starting from the 3rd customer approval, GH₵ 3.00 is deducted atomically
--     from the rider's prepaid wallet inside accept_order().
--   • Top-ups are credited ONLY via verified Paystack server-side Edge Functions.
--   • Accepted orders are NOT auto-refunded; riders can submit a refund request
--     for support review and 1-click wallet credit.
-- ==============================================================================

-- 1. Add Wallet & Free Ride Columns to Riders
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS free_rides_remaining INTEGER NOT NULL DEFAULT 2;

-- 2. Wallet Transactions Ledger (Tamper-Proof Audit Trail)
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  order_reference TEXT NULL,
  type TEXT NOT NULL CHECK (type IN ('topup', 'order_commission', 'free_ride', 'refund', 'adjustment')),
  amount NUMERIC(10,2) NOT NULL,
  balance_after NUMERIC(10,2) NOT NULL,
  paystack_reference TEXT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_rider ON public.wallet_transactions(rider_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_paystack_ref ON public.wallet_transactions(paystack_reference) WHERE paystack_reference IS NOT NULL;

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on wallet_transactions" ON public.wallet_transactions;
CREATE POLICY "Service role full access on wallet_transactions"
  ON public.wallet_transactions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Riders can view own wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Riders can view own wallet transactions"
  ON public.wallet_transactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = wallet_transactions.rider_id
        AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view all wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Admins can view all wallet transactions"
  ON public.wallet_transactions FOR SELECT TO authenticated
  USING (public.is_admin());

-- 3. Refund Requests Table (1 request max per order)
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE UNIQUE,
  order_reference TEXT NOT NULL,
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('wallet', 'free_ride')),
  amount NUMERIC(10,2) NOT NULL DEFAULT 3.00,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON public.refund_requests(status, created_at DESC);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on refund_requests" ON public.refund_requests;
CREATE POLICY "Service role full access on refund_requests"
  ON public.refund_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Riders can view own refund requests" ON public.refund_requests;
CREATE POLICY "Riders can view own refund requests"
  ON public.refund_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = refund_requests.rider_id
        AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can manage all refund requests" ON public.refund_requests;
CREATE POLICY "Admins can manage all refund requests"
  ON public.refund_requests FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 4. Atomic accept_order() with 2 Free Rides + GH₵ 3.00 Commission Deduction
CREATE OR REPLACE FUNCTION public.accept_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rider RECORD;
  v_order RECORD;
  v_fee NUMERIC(10,2) := 3.00;
  v_new_balance NUMERIC(10,2);
  v_new_free INTEGER;
  v_used_free BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- Lock rider row to prevent concurrent double-spending
  SELECT id, is_available, verification_status, wallet_balance, free_rides_remaining
  INTO v_rider
  FROM public.riders
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_rider.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider profile not found.');
  END IF;

  IF v_rider.verification_status IN ('suspended', 'rejected') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Your rider account is currently restricted. Please contact support.'
    );
  END IF;

  IF NOT v_rider.is_available THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be Online to accept orders.');
  END IF;

  -- Check if rider has free rides OR at least GH₵ 3.00 balance
  IF coalesce(v_rider.free_rides_remaining, 0) > 0 THEN
    v_used_free := true;
  ELSIF coalesce(v_rider.wallet_balance, 0) < v_fee THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INSUFFICIENT_BALANCE',
      'wallet_balance', coalesce(v_rider.wallet_balance, 0),
      'required_fee', v_fee,
      'error', 'Low wallet balance. You need at least GH₵ 3.00 to accept this ride. Tap Top Up to add funds via MoMo.'
    );
  END IF;

  -- Atomic Order Assignment (only 1 rider can ever win this row)
  UPDATE public.orders
  SET status = 'accepted',
      rider_id = v_rider.id,
      accepted_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id
    AND status = 'pending'
    AND rider_id IS NULL
  RETURNING id, order_reference, customer_phone, order_type, order_description, voice_recording_path, status, created_at, accepted_at
  INTO v_order;

  -- If another rider won the order first, exit immediately WITHOUT charging this rider
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order has already been taken by another rider or cancelled.'
    );
  END IF;

  -- Deduct 1 free ride OR GH₵ 3.00 from wallet
  IF v_used_free THEN
    v_new_free := GREATEST(0, coalesce(v_rider.free_rides_remaining, 0) - 1);
    v_new_balance := coalesce(v_rider.wallet_balance, 0);

    UPDATE public.riders
    SET free_rides_remaining = v_new_free,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_rider.id;

    INSERT INTO public.wallet_transactions (
      rider_id, order_id, order_reference, type, amount, balance_after, description
    ) VALUES (
      v_rider.id, v_order.id, v_order.order_reference, 'free_ride', 0.00, v_new_balance,
      'Free welcome ride used (' || v_order.order_reference || ')'
    );
  ELSE
    v_new_free := 0;
    v_new_balance := coalesce(v_rider.wallet_balance, 0) - v_fee;

    UPDATE public.riders
    SET wallet_balance = v_new_balance,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_rider.id;

    INSERT INTO public.wallet_transactions (
      rider_id, order_id, order_reference, type, amount, balance_after, description
    ) VALUES (
      v_rider.id, v_order.id, v_order.order_reference, 'order_commission', -v_fee, v_new_balance,
      'Ride approval fee (' || v_order.order_reference || ')'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'walletBalance', v_new_balance,
    'freeRidesRemaining', v_new_free,
    'chargedAmount', CASE WHEN v_used_free THEN 0.00 ELSE v_fee END,
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

GRANT EXECUTE ON FUNCTION public.accept_order(UUID) TO authenticated;

-- 5. Server-Only RPC: Credit Rider Wallet After Paystack Verification (Idempotent)
CREATE OR REPLACE FUNCTION public.credit_rider_wallet_paystack(
  p_rider_id UUID,
  p_amount NUMERIC,
  p_paystack_ref TEXT,
  p_description TEXT DEFAULT 'Paystack MoMo/Card top-up'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing RECORD;
  v_rider RECORD;
  v_new_balance NUMERIC(10,2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid top-up amount.');
  END IF;

  -- Idempotency check: if already credited, return current balance without double-crediting
  SELECT id, balance_after INTO v_existing
  FROM public.wallet_transactions
  WHERE paystack_reference = p_paystack_ref
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_credited', true,
      'wallet_balance', v_existing.balance_after
    );
  END IF;

  SELECT id, wallet_balance INTO v_rider
  FROM public.riders
  WHERE id = p_rider_id
  FOR UPDATE;

  IF v_rider.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider not found.');
  END IF;

  v_new_balance := coalesce(v_rider.wallet_balance, 0) + ROUND(p_amount::numeric, 2);

  UPDATE public.riders
  SET wallet_balance = v_new_balance,
      updated_at = timezone('utc'::text, now())
  WHERE id = v_rider.id;

  INSERT INTO public.wallet_transactions (
    rider_id, type, amount, balance_after, paystack_reference, description
  ) VALUES (
    v_rider.id, 'topup', ROUND(p_amount::numeric, 2), v_new_balance, p_paystack_ref, p_description
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_credited', false,
    'wallet_balance', v_new_balance
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_rider_wallet_paystack(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_rider_wallet_paystack(UUID, NUMERIC, TEXT, TEXT) TO service_role;

-- 6. Rider RPC: Request Refund on Cancelled / No-Show Accepted Order
CREATE OR REPLACE FUNCTION public.request_order_refund(
  p_order_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rider_id UUID;
  v_order RECORD;
  v_tx RECORD;
  v_existing UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF trim(coalesce(p_reason, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please select or enter a reason.');
  END IF;

  SELECT id INTO v_rider_id FROM public.riders WHERE user_id = auth.uid() LIMIT 1;
  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider profile not found.');
  END IF;

  SELECT id, order_reference, rider_id, status INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND rider_id = v_rider_id
  LIMIT 1;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found for your account.');
  END IF;

  SELECT id INTO v_existing FROM public.refund_requests WHERE order_id = v_order.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_requested', true, 'message', 'A refund request is already submitted for this order.');
  END IF;

  -- Check whether this order used a free ride or GH₵ 3.00 wallet deduction
  SELECT type, abs(amount) AS charged INTO v_tx
  FROM public.wallet_transactions
  WHERE order_id = v_order.id AND rider_id = v_rider_id AND type IN ('order_commission', 'free_ride')
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.refund_requests (
    order_id,
    order_reference,
    rider_id,
    reason,
    charge_type,
    amount
  ) VALUES (
    v_order.id,
    v_order.order_reference,
    v_rider_id,
    left(trim(p_reason), 400),
    CASE WHEN v_tx.type = 'free_ride' THEN 'free_ride' ELSE 'wallet' END,
    CASE WHEN v_tx.type = 'free_ride' THEN 0.00 ELSE coalesce(v_tx.charged, 3.00) END
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Refund request submitted. Support will review and update your wallet.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_order_refund(UUID, TEXT) TO authenticated;

-- 7. Admin RPC: Approve or Reject Refund Request (1-Click Credit)
CREATE OR REPLACE FUNCTION public.admin_review_refund_request(
  p_refund_id UUID,
  p_decision TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_rider RECORD;
  v_new_balance NUMERIC(10,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized.');
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Decision must be approved or rejected.');
  END IF;

  SELECT * INTO v_req FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Refund request not found.');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Refund request has already been reviewed.');
  END IF;

  UPDATE public.refund_requests
  SET status = p_decision,
      review_notes = NULLIF(trim(coalesce(p_notes, '')), ''),
      reviewed_at = timezone('utc'::text, now()),
      reviewed_by = auth.uid()
  WHERE id = v_req.id;

  IF p_decision = 'approved' THEN
    SELECT id, wallet_balance, free_rides_remaining INTO v_rider
    FROM public.riders WHERE id = v_req.rider_id FOR UPDATE;

    IF v_req.charge_type = 'free_ride' THEN
      UPDATE public.riders
      SET free_rides_remaining = coalesce(free_rides_remaining, 0) + 1,
          updated_at = timezone('utc'::text, now())
      WHERE id = v_rider.id;

      INSERT INTO public.wallet_transactions (
        rider_id, order_id, order_reference, type, amount, balance_after, description
      ) VALUES (
        v_rider.id, v_req.order_id, v_req.order_reference, 'refund', 0.00, coalesce(v_rider.wallet_balance, 0),
        'Free ride restored (' || v_req.order_reference || ')'
      );
    ELSE
      v_new_balance := coalesce(v_rider.wallet_balance, 0) + v_req.amount;

      UPDATE public.riders
      SET wallet_balance = v_new_balance,
          updated_at = timezone('utc'::text, now())
      WHERE id = v_rider.id;

      INSERT INTO public.wallet_transactions (
        rider_id, order_id, order_reference, type, amount, balance_after, description
      ) VALUES (
        v_rider.id, v_req.order_id, v_req.order_reference, 'refund', v_req.amount, v_new_balance,
        'Ride fee refunded (' || v_req.order_reference || ')'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_decision);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_refund_request(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_refund_request(UUID, TEXT, TEXT) TO authenticated;

-- 8. Update admin_get_all_riders() to include wallet_balance and free_rides_remaining
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
  wallet_balance NUMERIC,
  free_rides_remaining INTEGER,
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
    coalesce(r.wallet_balance, 0.00)::numeric AS wallet_balance,
    coalesce(r.free_rides_remaining, 0)::integer AS free_rides_remaining,
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
