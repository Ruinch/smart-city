import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Recommendation } from '../shared/types'
import type { DynamicPlace } from './dynamic'
import { attachVenueDetails, collectVenueDetails } from './venue-details'

function venue(overrides: Partial<DynamicPlace> = {}): DynamicPlace {
  return {
    id: 'osm:node:1', name: 'Qazaq Gourmet', category: 'restaurant',
    lat: 51.1081164, lon: 71.4301872, visitMinutes: 60,
    sourceUrl: 'https://www.openstreetmap.org/node/1', provider: 'OpenStreetMap',
    tags: {}, ...overrides,
  }
}

function htmlResponse(html: string): Response {
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function xmlResponse(xml: string): Response {
  return new Response(xml, { headers: { 'content-type': 'text/xml; charset=utf-8' } })
}

const index = `<?xml version="1.0"?><urlset><url><loc>
  https://visitastana.kz/en/about-city/where-to-eat/restoran-kazakhskoy-kukhni-qazaq-gourmet2
  </loc></url></urlset>`

function sourceResponse(url: string | URL | Request, page: string): Response {
  return String(url).includes('sitemap-iblock-42.xml') ? xmlResponse(index) : htmlResponse(page)
}

afterEach(() => vi.unstubAllGlobals())

function detail(address = 'Mangilik El Avenue, 29', coordinates = '51.10811,71.43043'): string {
  return `<html><head><title>Visit Astana - Qazaq Gourmet</title></head><body><main>
    <span class="banner--gastronomy-single-schedule">from 12:00 to 23:00 daily</span>
    <div class="gastronomy-single__about"><h2>About us</h2>
      <p>Qazaq Gourmet offers a tasting menu and Kazakh cuisine.</p>
      <div>Average check: 20000 KZT</div><h3>Food Menu</h3></div>
    <div class="gastronomy-single__contacts"><h2>Contacts</h2>
      <h3>Address</h3><p>${address}</p><h3>Phone</h3><p>+7 000</p>
      <script>center: [${coordinates}]</script></div>
  </main></body></html>`
}

describe('venue details', () => {
  it('extracts a current Visit Astana average check only for the matched branch', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      sourceResponse(url, detail())) as unknown as typeof fetch
    const result = await collectVenueDetails([venue({ tags: {
      'addr:street': 'Мәңгілік Ел даңғылы', 'addr:housenumber': '29',
    } })], 'ru', {
      fetcher, now: new Date('2026-10-20T12:00:00Z'),
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.prices).toEqual([expect.objectContaining({
      minKzt: 20000, unit: 'average_bill', sourceKind: 'visit_astana',
      checkedAt: '2026-10-20T12:00:00.000Z',
    })])
    expect(result.details.map((entry) => entry.kind)).toContain('hours')
    expect(result.details.map((entry) => entry.kind)).toContain('menu')
    expect(result.details.every((entry) => entry.sourceUrl.endsWith('qazaq-gourmet2/'))).toBe(true)
  })

  it('rejects a Visit Astana page for a different branch despite the matching name', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      sourceResponse(url, detail('Mangilik El Avenue, 99', '51.18,71.50'))) as unknown as typeof fetch
    const result = await collectVenueDetails([venue({ tags: {
      'addr:street': 'Мәңгілік Ел даңғылы', 'addr:housenumber': '29',
    } })], 'ru', { fetcher })
    expect(result).toEqual({ details: [], prices: [] })
  })

  it('rejects unrelated or spammy text even under the Visit Astana domain', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      sourceResponse(url, detail().replace('Qazaq Gourmet offers a tasting menu and Kazakh cuisine.',
        'Online casino and sports betting are available here.'))) as unknown as typeof fetch
    expect(await collectVenueDetails([venue()], 'en', { fetcher })).toEqual({ details: [], prices: [] })
  })

  it('keeps OSM tag claims conservative and never fetches a private website', async () => {
    const fetcher = vi.fn(async () => { throw new Error('Unexpected fetch') }) as unknown as typeof fetch
    const result = await collectVenueDetails([venue({ category: 'museum', tags: {
      website: 'https://127.0.0.1/private', outdoor_seating: 'yes', internet_access: 'wlan',
      'toilets:wheelchair': 'yes', opening_hours: 'Tu-Su 10:00-18:00',
    } })], 'en', { fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.details).toHaveLength(4)
    expect(result.details.some((entry) => entry.kind === 'accessibility')).toBe(true)
    expect(result.details.some((entry) => entry.kind === 'hours')).toBe(true)
    expect(result.details.every((entry) => entry.sourceUrl.includes('openstreetmap.org'))).toBe(true)
  })

  it('uses explicit OSM diet and same-site menu tags without inventing a price', async () => {
    const fetcher = vi.fn(async () => htmlResponse('<html><title>Unrelated</title></html>')) as unknown as typeof fetch
    const result = await collectVenueDetails([venue({ category: 'museum', tags: {
      website: 'https://venue.kz/', 'website:menu': 'https://venue.kz/menu',
      'diet:vegan': 'yes', 'diet:vegetarian': 'yes',
    } })], 'kk', { fetcher })
    expect(result.prices).toEqual([])
    expect(result.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'menu', sourceUrl: 'https://www.openstreetmap.org/node/1' }),
      expect.objectContaining({ kind: 'feature', sourceKind: 'osm' }),
    ]))
  })

  it('fetches no more than three selected venue pages', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('<html><title>Unrelated</title></html>'))
    const places = Array.from({ length: 7 }, (_, index) => venue({
      id: `osm:node:${index + 1}`, name: `Museum ${index}`, category: 'museum',
      sourceUrl: `https://www.openstreetmap.org/node/${index + 1}`,
      tags: { website: `https://museum-${index}.kz/` },
    }))
    await collectVenueDetails(places, 'en', { fetcher: fetchMock as unknown as typeof fetch })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('accepts structured facts on an official site only for the named Astana branch', async () => {
    const page = `<html><title>National Museum</title><script type="application/ld+json">${JSON.stringify({
      '@type': 'Museum', name: 'National Museum',
      address: { streetAddress: 'Tauelsizdik Avenue, 54', addressLocality: 'Astana' },
      geo: { latitude: 51.1182, longitude: 71.4694 }, openingHours: 'Tu-Su 10:00-18:00',
    })}</script></html>`
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => htmlResponse(page))
    const fetcher = fetchMock as unknown as typeof fetch
    const result = await collectVenueDetails([venue({
      name: 'Национальный музей', category: 'museum', lat: 51.1182, lon: 71.4694,
      names: { en: 'National Museum' },
      tags: { website: 'https://museum.kz/', 'addr:street': 'Тәуелсіздік даңғылы',
        'addr:housenumber': '54' },
    })], 'en', { fetcher })
    expect(result.details).toEqual([expect.objectContaining({ kind: 'hours', sourceKind: 'official_site' })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('keeps the original retrieval time on a cached page', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => sourceResponse(url, detail()))
    vi.stubGlobal('fetch', fetcher)
    const first = await collectVenueDetails([venue()], 'en', { now: new Date('2026-10-20T12:00:00Z') })
    const second = await collectVenueDetails([venue()], 'en', { now: new Date('2026-10-20T13:00:00Z') })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(second.prices[0].checkedAt).toBe(first.prices[0].checkedAt)
    expect(second.details[0].checkedAt).toBe(first.details[0].checkedAt)
  })

  it('prioritizes an explicit accessibility tag above other details', () => {
    const stop: Recommendation = {
      id: 'osm:node:1', name: 'Test', category: 'cafe', why: '', action: '',
      actionSource: 'template', sourceUrl: 'https://www.openstreetmap.org/node/1',
      routeUrl: 'https://example.com/route', evidence: [{ claim: 'Old', sourceUrl: 'https://example.com/old' }],
    }
    const details = ['menu', 'feature', 'hours', 'feature', 'accessibility'].map((kind, index) => ({
      id: stop.id, kind: kind as 'menu' | 'feature' | 'hours' | 'accessibility',
      claim: `Claim ${index}`, sourceUrl: `https://example.org/${index}`,
      sourceKind: 'visit_astana' as const,
    }))
    attachVenueDetails([stop], details)
    expect(stop.evidence?.[0]).toMatchObject({ kind: 'accessibility', claim: 'Claim 4' })
    expect(stop.evidence).toHaveLength(4)
  })

  it('keeps requested Wi-Fi and terrace facts alongside earlier quiet evidence', () => {
    const stop: Recommendation = {
      id: 'osm:node:1', name: 'Test cafe', category: 'cafe', why: '', action: '',
      actionSource: 'template', sourceUrl: 'https://www.openstreetmap.org/node/1',
      routeUrl: 'https://example.com/route', evidence: [{
        claim: 'В найденном описании упоминается спокойная обстановка.',
        sourceUrl: 'https://example.org/quiet', kind: 'feature',
      }],
    }
    const topics = ['accessibility', 'hours', 'diet', 'menu', 'outdoor', 'wifi', 'booking'] as const
    attachVenueDetails([stop], topics.map((topic) => ({
      id: stop.id, kind: topic === 'accessibility' ? 'accessibility'
        : topic === 'hours' ? 'hours' : 'feature',
      claim: topic, sourceUrl: `https://example.org/${topic}`, sourceKind: 'osm', topic,
    })), 'Ищу тихое кафе с Wi-Fi и террасой')
    expect(stop.evidence?.map((entry) => entry.claim)).toEqual([
      'accessibility', 'outdoor', 'wifi', 'В найденном описании упоминается спокойная обстановка.',
    ])
  })

  it('preserves existing evidence when adding venue details', () => {
    const stop: Recommendation = {
      id: 'osm:node:1', name: 'Qazaq Gourmet', category: 'restaurant', why: '',
      action: '', actionSource: 'template', sourceUrl: 'https://www.openstreetmap.org/node/1',
      routeUrl: 'https://example.com/route', evidence: [{ claim: 'Existing claim', sourceUrl: 'https://example.com/source' }],
    }
    attachVenueDetails([stop], [{ id: stop.id, kind: 'menu', claim: 'Menu link',
      sourceUrl: 'https://visitastana.kz/en/about-city/where-to-eat/qazaq-gourmet/',
      checkedAt: '2026-10-20T12:00:00Z', sourceKind: 'visit_astana' }])
    expect(stop.evidence).toHaveLength(2)
    expect(stop.evidence?.[0].claim).toBe('Menu link')
    expect(stop.evidence?.[1].claim).toBe('Existing claim')
  })
})
