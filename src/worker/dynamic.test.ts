import { describe, expect, it } from 'vitest'
import snapshot from '../../data/astana-dynamic-fallback.json'
import type { WalkRequest } from '../shared/types'
import {
  ASTANA_CENTER, SEARCH_CATEGORIES, assembleRoute, buildOverpassQuery, localSearchIntent, parseOverpassPlaces,
  rankDynamicPlaces, shortlistCandidatesForAI, type DynamicPlace,
} from './dynamic'

const request = (text: string, extra: Partial<WalkRequest> = {}): WalkRequest => ({
  cityId: 'astana', scope: 'city', transport: 'walk', minutes: 180,
  intents: [], text, ...extra,
})

const place = (id: number, category: string): DynamicPlace => ({
  id: `osm:node:${id}`, name: `${category} ${id}`, category,
  lat: 51.1282, lon: 71.4304 + id * 0.00001, visitMinutes: 30,
  sourceUrl: `https://www.openstreetmap.org/node/${id}`,
  provider: 'OpenStreetMap', tags: {},
})

describe('broader Astana retrieval', () => {
  it('can search every category present in the extracted city snapshot', () => {
    const searchable = new Set<string>(SEARCH_CATEGORIES)
    const missing = [...new Set(snapshot.pois.map((poi) => poi.category))]
      .filter((category) => !searchable.has(category))
    expect(missing).toEqual([])
  })

  it('preserves specific activities and mixed requests in local intent', () => {
    expect(localSearchIntent(request('Хочу поиграть в боулинг с друзьями')))
      .toMatchObject({ theme: 'active', categories: expect.arrayContaining(['bowling_alley']) })
    expect(localSearchIntent(request('Квест и кофе')))
      .toMatchObject({ theme: 'active', categories: expect.arrayContaining(['escape_game', 'cafe']) })
    expect(localSearchIntent(request('Памятники и история города')).categories)
      .toEqual(expect.arrayContaining(['monument', 'memorial']))
    expect(localSearchIntent(request('Кофе, а потом боулинг')))
      .toMatchObject({ theme: 'active', categories: expect.arrayContaining(['cafe', 'bowling_alley']) })
    expect(localSearchIntent(request('Хочу суши рядом')).categories)
      .toEqual(expect.arrayContaining(['restaurant']))
  })

  it('prefers a cuisine that is explicitly tagged over a nearer generic restaurant', () => {
    const generic = place(1, 'restaurant')
    const sushi = { ...place(200, 'restaurant'), tags: { cuisine: 'japanese;sushi' } }
    const ranked = rankDynamicPlaces([generic, sushi], request('Хочу суши'),
      { theme: 'general', categories: ['restaurant'] }, ASTANA_CENTER)
    expect(ranked[0].id).toBe(sushi.id)
    const route = assembleRoute(request('Хочу суши'),
      { theme: 'general', categories: ['restaurant'] }, [sushi], ASTANA_CENTER)
    expect(route?.stops[0].why).toContain('В OSM отмечена подходящая кухня')
  })

  it('parses a named historic place with sourced coordinates', () => {
    const result = parseOverpassPlaces({ elements: [{
      type: 'node', id: 789, lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon,
      tags: { name: 'Памятник', historic: 'monument' },
    }] }, ['monument'])
    expect(result).toMatchObject([{
      id: 'osm:node:789', category: 'monument',
      sourceUrl: 'https://www.openstreetmap.org/node/789',
    }])
  })

  it('keeps rare requested categories in the model shortlist despite many nearby cafes', () => {
    const cafes = Array.from({ length: 40 }, (_, index) => place(index + 1, 'cafe'))
    const libraries = Array.from({ length: 3 }, (_, index) => place(index + 100, 'library'))
    const bookshops = Array.from({ length: 2 }, (_, index) => place(index + 200, 'bookshop'))
    const candidates = [...cafes, ...libraries, ...bookshops]
    const shortlist = shortlistCandidatesForAI(candidates,
      { theme: 'reading', categories: ['cafe', 'library', 'bookshop'] })
    expect(shortlist).toHaveLength(36)
    expect(shortlist[0].id).toBe(cafes[0].id)
    expect(shortlist.filter((candidate) => candidate.category === 'library')).toHaveLength(3)
    expect(shortlist.filter((candidate) => candidate.category === 'bookshop')).toHaveLength(2)
    expect(new Set(shortlist.map((candidate) => candidate.id)).size).toBe(shortlist.length)
  })

  it('does not present typically paid new activities as free', () => {
    const input = [place(1, 'bowling_alley'), place(2, 'water_park'), place(3, 'monument')]
    const intent = { theme: 'active' as const,
      categories: ['bowling_alley' as const, 'water_park' as const, 'monument' as const] }
    const ranked = rankDynamicPlaces(input, request('Боулинг и памятники', { budgetKzt: 0 }), intent, ASTANA_CENTER)
    expect(ranked.map((candidate) => candidate.category)).toEqual(['monument'])
  })

  it('keeps a requested venue in the chosen heading and excludes a cross-city detour', () => {
    const target = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + .07 }
    const inDirection = { ...place(301, 'cafe'), lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + .03 }
    const opposite = { ...place(302, 'cafe'), lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon - .03 }
    const offCorridor = { ...place(303, 'cafe'), lat: ASTANA_CENTER.lat + .04,
      lon: ASTANA_CENTER.lon + .03 }
    const ranked = rankDynamicPlaces([opposite, offCorridor, inDirection],
      request('Хочу кофе', { minutes: 240, targetArea: target }),
      { theme: 'reading', categories: ['cafe'] }, ASTANA_CENTER)
    expect(ranked.map((candidate) => candidate.id)).toEqual([inDirection.id])
  })

  it('finds a nearby venue outside an empty heading corridor without a cross-city detour', () => {
    const target = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + .07 }
    const nearbySide = { ...place(401, 'cafe'), lat: ASTANA_CENTER.lat + .025,
      lon: ASTANA_CENTER.lon + .005 }
    const nearbyBehind = { ...place(402, 'cafe'), lat: ASTANA_CENTER.lat,
      lon: ASTANA_CENTER.lon - .008 }
    const acrossCity = { ...place(403, 'cafe'), lat: ASTANA_CENTER.lat + .16,
      lon: ASTANA_CENTER.lon }
    const query = request('Хочу кофе', { transport: 'car', targetArea: target })
    const intent = { theme: 'reading' as const, categories: ['cafe' as const] }
    expect(rankDynamicPlaces([nearbySide, nearbyBehind, acrossCity], query, intent, ASTANA_CENTER))
      .toEqual([])
    const relaxed = rankDynamicPlaces([nearbySide, nearbyBehind, acrossCity], query, intent,
      ASTANA_CENTER, 'relaxed')
    expect(relaxed.map((candidate) => candidate.id))
      .toEqual(expect.arrayContaining([nearbySide.id, nearbyBehind.id]))
    expect(relaxed.map((candidate) => candidate.id)).not.toContain(acrossCity.id)
  })

  it('recovers a feasible museum from the published catalog when a northward hint is too narrow', () => {
    const museums: DynamicPlace[] = snapshot.pois.filter((candidate) => candidate.category === 'museum')
      .map((candidate) => ({
        id: candidate.id, name: candidate.name, category: candidate.category,
        lat: candidate.lat, lon: candidate.lon, visitMinutes: candidate.visitMinutes,
        sourceUrl: candidate.sourceUrl,
        tags: Object.fromEntries(Object.entries(candidate.tags)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
        provider: 'OpenStreetMap',
      }))
    const query = request('Хочу в музей', { minutes: 60,
      targetArea: { lat: ASTANA_CENTER.lat + .072, lon: ASTANA_CENTER.lon } })
    const intent = { theme: 'culture' as const, categories: ['museum' as const] }
    expect(rankDynamicPlaces(museums, query, intent, ASTANA_CENTER)).toEqual([])
    const alternatives = rankDynamicPlaces(museums, query, intent, ASTANA_CENTER, 'relaxed')
    expect(alternatives.length).toBeGreaterThan(0)
    const fallbackRoute = assembleRoute({ ...query, targetArea: undefined }, intent,
      alternatives, ASTANA_CENTER)
    expect(fallbackRoute?.stops[0].category).toBe('museum')
    expect(fallbackRoute?.totalMinutesApprox).toBeLessThanOrEqual(60)
  })

  it('keeps time, zero-budget and accessibility limits in the relaxed heading fallback', () => {
    const target = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + .07 }
    const nearbySide = { ...place(411, 'park'), lat: ASTANA_CENTER.lat + .014,
      lon: ASTANA_CENTER.lon, tags: { wheelchair: 'yes' } }
    const tooFarForTime = { ...place(412, 'park'), lat: ASTANA_CENTER.lat + .03,
      lon: ASTANA_CENTER.lon, tags: { wheelchair: 'yes' } }
    const unknownAccess = { ...place(413, 'park'), lat: ASTANA_CENTER.lat + .014,
      lon: ASTANA_CENTER.lon }
    const paid = { ...place(414, 'cafe'), lat: ASTANA_CENTER.lat + .014,
      lon: ASTANA_CENTER.lon, tags: { wheelchair: 'yes' } }
    const query = request('Парк или кофе', { targetArea: target, minutes: 65,
      budgetKzt: 0, accessibility: 'osm_wheelchair_yes' })
    const ranked = rankDynamicPlaces([tooFarForTime, unknownAccess, paid, nearbySide], query,
      { theme: 'nature', categories: ['park', 'cafe'] }, ASTANA_CENTER, 'relaxed')
    expect(ranked.map((candidate) => candidate.id)).toEqual([nearbySide.id])
  })

  it('keeps only OSM wheelchair=yes venues when the visitor requests that filter', () => {
    const yes = { ...place(501, 'cafe'), tags: { wheelchair: 'yes' } }
    const limited = { ...place(502, 'cafe'), tags: { wheelchair: 'limited' } }
    const no = { ...place(503, 'cafe'), tags: { wheelchair: 'no' } }
    const unknown = place(504, 'cafe')
    const intent = { theme: 'reading' as const, categories: ['cafe' as const] }
    const ranked = rankDynamicPlaces([unknown, limited, no, yes],
      request('Кофе', { accessibility: 'osm_wheelchair_yes' }), intent, ASTANA_CENTER)
    expect(ranked.map((candidate) => candidate.id)).toEqual([yes.id])
    expect(buildOverpassQuery(ASTANA_CENTER, ['cafe'], undefined, true))
      .toContain('nwr["amenity"="cafe"]["wheelchair"="yes"]')
  })

  it('limits each short walking leg while allowing a two-hop outing', () => {
    const first = { ...place(601, 'park'), lon: ASTANA_CENTER.lon + .005 }
    const second = { ...place(602, 'gallery'), lon: ASTANA_CENTER.lon + .011,
      tags: { wheelchair: 'yes' } }
    const tooFar = { ...place(603, 'museum'), lon: ASTANA_CENTER.lon + .024 }
    const route = assembleRoute(request('Погулять', { shortLegs: true }),
      { theme: 'general', categories: ['park', 'gallery', 'museum'] },
      [first, second, tooFar], ASTANA_CENTER)
    expect(route?.stops.map((stop) => stop.id)).toEqual([first.id, second.id])
    expect(route?.stops[1].wheelchairTag).toBe('yes')
  })

  it('diversifies an optional discovery quest after retaining the best first stop', () => {
    const first = { ...place(701, 'cafe'), lon: ASTANA_CENTER.lon + .001 }
    const duplicate = { ...place(702, 'cafe'), lon: ASTANA_CENTER.lon + .002 }
    const gallery = { ...place(703, 'gallery'), lon: ASTANA_CENTER.lon + .003 }
    const park = { ...place(704, 'park'), lon: ASTANA_CENTER.lon + .004 }
    const route = assembleRoute(request('Прогулка', { microQuest: true }),
      { theme: 'general', categories: ['cafe', 'gallery', 'park'] },
      [first, duplicate, gallery, park], ASTANA_CENTER)
    expect(route?.stops.map((stop) => stop.category)).toEqual(['cafe', 'gallery', 'park'])
    expect(route?.title).toBe('Маршрут-открытие')
  })

  it('slows the planning pace and combines short hops, tagged access and discovery without adding stops', () => {
    const stops = [
      { ...place(801, 'cafe'), lon: ASTANA_CENTER.lon + .004, visitMinutes: 30, tags: { wheelchair: 'yes' } },
      { ...place(802, 'gallery'), lon: ASTANA_CENTER.lon + .008, visitMinutes: 30, tags: { wheelchair: 'yes' } },
      { ...place(803, 'park'), lon: ASTANA_CENTER.lon + .012, visitMinutes: 30, tags: { wheelchair: 'yes' } },
    ]
    const intent = { theme: 'general' as const, categories: ['cafe' as const, 'gallery' as const, 'park' as const] }
    const normal = assembleRoute(request('Прогулка', { minutes: 180 }), intent, stops, ASTANA_CENTER)
    const relaxedRequest = request('Прогулка', { minutes: 180, gentlePace: true, shortLegs: true,
      accessibility: 'osm_wheelchair_yes', microQuest: true })
    const filtered = rankDynamicPlaces(stops, relaxedRequest, intent, ASTANA_CENTER)
    const relaxed = assembleRoute(relaxedRequest, intent, filtered, ASTANA_CENTER)
    expect(normal?.stops).toHaveLength(3)
    expect(relaxed?.stops).toHaveLength(2)
    expect(relaxed?.stops.map((stop) => stop.category)).toEqual(['cafe', 'gallery'])
    expect(relaxed?.stops.every((stop) => stop.wheelchairTag === 'yes')).toBe(true)
    expect(relaxed?.stops[0].visitMinutes).toBeGreaterThan(normal!.stops[0].visitMinutes!)
    expect(relaxed?.totalMinutesApprox).toBeLessThanOrEqual(180)
  })
})
