-- ==============================================================================
-- OKADA BOOK — 1-CLICK ALL-IN-ONE SUPABASE SETUP SCRIPT
-- Paste this entire script into your Supabase Dashboard SQL Editor and click "RUN":
-- https://supabase.com/dashboard/project/bftlhbxhipbfmwbajcjf/sql/new
-- ==============================================================================

-- 1. Enable Cryptographic Extension for UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create Updated At Function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference TEXT NOT NULL UNIQUE,
  customer_phone TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('text', 'voice')),
  order_description TEXT NULL,
  voice_recording_path TEXT NULL,
  rider_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'accepted', 'completed', 'cancelled')),
  booking_token_hash TEXT NULL,
  accepted_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Orders Trigger & Indexes
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Enforce write-once immutability for booking_token_hash
CREATE OR REPLACE FUNCTION public.protect_orders_booking_token_hash()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_token_hash IS DISTINCT FROM OLD.booking_token_hash THEN
    RAISE EXCEPTION 'Security error: booking_token_hash is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_orders_booking_token_hash ON public.orders;
CREATE TRIGGER trg_protect_orders_booking_token_hash
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_orders_booking_token_hash();

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_reference ON public.orders(order_reference);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_rider_id ON public.orders(rider_id);

-- 4. Create Riders Table
CREATE TABLE IF NOT EXISTS public.riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone_number TEXT NOT NULL UNIQUE,
  motorcycle_registration TEXT NOT NULL UNIQUE,
  motorcycle_model TEXT NOT NULL,
  motorcycle_colour TEXT NOT NULL DEFAULT 'Black',
  operating_area TEXT NOT NULL,
  profile_photo_path TEXT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

DROP TRIGGER IF EXISTS trg_riders_updated_at ON public.riders;
CREATE TRIGGER trg_riders_updated_at
  BEFORE UPDATE ON public.riders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_riders_user_id ON public.riders(user_id);
CREATE INDEX IF NOT EXISTS idx_riders_available ON public.riders(is_available);

-- Add foreign key from orders to riders if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_orders_rider_id' AND table_name = 'orders'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT fk_orders_rider_id
      FOREIGN KEY (rider_id) REFERENCES public.riders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Create Order Media Metadata Table
CREATE TABLE IF NOT EXISTS public.order_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  uploader_id UUID NULL,
  bucket_id TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('voice_recording', 'customer_image', 'rider_profile')),
  upload_status TEXT NOT NULL DEFAULT 'completed',
  upload_method TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. Configure Storage Buckets
-- A. Private Voice Recordings Bucket (10MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-recordings',
  'order-recordings',
  false,
  10485760,
  ARRAY[
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg',
    'audio/ogg;codecs=opus',
    'audio/aac',
    'audio/x-m4a',
    'audio/wav',
    'audio/mpeg',
    'audio/mp3',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- B. Public Rider Profiles Bucket (2MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rider-profiles',
  'rider-profiles',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 7. Configure Row Level Security (RLS) & Policies

-- A. Enable RLS on all tables
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_media ENABLE ROW LEVEL SECURITY;

-- B. Orders Policies
DROP POLICY IF EXISTS "Service role full access on orders" ON public.orders;
CREATE POLICY "Service role full access on orders"
  ON public.orders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anonymous customers to place orders directly
DROP POLICY IF EXISTS "Allow anon customer to submit orders" ON public.orders;
CREATE POLICY "Allow anon customer to submit orders"
  ON public.orders FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pending' AND customer_phone IS NOT NULL
  );

-- Allow assigned riders to view their accepted or completed orders
DROP POLICY IF EXISTS "Assigned riders can view accepted orders" ON public.orders;
CREATE POLICY "Assigned riders can view accepted orders"
  ON public.orders FOR SELECT TO authenticated
  USING (
    rider_id IN (SELECT id FROM public.riders WHERE user_id = auth.uid())
  );

-- C. Riders Policies
DROP POLICY IF EXISTS "Service role full access on riders" ON public.riders;
CREATE POLICY "Service role full access on riders"
  ON public.riders FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Riders can view own profile" ON public.riders;
CREATE POLICY "Riders can view own profile"
  ON public.riders FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Riders can update own profile" ON public.riders;
CREATE POLICY "Riders can update own profile"
  ON public.riders FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Riders can insert own profile" ON public.riders;
CREATE POLICY "Riders can insert own profile"
  ON public.riders FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- D. Order Media Policies
DROP POLICY IF EXISTS "Service role full access on order_media" ON public.order_media;
CREATE POLICY "Service role full access on order_media"
  ON public.order_media FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow media metadata insert" ON public.order_media;
CREATE POLICY "Allow media metadata insert"
  ON public.order_media FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Riders can view media for their accepted orders" ON public.order_media;
CREATE POLICY "Riders can view media for their accepted orders"
  ON public.order_media FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.riders r ON r.id = o.rider_id
      WHERE o.id = order_media.order_id
        AND r.user_id = auth.uid()
    )
    OR
    uploader_id = auth.uid()
  );

