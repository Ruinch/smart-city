import type { WalkRequest } from '../shared/types'

export interface Coordinate { lat: number; lon: number }

export interface DirectionMetrics {
  /** Projection of the place on the start-to-target axis: 0=start, 1=target. */
  progress: number
  /** Shortest straight-line offset from that axis. */
  lateralMeters: number
  targetMeters: number
}

/** Local flat projection is sufficient for filtering candidate places around Astana. */
export function directionMetrics(origin: Coordinate, target: Coordinate,
  place: Coordinate): DirectionMetrics | null {
  const metersPerDegree = 111_195
  const lonScale = metersPerDegree * Math.cos(origin.lat * Math.PI / 180)
  const tx = (target.lon - origin.lon) * lonScale
  const ty = (target.lat - origin.lat) * metersPerDegree
  const distanceSquared = tx * tx + ty * ty
  if (distanceSquared < 500 * 500) return null
  const px = (place.lon - origin.lon) * lonScale
  const py = (place.lat - origin.lat) * metersPerDegree
  return {
    progress: (px * tx + py * ty) / distanceSquared,
    lateralMeters: Math.abs(px * ty - py * tx) / Math.sqrt(distanceSquared),
    targetMeters: Math.sqrt(distanceSquared),
  }
}

export function cityCorridorMeters(targetMeters: number, transport: WalkRequest['transport']): number {
  return transport === 'walk'
    ? Math.max(900, Math.min(3_500, targetMeters * .3))
    : Math.max(1_500, Math.min(5_000, targetMeters * .38))
}

export function onCityHeading(origin: Coordinate, target: Coordinate, place: Coordinate,
  transport: WalkRequest['transport']): boolean {
  const metrics = directionMetrics(origin, target, place)
  if (!metrics) return true
  return metrics.progress >= -.06 && metrics.progress <= 1.3
    && metrics.lateralMeters <= cityCorridorMeters(metrics.targetMeters, transport)
}

export function cityDirectionScore(origin: Coordinate, target: Coordinate, place: Coordinate,
  transport: WalkRequest['transport']): number {
  const metrics = directionMetrics(origin, target, place)
  if (!metrics) return 0
  const corridor = cityCorridorMeters(metrics.targetMeters, transport)
  return 50 * Math.max(0, Math.min(1, metrics.progress))
    - 12 * metrics.lateralMeters / corridor
    - 30 * Math.max(0, -metrics.progress)
    - 30 * Math.max(0, metrics.progress - 1)
}

/** Rough out-of-city heading; it does not assert a road reaches the selected area. */
export function onTripHeading(origin: Coordinate, target: Coordinate, place: Coordinate): boolean {
  const metrics = directionMetrics(origin, target, place)
  if (!metrics) return true
  const placeDx = (place.lon - origin.lon) * Math.cos(origin.lat * Math.PI / 180)
  const placeDy = place.lat - origin.lat
  const placeMeters = Math.hypot(placeDx, placeDy) * 111_195
  return placeMeters < 2_000 || metrics.progress * metrics.targetMeters / placeMeters >= .25
}

export function tripDirectionScore(origin: Coordinate, target: Coordinate, place: Coordinate): number {
  const metrics = directionMetrics(origin, target, place)
  if (!metrics) return 0
  const targetDistance = Math.hypot((target.lon - place.lon) * Math.cos(origin.lat * Math.PI / 180),
    target.lat - place.lat) * 111_195
  return 35 * Math.max(-1, Math.min(1, metrics.progress))
    - Math.min(35, targetDistance / 12_000)
}
