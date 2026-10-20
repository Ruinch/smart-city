export type Intent = 'outdoors' | 'indoors' | 'child'

export interface Poi {
  id: string
  name: string
  names?: { ru?: string; kk?: string; en?: string }
  category: string
  description: string
  descriptionSource: 'osm_tags' | 'category_template'
  lat: number
  lon: number
  visitMinutes: number
  sourceUrl: string
  osmType: 'node' | 'way' | 'relation'
  osmId: number
  tags: Record<string, string>
}

export interface PoiCatalog {
  schemaVersion: 1
  zone: {
    id: string
    name: string
    center: { lat: number; lon: number }
    radiusMeters: number
  }
  source: {
    provider: 'OpenStreetMap'
    importedAt: string
    osmBaseTimestamp?: string
    attribution: string
    licenseUrl: string
  }
  pois: Poi[]
}

export interface CityCatalog {
  id: string
  name: string
  center: { lat: number; lon: number }
  radiusMeters: number
  pois: Poi[]
}

export interface Trip {
  id: string
  name: string
  cityId: string
  category: string
  description: string
  descriptionSource: 'osm_tags' | 'category_template'
  lat: number
  lon: number
  visitMinutes: number
  sourceUrl: string
  osmType: 'node' | 'way' | 'relation'
  osmId: number
  tags: Record<string, string>
  /** Main visit setting, backed by a venue or OSM source. */
  setting: 'indoor' | 'outdoor'
  settingSourceUrl: string
  /** Sourced broad duration category, never an exact road ETA. */
  durationClass?: 'half_day' | 'full_day'
  durationSourceUrl?: string
  travel: {
    roadKmApprox?: number
    driveMinutesApprox?: number
    transitMinutesApprox?: number
    sourceUrl?: string
    costKzt?: { min: number; max: number; sourceUrl?: string }
    notes?: string
  }
}

export interface TripCatalog {
  schemaVersion: 1
  source: PoiCatalog['source']
  trips: Trip[]
}

export type TripScope = 'city' | 'day_trip'
export type TransportMode = 'walk' | 'car' | 'transit'
export type Language = 'ru' | 'kk' | 'en'

export interface WalkRequest {
  /** Language explicitly selected in the Mini App; independent of the prompt language. */
  language?: Language
  cityId?: string
  scope?: TripScope
  transport?: TransportMode
  /** Maximum amount the visitor plans to spend, in tenge. Prices may be unknown. */
  budgetKzt?: number
  latitude?: number
  longitude?: number
  /** Optional rough heading/end area. Used only for the current request, not as a required stop. */
  targetArea?: { lat: number; lon: number }
  /** Require the venue's OSM wheelchair tag to be yes. Street access is not verified. */
  accessibility?: 'osm_wheelchair_yes'
  /** Cap each approximate walking leg at ten minutes; walking routes only. */
  shortLegs?: boolean
  /** Prefer at most two city stops with more time at each; no seating claim. */
  gentlePace?: boolean
  /** Opt-in playful route with varied real stops and local-only completion. */
  microQuest?: boolean
  landmarkId?: string
  minutes: number
  intents: Intent[]
  text: string
  /** Number of people travelling together. Capacity remains unverified. */
  groupSize?: number
  /** Previously shown sourced places to skip when asking for more ideas. */
  excludePlaceIds?: string[]
}

export interface RecommendRequest {
  initData: string
  request: WalkRequest
}

/** A published venue price found at request time, not a total outing estimate. */
export interface PriceEvidence {
  minKzt: number
  maxKzt?: number
  unit: 'entry' | 'average_bill' | 'item'
  qualifier: 'exact' | 'from' | 'range'
  checkedAt: string
  sourceUrl: string
}

export interface Recommendation {
  id: string
  name: string
  category: string
  kind?: 'place' | 'trip'
  cityId?: string
  lat?: number
  lon?: number
  travelMode?: TransportMode
  travelMinutesApprox?: number
  distanceKmApprox?: number
  estimatedCostKzt?: { min: number; max: number }
  priceEvidence?: PriceEvidence
  /** Venue-level OSM accessibility tag; absent means unknown. */
  wheelchairTag?: 'yes' | 'limited' | 'no'
  travelSourceUrl?: string
  costSourceUrl?: string
  durationSourceUrl?: string
  budgetStatus?: 'within' | 'possible' | 'unknown'
  timeStatus?: 'within' | 'unknown'
  why: string
  action: string
  actionSource: 'ai' | 'template'
  walkMinutes?: number
  visitMinutes?: number
  hoursStatus?: string
  sourceUrl: string
  /** Website recorded for this place by the source catalog; availability is unverified. */
  venueWebsite?: string
  routeUrl: string
  approximate?: boolean
  /** Position in the generated itinerary, starting at one. */
  stopOrder?: number
  /** Optional sourced claim verified separately from the OSM location. */
  evidence?: Array<{ claim: string; sourceUrl: string }>
  sourceProvider?: 'OpenStreetMap' | 'Overture Maps' | '2GIS'
  /** Original Overture supplier when present, displayed with the source link. */
  sourceDataset?: string
}

/** A route is an ordered itinerary selected at request time from sourced places. */
export interface RoutePlan {
  id: string
  title: string
  summary: string
  stops: Recommendation[]
  routeUrl: string
  /** Start actually used by the server, including a matched named area. */
  origin?: { lat: number; lon: number; name?: string }
  /** Walking and visit estimate only; omitted when travel time is unknown. */
  totalMinutesApprox?: number
  /** Straight-line distance between stops, never a road distance. */
  distanceKmApprox?: number
  geometry?: Array<{ lat: number; lon: number }>
}

export interface MapPlace {
  id: string
  name: string
  category: string
  cityId: string
  kind: 'place' | 'trip'
  lat: number
  lon: number
  sourceUrl: string
}

export interface RecommendResponse {
  summary: string
  recommendations: Recommendation[]
  routes?: RoutePlan[]
  note?: string
}
