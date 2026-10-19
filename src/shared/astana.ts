import boundaryJson from '../../data/astana-boundary.json'

export interface Coordinate { lat: number; lon: number }

export const ASTANA_CENTER: Coordinate = { lat: 51.1282, lon: 71.4304 }
export const ASTANA_RADIUS_METERS = 35_000
export const TRIP_PLANNING_RADIUS_METERS = 350_000

const boundary = boundaryJson as unknown as {
  features: Array<{ geometry: { type: string; coordinates: number[][][][] } }>
}

function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180
  const deltaLat = (b.lat - a.lat) * radians
  const deltaLon = (b.lon - a.lon) * radians
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(deltaLon / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A broad planning bound, not a claim that every point is reachable as a day trip. */
export function insideTripPlanningArea(point: Coordinate): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180
    && distanceMeters(point, ASTANA_CENTER) <= TRIP_PLANNING_RADIUS_METERS
}

function inRing(point: Coordinate, ring: number[][]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index]
    const [oldX, oldY] = ring[previous]
    if ((y > point.lat) !== (oldY > point.lat)
      && point.lon < (oldX - x) * (point.lat - y) / (oldY - y) + x) inside = !inside
  }
  return inside
}

/** The same OSM city boundary guards both user-picked and server-side origins. */
export function insideAstana(point: Coordinate): boolean {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)
    || distanceMeters(point, ASTANA_CENTER) > ASTANA_RADIUS_METERS) return false
  const geometry = boundary.features[0]?.geometry
  if (geometry?.type !== 'MultiPolygon') return false
  return geometry.coordinates.some((polygon) => polygon.length > 0
    && inRing(point, polygon[0]) && !polygon.slice(1).some((hole) => inRing(point, hole)))
}
