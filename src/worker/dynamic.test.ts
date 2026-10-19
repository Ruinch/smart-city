import { describe, expect, it } from 'vitest'
import snapshot from '../../data/astana-dynamic-fallback.json'
import type { WalkRequest } from '../shared/types'
import {
  ASTANA_CENTER, SEARCH_CATEGORIES, localSearchIntent, parseOverpassPlaces,
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
})
