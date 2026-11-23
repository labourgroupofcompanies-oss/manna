-- ==============================================================================
-- MANNA (OKADA BOOK) — STATION-BASED WAVE DISPATCH & WEEKLY STATION CHANGE LIMIT
-- Migration: 20261122000000_station_wave_dispatch.sql
-- ==============================================================================

-- 1. Moto Stations Table
CREATE TABLE IF NOT EXISTS public.stations (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  zone TEXT NOT NULL CHECK (zone IN ('Kadjebi Town', 'Outside Kadjebi Town')),
  aliases TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Station Neighbors Table (Wave 2 expansion targets, ordered nearest first)
CREATE TABLE IF NOT EXISTS public.station_neighbors (
  station_slug TEXT NOT NULL REFERENCES public.stations(slug) ON DELETE CASCADE,
  neighbor_slug TEXT NOT NULL REFERENCES public.stations(slug) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (station_slug, neighbor_slug),
  CHECK (station_slug <> neighbor_slug)
);

-- RLS for stations & neighbors (public read, admin write)
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_neighbors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active stations" ON public.stations;
CREATE POLICY "Public can read active stations"
  ON public.stations FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage stations" ON public.stations;
CREATE POLICY "Admins can manage stations"
  ON public.stations FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Public can read station neighbors" ON public.station_neighbors;
CREATE POLICY "Public can read station neighbors"
  ON public.station_neighbors FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage station neighbors" ON public.station_neighbors;
CREATE POLICY "Admins can manage station neighbors"
  ON public.station_neighbors FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Seed Official Kadjebi Moto Stations
INSERT INTO public.stations (slug, name, zone, aliases) VALUES
  ('main-lorry-station', 'Main Lorry Station', 'Kadjebi Town', ARRAY['Lorry Station', 'Kadjebi Station', 'Main Station', 'Kadjebi-Town']),
  ('barrister-junction', 'Barrister Junction', 'Kadjebi Town', ARRAY['Barister Junction', 'Barister', 'Barrister']),
  ('nuwel-junction',     'Nuwel Junction',     'Kadjebi Town', ARRAY['Nuwel', 'Newell Junction']),
  ('clinic-junction',    'Clinic Junction',    'Kadjebi Town', ARRAY['Clinic', 'Hospital Junction']),
  ('kasec-junction',     'KASEC Junction',     'Kadjebi Town', ARRAY['Kasec', 'KASEC']),
  ('menuso',             'Menuso',             'Outside Kadjebi Town', ARRAY['Menusoh']),
  ('road-block',         'Road Block',         'Outside Kadjebi Town', ARRAY['Roadblock', 'Barrier', 'Border']),
  ('dzindziso',          'Dzindziso',          'Outside Kadjebi Town', ARRAY['Dzidziso', 'Dzindzi']),
  ('asato',              'Asato',              'Outside Kadjebi Town', ARRAY['Asatoh'])
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  zone = EXCLUDED.zone,
  aliases = EXCLUDED.aliases;

-- Seed Neighbor Relationships (Wave 2)
-- All 5 Kadjebi Town stations are neighbors of each other + Menuso & Asato
INSERT INTO public.station_neighbors (station_slug, neighbor_slug, priority) VALUES
  -- Main Lorry Station
  ('main-lorry-station', 'barrister-junction', 1),
  ('main-lorry-station', 'nuwel-junction', 2),
  ('main-lorry-station', 'clinic-junction', 3),
  ('main-lorry-station', 'kasec-junction', 4),
  ('main-lorry-station', 'menuso', 5),
  ('main-lorry-station', 'asato', 6),
  -- Barrister Junction
  ('barrister-junction', 'main-lorry-station', 1),
  ('barrister-junction', 'nuwel-junction', 2),
  ('barrister-junction', 'clinic-junction', 3),
  ('barrister-junction', 'kasec-junction', 4),
  ('barrister-junction', 'menuso', 5),
  ('barrister-junction', 'asato', 6),
  -- Nuwel Junction
  ('nuwel-junction', 'main-lorry-station', 1),
  ('nuwel-junction', 'barrister-junction', 2),
  ('nuwel-junction', 'clinic-junction', 3),
  ('nuwel-junction', 'kasec-junction', 4),
  ('nuwel-junction', 'menuso', 5),
  ('nuwel-junction', 'asato', 6),
  -- Clinic Junction
  ('clinic-junction', 'main-lorry-station', 1),
  ('clinic-junction', 'barrister-junction', 2),
  ('clinic-junction', 'nuwel-junction', 3),
  ('clinic-junction', 'kasec-junction', 4),
  ('clinic-junction', 'menuso', 5),
  ('clinic-junction', 'asato', 6),
  -- KASEC Junction
  ('kasec-junction', 'main-lorry-station', 1),
  ('kasec-junction', 'barrister-junction', 2),
  ('kasec-junction', 'nuwel-junction', 3),
  ('kasec-junction', 'clinic-junction', 4),
  ('kasec-junction', 'menuso', 5),
  ('kasec-junction', 'asato', 6),
  -- Menuso (close to Road Block, Dzindziso, and Kadjebi Town)
  ('menuso', 'road-block', 1),
  ('menuso', 'dzindziso', 2),
  ('menuso', 'main-lorry-station', 3),
  ('menuso', 'barrister-junction', 4),
  ('menuso', 'nuwel-junction', 5),
  ('menuso', 'clinic-junction', 6),
  ('menuso', 'kasec-junction', 7),
  -- Road Block (close to Menuso and Dzindziso)
  ('road-block', 'menuso', 1),
  ('road-block', 'dzindziso', 2),
  -- Dzindziso (close to Road Block and Menuso)
  ('dzindziso', 'road-block', 1),
  ('dzindziso', 'menuso', 2),
  -- Asato (close to Kadjebi Town)
  ('asato', 'main-lorry-station', 1),
  ('asato', 'barrister-junction', 2),
  ('asato', 'nuwel-junction', 3),
  ('asato', 'clinic-junction', 4),
  ('asato', 'kasec-junction', 5)
ON CONFLICT (station_slug, neighbor_slug) DO UPDATE SET priority = EXCLUDED.priority;

-- 3. Add Station & Wave Columns to Orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_station TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_wave INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS wave_started_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_orders_pickup_station_pending
  ON public.orders(pickup_station, created_at DESC)
  WHERE status = 'pending';

-- 4. Add Weekly Station Change Limit Columns to Riders
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS station_change_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS station_change_week_start TIMESTAMPTZ;

-- 5. RPC: Change Rider Station (max 2 changes per 7-day rolling week)
CREATE OR REPLACE FUNCTION public.change_rider_station(p_new_station TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider RECORD;
  v_station_name TEXT;
  v_count INTEGER;
  v_week_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- Validate station exists
  SELECT name INTO v_station_name
  FROM public.stations
  WHERE is_active = true
    AND (lower(name) = lower(trim(p_new_station)) OR lower(slug) = lower(trim(p_new_station)))
  LIMIT 1;

  IF v_station_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected moto station is not valid.');
  END IF;

  SELECT id, operating_area, station_change_count, station_change_week_start
  INTO v_rider
  FROM public.riders
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_rider.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider profile not found.');
  END IF;

  IF lower(coalesce(v_rider.operating_area, '')) = lower(v_station_name) THEN
    RETURN jsonb_build_object(
      'success', true,
      'operating_area', v_station_name,
      'changes_remaining', GREATEST(0, 2 - coalesce(v_rider.station_change_count, 0))
    );
  END IF;

  -- Reset counter if 7 days have elapsed or never set
  IF v_rider.station_change_week_start IS NULL OR v_now >= (v_rider.station_change_week_start + INTERVAL '7 days') THEN
    v_count := 0;
    v_week_start := v_now;
  ELSE
    v_count := coalesce(v_rider.station_change_count, 0);
    v_week_start := v_rider.station_change_week_start;
  END IF;

  IF v_count >= 2 THEN
    RETURN jsonb_build_object(
      'success', false,
      'changes_remaining', 0,
      'error', 'You have used your 2 station changes for this week. Please wait until your weekly limit resets.'
    );
  END IF;

  UPDATE public.riders
  SET
    operating_area = v_station_name,
    station_change_count = v_count + 1,
    station_change_week_start = v_week_start,
    updated_at = v_now
  WHERE id = v_rider.id;

  RETURN jsonb_build_object(
    'success', true,
    'operating_area', v_station_name,
    'changes_remaining', GREATEST(0, 2 - (v_count + 1))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_rider_station(TEXT) TO authenticated;

-- 6. RPC: Get Online Rider FCM Tokens Filtered by Station & Wave
-- Wave 1: exact station riders
-- Wave 2: nearby neighbor station riders (plus exact station)
-- Wave 3 (or NULL pickup_station): all online approved riders
CREATE OR REPLACE FUNCTION public.get_station_wave_rider_tokens(
  p_pickup_station TEXT DEFAULT NULL,
  p_wave INTEGER DEFAULT 1
)
RETURNS TABLE(token TEXT, rider_id UUID, operating_area TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station_slug TEXT;
BEGIN
  IF p_pickup_station IS NOT NULL AND trim(p_pickup_station) <> '' THEN
    SELECT s.slug INTO v_station_slug
    FROM public.stations s
    WHERE lower(s.name) = lower(trim(p_pickup_station))
       OR lower(s.slug) = lower(trim(p_pickup_station))
       OR EXISTS (
         SELECT 1 FROM unnest(s.aliases) a WHERE lower(a) = lower(trim(p_pickup_station))
       )
    LIMIT 1;
  END IF;

  -- Wave 3 or unrecognized station -> all online non-suspended riders
  IF p_wave >= 3 OR v_station_slug IS NULL THEN
    RETURN QUERY
    SELECT DISTINCT ft.token, r.id, r.operating_area
    FROM public.fcm_tokens ft
    JOIN public.riders r ON r.user_id = ft.user_id
    WHERE ft.user_type = 'rider'
      AND ft.is_active = true
      AND r.is_available = true
      AND r.verification_status NOT IN ('suspended', 'rejected');
    RETURN;
  END IF;

  IF p_wave = 1 THEN
    RETURN QUERY
    SELECT DISTINCT ft.token, r.id, r.operating_area
    FROM public.fcm_tokens ft
    JOIN public.riders r ON r.user_id = ft.user_id
    JOIN public.stations s ON lower(s.name) = lower(r.operating_area) OR lower(s.slug) = lower(r.operating_area)
    WHERE ft.user_type = 'rider'
      AND ft.is_active = true
      AND r.is_available = true
      AND r.verification_status NOT IN ('suspended', 'rejected')
      AND s.slug = v_station_slug;
    RETURN;
  END IF;

  -- Wave 2: exact station + neighbor stations
  RETURN QUERY
  SELECT DISTINCT ft.token, r.id, r.operating_area
  FROM public.fcm_tokens ft
  JOIN public.riders r ON r.user_id = ft.user_id
  JOIN public.stations s ON lower(s.name) = lower(r.operating_area) OR lower(s.slug) = lower(r.operating_area)
  WHERE ft.user_type = 'rider'
    AND ft.is_active = true
    AND r.is_available = true
    AND r.verification_status NOT IN ('suspended', 'rejected')
    AND (
      s.slug = v_station_slug
      OR s.slug IN (
        SELECT sn.neighbor_slug FROM public.station_neighbors sn WHERE sn.station_slug = v_station_slug
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_station_wave_rider_tokens(TEXT, INTEGER) TO service_role, authenticated;

-- 7. Update get_available_orders() to Respect Station Wave Visibility (45s / 60s)
DROP FUNCTION IF EXISTS public.get_available_orders();
CREATE OR REPLACE FUNCTION public.get_available_orders()
RETURNS TABLE(
  id UUID,
  order_reference TEXT,
  order_type TEXT,
  order_description TEXT,
  voice_recording_path TEXT,
  customer_comment TEXT,
  pickup_station TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider RECORD;
  v_rider_slug TEXT;
BEGIN
  SELECT r.id, r.is_available, r.verification_status, r.operating_area
  INTO v_rider
  FROM public.riders r
  WHERE r.user_id = auth.uid()
  LIMIT 1;

  IF v_rider.id IS NULL OR v_rider.is_available IS NOT TRUE OR v_rider.verification_status IN ('suspended', 'rejected') THEN
    RETURN;
  END IF;

  SELECT s.slug INTO v_rider_slug
  FROM public.stations s
  WHERE lower(s.name) = lower(v_rider.operating_area)
     OR lower(s.slug) = lower(v_rider.operating_area)
     OR EXISTS (SELECT 1 FROM unnest(s.aliases) a WHERE lower(a) = lower(v_rider.operating_area))
  LIMIT 1;

  RETURN QUERY
  SELECT
    o.id,
    o.order_reference,
    o.order_type,
    o.order_description,
    o.voice_recording_path,
    o.customer_comment,
    o.pickup_station,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.stations ps
    ON o.pickup_station IS NOT NULL
   AND (lower(ps.name) = lower(o.pickup_station) OR lower(ps.slug) = lower(o.pickup_station))
  WHERE o.status = 'pending'
    AND o.rider_id IS NULL
    AND (
      -- No station tag or >= 105s elapsed (Wave 3: all online riders)
      ps.slug IS NULL
      OR EXTRACT(EPOCH FROM (now() - o.created_at)) >= 105
      -- Wave 1 (0–45s): exact station match
      OR (v_rider_slug IS NOT NULL AND v_rider_slug = ps.slug)
      -- Wave 2 (45–105s): neighbor stations
      OR (
        EXTRACT(EPOCH FROM (now() - o.created_at)) >= 45
        AND v_rider_slug IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.station_neighbors sn
          WHERE sn.station_slug = ps.slug
            AND sn.neighbor_slug = v_rider_slug
        )
      )
    )
  ORDER BY o.created_at DESC
  LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_orders() TO authenticated;
