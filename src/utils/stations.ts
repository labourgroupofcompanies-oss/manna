/**
 * Kadjebi Moto Station Registry & Wave-Based Dispatch Engine
 *
 * Wave 1 (0–45s):   Riders stationed at the exact pickup station
 * Wave 2 (45–105s): Riders at nearby/neighboring stations
 * Wave 3 (105s+):   All online riders across the district
 */

export type StationZone = 'Kadjebi Town' | 'Outside Kadjebi Town';

export interface MotoStation {
  slug: string;
  name: string;
  zone: StationZone;
  aliases: string[];
  nearbySlugs: string[];
}

export const WAVE_1_DURATION_SECONDS = 45;
export const WAVE_2_DURATION_SECONDS = 60;
export const MAX_STATION_CHANGES_PER_WEEK = 2;

const KADJEBI_TOWN_SLUGS = [
  'main-lorry-station',
  'barrister-junction',
  'nuwel-junction',
  'clinic-junction',
  'kasec-junction'
] as const;

function otherTownSlugs(selfSlug: string): string[] {
  return KADJEBI_TOWN_SLUGS.filter((s) => s !== selfSlug);
}

export const MOTO_STATIONS: MotoStation[] = [
  // Kadjebi Town (5 stations)
  {
    slug: 'main-lorry-station',
    name: 'Main Lorry Station',
    zone: 'Kadjebi Town',
    aliases: ['Lorry Station', 'Kadjebi Station', 'Main Station', 'Kadjebi Lorry Park', 'Kadjebi-Town'],
    nearbySlugs: [...otherTownSlugs('main-lorry-station'), 'menuso', 'asato']
  },
  {
    slug: 'barrister-junction',
    name: 'Barrister Junction',
    zone: 'Kadjebi Town',
    aliases: ['Barister Junction', 'Barister', 'Barrister'],
    nearbySlugs: [...otherTownSlugs('barrister-junction'), 'menuso', 'asato']
  },
  {
    slug: 'nuwel-junction',
    name: 'Nuwel Junction',
    zone: 'Kadjebi Town',
    aliases: ['Nuwel', 'Newell Junction', 'Newel Junction'],
    nearbySlugs: [...otherTownSlugs('nuwel-junction'), 'menuso', 'asato']
  },
  {
    slug: 'clinic-junction',
    name: 'Clinic Junction',
    zone: 'Kadjebi Town',
    aliases: ['Clinic', 'Hospital Junction', 'Kadjebi Clinic'],
    nearbySlugs: [...otherTownSlugs('clinic-junction'), 'menuso', 'asato']
  },
  {
    slug: 'kasec-junction',
    name: 'KASEC Junction',
    zone: 'Kadjebi Town',
    aliases: ['Kasec', 'KASEC', 'Kadjebi Asato SHS'],
    nearbySlugs: [...otherTownSlugs('kasec-junction'), 'menuso', 'asato']
  },

  // Outside Kadjebi Town (4 stations)
  {
    slug: 'menuso',
    name: 'Menuso',
    zone: 'Outside Kadjebi Town',
    aliases: ['Menusoh', 'Menusu'],
    nearbySlugs: ['road-block', 'dzindziso', ...KADJEBI_TOWN_SLUGS]
  },
  {
    slug: 'road-block',
    name: 'Road Block',
    zone: 'Outside Kadjebi Town',
    aliases: ['Roadblock', 'Road-Block', 'Barrier', 'Border'],
    nearbySlugs: ['menuso', 'dzindziso']
  },
  {
    slug: 'dzindziso',
    name: 'Dzindziso',
    zone: 'Outside Kadjebi Town',
    aliases: ['Dzidziso', 'Dzindzi', 'Dzidzi'],
    nearbySlugs: ['road-block', 'menuso']
  },
  {
    slug: 'asato',
    name: 'Asato',
    zone: 'Outside Kadjebi Town',
    aliases: ['Asatoh'],
    nearbySlugs: [...KADJEBI_TOWN_SLUGS]
  }
];

export const STATIONS_BY_ZONE: Record<StationZone, MotoStation[]> = {
  'Kadjebi Town': MOTO_STATIONS.filter((s) => s.zone === 'Kadjebi Town'),
  'Outside Kadjebi Town': MOTO_STATIONS.filter((s) => s.zone === 'Outside Kadjebi Town')
};

