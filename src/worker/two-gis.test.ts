import { describe, expect, it } from 'vitest'
import { ASTANA_CENTER } from '../shared/astana'
import { createTwoGisSearcher, parseTwoGisResponse } from './two-gis'

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: '70000001012345678', type: 'branch', name: 'Тихая чашка',
    point: { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon },
    rubrics: [{ id: '123', name: 'Кафе' }],
    ...overrides,
  }
}

function payload(items: unknown[], code = 200) {
  return { meta: { code }, result: { items } }
}

describe('2GIS response parser', () => {
  it('accepts a real business category inside Astana with a source link', () => {
    const result = parseTwoGisResponse(payload([item()]), 'cafe')
    expect(result).toEqual([expect.objectContaining({
      id: '2gis:70000001012345678', category: 'cafe', provider: '2GIS',
      sourceUrl: 'https://2gis.kz/astana/firm/70000001012345678',
      lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon,
    })])
  })

  it('keeps a branch address only when the provider supplies street and house', () => {
    const result = parseTwoGisResponse(payload([item({
      address: { components: [{ type: 'street_number', street: 'Достық көшесі', number: '5' }] },
    })]), 'cafe')
    expect(result?.[0]?.tags).toEqual({ 'addr:street': 'Достық көшесі', 'addr:housenumber': '5' })
  })

  it('rejects wrong rubrics, non-business objects, closed and outside-city venues', () => {
    const entries = [
      item({ id: '70000001012345679', rubrics: [{ name: 'Барбершопы' }] }),
      item({ id: '70000001012345680', type: 'attraction' }),
      item({ id: '70000001012345681', is_deleted: true }),
      item({ id: '70000001012345682', flags: { temporary_closed: 'yes' } }),
      item({ id: '70000001012345683', point: { lat: 43.2389, lon: 76.8897 } }),
      item({ id: '70000001012345684', rubrics: undefined }),
    ]
    expect(parseTwoGisResponse(payload(entries), 'cafe')).toEqual([])
  })

  it('does not accept malformed provider replies as an empty catalog', () => {
    expect(parseTwoGisResponse({ meta: { code: 200 } }, 'cafe')).toBeNull()
    expect(parseTwoGisResponse({ meta: { code: 403 } }, 'cafe')).toBeNull()
    expect(parseTwoGisResponse({ meta: { code: 404 } }, 'cafe')).toEqual([])
  })
})

describe('2GIS live search', () => {
  it('does not fetch without a server-side key', async () => {
    const search = createTwoGisSearcher(async () => { throw new Error('unexpected fetch') })
    expect(await search(undefined, { categories: ['cafe'] }))
      .toEqual({ places: [], status: 'disabled' })
  })

  it('uses fixed categories and coarse city coordinates, at most two calls, and no caching', async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = []
    const search = createTwoGisSearcher(async (url, init) => {
      requests.push({ url: new URL(url), init })
      return new Response(JSON.stringify(payload([item()])), { status: 200 })
    })
    const result = await search('server-secret', { categories: ['cafe', 'restaurant', 'bar'] })
    expect(requests).toHaveLength(2)
    expect(result.status).toBe('ok')
    expect(result.places).toHaveLength(1)
    for (const { url, init } of requests) {
      expect(url.origin).toBe('https://catalog.api.2gis.com')
      expect(url.searchParams.get('type')).toBe('branch')
      expect(url.searchParams.get('search_nearby')).toBe('true')
      expect(url.searchParams.get('point')).toBe('71.43,51.13')
      expect(url.searchParams.get('location')).toBe('71.43,51.13')
      expect(url.searchParams.get('radius')).toBe('35000')
      expect(url.searchParams.get('fields')).toContain('items.rubrics')
      expect(url.searchParams.get('page_size')).toBe('10')
      expect(url.searchParams.get('q')).toMatch(/^(кафе|рестораны)$/u)
      expect(init?.cache).toBe('no-store')
    }
  })

  it('rounds an in-city origin and falls back for an outside-city origin', async () => {
    const points: string[] = []
    const search = createTwoGisSearcher(async (url) => {
      points.push(new URL(url).searchParams.get('point') ?? '')
      return new Response(JSON.stringify(payload([])), { status: 200 })
    })
    await search('key', { categories: ['cafe'], center: { lat: 51.1485, lon: 71.4445 } })
    await search('key', { categories: ['cafe'], center: { lat: 43.2389, lon: 76.8897 } })
    expect(points).toEqual(['71.44,51.15', '71.43,51.13'])
  })

  it('handles quota and failed upstream responses without throwing', async () => {
    const quota = createTwoGisSearcher(async () => new Response('', { status: 429 }))
    expect(await quota('server-secret', { categories: ['cafe'] }))
      .toEqual({ places: [], status: 'limited' })
    const broken = createTwoGisSearcher(async () => new Response('{', { status: 200 }))
    expect(await broken('server-secret', { categories: ['cafe'] }))
      .toEqual({ places: [], status: 'unavailable' })
  })

  it('applies a per-isolate rate guard without retaining venue data', async () => {
    let calls = 0
    let clock = 0
    const search = createTwoGisSearcher(async () => {
      calls += 1
      return new Response(JSON.stringify(payload([])), { status: 200 })
    }, () => clock)
    for (let index = 0; index < 6; index += 1) {
      expect((await search('key', { categories: ['cafe', 'bar'] })).status).toBe('ok')
    }
    expect((await search('key', { categories: ['cafe', 'bar'] })).status).toBe('limited')
    expect(calls).toBe(12)
    clock = 60_000
    expect((await search('key', { categories: ['cafe', 'bar'] })).status).toBe('ok')
    expect(calls).toBe(14)
  })
})
