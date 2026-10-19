import { describe, expect, it } from 'vitest'
import realCatalog from '../../data/pois.json'
import type { Poi, PoiCatalog, WalkRequest } from '../shared/types'
import { rankCandidates, toRecommendation, validateSelections } from './recommend'
import { requestsVerifiedOpenNow } from './index'

const center = { lat: 51.128, lon: 71.43 }

function poi(id: string, category: string, lat: number, visitMinutes: number): Poi {
  return {
    id,
    name: `${category} ${id}`,
    category,
    description: `Категория ${category} по данным OSM.`,
    descriptionSource: 'category_template',
    lat,
    lon: center.lon,
    visitMinutes,
    sourceUrl: `https://www.openstreetmap.org/node/${id}`,
    osmType: 'node',
    osmId: Number(id),
    tags: {},
  }
}

const catalog: PoiCatalog = {
  schemaVersion: 1,
  zone: { id: 'test', name: 'Тест', center, radiusMeters: 2500 },
  source: { provider: 'OpenStreetMap', importedAt: '2026-10-18', attribution: 'OSM', licenseUrl: 'https://www.openstreetmap.org/copyright' },
  pois: [
    poi('1', 'park', 51.1285, 15),
    poi('2', 'museum', 51.1286, 20),
    poi('3', 'park', 51.15, 25),
    poi('4', 'gallery', 51.1287, 80),
  ],
}

const baseRequest: WalkRequest = { minutes: 30, intents: [], text: '' }