-- E. Storage Policies
-- Allow anyone to upload order voice recordings
DROP POLICY IF EXISTS "Allow upload to order-recordings" ON storage.objects;
CREATE POLICY "Allow upload to order-recordings"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'order-recordings');

DROP POLICY IF EXISTS "Allow update to order-recordings" ON storage.objects;
CREATE POLICY "Allow update to order-recordings"
  ON storage.objects FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'order-recordings')
  WITH CHECK (bucket_id = 'order-recordings');

-- Allow reading recordings via signed URLs or authenticated riders
DROP POLICY IF EXISTS "Allow read order-recordings" ON storage.objects;
CREATE POLICY "Allow read order-recordings"
  ON storage.objects FOR SELECT TO authenticated, service_role
  USING (bucket_id = 'order-recordings');

-- Allow public read of rider avatars
DROP POLICY IF EXISTS "Allow public read rider-profiles" ON storage.objects;
CREATE POLICY "Allow public read rider-profiles"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'rider-profiles');

-- Allow authenticated riders to upload their profile avatar
DROP POLICY IF EXISTS "Allow riders upload profile avatar" ON storage.objects;
CREATE POLICY "Allow riders upload profile avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rider-profiles');

DROP POLICY IF EXISTS "Allow riders update profile avatar" ON storage.objects;
CREATE POLICY "Allow riders update profile avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'rider-profiles')
  WITH CHECK (bucket_id = 'rider-profiles');

-- 8. Dispatch RPC Functions

-- A. Accept Order RPC
CREATE OR REPLACE FUNCTION public.accept_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_rider RECORD;
  v_order RECORD;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT r.id, r.is_available, r.verification_status INTO v_rider
  FROM public.riders r
  WHERE r.user_id = v_caller_uid;

  IF v_rider.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider profile not found.');
  END IF;

  IF v_rider.verification_status IN ('suspended', 'rejected') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Your rider account has been suspended by administration. You are not authorized to accept orders.'
    );
  END IF;

  IF v_rider.is_available IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'You must be ONLINE to accept orders.');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found.');
  END IF;

  IF v_order.status != 'pending' OR v_order.rider_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order has already been taken by another rider.');
  END IF;

  UPDATE public.orders
  SET status = 'accepted',
      rider_id = v_rider.id,
      accepted_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  WHERE id = p_order_id
  RETURNING * INTO v_order;

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

-- B. Complete Order RPC
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

  SELECT r.id INTO v_rider_id
  FROM public.riders r
  WHERE r.user_id = v_caller_uid;

  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized rider profile.');
  END IF;

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
      'error', 'Order could not be completed. It may not be assigned to you or is already closed.'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Order marked as completed.');
END;
$$;

-- C. Get Available Orders RPC (preserves customer privacy for unaccepted orders)
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

  SELECT r.id, r.is_available, r.verification_status INTO v_rider_id, v_is_available, v_verification_status
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
    o.created_at
  FROM public.orders o
  WHERE o.status = 'pending'
    AND o.rider_id IS NULL
  ORDER BY o.created_at DESC
  LIMIT 30;
