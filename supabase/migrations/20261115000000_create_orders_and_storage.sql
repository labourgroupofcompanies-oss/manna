-- ==============================================================================
-- OKADA BOOK — STAGE 2: SUPABASE DATABASE MIGRATION
-- Migration: 20261115000000_create_orders_and_storage.sql
-- Description: Creates the orders table, constraints, indexes, RLS policies,
--              updated_at trigger, and private order-recordings storage bucket.
-- ==============================================================================

-- 1. Enable pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create updated_at timestamp trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create the orders table
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_reference TEXT NOT NULL UNIQUE,
  customer_phone TEXT NOT NULL,
  order_type TEXT NOT NULL,
  order_description TEXT NULL,
  voice_recording_path TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  -- Order type constraint: must be 'text' or 'voice'
  CONSTRAINT chk_orders_order_type CHECK (
    order_type IN ('text', 'voice')
  ),

  -- Status constraint
  CONSTRAINT chk_orders_status CHECK (
    status IN ('pending', 'assigned', 'accepted', 'completed', 'cancelled')
  ),

  -- Content requirement constraint:
  -- Text orders require a non-empty description.
  -- Voice orders require a non-empty voice_recording_path.
  CONSTRAINT chk_orders_content CHECK (
    (order_type = 'text' AND order_description IS NOT NULL AND length(trim(order_description)) > 0)
    OR
    (order_type = 'voice' AND voice_recording_path IS NOT NULL AND length(trim(voice_recording_path)) > 0)
  ),

  -- Basic phone length validation
  CONSTRAINT chk_orders_phone_length CHECK (
    length(trim(customer_phone)) >= 10
  )
);

-- 4. Create optimized indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_reference ON public.orders(order_reference);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone_cooldown ON public.orders(customer_phone, created_at DESC);

-- 5. Attach updated_at trigger
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 6. Enable Row Level Security (RLS) on orders
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Security rules:
-- - The public anon role has NO SELECT access (prevents scraping customer phone numbers or rides).
-- - The public anon role has NO UPDATE or DELETE access.
-- - Order insertion is strictly mediated through the secure Edge Function using the service_role key.
-- - A policy is provided allowing service_role full control.
DROP POLICY IF EXISTS "Service role full access on orders" ON public.orders;
CREATE POLICY "Service role full access on orders"
  ON public.orders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 7. Configure Private Storage for Voice Recordings
-- Create 'order-recordings' bucket with 10MB file limit and restricted audio MIME types
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-recordings',
  'order-recordings',
  false, -- Private bucket: no public anonymous access
  10485760, -- 10 Megabytes limit
  ARRAY[
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg',
    'audio/ogg;codecs=opus',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-m4a',
    'audio/aac'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/ogg',
    'audio/ogg;codecs=opus',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-m4a',
    'audio/aac'
  ];

-- Storage RLS: Restrict bucket access strictly to service_role
DROP POLICY IF EXISTS "Service role full access on order recordings" ON storage.objects;
CREATE POLICY "Service role full access on order recordings"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'order-recordings')
  WITH CHECK (bucket_id = 'order-recordings');
