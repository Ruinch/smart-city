import type { PriceEvidence, RoutePlan, WalkRequest } from '../shared/types'
import { insideAstana } from '../shared/astana'
import { assembleRoute, rankDynamicPlaces, type DynamicPlace, type SearchIntent } from './dynamic'
import { onCityHeading } from './direction'
import { distanceMeters } from './recommend'

export type ReplaceReason = 'far' | 'expensive' | 'visited' | 'other'

export interface ReplaceStopInput {
  request: WalkRequest
  intent: SearchIntent
  /** Only the ordered stop IDs are used; stop details must be resolved server-side. */
  route: { stops: Array<{ id: string }> }
  stopIndex: number
  reason: ReplaceReason
  /** Trusted, sourced city places, including every current stop and alternatives. */
  rankedPlaces: DynamicPlace[]
  /** Server-resolved origin, never coordinates supplied inside route. */
  origin: { lat: number; lon: number }
  originName?: string
  /** Optional server-researched prices keyed by place ID, never client claims. */
  priceEvidenceById?: ReadonlyMap<string, PriceEvidence>
}

export interface ReplaceStopResult {
  route: RoutePlan
  replacement: DynamicPlace
  /** True when an approximate direction had to be softened to preserve a useful route. */
  headingAdjusted: boolean
  /** True when a requested cheaper price has not been established by two sourced prices. */
  priceUnverified: boolean
}

