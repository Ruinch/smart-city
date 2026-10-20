import { insideAstana } from '../shared/astana'
import type { DynamicPlace, SearchCategory } from './dynamic'
import { distanceMeters } from './recommend'

/** Only activities that have an honest equivalent in the current planner. */
const CATEGORY_MAP: Record<string, SearchCategory> = {
  restaurant: 'restaurant', gastropub: 'restaurant', cafe: 'cafe', coffee_shop: 'cafe',
  bar: 'bar', pub: 'bar', beer_bar: 'bar', cocktail_bar: 'bar', sports_bar: 'bar',
  nightclub: 'nightclub', karaoke_venue: 'karaoke', lounge: 'bar', shopping_mall: 'mall', library: 'library', bookstore: 'bookshop',
  movie_theater: 'cinema', theatre_venue: 'theatre', museum: 'museum', art_gallery: 'gallery',
  park: 'park', garden: 'garden', bowling_alley: 'bowling_alley', escape_game: 'escape_game',
  fitness_center: 'fitness_centre', sports_center: 'sports_centre', stadium: 'stadium',
  water_park: 'water_park', confectionery: 'confectionery', ice_cream_shop: 'ice_cream', zoo: 'zoo',
}
const ALLOWED_LICENSES = new Set(['CDLA-Permissive-2.0', 'Apache-2.0', 'CC0-1.0'])
const ALLOWED_DATASETS = new Set(['meta', 'foursquare', 'microsoft', 'alltheplaces', 'brightquery', 'pinmeto', 'dac', 'krick', 'renderseo'])
const DATASET_LABELS: Record<string, string> = {
  meta: 'Meta', foursquare: 'Foursquare', microsoft: 'Microsoft',
  alltheplaces: 'AllThePlaces', brightquery: 'BrightQuery', pinmeto: 'PinMeTo',
  dac: 'DAC', krick: 'Krick', renderseo: 'RenderSEO',
}
const SOURCE_HOST = 'explore.overturemaps.org'
const GERS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_VERIFICATION_AGE_MS = 180 * 86_400_000
const MAX_SOURCE_DRIFT_METERS = 250

export interface VenueVerification {
  /** A separately inspected listing for the same branch, never the Overture record itself. */
  kind: 'official_site' | '2gis_branch' | 'osm_place' | 'osm_address'
  sourceUrl: string
  /** Link to the independent map pin when it is separate from the venue page. */
  coordinateSourceUrl?: string
  checkedAt: string
  /** Required for venue pages. OSM address features confirm position, not venue identity. */
  name?: string
  address: string
  street?: string
  houseNumber?: string
  /** Coordinates read from the independent source, not copied from Overture. */
  lat: number
  lon: number
}

export interface VerifiedOverturePlace extends DynamicPlace {
  provider: 'Overture Maps'
  sourceDataset: string
  provenance: {
    release: string
    sourceDataset: string
    sourceRecordId: string
    sourceRecordUrl?: string
    sourceLicense: string
    confidence: number
    address: string
    verifiedAddress: string
    sourceLat: number
    sourceLon: number
    coordinateCorrectionMeters: number
    verificationUrl: string
    verificationKind: VenueVerification['kind']
    verificationDistanceMeters: number
    coordinateSourceUrl?: string
    verifiedAt: string
  }
}

export interface OvertureImport {
  places: VerifiedOverturePlace[]
  rejected: Record<string, number>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function safeHttpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.')
      || url.hostname === 'localhost' || /^(?:\d+\.){3}\d+$/.test(url.hostname)) return null
    return url
  } catch { return null }
}

function comparable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

const ADDRESS_WORDS = new Set([
  'улица', 'ул', 'street', 'st', 'көшесі', 'көше', 'кошеси', 'коше',
  'проспект', 'пр', 'prospekt', 'avenue', 'ave', 'дангылы', 'г', 'город',
  'астана', 'дом', 'д', 'корпус', 'korpus', 'й',
])

