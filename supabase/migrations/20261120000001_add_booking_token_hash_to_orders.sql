-- ==============================================================================
-- OKADA BOOK — MIGRATION: Add booking_token_hash to public.orders
-- Migration: 20261120000001_add_booking_token_hash_to_orders.sql
-- Description: Adds booking_token_hash column to public.orders table for
--              cryptographically secure anonymous booking capability verification.
-- ==============================================================================

-- 1. Add booking_token_hash column to public.orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS booking_token_hash TEXT NULL;

-- 2. Create partial index for fast capability token lookup
CREATE INDEX IF NOT EXISTS idx_orders_booking_token_hash
ON public.orders(booking_token_hash)
WHERE booking_token_hash IS NOT NULL;

-- 3. Document column
COMMENT ON COLUMN public.orders.booking_token_hash IS
  'SHA-256 hash of the customer 256-bit booking capability token. Raw token is never stored in DB.';

-- 4. Enforce write-once immutability: booking_token_hash can never be updated after creation
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