function sourced(place: DynamicPlace): boolean {
  if (!place.name.trim() || place.name.length > 120 || !Number.isFinite(place.visitMinutes)
    || place.visitMinutes <= 0 || !insideAstana(place)) return false
  let url: URL
  try { url = new URL(place.sourceUrl) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  if (place.provider === 'OpenStreetMap') {
    const match = /^osm:(node|way|relation):([1-9]\d{0,12})$/.exec(place.id)
    return !!match && url.hostname === 'www.openstreetmap.org'
      && url.pathname === `/${match[1]}/${match[2]}`
  }
  if (place.provider === 'Overture Maps') {
    const match = /^overture:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(place.id)
    return !!match && url.hostname === 'explore.overturemaps.org'
      && url.searchParams.get('feature')?.toLowerCase() === `places.place.${match[1].toLowerCase()}`
  }
  if (place.provider === '2GIS') {
    const match = /^2gis:([1-9]\d{0,20})$/.exec(place.id)
    return !!match && url.hostname === '2gis.kz' && url.pathname === `/astana/firm/${match[1]}`
  }
  return false
}

function validPrice(price: PriceEvidence | undefined): PriceEvidence | undefined {
  if (!price || !Number.isFinite(price.minKzt) || price.minKzt < 0) return undefined
  try {
    const url = new URL(price.sourceUrl)
    return url.protocol === 'https:' && !url.username && !url.password ? price : undefined
  } catch { return undefined }
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function routeDistance(origin: { lat: number; lon: number }, places: DynamicPlace[]): number {
  let previous = origin
  let meters = 0
  for (const place of places) {
    meters += distanceMeters(previous, place)
    previous = place
  }
  return meters
}

/**
 * Replace exactly one sourced city stop. The caller must resolve every route ID
 * against its current server catalog and enrich the returned route independently.
 * Group capacity is unknown, so it cannot be used as a verified exclusion.
 */
export function replaceRouteStop(input: ReplaceStopInput): ReplaceStopResult | null {
  const { request, intent, route, stopIndex, reason, rankedPlaces, origin } = input
  if (request.scope === 'day_trip' || !insideAstana(origin)
    || route.stops.length < 1 || route.stops.length > 3
    || !Number.isInteger(stopIndex) || stopIndex < 0 || stopIndex >= route.stops.length
    || !['far', 'expensive', 'visited', 'other'].includes(reason)) return null

  const byId = new Map(rankedPlaces.filter(sourced).map((place) => [place.id, place]))
  const oldIds = route.stops.map((stop) => stop.id)
  if (new Set(oldIds).size !== oldIds.length) return null
  const oldPlaces = oldIds.map((id) => byId.get(id))
  if (oldPlaces.some((place) => !place)) return null
  const current = oldPlaces as DynamicPlace[]
  const replaced = current[stopIndex]
  const oldDistance = routeDistance(origin, current)
  const oldPrice = validPrice(input.priceEvidenceById?.get(replaced.id))
  // Apply the planner's hard filters without its optional heading filter. The
  // direction is handled below in two passes, after all fixed stops are known.
  const allowed = new Set(rankDynamicPlaces([...byId.values()],
    { ...request, targetArea: undefined }, intent, origin)
    .map((place) => place.id))
  // Existing stops also have to remain compatible with hard constraints such
  // as wheelchair=yes, indoor/outdoor and a zero budget.
  if (current.some((place) => !allowed.has(place.id))) return null

  const knownIds = new Set(oldIds)
  const excluded = new Set(request.excludePlaceIds ?? [])
  const order = new Map(rankedPlaces.map((place, index) => [place.id, index]))
  const choices = [...byId.values()].filter((place) => {
    if (knownIds.has(place.id) || excluded.has(place.id) || !allowed.has(place.id)) return false
    if (place.category !== replaced.category && !intent.categories.includes(place.category as SearchIntent['categories'][number])) return false
    if (request.intents.includes('child') && ['nightclub', 'bar', 'biergarten', 'karaoke'].includes(place.category)) return false
    if (normalizedName(place.name) === normalizedName(replaced.name)
      && distanceMeters(place, replaced) < 350) return false
    const price = validPrice(input.priceEvidenceById?.get(place.id))
    if (request.budgetKzt !== undefined && price && price.minKzt > request.budgetKzt) return false
    if (reason === 'expensive' && oldPrice && price && price.unit === oldPrice.unit
      && price.minKzt >= oldPrice.minKzt) return false
    return true
  })

  const candidateDistance = (place: DynamicPlace): number => {
    const proposed = [...current]
    proposed[stopIndex] = place
    return routeDistance(origin, proposed)
  }
  choices.sort((left, right) => {
    if (reason === 'expensive') {
      const lp = validPrice(input.priceEvidenceById?.get(left.id))
      const rp = validPrice(input.priceEvidenceById?.get(right.id))
      const leftComparable = !!lp && !!oldPrice && lp.unit === oldPrice.unit
      const rightComparable = !!rp && !!oldPrice && rp.unit === oldPrice.unit
      if (leftComparable !== rightComparable) return leftComparable ? -1 : 1
      if (leftComparable && rightComparable && lp!.minKzt !== rp!.minKzt) return lp!.minKzt - rp!.minKzt
    }
    if (reason === 'far') {
      const difference = candidateDistance(left) - candidateDistance(right)
      if (difference) return difference
    }
    const sameCategory = Number(right.category === replaced.category) - Number(left.category === replaced.category)
    const categoryPreference = reason === 'other' ? -sameCategory : sameCategory
    return categoryPreference || (order.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  })

  const target = request.targetArea
  const modes: Array<'strict' | 'relaxed'> = target ? ['strict', 'relaxed'] : ['strict']
  for (const mode of modes) {
    for (const choice of choices) {
      const proposed = [...current]
      proposed[stopIndex] = choice
      if (reason === 'far' && candidateDistance(choice) > oldDistance - Math.max(100, oldDistance * .05)) continue
      if (mode === 'strict' && target && proposed.some((place) =>
        !onCityHeading(origin, target, place, request.transport ?? 'walk'))) continue
      const routeRequest = mode === 'relaxed' ? { ...request, targetArea: undefined } : request
      const next = assembleRoute(routeRequest, intent, proposed, origin, input.originName)
      if (!next || next.stops.length !== proposed.length
        || next.stops.some((stop, index) => stop.id !== proposed[index].id)) continue
      const choicePrice = validPrice(input.priceEvidenceById?.get(choice.id))
      return {
        route: next,
        replacement: choice,
        headingAdjusted: mode === 'relaxed',
        priceUnverified: reason === 'expensive'
          && (!oldPrice || !choicePrice || choicePrice.unit !== oldPrice.unit
            || choicePrice.minKzt >= oldPrice.minKzt),
      }
    }
  }
  return null
}