function latinToCyrillic(value: string): string {
  const transliterated = value.replace(/shch|sch|zh|kh|ch|sh|ts|ya|yu|yo|ye|[a-z]/gu, (piece) => ({
    shch: 'щ', sch: 'щ', zh: 'ж', kh: 'х', ch: 'ч', sh: 'ш', ts: 'ц',
    ya: 'я', yu: 'ю', yo: 'е', ye: 'е',
    a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х',
    i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
    q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс',
    y: 'ы', z: 'з',
  })[piece] ?? piece)
  return transliterated.replace(/аы/gu, 'ай')
}

function addressComponents(value: string): { street: string; house: string[] } {
  const common = value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/gu, 'е')
    .replace(/[қғңәөүұі]/gu, (letter) => ({
      қ: 'к', ғ: 'г', ң: 'н', ә: 'а', ө: 'о', ү: 'у', ұ: 'у', і: 'и',
    })[letter] ?? letter)
    .replace(/\b[a-z]+\b/gu, (word) => ADDRESS_WORDS.has(word) ? '' : latinToCyrillic(word))
    .replace(/(\d+[\p{L}])к(\d+)/gu, '$1 $2')
  const words = common.match(/[\p{L}\p{N}]+/gu) ?? []
  const street = words.filter((word) => !/\d/u.test(word) && !ADDRESS_WORDS.has(word))
    .map((word) => word === 'батыра' ? 'батыр' : word).sort().join(' ')
  const house = words.filter((word) => /\d/u.test(word))
  return { street, house }
}

function comparableAddress(value: string): string {
  const address = addressComponents(value)
  return `${address.street}|${address.house.join('/')}`
}

function addressCompatible(source: string, checked: string, sourceToCheckedMeters: number,
  proofKind: VenueVerification['kind']): boolean {
  const a = addressComponents(source)
  const b = addressComponents(checked)
  if (a.street === b.street && a.house.join('/') === b.house.join('/')) return true
  if (proofKind !== 'official_site' || sourceToCheckedMeters > 100) return false
  const base = (house: string[]): string | undefined => house[0]?.match(/\d+/u)?.[0]
  return a.street.length >= 5 && a.street === b.street && !!base(a.house)
    && base(a.house) === base(b.house)
}

function usefulName(value: unknown): value is string {
  return typeof value === 'string' && comparable(value).length >= 3 && value.trim().length <= 120
}

function overtureId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.startsWith('overture:') ? value.slice(9) : value
  return GERS_ID.test(id) ? id.toLowerCase() : null
}

function overtureCategory(value: unknown): SearchCategory | null {
  return typeof value === 'string' ? CATEGORY_MAP[value] ?? null : null
}

/** Compare a venue to one already known. Repeated branches remain distinct if far apart. */
export function sameVenue(a: Pick<DynamicPlace, 'name' | 'lat' | 'lon' | 'tags'>,
  b: Pick<DynamicPlace, 'name' | 'lat' | 'lon' | 'tags'>): boolean {
  const meters = distanceMeters(a, b)
  if (meters > 220) return false
  const aName = comparable(a.name)
  const bName = comparable(b.name)
  if (aName.length >= 3 && aName === bName) return true
  const aSite = safeHttpsUrl(a.tags.website)
  const bSite = safeHttpsUrl(b.tags.website)
  return meters <= 100 && !!aSite && !!bSite && aSite.hostname === bSite.hostname
}

