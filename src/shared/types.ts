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

export interface WalkRequest {
  cityId?: string
  scope?: TripScope
  transport?: TransportMode
  /** Maximum amount the visitor plans to spend, in tenge. Prices may be unknown. */
  budgetKzt?: number
  latitude?: number
  longitude?: number
  landmarkId?: string
  minutes: number
  intents: Intent[]
  text: string
}

export interface RecommendRequest {
  initData: string
  request: WalkRequest
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
  routeUrl: string
  approximate?: boolean
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
  note?: string
}