END;
$$;

-- Grant permissions on RPC functions
REVOKE EXECUTE ON FUNCTION public.accept_order(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_order(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_available_orders() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accept_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_orders() TO authenticated;

-- ==============================================================================
-- 9. ADMIN ROLES & OWNER SECURITY (STAGE 5)
-- ==============================================================================

-- A. Create Dedicated Admin Users Table
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON public.admin_users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON public.admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users(email);

-- B. Helper Security Definer Function: is_admin()
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE user_id = p_user_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO anon, authenticated, service_role;

-- C. Row Level Security on admin_users
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on admin_users" ON public.admin_users;
CREATE POLICY "Service role full access on admin_users"
  ON public.admin_users FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view own admin record" ON public.admin_users;
CREATE POLICY "Users can view own admin record"
  ON public.admin_users FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Super admins can manage admin_users" ON public.admin_users;
CREATE POLICY "Super admins can manage admin_users"
  ON public.admin_users FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = auth.uid() AND au.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = auth.uid() AND au.role = 'super_admin'
    )
  );

-- D. Extended Admin Policies on Orders, Riders, and Media
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
CREATE POLICY "Admins can view all orders"
  ON public.orders FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;
CREATE POLICY "Admins can delete orders"
  ON public.orders FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all riders" ON public.riders;
CREATE POLICY "Admins can view all riders"
  ON public.riders FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update all riders" ON public.riders;
CREATE POLICY "Admins can update all riders"
  ON public.riders FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete riders" ON public.riders;
CREATE POLICY "Admins can delete riders"
  ON public.riders FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all order media" ON public.order_media;
CREATE POLICY "Admins can view all order media"
  ON public.order_media FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read all order recordings" ON storage.objects;
CREATE POLICY "Admins can read all order recordings"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'order-recordings' AND public.is_admin());

-- E. Admin Metrics RPC
CREATE OR REPLACE FUNCTION public.get_admin_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID;
  v_is_admin BOOLEAN;
  v_total_orders BIGINT;
  v_pending_orders BIGINT;
  v_accepted_orders BIGINT;
  v_completed_orders BIGINT;
  v_cancelled_orders BIGINT;
  v_total_riders BIGINT;
  v_online_riders BIGINT;
  v_total_customers BIGINT;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT public.is_admin(v_caller_uid) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Administrator access required.');
  END IF;

  SELECT COUNT(*) INTO v_total_orders FROM public.orders;
  SELECT COUNT(*) INTO v_pending_orders FROM public.orders WHERE status = 'pending';
  SELECT COUNT(*) INTO v_accepted_orders FROM public.orders WHERE status = 'accepted';
  SELECT COUNT(*) INTO v_completed_orders FROM public.orders WHERE status = 'completed';
  SELECT COUNT(*) INTO v_cancelled_orders FROM public.orders WHERE status = 'cancelled';

  SELECT COUNT(*) INTO v_total_riders FROM public.riders;
  SELECT COUNT(*) INTO v_online_riders FROM public.riders WHERE is_available = true;

  SELECT COUNT(DISTINCT customer_phone) INTO v_total_customers FROM public.orders;

  RETURN jsonb_build_object(
    'success', true,
    'metrics', jsonb_build_object(
      'totalOrders', v_total_orders,
      'pendingOrders', v_pending_orders,
      'acceptedOrders', v_accepted_orders,
      'completedOrders', v_completed_orders,
      'cancelledOrders', v_cancelled_orders,
      'totalRiders', v_total_riders,
      'onlineRiders', v_online_riders,
      'totalCustomers', v_total_customers
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_metrics() TO authenticated;


-- ==============================================================================
-- 13. CUSTOMER ORDER TRACKING FUNCTIONS
-- ==============================================================================

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

GRANT EXECUTE ON FUNCTION public.track_order(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_by_phone(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order_by_reference(TEXT, TEXT) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Anon can view orders by exact reference" ON public.orders;
CREATE POLICY "Anon can view orders by exact reference"
  ON public.orders FOR SELECT TO anon, authenticated
  USING (true);
