-- ==============================================================================
-- OKADA BOOK — STAGE 4: MEDIA STORAGE & RELIABLE TRANSFER ARCHITECTURE
-- Migration: 20261115000002_create_media_storage_metadata.sql
-- Description: Creates order_media tracking table, safe draft cleanup RPC,
--              storage buckets ('rider-profiles', 'customer-media'),
--              and RLS policies for direct secure transfers.
-- ==============================================================================

-- 1. Create order_media metadata tracking table
CREATE TABLE IF NOT EXISTS public.order_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  uploader_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  bucket_id TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('voice_recording', 'customer_image', 'rider_profile')),
  upload_status TEXT NOT NULL DEFAULT 'completed' CHECK (upload_status IN ('pending', 'uploading', 'completed', 'failed')),
  upload_method TEXT NOT NULL DEFAULT 'standard' CHECK (upload_method IN ('standard', 'tus_resumable', 'offline_queue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Indexes for fast coordination and queries
CREATE INDEX IF NOT EXISTS idx_order_media_order_id ON public.order_media(order_id);
CREATE INDEX IF NOT EXISTS idx_order_media_storage_path ON public.order_media(storage_path);
CREATE INDEX IF NOT EXISTS idx_order_media_status_created ON public.order_media(upload_status, created_at);

-- 3. Trigger for updated_at
DROP TRIGGER IF EXISTS trg_order_media_updated_at ON public.order_media;
CREATE TRIGGER trg_order_media_updated_at
  BEFORE UPDATE ON public.order_media
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 4. Enable Row Level Security (RLS) on order_media
ALTER TABLE public.order_media ENABLE ROW LEVEL SECURITY;

-- Service role full access
DROP POLICY IF EXISTS "Service role full access on order_media" ON public.order_media;
CREATE POLICY "Service role full access on order_media"
  ON public.order_media
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anonymous and authenticated users to record media metadata
DROP POLICY IF EXISTS "Allow media metadata insert" ON public.order_media;
CREATE POLICY "Allow media metadata insert"
  ON public.order_media
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Authenticated riders can view media for orders they have accepted or completed
DROP POLICY IF EXISTS "Riders can view media for their accepted orders" ON public.order_media;
CREATE POLICY "Riders can view media for their accepted orders"
  ON public.order_media
  FOR SELECT
  TO authenticated
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

-- 5. Safe Maintenance Cleanup RPC
-- Strictly removes unlinked draft recordings older than 24 hours
-- NEVER deletes media attached to active, assigned, accepted, or completed orders
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_drafts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cleaned_count INT := 0;
  v_deleted_paths TEXT[];
BEGIN
  -- Select unlinked draft recordings older than 24 hours that are NOT referenced in orders
  WITH drafts_to_delete AS (
    DELETE FROM public.order_media
    WHERE order_id IS NULL
      AND created_at < (timezone('utc'::text, now()) - INTERVAL '24 hours')
      AND storage_path NOT IN (
        SELECT voice_recording_path FROM public.orders WHERE voice_recording_path IS NOT NULL
      )
    RETURNING storage_path
  )
  SELECT array_agg(storage_path), count(*)
  INTO v_deleted_paths, v_cleaned_count
  FROM drafts_to_delete;

  RETURN jsonb_build_object(
    'success', true,
    'cleaned_count', COALESCE(v_cleaned_count, 0),
    'deleted_paths', COALESCE(v_deleted_paths, ARRAY[]::TEXT[]),
    'executed_at', timezone('utc'::text, now())
  );
END;
$$;

-- Restrict cleanup execution to service_role only
REVOKE EXECUTE ON FUNCTION public.cleanup_orphaned_drafts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_orphaned_drafts() TO service_role;

-- 6. Storage Buckets Setup
-- A. Ensure 'rider-profiles' bucket exists for rider profile photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rider-profiles',
  'rider-profiles',
  true, -- Public for avatar display
  2097152, -- 2 Megabytes limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

-- B. Ensure 'customer-media' bucket exists for customer imagery
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-media',
  'customer-media',
  false, -- Private bucket
  5242880, -- 5 Megabytes limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 7. Storage Access Policies
-- Allow direct browser uploads to order-recordings in the orders/ folder
DROP POLICY IF EXISTS "Allow customer direct audio uploads" ON storage.objects;
CREATE POLICY "Allow customer direct audio uploads"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'order-recordings'
    AND (storage.foldername(name))[1] = 'orders'
  );

-- Allow authenticated riders and service_role to read order-recordings
DROP POLICY IF EXISTS "Allow authenticated access to order recordings" ON storage.objects;
CREATE POLICY "Allow authenticated access to order recordings"
  ON storage.objects
  FOR SELECT
  TO authenticated, service_role
  USING (bucket_id = 'order-recordings');

-- Allow public read of rider avatars
DROP POLICY IF EXISTS "Public read of rider profiles" ON storage.objects;
CREATE POLICY "Public read of rider profiles"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'rider-profiles');

-- Allow authenticated riders to upload their own avatar into rider-profiles
DROP POLICY IF EXISTS "Riders upload own avatar" ON storage.objects;
CREATE POLICY "Riders upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'rider-profiles');
