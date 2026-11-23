-- ==============================================================================
-- MANNA (OKADA BOOK) — MANUAL MOBILE MONEY (MoMo) WALLET TOP-UP SYSTEM
-- Migration: 20261122000003_manual_momo_topups.sql
-- Features:
--   • 0% gateway fees, works with MTN MoMo, Telecel Cash, and AT Money
--   • No business registration required
--   • Duplicate MoMo Transaction ID protection (UNIQUE)
--   • 1-click Admin verification that atomically credits riders.wallet_balance
-- ==============================================================================

-- 1. Platform Payment Settings (Single-row config editable from Admin Portal)
CREATE TABLE IF NOT EXISTS public.platform_payment_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  momo_number TEXT NOT NULL DEFAULT '0245660622',
  momo_name TEXT NOT NULL DEFAULT 'Labour App Enterprise',
  momo_network TEXT NOT NULL DEFAULT 'MTN MoMo',
  fee_per_ride NUMERIC(10,2) NOT NULL DEFAULT 3.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.platform_payment_settings (id, momo_number, momo_name, momo_network, fee_per_ride)
VALUES (1, '0245660622', 'Labour App Enterprise', 'MTN MoMo', 3.00)
ON CONFLICT (id) DO UPDATE SET
  momo_number = EXCLUDED.momo_number,
  momo_name = EXCLUDED.momo_name,
  momo_network = EXCLUDED.momo_network;

ALTER TABLE public.platform_payment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read payment settings" ON public.platform_payment_settings;
CREATE POLICY "Authenticated users can read payment settings"
  ON public.platform_payment_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can update payment settings" ON public.platform_payment_settings;
CREATE POLICY "Admins can update payment settings"
  ON public.platform_payment_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 2. Manual MoMo Top-Up Requests Table
CREATE TABLE IF NOT EXISTS public.manual_topup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 3.00 AND amount <= 5000.00),
  momo_network TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_manual_topups_status ON public.manual_topup_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_topups_rider ON public.manual_topup_requests(rider_id, created_at DESC);

ALTER TABLE public.manual_topup_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on manual_topup_requests" ON public.manual_topup_requests;
CREATE POLICY "Service role full access on manual_topup_requests"
  ON public.manual_topup_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Riders can view own manual topup requests" ON public.manual_topup_requests;
CREATE POLICY "Riders can view own manual topup requests"
  ON public.manual_topup_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = manual_topup_requests.rider_id
        AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can manage all manual topup requests" ON public.manual_topup_requests;
CREATE POLICY "Admins can manage all manual topup requests"
  ON public.manual_topup_requests FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3. Rider RPC: Submit a Manual MoMo Top-Up Request
