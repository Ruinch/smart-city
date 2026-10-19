import { describe, expect, it } from 'vitest'
import type { CityCatalog, Trip, WalkRequest } from '../shared/types'
import { rankTrips, toTripRecommendation } from './trips'

const city: CityCatalog = {
  id: 'astana', name: 'Астана', center: { lat: 51.128, lon: 71.43 }, radiusMeters: 2_500, pois: [],
}
const trip: Trip = {
  id: 'burabay', name: 'Бурабай', cityId: 'astana', category: 'nature',
  description: 'Природная территория по данным OSM.', descriptionSource: 'category_template',
  lat: 53.08, lon: 70.31, visitMinutes: 120,
  sourceUrl: 'https://www.openstreetmap.org/relation/123', osmType: 'relation', osmId: 123, tags: {},
  setting: 'outdoor', settingSourceUrl: 'https://example.test/setting',
  travel: {
    roadKmApprox: 200, driveMinutesApprox: 180,
    sourceUrl: 'https://example.test/road',
    costKzt: { min: 4_000, max: 8_000, sourceUrl: 'https://example.test/prices' },
  },
}
const request: WalkRequest = {
  cityId: 'astana', scope: 'day_trip', transport: 'car', minutes: 540, budgetKzt: 8_000,
  intents: ['outdoors'], text: 'Хочу в Бурабай',
}

describe('out-of-town trip guardrails', () => {
  it('uses sourced round-trip travel and cost to filter, without treating a one-way drive as the total', () => {
    const ranked = rankTrips([trip], city, request)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].totalMinutesApprox).toBe(480)
    expect(ranked[0].budgetStatus).toBe('within')
    expect(rankTrips([trip], city, { ...request, minutes: 420 })).toEqual([])
    expect(rankTrips([trip], city, { ...request, budgetKzt: 3_999 })).toEqual([])
    expect(rankTrips([{ ...trip, travel: {} }], city, { ...request, minutes: 120 })).toEqual([])
  })

  it('labels partially affordable and unknown estimates honestly', () => {
    expect(rankTrips([trip], city, { ...request, budgetKzt: 6_000 })[0].budgetStatus).toBe('possible')
    const unpriced = { ...trip, travel: {} }
    const ranked = rankTrips([unpriced], city, { ...request, budgetKzt: 0 })
    expect(ranked[0].budgetStatus).toBe('unknown')
    expect(ranked[0].totalMinutesApprox).toBeUndefined()
    const card = toTripRecommendation(ranked[0], city, request)
    expect(card.timeStatus).toBe('unknown')
    expect(card.estimatedCostKzt).toBeUndefined()
    expect(card.why).toContain('не проверена')

    const unsourced = { ...trip, travel: { driveMinutesApprox: 100, costKzt: { min: 0, max: 0 } } }
    const unverified = rankTrips([unsourced], city, { ...request, budgetKzt: 0 })[0]
    expect(unverified.totalMinutesApprox).toBeUndefined()
    expect(unverified.budgetStatus).toBe('unknown')
  })

  it('requires transport evidence for transit and never suggests this trip on foot', () => {
    expect(rankTrips([trip], city, { ...request, transport: 'walk' })).toEqual([])
    expect(rankTrips([trip], city, { ...request, transport: 'transit' })).toEqual([])
    const transit = { ...trip, travel: { ...trip.travel, transitMinutesApprox: 210 } }
    expect(rankTrips([transit], city, { ...request, transport: 'transit', minutes: 600 })).toHaveLength(1)
    expect(rankTrips([trip], city, { ...request, intents: ['indoors'] })).toEqual([])
    expect(rankTrips([{ ...trip, category: 'museum' }], city, request)).toHaveLength(1)
  })

  it('uses the selected travel mode in external directions and returns coordinates for the map', () => {
    const card = toTripRecommendation(rankTrips([trip], city, request)[0], city, request)
    expect(card.kind).toBe('trip')
    expect(card.lat).toBe(trip.lat)
    expect(card.lon).toBe(trip.lon)
    expect(card.routeUrl).toContain('travelmode=driving')
    expect(card.sourceUrl).toBe('https://www.openstreetmap.org/relation/123')
    expect(card.travelSourceUrl).toBe('https://example.test/road')
    expect(card.costSourceUrl).toBe('https://example.test/prices')
  })

  it('uses a museum request to prioritize a sourced museum over a nature stop', () => {
    const museum = { ...trip, id: 'alzhir', name: 'Музей АЛЖИР', category: 'museum' }
    const ranked = rankTrips([trip, museum], city, { ...request, intents: [], text: 'Хочу музей' })
    expect(ranked[0].trip.id).toBe('alzhir')
  })

  it('respects sourced visit setting and a known entrance fee', () => {
    const paidMuseum: Trip = { ...trip, id: 'alzhir', category: 'museum', setting: 'indoor', tags: { fee: 'yes' } }
    const openAirMuseum: Trip = { ...trip, id: 'botai', category: 'museum', setting: 'outdoor' }
    expect(rankTrips([paidMuseum], city, { ...request, budgetKzt: 0, intents: [] })).toEqual([])
    expect(rankTrips([paidMuseum, openAirMuseum], city, { ...request, intents: ['indoors'] })
      .map(({ trip: item }) => item.id)).toEqual(['alzhir'])
    expect(rankTrips([paidMuseum, openAirMuseum], city, { ...request, intents: ['outdoors'] })
      .map(({ trip: item }) => item.id)).toEqual(['botai'])
  })

  it('uses the chosen out-of-city heading before proposing a trip', () => {
    const east = { lat: city.center.lat, lon: city.center.lon + 1 }
    const eastTrip: Trip = { ...trip, id: 'east-trip', lat: east.lat, lon: east.lon }
    const ranked = rankTrips([trip, eastTrip], city,
      { ...request, text: '', targetArea: east })
    expect(ranked.map(({ trip: item }) => item.id)).toEqual(['east-trip'])
  })
})