/** Suspiciously scattered records sharing one street address are all quarantined. */
export function conflictingAddressIds(places: unknown[], maxSpreadMeters = 500): Set<string> {
  const byAddress = new Map<string, Array<{ id: string; lat: number; lon: number }>>()
  for (const raw of places) {
    const place = record(raw)
    const id = overtureId(place?.id)
    const address = typeof place?.address === 'string' ? comparableAddress(place.address) : ''
    const lat = place?.lat
    const lon = place?.lon
    if (!id || address.length < 5 || !/\d/u.test(address)
      || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const group = byAddress.get(address) ?? []
    group.push({ id, lat, lon })
    byAddress.set(address, group)
  }
  const rejected = new Set<string>()
  for (const group of byAddress.values()) {
    if (group.length < 2) continue
    if (group.some((item, index) => group.slice(index + 1)
      .some((other) => distanceMeters(item, other) > maxSpreadMeters))) {
      for (const item of group) rejected.add(item.id)
    }
  }
  return rejected
}

function verifiedEvidence(value: unknown, candidate: Record<string, unknown>, asOf: Date): VenueVerification | null {
  const evidence = record(value)
  if (!evidence || !['official_site', '2gis_branch', 'osm_place', 'osm_address'].includes(String(evidence.kind))) return null
  const source = safeHttpsUrl(evidence.sourceUrl)
  if (!source || source.hostname === SOURCE_HOST) return null
  if (evidence.coordinateSourceUrl !== undefined && !safeHttpsUrl(evidence.coordinateSourceUrl)) return null
  if (evidence.kind === '2gis_branch' && !/^2gis\.kz$/i.test(source.hostname)) return null
  if ((evidence.kind === 'osm_place' || evidence.kind === 'osm_address')
    && (!/^www\.openstreetmap\.org$/i.test(source.hostname)
      || !/^\/(?:node|way|relation)\/\d+$/u.test(source.pathname))) return null
  if (evidence.kind === 'official_site' && /(?:^|\.)(?:facebook|instagram|foursquare|overturemaps)\.(?:com|org)$/i.test(source.hostname)) return null
  const checkedAt = typeof evidence.checkedAt === 'string' ? Date.parse(evidence.checkedAt) : NaN
  if (!Number.isFinite(checkedAt) || checkedAt > asOf.getTime() + 86_400_000
    || asOf.getTime() - checkedAt > MAX_VERIFICATION_AGE_MS) return null
  if (!usefulName(candidate.name)) return null
  if (evidence.kind !== 'osm_address'
    && (!usefulName(evidence.name) || comparable(evidence.name) !== comparable(candidate.name))) return null
  if (typeof evidence.lat !== 'number' || typeof evidence.lon !== 'number'
    || !Number.isFinite(evidence.lat) || !Number.isFinite(evidence.lon)
    || !insideAstana({ lat: evidence.lat, lon: evidence.lon })) return null
  const sourceToCheckedMeters = distanceMeters({ lat: evidence.lat, lon: evidence.lon },
    { lat: candidate.lat as number, lon: candidate.lon as number })
  if (sourceToCheckedMeters > (evidence.kind === 'osm_address' ? 150 : MAX_SOURCE_DRIFT_METERS)
    || typeof evidence.address !== 'string' || typeof candidate.address !== 'string'
    || !addressCompatible(candidate.address, evidence.address, sourceToCheckedMeters,
      evidence.kind as VenueVerification['kind'])) return null
  if (evidence.kind === 'osm_address'
    && (typeof evidence.street !== 'string' || typeof evidence.houseNumber !== 'string'
      || !evidence.street.trim() || !evidence.houseNumber.trim()
      || comparableAddress(`${evidence.street} ${evidence.houseNumber}`)
        !== comparableAddress(evidence.address))) return null
  return evidence as unknown as VenueVerification
}

/**
 * Parse a compact, human-curated Overture snapshot. The 521-record research
 * candidate file has candidateOnly=true and cannot be promoted by confidence.
 * An official venue page can independently verify the branch. OSM address
 * evidence only checks the street, house number and location; it does not prove
 * that the named business is currently operating at that address.
 */
export function importVerifiedOverture(raw: unknown, existing: DynamicPlace[], asOf = new Date()): OvertureImport {
  const snapshot = record(raw)
  const source = record(snapshot?.source)
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.candidateOnly === true
    || source?.provider !== 'Overture Maps Places'
    || typeof source.release !== 'string' || !/^\d{4}-\d{2}-\d{2}\.\d+$/u.test(source.release)
    || !Array.isArray(snapshot.places)) return { places: [], rejected: { invalid_snapshot: 1 } }
  const rejected: Record<string, number> = {}
  const reject = (reason: string): void => { rejected[reason] = (rejected[reason] ?? 0) + 1 }
  const conflicts = conflictingAddressIds(snapshot.places)
  const places: VerifiedOverturePlace[] = []
  const seen = new Set<string>()
  for (const rawPlace of snapshot.places) {
    const place = record(rawPlace)
    const id = overtureId(place?.id)
    if (!place || !id || seen.has(id)) { reject('id'); continue }
    seen.add(id)
    if (conflicts.has(id)) { reject('address_conflict'); continue }
    const category = overtureCategory(place.category)
    if (!category) { reject('category'); continue }
    if (place.category === 'lounge' && (typeof place.name !== 'string'
      || !/(?:^|[\s-])(?:bar|бар)(?=$|[\s-])/iu.test(place.name))) {
      reject('category'); continue
    }
    const lat = place.lat
    const lon = place.lon
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)
      || !insideAstana({ lat, lon })) { reject('location'); continue }
    if (!usefulName(place.name) || typeof place.address !== 'string'
      || comparableAddress(place.address).length < 5 || !/\d/u.test(place.address)) {
      reject('identity'); continue
    }
    if (typeof place.confidence !== 'number' || !Number.isFinite(place.confidence)
      || place.confidence < .8 || place.confidence > 1) { reject('confidence'); continue }
    if (place.operatingStatus === 'permanently_closed' || place.operatingStatus === 'temporarily_closed') {
      reject('closed'); continue
    }
    if (place.provider !== 'Overture Maps' || typeof place.sourceProvider !== 'string'
      || !ALLOWED_DATASETS.has(place.sourceProvider.toLowerCase())
      || typeof place.sourceRecordId !== 'string'
      || !(place.sourceProvider.toLowerCase() === 'alltheplaces'
        ? /^[A-Za-z0-9+/_=-]{1,160}$/u.test(place.sourceRecordId)
        : /^[\p{L}\p{N}._:-]{1,160}$/u.test(place.sourceRecordId))
      || !ALLOWED_LICENSES.has(String(place.sourceLicense))) { reject('provenance'); continue }
    const evidence = verifiedEvidence(place.verification, place, asOf)
    if (!evidence) { reject('unverified'); continue }
    const candidate: VerifiedOverturePlace = {
      id: `overture:${id}`, name: String(place.name).trim().replace(/\s+/g, ' '), category,
      lat: evidence.kind === 'osm_address' ? lat : evidence.lat,
      lon: evidence.kind === 'osm_address' ? lon : evidence.lon,
      visitMinutes: typeof place.visitMinutes === 'number' && Number.isFinite(place.visitMinutes)
        ? Math.max(20, Math.min(90, Math.round(place.visitMinutes))) : 45,
      sourceUrl: `https://${SOURCE_HOST}/?mode=inspect&feature=places.place.${id}#18/${lat.toFixed(6)}/${lon.toFixed(6)}/0/0`,
      provider: 'Overture Maps',
      sourceDataset: DATASET_LABELS[place.sourceProvider.toLowerCase()],
      tags: {
        'overture:category': String(place.category), 'addr:full': evidence.address,
        ...(evidence.kind === 'osm_address' ? {
          'addr:street': evidence.street as string, 'addr:housenumber': evidence.houseNumber as string,
        } : {}),
        ...(evidence.kind === 'official_site' ? { website: evidence.sourceUrl } : {}),
      },
      provenance: {
        release: source.release, sourceDataset: place.sourceProvider,
        sourceRecordId: place.sourceRecordId, sourceLicense: String(place.sourceLicense),
        ...(safeHttpsUrl(place.sourceRecordUrl) ? { sourceRecordUrl: String(place.sourceRecordUrl) } : {}),
        confidence: place.confidence, address: String(place.address).trim(),
        verifiedAddress: evidence.address, sourceLat: lat, sourceLon: lon,
        coordinateCorrectionMeters: evidence.kind === 'osm_address' ? 0 : Math.round(distanceMeters({ lat, lon }, evidence)),
        verificationDistanceMeters: Math.round(distanceMeters({ lat, lon }, evidence)),
        verificationUrl: evidence.sourceUrl, verificationKind: evidence.kind,
        verifiedAt: evidence.checkedAt,
        ...(evidence.coordinateSourceUrl ? { coordinateSourceUrl: evidence.coordinateSourceUrl } : {}),
      },
    }
    if (existing.some((other) => sameVenue(candidate, other)) || places.some((other) => sameVenue(candidate, other))) {
      reject('duplicate'); continue
    }
    places.push(candidate)
  }
  return { places, rejected }
}

export { CATEGORY_MAP as OVERTURE_CATEGORY_MAP }
