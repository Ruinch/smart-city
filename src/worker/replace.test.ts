import { describe, expect, it } from 'vitest'
import type { PriceEvidence, WalkRequest } from '../shared/types'
import { ASTANA_CENTER, assembleRoute, type DynamicPlace, type SearchIntent } from './dynamic'
import { replaceRouteStop } from './replace'

const request = (extra: Partial<WalkRequest> = {}): WalkRequest => ({
  cityId: 'astana', scope: 'city', transport: 'walk', minutes: 120,
  intents: [], text: 'Хочу интересные места', ...extra,
})

const intent: SearchIntent = { theme: 'general', categories: ['park', 'museum', 'cafe'] }

function place(id: number, category: string, lonOffset: number, latOffset = 0): DynamicPlace {
  return {
    id: `osm:node:${id}`, name: `${category} ${id}`, category,
    lat: ASTANA_CENTER.lat + latOffset, lon: ASTANA_CENTER.lon + lonOffset,
    visitMinutes: 30, tags: {}, provider: 'OpenStreetMap',
    sourceUrl: `https://www.openstreetmap.org/node/${id}`,
  }
}

function routeFor(input: WalkRequest, theme: SearchIntent, stops: DynamicPlace[]) {
  const route = assembleRoute(input, theme, stops, ASTANA_CENTER)
  expect(route?.stops.map((stop) => stop.id)).toEqual(stops.map((stop) => stop.id))
  return route!
}

function price(minKzt: number): PriceEvidence {
  return {
    minKzt, unit: 'average_bill', qualifier: 'from',
    checkedAt: '2026-10-20', sourceUrl: 'https://example.com/menu',
  }
}

