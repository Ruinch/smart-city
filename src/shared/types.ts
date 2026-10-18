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

export interface WalkRequest {
  latitude?: number
  longitude?: number
  landmarkId?: string
  minutes: 30 | 60 | 120
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

export interface RecommendResponse {
  summary: string
  recommendations: Recommendation[]
  note?: string
}
