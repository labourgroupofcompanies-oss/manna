-- ==============================================================================
-- OKADA BOOK — STAGE 3: RIDER REGISTRATION, PROFILES & ORDER DISPATCH
-- Migration: 20261115000001_create_riders_and_order_dispatch.sql
-- ==============================================================================

-- 1. Add rider dispatch columns to existing orders table
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rider_id UUID NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_orders_rider_id ON public.orders(rider_id);

-- 2. Create the riders table
CREATE TABLE IF NOT EXISTS public.riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL UNIQUE,
  motorcycle_registration TEXT NOT NULL,
  motorcycle_model TEXT NOT NULL,
  motorcycle_colour TEXT NOT NULL,
  operating_area TEXT NOT NULL,
  profile_photo_path TEXT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT chk_rider_phone_len CHECK (length(trim(phone_number)) >= 10),
  CONSTRAINT chk_rider_name_len CHECK (length(trim(full_name)) >= 2)
);

-- Indexes for riders
CREATE INDEX IF NOT EXISTS idx_riders_user_id ON public.riders(user_id);
CREATE INDEX IF NOT EXISTS idx_riders_phone ON public.riders(phone_number);
CREATE INDEX IF NOT EXISTS idx_riders_available ON public.riders(is_available) WHERE is_available = true;

-- Attach updated_at trigger
DROP TRIGGER IF EXISTS trg_riders_updated_at ON public.riders;
CREATE TRIGGER trg_riders_updated_at
  BEFORE UPDATE ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3. Row Level Security for riders table
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

-- Policy: Rider can select their own profile
DROP POLICY IF EXISTS "Riders can view own profile" ON public.riders;
CREATE POLICY "Riders can view own profile"
  ON public.riders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Rider can update their own profile (e.g. toggle is_available, change area)
DROP POLICY IF EXISTS "Riders can update own profile" ON public.riders;
CREATE POLICY "Riders can update own profile"
  ON public.riders
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Allow new rider profile creation on registration
DROP POLICY IF EXISTS "Riders can insert own profile" ON public.riders;
CREATE POLICY "Riders can insert own profile"
  ON public.riders
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Service role full access
DROP POLICY IF EXISTS "Service role full access on riders" ON public.riders;
CREATE POLICY "Service role full access on riders"
  ON public.riders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Additional RLS for orders table for assigned riders
-- Authenticated riders can view orders assigned to them (including customer phone)
DROP POLICY IF EXISTS "Riders can view assigned orders" ON public.orders;
CREATE POLICY "Riders can view assigned orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = rider_id);

-- 5. Storage bucket for rider profile pictures
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rider-profiles',
  'rider-profiles',
  true, -- Public read for avatar avatars
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS: Authenticated riders can upload their own profile avatar
DROP POLICY IF EXISTS "Riders can upload own profile picture" ON storage.objects;
CREATE POLICY "Riders can upload own profile picture"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'rider-profiles' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 6. Concurrency-Safe RPC Function: Accept Order
-- Atomically assigns an order to the calling rider if still pending
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
  v_order RECORD;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- Verify rider profile exists and is online
  SELECT id, is_available INTO v_rider_id, v_is_available
  FROM public.riders
  WHERE user_id = v_caller_uid;

  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active rider profile found for your account.');
  END IF;

  IF NOT v_is_available THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be Online to accept orders.');
  END IF;

  -- Concurrency-Safe Atomic Update with Row Lock
  UPDATE public.orders
  SET status = 'accepted',
      rider_id = v_caller_uid,
      accepted_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id AND status = 'pending'
  RETURNING id, order_reference, customer_phone, order_type, order_description, voice_recording_path, status, created_at, accepted_at
  INTO v_order;

  -- If no row updated, the order was already accepted by someone else or cancelled
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

-- 7. RPC Function: Complete Order
CREATE OR REPLACE FUNCTION public.complete_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_order_id UUID;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  UPDATE public.orders
  SET status = 'completed',
      completed_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id AND rider_id = v_caller_uid AND status = 'accepted'
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order could not be marked as completed. It may not be assigned to you or is already closed.'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Order marked as completed.');
END;
$$;

-- 8. Privacy-Preserving RPC Function: Get Available Orders
-- Returns pending orders for online riders WITHOUT customer phone numbers
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
  v_is_available BOOLEAN;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN;
  END IF;

  -- Only return available orders if the rider is registered and toggled online
  SELECT is_available INTO v_is_available
  FROM public.riders
  WHERE user_id = v_caller_uid;

  IF v_is_available IS NOT TRUE THEN
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
  ORDER BY o.created_at DESC
  LIMIT 30;
END;
$$;
