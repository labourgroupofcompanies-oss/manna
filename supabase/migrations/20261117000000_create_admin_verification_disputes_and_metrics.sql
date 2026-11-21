-- ==============================================================================
-- OKADA BOOK — STAGE 5: ADMIN PORTAL ADVANCED METRICS, VERIFICATION & DISPUTES
-- Migration: 20261117000000_create_admin_verification_disputes_and_metrics.sql
-- Description: Adds rider verification workflow, sensitive document storage,
--              disputes management, tamper-evident audit logging, and updates
--              dispatch RPCs to enforce rider verification before accepting orders.
-- ==============================================================================

-- 1. Add Rider Verification Columns to public.riders
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected', 'suspended')),
  ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS verified_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_riders_verification_status ON public.riders(verification_status);
CREATE INDEX IF NOT EXISTS idx_riders_verification_submitted ON public.riders(verification_submitted_at DESC);

-- 2. Create rider_verification_documents Table
CREATE TABLE IF NOT EXISTS public.rider_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('national_id', 'drivers_license', 'motorcycle_insurance', 'roadworthiness', 'other')),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  verified_at TIMESTAMPTZ NULL,
  notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_rider_docs_rider_id ON public.rider_verification_documents(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_docs_status ON public.rider_verification_documents(verification_status);

ALTER TABLE public.rider_verification_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on rider docs" ON public.rider_verification_documents;
CREATE POLICY "Service role full access on rider docs"
  ON public.rider_verification_documents
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view all rider verification docs" ON public.rider_verification_documents;
CREATE POLICY "Admins can view all rider verification docs"
  ON public.rider_verification_documents
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update all rider verification docs" ON public.rider_verification_documents;
CREATE POLICY "Admins can update all rider verification docs"
  ON public.rider_verification_documents
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Riders can view own verification docs" ON public.rider_verification_documents;
CREATE POLICY "Riders can view own verification docs"
  ON public.rider_verification_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = rider_verification_documents.rider_id
        AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Riders can upload own verification docs" ON public.rider_verification_documents;
CREATE POLICY "Riders can upload own verification docs"
  ON public.rider_verification_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = rider_verification_documents.rider_id
        AND r.user_id = auth.uid()
    )
    AND verification_status = 'pending'
  );

-- 3. Create disputes Table
CREATE TABLE IF NOT EXISTS public.disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_reference TEXT NOT NULL UNIQUE,
  order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  order_reference TEXT NULL,
  reporter_type TEXT NOT NULL CHECK (reporter_type IN ('customer', 'rider', 'admin')),
  reporter_phone TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'rider_did_not_arrive',
      'customer_unavailable',
      'payment_disagreement',
      'unsafe_driving',
      'wrong_destination',
      'service_quality',
      'other'
    )
  ),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'awaiting_response', 'resolved', 'closed')),
  resolution_notes TEXT NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_disputes_reference ON public.disputes(dispute_reference);
CREATE INDEX IF NOT EXISTS idx_disputes_order_id ON public.disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON public.disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_created_at ON public.disputes(created_at DESC);

DROP TRIGGER IF EXISTS trg_disputes_updated_at ON public.disputes;
CREATE TRIGGER trg_disputes_updated_at
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on disputes" ON public.disputes;
CREATE POLICY "Service role full access on disputes"
  ON public.disputes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view all disputes" ON public.disputes;
CREATE POLICY "Admins can view all disputes"
  ON public.disputes
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update all disputes" ON public.disputes;
CREATE POLICY "Admins can update all disputes"
  ON public.disputes
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert disputes" ON public.disputes;
CREATE POLICY "Admins can insert disputes"
  ON public.disputes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- 4. Create dispute_updates Table (Audit trail of notes & status changes)
CREATE TABLE IF NOT EXISTS public.dispute_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  update_type TEXT NOT NULL CHECK (update_type IN ('status_change', 'note', 'resolution')),
  old_status TEXT NULL,
  new_status TEXT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_dispute_updates_dispute ON public.dispute_updates(dispute_id, created_at DESC);

ALTER TABLE public.dispute_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on dispute updates" ON public.dispute_updates;
CREATE POLICY "Service role full access on dispute updates"
  ON public.dispute_updates
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view dispute updates" ON public.dispute_updates;
CREATE POLICY "Admins can view dispute updates"
  ON public.dispute_updates
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert dispute updates" ON public.dispute_updates;
CREATE POLICY "Admins can insert dispute updates"
  ON public.dispute_updates
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- 5. Create admin_audit_logs Table (Tamper-evident system activity log)
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NULL,
  reason TEXT NULL,
  metadata JSONB NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON public.admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON public.admin_audit_logs(target_type, target_id);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on admin audit logs" ON public.admin_audit_logs;
CREATE POLICY "Service role full access on admin audit logs"
  ON public.admin_audit_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view admin audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can view admin audit logs"
  ON public.admin_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert admin audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can insert admin audit logs"
  ON public.admin_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Strictly forbid UPDATE and DELETE on audit logs by non-service-roles
-- (No UPDATE or DELETE policies are granted to authenticated role)

-- 6. Storage Bucket for Private Sensitive Rider Verification Documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rider-documents',
  'rider-documents',
  false, -- Strictly private
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS "Admins can read all rider documents" ON storage.objects;
CREATE POLICY "Admins can read all rider documents"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rider-documents' AND public.is_admin());

