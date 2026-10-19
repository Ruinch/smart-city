import type { RoutePlan, WalkRequest } from '../shared/types'
import { assembleRoute, type DynamicPlace, type SearchIntent } from './dynamic'
import { distanceMeters } from './recommend'

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru').trim()
}

/** Offer distinct routes from retrieved places without asking the model to invent locations. */
export function buildRouteVariants(request: WalkRequest, intent: SearchIntent,
  ordered: DynamicPlace[], origin: { lat: number; lon: number }, originName?: string): RoutePlan[] {
  const first = assembleRoute(request, intent, ordered, origin, originName)
  if (!first) return []
  const routes = [first]
  const used = new Set(first.stops.map((stop) => stop.id))
  const firstStops = ordered.filter((place) => place.id === first.stops[0].id)
  const wantsCoffee = /коф|кафе|coffee|cafe/u.test(normalized(request.text))
  const hasCafe = ordered.some((place) => place.category === 'cafe' && !used.has(place.id))

  for (const seed of ordered.slice(0, 100)) {
    if (routes.length === 3) break
    if (used.has(seed.id)) continue
    if (intent.theme === 'reading' && wantsCoffee && hasCafe && seed.category !== 'cafe') continue
    if (firstStops.some((stop) => normalized(stop.name) === normalized(seed.name)
      || distanceMeters(stop, seed) < 350)) continue

    const available = ordered.filter((place) => !used.has(place.id) && place.id !== seed.id)
    const nearby = available.filter((place) => distanceMeters(seed, place) <= 2_000)
    const complements = nearby.filter((place) => place.category !== seed.category)
      .sort((left, right) => distanceMeters(seed, left) - distanceMeters(seed, right))
    const otherNearby = nearby.filter((place) => place.category === seed.category)
      .sort((left, right) => distanceMeters(seed, left) - distanceMeters(seed, right))
    const proposed = [seed, ...complements, ...otherNearby, ...available]
    const route = assembleRoute(request, intent, proposed, origin, originName)
    if (!route || route.stops[0]?.id !== seed.id) continue
    if (route.stops.some((stop) => used.has(stop.id))) continue
    routes.push(route)
    firstStops.push(seed)
    for (const stop of route.stops) used.add(stop.id)
  }
  return routes
}