describe('one-stop replacement', () => {
  it('replaces only the distant middle stop, preserving the other IDs and order', () => {
    const first = place(1, 'park', .003)
    const distant = place(2, 'museum', .015, .01)
    const last = place(3, 'park', .025)
    const nearer = place(4, 'museum', .01)
    const input = request({ minutes: 180 })
    const current = routeFor(input, intent, [first, distant, last])
    const next = replaceRouteStop({ request: input, intent, route: current,
      stopIndex: 1, reason: 'far', rankedPlaces: [first, distant, last, nearer], origin: ASTANA_CENTER })
    expect(next?.route.stops.map((stop) => stop.id)).toEqual([first.id, nearer.id, last.id])
    expect(next?.route.totalMinutesApprox).toBeLessThan(current.totalMinutesApprox!)
    expect(next?.headingAdjusted).toBe(false)
  })

  it('does not silently delete a fixed stop when an alternative exceeds the time limit', () => {
    const input = request({ minutes: 35 })
    const first = place(11, 'park', .001)
    const tooFar = place(12, 'park', .03)
    const current = routeFor(input, intent, [first])
    expect(replaceRouteStop({ request: input, intent, route: current,
      stopIndex: 0, reason: 'other', rankedPlaces: [first, tooFar], origin: ASTANA_CENTER }))
      .toBeNull()
  })

  it('keeps wheelchair and zero-budget filters, and rejects an unsourced alternative', () => {
    const first = { ...place(21, 'park', .001), tags: { wheelchair: 'yes' } }
    const inaccessible = place(22, 'park', .002)
    const paid = { ...place(23, 'cafe', .002), tags: { wheelchair: 'yes' } }
    const forged = { ...place(24, 'park', .002), tags: { wheelchair: 'yes' },
      sourceUrl: 'https://example.com/invented' }
    const input = request({ accessibility: 'osm_wheelchair_yes', budgetKzt: 0 })
    const current = routeFor(input, intent, [first])
    expect(replaceRouteStop({ request: input, intent, route: current,
      stopIndex: 0, reason: 'other', rankedPlaces: [first, inaccessible, paid, forged],
      origin: ASTANA_CENTER })).toBeNull()
  })

  it('prefers a stop on the chosen heading, then clearly marks a nearby off-heading fallback', () => {
    const input = request({ targetArea: { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + .06 } })
    const first = place(31, 'museum', .01)
    const strict = place(32, 'museum', .02)
    const offHeading = place(33, 'museum', .01, .025)
    const current = routeFor(input, intent, [first])
    const inHeading = replaceRouteStop({ request: input, intent, route: current,
      stopIndex: 0, reason: 'visited', rankedPlaces: [first, offHeading, strict], origin: ASTANA_CENTER })
    expect(inHeading?.replacement.id).toBe(strict.id)
    expect(inHeading?.headingAdjusted).toBe(false)
    const relaxed = replaceRouteStop({ request: input, intent, route: current,
      stopIndex: 0, reason: 'visited', rankedPlaces: [first, offHeading], origin: ASTANA_CENTER })
    expect(relaxed?.replacement.id).toBe(offHeading.id)
    expect(relaxed?.headingAdjusted).toBe(true)
  })

  it('uses sourced cheaper prices first and flags an unknown-price alternative', () => {
    const input = request({ text: 'Хочу кофе', budgetKzt: 4_000 })
    const reading: SearchIntent = { theme: 'reading', categories: ['cafe'] }
    const first = place(41, 'cafe', .002)
    const unknown = place(42, 'cafe', .003)
    const cheaper = place(43, 'cafe', .004)
    const current = routeFor(input, reading, [first])
    const prices = new Map([[first.id, price(3_000)], [cheaper.id, price(1_500)]])
    const next = replaceRouteStop({ request: input, intent: reading, route: current,
      stopIndex: 0, reason: 'expensive', rankedPlaces: [first, unknown, cheaper],
      origin: ASTANA_CENTER, priceEvidenceById: prices })
    expect(next?.replacement.id).toBe(cheaper.id)
    expect(next?.priceUnverified).toBe(false)
    const fallback = replaceRouteStop({ request: input, intent: reading, route: current,
      stopIndex: 0, reason: 'expensive', rankedPlaces: [first, unknown],
      origin: ASTANA_CENTER, priceEvidenceById: prices })
    expect(fallback?.replacement.id).toBe(unknown.id)
    expect(fallback?.priceUnverified).toBe(true)
  })

  it('does not compare an item price with an average bill as if both were total cost', () => {
    const input = request({ text: 'Хочу кофе', budgetKzt: 4_000 })
    const reading: SearchIntent = { theme: 'reading', categories: ['cafe'] }
    const first = place(61, 'cafe', .002)
    const alternative = place(62, 'cafe', .003)
    const current = routeFor(input, reading, [first])
    const prices = new Map([
      [first.id, price(3_000)],
      [alternative.id, { ...price(500), unit: 'item' as const }],
    ])
    const next = replaceRouteStop({ request: input, intent: reading, route: current,
      stopIndex: 0, reason: 'expensive', rankedPlaces: [first, alternative],
      origin: ASTANA_CENTER, priceEvidenceById: prices })
    expect(next?.replacement.id).toBe(alternative.id)
    expect(next?.priceUnverified).toBe(true)
  })

  it('prefers another relevant category for the “something else” reason', () => {
    const input = request()
    const original = place(71, 'park', .001)
    const sameCategory = place(72, 'park', .002)
    const museum = place(73, 'museum', .003)
    const current = routeFor(input, intent, [original])
    const next = replaceRouteStop({ request: input, intent, route: current,
      stopIndex: 0, reason: 'other', rankedPlaces: [original, sameCategory, museum],
      origin: ASTANA_CENTER })
    expect(next?.replacement.id).toBe(museum.id)
  })

  it('skips the same nearby venue under a duplicate source ID', () => {
    const input = request()
    const first = place(51, 'park', .001)
    const duplicate = { ...place(52, 'park', .0011), name: first.name }
    const distinct = place(53, 'park', .003)
    const current = routeFor(input, intent, [first])
    const next = replaceRouteStop({ request: input, intent, route: current,
      stopIndex: 0, reason: 'visited', rankedPlaces: [first, duplicate, distinct], origin: ASTANA_CENTER })
    expect(next?.replacement.id).toBe(distinct.id)
  })
})
