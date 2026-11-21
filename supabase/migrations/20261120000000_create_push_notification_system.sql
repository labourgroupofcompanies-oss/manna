-- ==============================================================================
-- OKADA BOOK — FIREBASE PUSH NOTIFICATION SYSTEM MIGRATION
-- Migration: 20261120000000_create_push_notification_system.sql
-- Description: Establishes FCM token storage, push notification logs,
--              realtime triggers, RPCs, and RLS security policies for
--              Customers, Riders, and Admins.
-- ==============================================================================

-- 1. Create FCM Tokens table
CREATE TABLE IF NOT EXISTS public.fcm_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  user_type TEXT NOT NULL CHECK (user_type IN ('customer', 'rider', 'admin')),
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT NULL,
  order_reference TEXT NULL,
  device_info JSONB NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for lightning fast token lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_fcm_tokens_token ON public.fcm_tokens(token);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_type ON public.fcm_tokens(user_type);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_id ON public.fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_phone ON public.fcm_tokens(phone_number);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_order_ref ON public.fcm_tokens(order_reference);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_active ON public.fcm_tokens(is_active) WHERE is_active = true;

-- Attach updated_at trigger
DROP TRIGGER IF EXISTS trg_fcm_tokens_updated_at ON public.fcm_tokens;
CREATE TRIGGER trg_fcm_tokens_updated_at
  BEFORE UPDATE ON public.fcm_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 2. Create Push Notifications history & inbox table
CREATE TABLE IF NOT EXISTS public.push_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'rider', 'admin', 'all')),
  recipient_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_phone TEXT NULL,
  order_reference TEXT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_push_notifications_recipient_type ON public.push_notifications(recipient_type);