function normalizeText(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds a station by exact slug, canonical name, alias, or substring match inside free text.
 */
export function matchStation(input?: string | null): MotoStation | null {
  if (!input) return null;
  const clean = normalizeText(input);
  if (!clean) return null;

  // 1. Exact slug or exact name match
  for (const station of MOTO_STATIONS) {
    if (clean === station.slug || clean === normalizeText(station.name)) {
      return station;
    }
  }

  // 2. Exact alias match
  for (const station of MOTO_STATIONS) {
    for (const alias of station.aliases) {
      if (clean === normalizeText(alias)) {
        return station;
      }
    }
  }

  // 3. Substring match inside free-text pickup descriptions (e.g. "Dzindziso near school")
  for (const station of MOTO_STATIONS) {
    const candidates = [station.name, ...station.aliases].map(normalizeText);
    for (const candidate of candidates) {
      if (candidate.length >= 4 && clean.includes(candidate)) {
        return station;
      }
    }
  }

  return null;
}

/**
 * Returns the station object for a given slug
 */
export function getStationBySlug(slug: string): MotoStation | null {
  return MOTO_STATIONS.find((s) => s.slug === slug) || null;
}

/**
 * Returns human-readable nearby station names for a station
 */
export function getNearbyStationNames(stationInput: string): string[] {
  const station = matchStation(stationInput);
  if (!station) return [];
  return station.nearbySlugs
    .map((slug) => getStationBySlug(slug)?.name)
    .filter((name): name is string => Boolean(name));
}

/**
 * Computes the current dispatch wave (1, 2, or 3) based on how many seconds have elapsed
 * since the order was placed.
 */
export function getCurrentDispatchWave(createdAtIso: string, nowMs = Date.now()): 1 | 2 | 3 {
  const createdMs = new Date(createdAtIso).getTime();
  if (Number.isNaN(createdMs)) return 3;

  const elapsedSeconds = Math.max(0, (nowMs - createdMs) / 1000);
  if (elapsedSeconds < WAVE_1_DURATION_SECONDS) return 1;
  if (elapsedSeconds < WAVE_1_DURATION_SECONDS + WAVE_2_DURATION_SECONDS) return 2;
  return 3;
}

/**
 * Returns the canonical station names eligible to see an order at a given wave.
 * Returns 'ALL' for Wave 3 or when pickup station cannot be resolved.
 */
export function getEligibleStationNamesForWave(
  pickupStationInput: string | null | undefined,
  wave: 1 | 2 | 3
): string[] | 'ALL' {
  if (wave >= 3 || !pickupStationInput) return 'ALL';
  const station = matchStation(pickupStationInput);
  if (!station) return 'ALL';

  if (wave === 1) {
    return [station.name];
  }

  // Wave 2: exact station + all nearby stations
  const nearbyNames = getNearbyStationNames(station.name);
  return [station.name, ...nearbyNames];
}

/**
 * Determines whether a pending order should be visible to a rider stationed at `riderStation`.
 */
export function isOrderVisibleToRiderAtWave(
  orderPickupStation: string | null | undefined,
  riderStation: string | null | undefined,
  createdAtIso: string,
  nowMs = Date.now()
): boolean {
  const wave = getCurrentDispatchWave(createdAtIso, nowMs);
  const eligible = getEligibleStationNamesForWave(orderPickupStation, wave);
  if (eligible === 'ALL') return true;

  const resolvedRiderStation = matchStation(riderStation);
  if (!resolvedRiderStation) {
    // Legacy riders with unmapped area (e.g. "Kadjebi District") see Wave 2+ or fallback
    return wave >= 2;
  }

  return eligible.some(
    (name) => normalizeText(name) === normalizeText(resolvedRiderStation.name)
  );
}

/**
 * Friendly customer-facing status text for the current dispatch wave
 */
export function getWaveStatusText(
  pickupStationInput: string | null | undefined,
  wave: 1 | 2 | 3
): string {
  const station = matchStation(pickupStationInput);
  if (!station) {
    return 'Alerting nearby riders...';
  }

  if (wave === 1) {
    return `Alerting riders at ${station.name}...`;
  }

  if (wave === 2) {
    const nearby = getNearbyStationNames(station.name);
    const preview = nearby.slice(0, 2).join(', ');
    return preview
      ? `Expanding to nearby stations (${preview}${nearby.length > 2 ? ' & more' : ''})...`
      : 'Expanding to nearby stations...';
  }

  return 'Alerting all online riders across Kadjebi...';
}