describe('deterministic recommendation guardrails', () => {
  it('filters by location, duration and outdoor intent before AI', () => {
    const result = rankCandidates(catalog, { ...baseRequest, intents: ['outdoors'] })
    expect(result.candidates.map((candidate) => candidate.poi.id)).toEqual(['1'])
  })

  it('uses free text to rank a matching category without adding ineligible POIs', () => {
    const result = rankCandidates(catalog, { ...baseRequest, text: 'Хочу музей' })
    expect(result.candidates[0].poi.id).toBe('2')
    expect(result.candidates.map((candidate) => candidate.poi.id)).not.toContain('4')
  })

  it('treats the zone ID as the preset center origin', () => {
    const result = rankCandidates(catalog, { ...baseRequest, landmarkId: catalog.zone.id })
    expect(result.origin).toEqual(center)
    expect(result.candidates.length).toBeGreaterThan(0)
  })

  it('offers an actual nearby walk for the 30-minute outdoor pilot scenario', () => {
    const cityCatalog = realCatalog as unknown as PoiCatalog
    const result = rankCandidates(cityCatalog, {
      minutes: 30, intents: ['outdoors'], text: 'Хочу немного пройтись', landmarkId: cityCatalog.zone.id,
    })
    expect(result.candidates.map((candidate) => candidate.poi.name)).toContain('Сквер')
    expect(result.candidates.map((candidate) => candidate.poi.name)).not.toContain('Бәйтерек')
    expect(result.candidates.every((candidate) => candidate.walkMinutes + candidate.visitMinutes <= 30)).toBe(true)
  })

  it('prioritizes an explicit playground for child intent without asserting its facilities', () => {
    const familyCatalog = { ...catalog, pois: [...catalog.pois, poi('5', 'playground', 51.1288, 15)] }
    const result = rankCandidates(familyCatalog, { ...baseRequest, intents: ['child'] })
    expect(result.candidates[0].poi.id).toBe('5')
  })

  it('uses specific OSM indoor and open-air tags before category defaults', () => {
    const specialCatalog: PoiCatalog = {
      ...catalog,
      pois: [
        { ...poi('10', 'theme_park', 51.1285, 15), tags: { indoor: 'area' } },
        { ...poi('11', 'museum', 51.1286, 15), tags: { museum: 'open_air' } },
        { ...poi('12', 'playground', 51.1287, 15), tags: { amenity: 'childcare', leisure: 'playground' } },
        poi('14', 'theatre', 51.1288, 15),
        poi('15', 'place_of_worship', 51.1289, 15),
      ],
    }
    const outdoor = rankCandidates(specialCatalog, { ...baseRequest, intents: ['outdoors'] })
    const indoor = rankCandidates(specialCatalog, { ...baseRequest, intents: ['indoors'] })
    expect(outdoor.candidates.map((candidate) => candidate.poi.id)).toEqual(['11'])
    expect(indoor.candidates.map((candidate) => candidate.poi.id)).toEqual(['10'])
  })

  it('does not present straight-line proximity as verified driving time', () => {
    const ranked = rankCandidates(catalog, { ...baseRequest, transport: 'car', minutes: 20 })
    const card = toRecommendation(ranked.candidates[0], ranked.origin, { ...baseRequest, transport: 'car', minutes: 20 })
    expect(card.travelMode).toBe('car')
    expect(card.travelMinutesApprox).toBeUndefined()
    expect(card.timeStatus).toBe('unknown')
    expect(card.routeUrl).toContain('travelmode=driving')
    expect(card.why).toContain('не проверено')
  })

  it('excludes explicitly paid entry for a zero budget, while leaving unknown prices unknown', () => {
    const paid = { ...poi('20', 'museum', 51.1285, 15), tags: { fee: 'yes' } }
    const unknown = poi('21', 'park', 51.1286, 15)
    const ranked = rankCandidates({ ...catalog, pois: [paid, unknown] }, { ...baseRequest, budgetKzt: 0 })
    expect(ranked.candidates.map((candidate) => candidate.poi.id)).toEqual(['21'])
    expect(toRecommendation(ranked.candidates[0], ranked.origin, { ...baseRequest, budgetKzt: 0 }).budgetStatus).toBe('unknown')
  })

  it('labels raw OSM hours as unverified without claiming current availability', () => {
    const cafe: Poi = { ...poi('13', 'cafe', 51.1285, 15), tags: { opening_hours: 'Mo-Su 10:00-22:00' } }
    const withCafe = { ...catalog, pois: [cafe] }
    const ranked = rankCandidates(withCafe, baseRequest)
    const recommendation = toRecommendation(ranked.candidates[0], ranked.origin, baseRequest)
    expect(recommendation.hoursStatus).toBe('По OSM: Mo-Su 10:00-22:00 (не проверено)')
    expect(recommendation.action).toContain('меню')
  })

  it('gives category-specific actions without promising admission', () => {
    const museum = rankCandidates(catalog, { ...baseRequest, text: 'музей' })
    const museumCard = toRecommendation(museum.candidates[0], museum.origin, baseRequest)
    expect(museumCard.action).toContain('возможность входа')
    const theatreCatalog = { ...catalog, pois: [poi('16', 'theatre', 51.1285, 15)] }
    const theatre = rankCandidates(theatreCatalog, baseRequest)
    const theatreCard = toRecommendation(theatre.candidates[0], theatre.origin, baseRequest)
    expect(theatreCard.action).toContain('афишу')
  })

  it('recognizes a request for verified current opening hours', () => {
    expect(requestsVerifiedOpenNow('Что открыто сейчас?')).toBe(true)
    expect(requestsVerifiedOpenNow('Парк на час')).toBe(false)
  })

  it('rejects fabricated IDs and unbounded model codes', () => {
    const candidates = rankCandidates(catalog, baseRequest).candidates
    const selections = validateSelections([
      { id: '999', reason: 'theme', action: 'open_route' },
      { id: '1', reason: 'nearby', action: 'open_route' },
      { id: '1', reason: 'theme', action: 'open_route' },
      { id: '2', reason: 'invented fact', action: 'open_route' },
    ], candidates)
    expect(selections).toEqual([{ id: '1', reason: 'nearby', action: 'open_route' }])
  })

  it('uses a short model activity only when it makes no unsupported factual claim', () => {
    const ranked = rankCandidates(catalog, baseRequest)
    const valid = validateSelections([
      { id: '1', reason: 'nearby', action: 'open_route', idea: 'Прогуляйтесь неспешно и выберите любимый ракурс.' },
    ], ranked.candidates)
    const safeCard = toRecommendation(ranked.candidates[0], ranked.origin, baseRequest, valid[0])
    expect(safeCard.action).toBe('Прогуляйтесь неспешно и выберите любимый ракурс.')
    expect(safeCard.actionSource).toBe('ai')

    const unsupported = validateSelections([
      { id: '1', reason: 'nearby', action: 'open_route', idea: 'Осмотрите бесплатную выставку, которая открыта сейчас.' },
    ], ranked.candidates)
    const fallbackCard = toRecommendation(ranked.candidates[0], ranked.origin, baseRequest, unsupported[0])
    expect(fallbackCard.actionSource).toBe('template')
    expect(fallbackCard.action).toContain('прогуляйтесь')
  })
})
