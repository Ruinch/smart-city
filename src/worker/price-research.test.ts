import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoutePlan, WalkRequest } from '../shared/types'
import type { DynamicPlace } from './dynamic'
import { attachPriceEvidence, researchVenuePrices } from './price-research'

const request: WalkRequest = {
  cityId: 'astana', scope: 'city', text: 'Куда сходить?', minutes: 120, intents: [],
}

function venue(id: string, name: string, category = 'cinema', tags: Record<string, string> = {}): DynamicPlace {
  return { id, name, category, lat: 51.1282, lon: 71.4304, visitMinutes: 60,
    sourceUrl: 'https://www.openstreetmap.org/node/1', tags, provider: 'OpenStreetMap' }
}

function searchPayload(findings: unknown[], sources: unknown[]) {
  return { status: 'completed', output: [
    { type: 'web_search_call', action: { sources } },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ findings }) }] },
  ] }
}

function finding(id: string, sourceUrl: string, minKzt = 3000, overrides: Record<string, unknown> = {}) {
  return { id, sourceUrl, minKzt, maxKzt: null, unit: 'entry', qualifier: 'exact', ...overrides }
}

afterEach(() => vi.unstubAllGlobals())

describe('sourced venue price research', () => {
  it('attaches sourced prices and moves a known over-budget ticket behind a cheaper variant', () => {
    const makeRoute = (id: string): RoutePlan => ({
      id, title: id, summary: id, routeUrl: 'https://example.org/route',
      stops: [{ id, name: id, category: 'cinema', sourceUrl: 'https://example.org/place',
        routeUrl: 'https://example.org/route', why: '', action: '', actionSource: 'template' }],
    })
    const expensive = makeRoute('expensive')
    const cheaper = makeRoute('cheaper')
    const routes = [expensive, cheaper]
    attachPriceEvidence(routes, [
      { id: 'expensive', minKzt: 5000, unit: 'entry', qualifier: 'exact',
        checkedAt: '2026-10-19T00:00:00Z', sourceUrl: 'https://tickets.example.org/expensive' },
      { id: 'cheaper', minKzt: 1500, unit: 'entry', qualifier: 'from',
        checkedAt: '2026-10-19T00:00:00Z', sourceUrl: 'https://tickets.example.org/cheaper' },
    ], 2000)
    expect(routes.map((route) => route.id)).toEqual(['cheaper', 'expensive'])
    expect(routes[0].stops[0].priceEvidence).toMatchObject({ minKzt: 1500, qualifier: 'from' })
    expect(routes[1].stops[0].priceEvidence?.sourceUrl).toBe('https://tickets.example.org/expensive')
  })

  it('searches at most six distinct paid venues in one Responses call', async () => {
    const places = Array.from({ length: 8 }, (_, index) => venue(`price-cap-${index}`, `Orbit Cinema ${index}`))
    const sources = places.slice(0, 6).map((place) => ({
      url: `https://tickets.example.org/astana/${place.id}`,
      title: `${place.name} Astana`, snippet: `${place.name} Астана: билет 3 000 ₸`,
    }))
    const proposed = sources.map((source, index) => finding(places[index].id, source.url))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(searchPayload(proposed, sources))))
    vi.stubGlobal('fetch', fetchMock)
    const prices = await researchVenuePrices('test-key', request, [...places, places[0]])
    expect(prices).toHaveLength(6)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>
    expect(body.tools).toMatchObject([{ type: 'web_search' }])
    expect((body.input as Array<{ content: string }>)[1].content).toContain('price-cap-5')
    expect((body.input as Array<{ content: string }>)[1].content).not.toContain('price-cap-6')
  })

  it('rejects a model-invented amount even when the source names the venue', async () => {
    const place = venue('price-fabricated', 'North Star Cinema')
    const url = 'https://tickets.example.org/astana/north-star'
    const payload = searchPayload([finding(place.id, url, 5000)], [
      { url, title: 'North Star Cinema Astana', snippet: 'North Star Cinema Астана: билет 3 000 ₸' },
    ])
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockResolvedValueOnce(new Response('Not found', { status: 404 })))
    expect(await researchVenuePrices('test-key', request, [place])).toEqual([])
  })

  it('rejects a price from an unvisited URL or a venue in another city', async () => {
    const place = venue('price-other-city', 'Aurora Cinema')
    const url = 'https://tickets.example.org/almaty/aurora'
    const payload = searchPayload([
      finding(place.id, 'https://unvisited.example.org/astana/aurora'),
      finding(place.id, url),
    ], [{ url, title: 'Aurora Cinema Almaty', snippet: 'Aurora Cinema Алматы: билет 3 000 ₸' }])
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockResolvedValueOnce(new Response('Not found', { status: 404 })))
    expect(await researchVenuePrices('test-key', request, [place])).toEqual([])
  })

  it('accepts a branch-specific average bill from a fetched public page and caches it', async () => {
    const place = venue('price-cafe-page', 'Aurora Coffee House', 'cafe',
      { 'addr:street': 'Достык', 'addr:housenumber': '12' })
    const url = 'https://menu.example.org/astana/aurora-coffee-house'
    const payload = searchPayload([finding(place.id, url, 4500,
      { unit: 'average_bill' })], [{ url, title: 'Aurora Coffee House Astana' }])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockResolvedValueOnce(new Response('<h1>Aurora Coffee House — Астана, Достык 12</h1><p>Средний чек: 4 500 ₸</p>',
        { headers: { 'Content-Type': 'text/html' } }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await researchVenuePrices('test-key', request, [place])
    expect(first).toMatchObject([{ id: place.id, minKzt: 4500,
      unit: 'average_bill', qualifier: 'exact', sourceUrl: url }])
    expect(first[0].checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(await researchVenuePrices('test-key', request, [place])).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('preserves an explicitly sourced starting price rather than treating it as a fixed bill', async () => {
    const place = venue('price-from-ticket', 'Northern Lights Cinema')
    const url = 'https://tickets.example.org/astana/northern-lights'
    const payload = searchPayload([finding(place.id, url, 2500, { qualifier: 'from' })], [
      { url, title: 'Northern Lights Cinema Астана',
        snippet: 'Northern Lights Cinema Астана: билеты от 2 500 ₸' },
    ])
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetchMock)
    expect(await researchVenuePrices('test-key', request, [place])).toMatchObject([
      { minKzt: 2500, qualifier: 'from', unit: 'entry' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('researches newly supported paid activities', async () => {
    const place = venue('price-waterpark', 'Ocean Water Park', 'water_park')
    const url = 'https://tickets.example.org/astana/ocean-water-park'
    const payload = searchPayload([finding(place.id, url, 7000)], [
      { url, title: 'Ocean Water Park Астана',
        snippet: 'Ocean Water Park Астана: входной билет 7 000 ₸' },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))))
    expect(await researchVenuePrices('test-key', request, [place])).toMatchObject([
      { id: place.id, minKzt: 7000, unit: 'entry' },
    ])
  })

  it('rejects an oversized source page without using truncated text', async () => {
    const place = venue('price-large-page', 'Velvet Cinema')
    const url = 'https://tickets.example.org/astana/velvet'
    const payload = searchPayload([finding(place.id, url, 3000)], [
      { url, title: 'Velvet Cinema Astana' },
    ])
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockResolvedValueOnce(new Response(`<h1>Velvet Cinema Астана</h1>${'x'.repeat(130_000)}билет 3 000 ₸`,
        { headers: { 'Content-Type': 'text/html' } })))
    expect(await researchVenuePrices('test-key', request, [place])).toEqual([])
  })

  it('skips free places and honors the shared search limiter', async () => {
    const free = venue('price-free-park', 'Central Park', 'park')
    const paid = venue('price-limited-club', 'Solar Nightclub', 'nightclub')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await researchVenuePrices('test-key', request, [free])).toEqual([])
    expect(await researchVenuePrices('test-key', request, [paid],
      { limit: async () => ({ success: false }) })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