DROP POLICY IF EXISTS "Riders can read own verification documents" ON storage.objects;
CREATE POLICY "Riders can read own verification documents"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'rider-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Riders can upload own verification documents" ON storage.objects;
CREATE POLICY "Riders can upload own verification documents"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'rider-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 7. Update RPC Function: accept_order()
-- Enforces: caller authenticated, rider profile exists, rider is APPROVED,
-- rider is ONLINE, order is pending and unassigned. Concurrency-safe atomic update.
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

  -- C. Enforce Verification Approval: ONLY approved riders can accept orders
  IF v_verification_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Rider account is ' || COALESCE(v_verification_status, 'unverified') || '. Only approved riders are eligible to accept orders.'
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

-- 8. Update RPC Function: get_available_orders()
-- Enforces: only online AND approved riders can see pending requests
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

  -- Strictly require rider to exist, be online, and be approved
  IF v_rider_id IS NULL OR v_is_available IS NOT TRUE OR v_verification_status IS DISTINCT FROM 'approved' THEN
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

-- 9. Comprehensive Admin Metrics RPC Function
CREATE OR REPLACE FUNCTION public.get_admin_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_is_admin BOOLEAN;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_today_start TIMESTAMPTZ := date_trunc('day', v_now);
  v_week_start TIMESTAMPTZ := date_trunc('week', v_now);
  v_month_start TIMESTAMPTZ := date_trunc('month', v_now);

  v_total_orders BIGINT := 0;
  v_pending_orders BIGINT := 0;
  v_accepted_orders BIGINT := 0;
  v_completed_orders BIGINT := 0;
  v_cancelled_orders BIGINT := 0;
  v_today_orders BIGINT := 0;
  v_week_orders BIGINT := 0;
  v_month_orders BIGINT := 0;

  v_total_riders BIGINT := 0;
  v_online_riders BIGINT := 0;
  v_offline_riders BIGINT := 0;
  v_verified_riders BIGINT := 0;
  v_pending_riders BIGINT := 0;
  v_rejected_riders BIGINT := 0;
  v_suspended_riders BIGINT := 0;

  v_total_customers BIGINT := 0;
  v_total_disputes BIGINT := 0;
  v_open_disputes BIGINT := 0;

  v_avg_acceptance_sec NUMERIC := NULL;
  v_avg_completion_sec NUMERIC := NULL;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT public.is_admin(v_caller_uid) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator access required.');
  END IF;

  -- Orders metrics
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'accepted'),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COUNT(*) FILTER (WHERE created_at >= v_today_start),
    COUNT(*) FILTER (WHERE created_at >= v_week_start),
    COUNT(*) FILTER (WHERE created_at >= v_month_start),
    COUNT(DISTINCT customer_phone),
    ROUND(AVG(EXTRACT(EPOCH FROM (accepted_at - created_at))) FILTER (WHERE accepted_at IS NOT NULL AND accepted_at >= created_at)::NUMERIC, 1),
    ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - accepted_at))) FILTER (WHERE completed_at IS NOT NULL AND accepted_at IS NOT NULL AND completed_at >= accepted_at)::NUMERIC, 1)
  INTO
    v_total_orders,
    v_pending_orders,
    v_accepted_orders,
    v_completed_orders,
    v_cancelled_orders,
    v_today_orders,
    v_week_orders,
    v_month_orders,
    v_total_customers,
    v_avg_acceptance_sec,
    v_avg_completion_sec
  FROM public.orders;

  -- Riders metrics
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE is_available = true),
    COUNT(*) FILTER (WHERE is_available = false),
    COUNT(*) FILTER (WHERE verification_status = 'approved'),
    COUNT(*) FILTER (WHERE verification_status = 'pending'),
    COUNT(*) FILTER (WHERE verification_status = 'rejected'),
    COUNT(*) FILTER (WHERE verification_status = 'suspended')
  INTO
    v_total_riders,
    v_online_riders,
    v_offline_riders,
    v_verified_riders,
    v_pending_riders,
    v_rejected_riders,
    v_suspended_riders
  FROM public.riders;

  -- Disputes metrics
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('open', 'investigating', 'awaiting_response'))
  INTO
    v_total_disputes,
    v_open_disputes
  FROM public.disputes;

  RETURN jsonb_build_object(
    'success', true,
    'metrics', jsonb_build_object(
      'totalOrders', v_total_orders,
      'pendingOrders', v_pending_orders,
      'acceptedOrders', v_accepted_orders,
      'completedOrders', v_completed_orders,
      'cancelledOrders', v_cancelled_orders,
      'todayOrders', v_today_orders,
      'weekOrders', v_week_orders,
      'monthOrders', v_month_orders,
      'totalRiders', v_total_riders,
      'onlineRiders', v_online_riders,
      'offlineRiders', v_offline_riders,
      'verifiedRiders', v_verified_riders,
      'pendingRiders', v_pending_riders,
      'rejectedRiders', v_rejected_riders,
      'suspendedRiders', v_suspended_riders,
      'totalCustomers', v_total_customers,
      'totalDisputes', v_total_disputes,
      'openDisputes', v_open_disputes,
      'avgAcceptanceSeconds', v_avg_acceptance_sec,
      'avgCompletionSeconds', v_avg_completion_sec
    )
  );
END;
$$;

-- 10. Admin Action Helper: Update Rider Verification with Audit Log
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

  UPDATE public.riders
  SET verification_status = p_status,
      verified_at = CASE WHEN p_status = 'approved' THEN timezone('utc'::text, now()) ELSE verified_at END,
      verified_by = v_caller_uid,
      verification_notes = p_notes,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_rider_id;

  -- Record in audit log
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
    'message', 'Rider verification status updated to ' || p_status
  );
END;
$$;

-- 11. Authorize RPC Permissions
REVOKE EXECUTE ON FUNCTION public.admin_set_rider_verification(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_rider_verification(UUID, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_metrics() TO authenticated;
