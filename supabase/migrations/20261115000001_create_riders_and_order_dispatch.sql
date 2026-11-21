-- ==============================================================================
-- OKADA BOOK — STAGE 3 SECURITY AUDIT: HARDENED RIDER & ORDER DISPATCH MIGRATION
-- Migration: 20261115000001_create_riders_and_order_dispatch.sql
-- Security Hardened: Corrects rider identity relationships, enforces atomic row-locks,
--                    establishes explicit foreign keys, search_path security, and
--                    strict customer privacy policies.
-- ==============================================================================

-- 1. Create the riders table FIRST so foreign keys can reference it
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

-- Indexes for riders table
CREATE INDEX IF NOT EXISTS idx_riders_user_id ON public.riders(user_id);
CREATE INDEX IF NOT EXISTS idx_riders_phone ON public.riders(phone_number);
CREATE INDEX IF NOT EXISTS idx_riders_available ON public.riders(is_available) WHERE is_available = true;

-- Attach updated_at trigger to riders table
DROP TRIGGER IF EXISTS trg_riders_updated_at ON public.riders;
CREATE TRIGGER trg_riders_updated_at
  BEFORE UPDATE ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 2. Add dispatch columns to orders table referencing public.riders(id)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rider_id UUID NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

-- Ensure foreign key constraint from orders.rider_id -> public.riders(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_rider_profile'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT fk_orders_rider_profile
      FOREIGN KEY (rider_id) REFERENCES public.riders(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_rider_id ON public.orders(rider_id);

-- 3. Row Level Security for riders table
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

-- Policy: Rider can only select their own profile
DROP POLICY IF EXISTS "Riders can view own profile" ON public.riders;
CREATE POLICY "Riders can view own profile"
  ON public.riders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Rider can only update their own profile (e.g. toggle availability, update bike)
DROP POLICY IF EXISTS "Riders can update own profile" ON public.riders;
CREATE POLICY "Riders can update own profile"
  ON public.riders
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Allow authenticated rider to insert their profile during registration
DROP POLICY IF EXISTS "Riders can insert own profile" ON public.riders;
CREATE POLICY "Riders can insert own profile"
  ON public.riders
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Service role full access on riders
DROP POLICY IF EXISTS "Service role full access on riders" ON public.riders;
CREATE POLICY "Service role full access on riders"
  ON public.riders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Row Level Security for orders table
-- Authenticated riders can ONLY view orders officially assigned to them
DROP POLICY IF EXISTS "Riders can view assigned orders" ON public.orders;
CREATE POLICY "Riders can view assigned orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = orders.rider_id
        AND r.user_id = auth.uid()
    )
  );

-- Direct client UPDATE, INSERT, or DELETE on orders is strictly prohibited for authenticated/anon.
-- All mutations must pass through the authorized RPCs or Edge Functions.

-- 5. Storage Buckets & Policies
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rider-profiles',
  'rider-profiles',
  true, -- Public read for avatar images
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS: Authenticated riders can only upload to their own avatar folder
DROP POLICY IF EXISTS "Riders can upload own profile picture" ON storage.objects;
CREATE POLICY "Riders can upload own profile picture"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'rider-profiles' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 6. Concurrency-Safe RPC Function: Accept Order
-- Atomically assigns an order to the calling rider if still pending and unassigned
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
  -- A. Verify caller is authenticated
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- B. Resolve rider record from public.riders using auth.uid()
  SELECT r.id, r.is_available INTO v_rider_id, v_is_available
  FROM public.riders r
  WHERE r.user_id = v_caller_uid;

  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No registered rider profile found for this account.');
  END IF;

  -- C. Verify rider is currently online
  IF NOT v_is_available THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be Online to accept orders.');
  END IF;

  -- D. Concurrency-Safe Atomic Update with Postgres Exclusive Row Lock
  -- Assigns rider_id = v_rider_id (public.riders.id)
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

  -- E. If 0 rows updated, order was already taken or cancelled
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
  v_rider_id UUID;
  v_updated_id UUID;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- Resolve rider profile id
  SELECT id INTO v_rider_id
  FROM public.riders
  WHERE user_id = v_caller_uid;

  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized rider profile.');
  END IF;

  -- Atomic completion check: must be assigned to this rider and in 'accepted' status
  UPDATE public.orders
  SET status = 'completed',
      completed_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id
    AND rider_id = v_rider_id
    AND status = 'accepted'
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
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
  v_rider_id UUID;
  v_is_available BOOLEAN;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN;
  END IF;

  -- Only online riders with an active profile can see pending requests
  SELECT r.id, r.is_available INTO v_rider_id, v_is_available
  FROM public.riders r
  WHERE r.user_id = v_caller_uid;

  IF v_rider_id IS NULL OR v_is_available IS NOT TRUE THEN
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
  LIMIT 30;
END;
$$;

-- 9. Authorize RPC Permissions (Explicit whitelist)
REVOKE EXECUTE ON FUNCTION public.accept_order(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_order(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_available_orders() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_orders() TO authenticated;