CREATE INDEX IF NOT EXISTS idx_push_notifications_recipient_id ON public.push_notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_push_notifications_recipient_phone ON public.push_notifications(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_push_notifications_order_ref ON public.push_notifications(order_reference);
CREATE INDEX IF NOT EXISTS idx_push_notifications_created_at ON public.push_notifications(created_at DESC);

-- Enable Realtime replication for push_notifications so portals receive instant in-app alerts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'push_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.push_notifications;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- 3. Row Level Security for fcm_tokens
ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;

-- Select policies
DROP POLICY IF EXISTS "Admins can view all fcm tokens" ON public.fcm_tokens;
CREATE POLICY "Admins can view all fcm tokens"
  ON public.fcm_tokens
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Users can view their own fcm tokens" ON public.fcm_tokens;
CREATE POLICY "Users can view their own fcm tokens"
  ON public.fcm_tokens
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Insert policy: allow anon and authenticated to register FCM tokens
DROP POLICY IF EXISTS "Anyone can insert FCM tokens" ON public.fcm_tokens;
CREATE POLICY "Anyone can insert FCM tokens"
  ON public.fcm_tokens
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Update policy: token owners and admins can update
DROP POLICY IF EXISTS "Token owners or admins can update tokens" ON public.fcm_tokens;
CREATE POLICY "Token owners or admins can update tokens"
  ON public.fcm_tokens
  FOR UPDATE
  TO anon, authenticated
  USING (
    public.is_admin() OR
    (auth.uid() IS NOT NULL AND auth.uid() = user_id) OR
    token = token
  );

-- Delete policy
DROP POLICY IF EXISTS "Token owners or admins can delete tokens" ON public.fcm_tokens;
CREATE POLICY "Token owners or admins can delete tokens"
  ON public.fcm_tokens
  FOR DELETE
  TO anon, authenticated
  USING (
    public.is_admin() OR
    (auth.uid() IS NOT NULL AND auth.uid() = user_id) OR
    token = token
  );

-- 4. Row Level Security for push_notifications
ALTER TABLE public.push_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all notifications" ON public.push_notifications;
CREATE POLICY "Admins can view all notifications"
  ON public.push_notifications
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Riders can view rider broadcast and their own notifications" ON public.push_notifications;
CREATE POLICY "Riders can view rider broadcast and their own notifications"
  ON public.push_notifications
  FOR SELECT
  TO authenticated
  USING (
    recipient_type = 'all' OR
    recipient_type = 'rider' OR
    (recipient_id IS NOT NULL AND auth.uid() = recipient_id)
  );

DROP POLICY IF EXISTS "Customers and anon can view public order notifications" ON public.push_notifications;
CREATE POLICY "Customers and anon can view public order notifications"
  ON public.push_notifications
  FOR SELECT
  TO anon, authenticated
  USING (
    recipient_type = 'all' OR
    recipient_type = 'customer'
  );

DROP POLICY IF EXISTS "Allow authenticated and anon to record notifications" ON public.push_notifications;
CREATE POLICY "Allow authenticated and anon to record notifications"
  ON public.push_notifications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 5. RPC Functions for FCM Token Management & Notification Dispatch

-- Register or update an FCM token safely
CREATE OR REPLACE FUNCTION public.register_fcm_token(
  p_token TEXT,
  p_user_type TEXT,
  p_phone_number TEXT DEFAULT NULL,
  p_order_reference TEXT DEFAULT NULL,
  p_device_info JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_user_id UUID := NULL;
  v_effective_type TEXT := p_user_type;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token cannot be empty');
  END IF;

  v_caller_uid := auth.uid();

  -- Normalize user type based on caller session
  IF v_caller_uid IS NOT NULL THEN
    IF public.is_admin(v_caller_uid) THEN
      v_effective_type := 'admin';
      v_user_id := v_caller_uid;
    ELSIF EXISTS (SELECT 1 FROM public.riders WHERE user_id = v_caller_uid) THEN
      v_effective_type := 'rider';
      v_user_id := v_caller_uid;
    ELSE
      v_effective_type := COALESCE(p_user_type, 'customer');
      v_user_id := v_caller_uid;
    END IF;
  ELSE
    -- Unauthenticated callers can only register as customers
    v_effective_type := 'customer';
  END IF;

  -- Upsert token
  INSERT INTO public.fcm_tokens (
    token,
    user_type,
    user_id,
    phone_number,
    order_reference,
    device_info,
    is_active,
    updated_at
  )
  VALUES (
    p_token,
    v_effective_type,
    v_user_id,
    p_phone_number,
    p_order_reference,
    p_device_info,
    true,
    timezone('utc'::text, now())
  )
  ON CONFLICT (token) DO UPDATE
  SET
    user_type = EXCLUDED.user_type,
    user_id = COALESCE(EXCLUDED.user_id, public.fcm_tokens.user_id),
    phone_number = COALESCE(EXCLUDED.phone_number, public.fcm_tokens.phone_number),
    order_reference = COALESCE(EXCLUDED.order_reference, public.fcm_tokens.order_reference),
    device_info = COALESCE(EXCLUDED.device_info, public.fcm_tokens.device_info),
    is_active = true,
    updated_at = timezone('utc'::text, now());

  RETURN jsonb_build_object(
    'success', true,
    'user_type', v_effective_type,
    'message', 'FCM token registered successfully'
  );
END;
$$;

-- Unregister/deactivate an FCM token
CREATE OR REPLACE FUNCTION public.delete_fcm_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token is required');
  END IF;

  DELETE FROM public.fcm_tokens WHERE token = p_token;
  RETURN jsonb_build_object('success', true, 'message', 'Token removed');
END;
$$;

-- Get active tokens for a specific order reference or customer phone
CREATE OR REPLACE FUNCTION public.get_order_customer_tokens(p_order_reference TEXT)
RETURNS TABLE (token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT;
BEGIN
  SELECT customer_phone INTO v_phone
  FROM public.orders
  WHERE order_reference = p_order_reference;

  RETURN QUERY
  SELECT ft.token
  FROM public.fcm_tokens ft
  WHERE ft.is_active = true
    AND (
      ft.order_reference = p_order_reference
      OR (v_phone IS NOT NULL AND ft.phone_number = v_phone)
    );
END;
$$;

-- Get active tokens for available online riders
CREATE OR REPLACE FUNCTION public.get_online_rider_tokens()
RETURNS TABLE (token TEXT, rider_id UUID, rider_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT ft.token, r.id AS rider_id, r.full_name AS rider_name
  FROM public.fcm_tokens ft
  JOIN public.riders r ON r.user_id = ft.user_id
  WHERE ft.is_active = true
    AND ft.user_type = 'rider'
    AND r.is_available = true
    AND r.verification_status != 'suspended';
END;
$$;

-- Get active tokens for administrators
CREATE OR REPLACE FUNCTION public.get_admin_fcm_tokens()
RETURNS TABLE (token TEXT, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT ft.token, a.email
  FROM public.fcm_tokens ft
  JOIN public.admin_users a ON a.user_id = ft.user_id
  WHERE ft.is_active = true
    AND ft.user_type = 'admin';
END;
$$;

-- Helper to record a sent push notification in audit history & realtime feed
CREATE OR REPLACE FUNCTION public.record_push_notification(
  p_recipient_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_order_reference TEXT DEFAULT NULL,
  p_recipient_id UUID DEFAULT NULL,
  p_recipient_phone TEXT DEFAULT NULL,
  p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.push_notifications (
    recipient_type,
    recipient_id,
    recipient_phone,
    order_reference,
    title,
    body,
    data,
    status
  )
  VALUES (
    p_recipient_type,
    p_recipient_id,
    p_recipient_phone,
    p_order_reference,
    p_title,
    p_body,
    p_data,
    'sent'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
