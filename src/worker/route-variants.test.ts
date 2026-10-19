import { describe, expect, it } from 'vitest'
import type { WalkRequest } from '../shared/types'
import { buildRouteVariants } from './route-variants'
import type { DynamicPlace, SearchIntent } from './dynamic'

const origin = { lat: 51.1282, lon: 71.4304 }
const request: WalkRequest = {
  cityId: 'astana', scope: 'city', transport: 'walk', minutes: 180,
  intents: [], text: 'Кофе и книга',
}
const intent: SearchIntent = { theme: 'reading', categories: ['cafe', 'library'] }

function place(id: string, category: string, lon: number): DynamicPlace {
  return { id, name: id, category, lat: origin.lat, lon, visitMinutes: 30,
    sourceUrl: `https://www.openstreetmap.org/node/${id}`, tags: {}, provider: 'OpenStreetMap' }
}

describe('city route variants', () => {
  it('returns separate cafe and reading plans instead of repeating the same stops', () => {
    const places = [
      place('cafe-1', 'cafe', 71.4304), place('library-1', 'library', 71.431),
      place('cafe-2', 'cafe', 71.439), place('library-2', 'library', 71.440),
      place('cafe-3', 'cafe', 71.449), place('library-3', 'library', 71.450),
    ]
    const routes = buildRouteVariants(request, intent, places, origin)
    expect(routes).toHaveLength(3)
    expect(routes.every((route) => route.stops[0].category === 'cafe')).toBe(true)
    expect(new Set(routes.flatMap((route) => route.stops.map((stop) => stop.id))).size)
      .toBe(routes.reduce((total, route) => total + route.stops.length, 0))
    expect(routes.every((route) => route.stops.some((stop) => stop.category === 'library'))).toBe(true)
  })

  it('returns one grounded route when there are no meaningful alternatives', () => {
    const routes = buildRouteVariants(request, intent, [place('only-cafe', 'cafe', 71.4304)], origin)
    expect(routes).toHaveLength(1)
    expect(routes[0].stops[0].id).toBe('only-cafe')
  })
})