CREATE OR REPLACE FUNCTION public.submit_manual_topup_request(
  p_amount NUMERIC,
  p_momo_network TEXT,
  p_sender_phone TEXT,
  p_transaction_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rider RECORD;
  v_clean_tx TEXT;
  v_existing UUID;
  v_req_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF p_amount IS NULL OR p_amount < 3 OR p_amount > 5000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be between GH₵ 3.00 and GH₵ 5,000.00.');
  END IF;

  v_clean_tx := upper(regexp_replace(trim(coalesce(p_transaction_id, '')), '\s+', '', 'g'));
  IF length(v_clean_tx) < 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please enter a valid MoMo Transaction ID from your SMS receipt.');
  END IF;

  SELECT id, full_name, phone_number INTO v_rider
  FROM public.riders
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_rider.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider profile not found.');
  END IF;

  -- Prevent duplicate transaction ID reuse
  SELECT id INTO v_existing
  FROM public.manual_topup_requests
  WHERE upper(transaction_id) = v_clean_tx
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This MoMo Transaction ID has already been submitted.');
  END IF;

  INSERT INTO public.manual_topup_requests (
    rider_id,
    amount,
    momo_network,
    sender_phone,
    transaction_id,
    status
  ) VALUES (
    v_rider.id,
    ROUND(p_amount::numeric, 2),
    left(trim(coalesce(p_momo_network, 'MTN MoMo')), 40),
    left(trim(coalesce(p_sender_phone, v_rider.phone_number)), 30),
    v_clean_tx,
    'pending'
  )
  RETURNING id INTO v_req_id;

  -- Alert Admin Portal via push_notifications table
  BEGIN
    INSERT INTO public.push_notifications (
      recipient_type,
      title,
      body,
      recipient_phone,
      data
    ) VALUES (
      'admin',
      'MoMo Top-Up Request: GH₵ ' || ROUND(p_amount::numeric, 2)::text,
      v_rider.full_name || ' sent TxID ' || v_clean_tx || ' (' || trim(coalesce(p_momo_network, 'MTN MoMo')) || ')',
      v_rider.phone_number,
      jsonb_build_object('type', 'manual_topup_request', 'requestId', v_req_id, 'transactionId', v_clean_tx)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_req_id,
    'message', 'Top-up submitted! Manna Support will confirm your MoMo payment and credit your wallet shortly.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_manual_topup_request(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- 4. Admin RPC: Approve or Reject a Manual MoMo Top-Up Request
CREATE OR REPLACE FUNCTION public.admin_review_manual_topup(
  p_request_id UUID,
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
  v_ref_key TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized.');
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Decision must be approved or rejected.');
  END IF;

  SELECT * INTO v_req
  FROM public.manual_topup_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Top-up request not found.');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This top-up request has already been reviewed.');
  END IF;

  UPDATE public.manual_topup_requests
  SET status = p_decision,
      review_notes = NULLIF(trim(coalesce(p_notes, '')), ''),
      reviewed_at = timezone('utc'::text, now()),
      reviewed_by = auth.uid()
  WHERE id = v_req.id;

  IF p_decision = 'approved' THEN
    SELECT id, user_id, wallet_balance INTO v_rider
    FROM public.riders
    WHERE id = v_req.rider_id
    FOR UPDATE;

    v_new_balance := coalesce(v_rider.wallet_balance, 0) + v_req.amount;
    v_ref_key := 'MOMO_' || v_req.transaction_id;

    UPDATE public.riders
    SET wallet_balance = v_new_balance,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_rider.id;

    INSERT INTO public.wallet_transactions (
      rider_id, type, amount, balance_after, paystack_reference, description
    ) VALUES (
      v_rider.id,
      'topup',
      v_req.amount,
      v_new_balance,
      v_ref_key,
      'MoMo Top-Up (' || v_req.momo_network || ' • ' || v_req.transaction_id || ')'
    );

    -- Notify rider that their wallet has been credited
    BEGIN
      INSERT INTO public.push_notifications (
        recipient_type,
        recipient_id,
        title,
        body,
        data
      ) VALUES (
        'rider',
        v_rider.user_id,
        'Wallet Credited: +GH₵ ' || v_req.amount::text,
        'Your MoMo top-up has been confirmed. New balance: GH₵ ' || v_new_balance::text,
        jsonb_build_object('type', 'wallet_credited', 'amount', v_req.amount, 'balance', v_new_balance)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_decision);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_manual_topup(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_manual_topup(UUID, TEXT, TEXT) TO authenticated;

-- 5. Admin RPC: Update Manna MoMo Number & Name
CREATE OR REPLACE FUNCTION public.admin_update_payment_settings(
  p_momo_number TEXT,
  p_momo_name TEXT,
  p_momo_network TEXT DEFAULT 'MTN MoMo'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized.');
  END IF;

  INSERT INTO public.platform_payment_settings (id, momo_number, momo_name, momo_network, updated_at)
  VALUES (1, trim(p_momo_number), trim(p_momo_name), trim(coalesce(p_momo_network, 'MTN MoMo')), timezone('utc'::text, now()))
  ON CONFLICT (id) DO UPDATE SET
    momo_number = EXCLUDED.momo_number,
    momo_name = EXCLUDED.momo_name,
    momo_network = EXCLUDED.momo_network,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_payment_settings(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_payment_settings(TEXT, TEXT, TEXT) TO authenticated;
