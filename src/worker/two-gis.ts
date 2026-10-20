import type { Language } from '../shared/types'
import { ASTANA_CENTER, insideAstana } from '../shared/astana'
import type { Coordinate } from '../shared/astana'
import type { SearchCategory } from './dynamic'

/**
 * Optional live business lookup. All upstream queries are predefined categories
 * around a coarse city location: no prompt, exact coordinates, or Telegram data
 * is sent to 2GIS. The API key must remain a server-side Worker secret.
 */
export interface TwoGisPlace {
  id: string
  name: string
  category: SearchCategory
  lat: number
  lon: number
  visitMinutes: number
  sourceUrl: string
  tags: Record<string, string>
  provider: '2GIS'
}

export interface TwoGisSearchOptions {
  categories: readonly SearchCategory[]
  language?: Language
  /** Optional origin. Only coordinates rounded to 0.01 degree reach 2GIS. */
  center?: Coordinate
}

export interface TwoGisSearchResult {
  places: TwoGisPlace[]
  status: 'disabled' | 'ok' | 'limited' | 'unavailable'
}

type CategoryQuery = { query: string; rubric: RegExp; visitMinutes: number }

// 2GIS rubric names are requested in Russian so that category validation is
// deterministic. Unsupported categories (for example parks) stay with OSM.
const CATEGORY_QUERIES: Partial<Record<SearchCategory, CategoryQuery>> = {
  nightclub: { query: 'ночные клубы', rubric: /ночн[а-яё]* клуб|дискотек/iu, visitMinutes: 90 },
  karaoke: { query: 'караоке', rubric: /караоке/iu, visitMinutes: 75 },
  bar: { query: 'бары', rubric: /(?:^|[^\p{L}])бар(?:ы|ов)?(?:$|[^\p{L}])|паб|лаунж/iu, visitMinutes: 60 },
  music_venue: { query: 'концертные залы', rubric: /концертн|музыкальн[а-яё]* клуб/iu, visitMinutes: 75 },
  events_venue: { query: 'ивент площадки', rubric: /мероприяти|ивент|банкетн|концертн[а-яё]* площад/iu, visitMinutes: 75 },
  cafe: { query: 'кафе', rubric: /кафе|кофейн|кофе.?шоп/iu, visitMinutes: 45 },
  restaurant: { query: 'рестораны', rubric: /ресторан/iu, visitMinutes: 75 },
  fast_food: { query: 'фастфуд', rubric: /быстр[а-яё]* питани|фаст.?фуд|бургерн|шаурм/iu, visitMinutes: 30 },
  food_court: { query: 'фудкорты', rubric: /фуд.?корт/iu, visitMinutes: 45 },
  ice_cream: { query: 'мороженое', rubric: /морожен|джелатери/iu, visitMinutes: 25 },
  confectionery: { query: 'кондитерские', rubric: /кондитерск|пекарн/iu, visitMinutes: 35 },
  mall: { query: 'торговые центры', rubric: /торгов[а-яё]* центр|торгово.?развлекательн/iu, visitMinutes: 60 },
  library: { query: 'библиотеки', rubric: /библиотек/iu, visitMinutes: 45 },
  bookshop: { query: 'книжные магазины', rubric: /книжн[а-яё]* магазин|книг[а-яё]* магазин/iu, visitMinutes: 30 },
  museum: { query: 'музеи', rubric: /музе/iu, visitMinutes: 60 },
  gallery: { query: 'галереи искусств', rubric: /галере|выставочн[а-яё]* зал/iu, visitMinutes: 45 },
  theatre: { query: 'театры', rubric: /театр/iu, visitMinutes: 75 },
  cinema: { query: 'кинотеатры', rubric: /кинотеатр/iu, visitMinutes: 90 },
  arts_centre: { query: 'центры искусств', rubric: /центр[а-яё]* искусств|арт.?центр|творческ[а-яё]* центр/iu, visitMinutes: 60 },
  bowling_alley: { query: 'боулинг', rubric: /боулинг/iu, visitMinutes: 75 },
  escape_game: { query: 'квест комнаты', rubric: /квест/iu, visitMinutes: 75 },
  fitness_centre: { query: 'фитнес центры', rubric: /фитнес|тренаж[а-яё]* зал/iu, visitMinutes: 75 },
  sports_centre: { query: 'спортивные центры', rubric: /спорт[а-яё]* центр|спорткомплекс/iu, visitMinutes: 75 },
  water_park: { query: 'аквапарки', rubric: /аквапарк/iu, visitMinutes: 90 },
  zoo: { query: 'зоопарки', rubric: /зоопарк|зоосад/iu, visitMinutes: 75 },
}

const ENDPOINT = 'https://catalog.api.2gis.com/3.0/items'
const MAX_QUERIES = 2
const MAX_RESULTS_PER_QUERY = 10 // demo keys cannot request a larger page
const MAX_REQUESTS_PER_MINUTE_PER_ISOLATE = 12
const TIMEOUT_MS = 2_500
const MAX_RESPONSE_CHARS = 250_000

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function parseItem(value: unknown, category: SearchCategory, mapping: CategoryQuery): TwoGisPlace | null {
  const item = record(value)
  if (!item || item.type !== 'branch' || item.is_deleted === true) return null
  const flags = record(item.flags)
  if (flags?.temporary_closed) return null
  if (typeof item.id !== 'string' || !/^[1-9]\d{5,20}$/.test(item.id)) return null
  if (typeof item.name !== 'string') return null
  const name = item.name.trim().replace(/\s+/gu, ' ')
  if (!name || name.length > 120 || /[\x00-\x1F\x7F<>]/u.test(name)) return null
  const point = record(item.point)
  const lat = point?.lat
  const lon = point?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number' || !insideAstana({ lat, lon })) return null
  if (!Array.isArray(item.rubrics) || !item.rubrics.some((rubric) => {
    const name = record(rubric)?.name
    return typeof name === 'string' && mapping.rubric.test(name)
  })) return null

  const address = record(item.address)
  const component = Array.isArray(address?.components)
    ? address.components.map(record).find((part) => part?.type === 'street_number') : null
  const street = typeof component?.street === 'string' && component.street.length <= 120
    ? component.street.trim() : ''
  const number = typeof component?.number === 'string' && component.number.length <= 40
    ? component.number.trim() : ''
  const tags: Record<string, string> = {}
  if (street && number) {
    tags['addr:street'] = street
    tags['addr:housenumber'] = number
  }

  return {
    id: `2gis:${item.id}`,
    name,
    category,
    lat,
    lon,
    visitMinutes: mapping.visitMinutes,
    sourceUrl: `https://2gis.kz/astana/firm/${item.id}`,
    tags,
    provider: '2GIS',
  }
}

/** Parse only sourced, matching business branches inside the Astana polygon. */
export function parseTwoGisResponse(value: unknown, category: SearchCategory): TwoGisPlace[] | null {
  const mapping = CATEGORY_QUERIES[category]
  if (!mapping) return []
  const root = record(value)
  const meta = record(root?.meta)
  if (meta?.code === 404) return []
  if (meta?.code !== 200) return null
  const result = record(root?.result)
  if (!Array.isArray(result?.items)) return null
  const deduped = new Map<string, TwoGisPlace>()
  for (const item of result.items.slice(0, MAX_RESULTS_PER_QUERY)) {
    const place = parseItem(item, category, mapping)
    if (place) deduped.set(place.id, place)
  }
  return [...deduped.values()]
}

function coarseCenter(center?: Coordinate): Coordinate {
  const safeCenter = center && insideAstana(center) ? center : ASTANA_CENTER
  const rounded = {
    lat: Math.round(safeCenter.lat * 100) / 100,
    lon: Math.round(safeCenter.lon * 100) / 100,
  }
  return insideAstana(rounded) ? rounded : {
    lat: Math.round(ASTANA_CENTER.lat * 100) / 100,
    lon: Math.round(ASTANA_CENTER.lon * 100) / 100,
  }
}

function makeUrl(key: string, mapping: CategoryQuery, center: Coordinate): string {
  const url = new URL(ENDPOINT)
  url.searchParams.set('key', key)
  url.searchParams.set('q', mapping.query)
  url.searchParams.set('type', 'branch')
  url.searchParams.set('search_nearby', 'true')
  url.searchParams.set('point', `${center.lon},${center.lat}`)
  url.searchParams.set('radius', '35000')
  url.searchParams.set('location', `${center.lon},${center.lat}`)
  url.searchParams.set('locale', 'ru_KZ')
  url.searchParams.set('fields', 'items.point,items.address,items.rubrics,items.is_deleted,items.flags')
  url.searchParams.set('page_size', String(MAX_RESULTS_PER_QUERY))
  url.searchParams.set('page', '1')
  return url.toString()
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

/** A per-isolate guard supplements, but cannot replace, a global Worker rate limit. */
export function createTwoGisSearcher(fetcher: Fetcher = fetch, now: () => number = Date.now) {
  let requestTimes: number[] = []
  return async (apiKey: string | undefined, options: TwoGisSearchOptions): Promise<TwoGisSearchResult> => {
    if (!apiKey?.trim()) return { places: [], status: 'disabled' }
    const center = coarseCenter(options.center)
    const categories = [...new Set(options.categories)]
      .filter((category) => CATEGORY_QUERIES[category] !== undefined)
      .slice(0, MAX_QUERIES)
    if (categories.length === 0) return { places: [], status: 'ok' }

    requestTimes = requestTimes.filter((at) => now() - at < 60_000)
    if (requestTimes.length + categories.length > MAX_REQUESTS_PER_MINUTE_PER_ISOLATE) {
      return { places: [], status: 'limited' }
    }
    requestTimes.push(...categories.map(() => now()))

    const outcomes = await Promise.all(categories.map(async (category) => {
      const mapping = CATEGORY_QUERIES[category]!
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const response = await fetcher(makeUrl(apiKey, mapping, center), {
          signal: controller.signal,
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (response.status === 402 || response.status === 403 || response.status === 429) {
          return { places: [], status: 'limited' as const }
        }
        if (!response.ok) return { places: [], status: 'unavailable' as const }
        const body = await response.text()
        if (body.length > MAX_RESPONSE_CHARS) return { places: [], status: 'unavailable' as const }
        const parsed: unknown = JSON.parse(body)
        const metaCode = record(record(parsed)?.meta)?.code
        if (metaCode === 402 || metaCode === 403 || metaCode === 429) {
          return { places: [], status: 'limited' as const }
        }
        const places = parseTwoGisResponse(parsed, category)
        return places === null
          ? { places: [], status: 'unavailable' as const }
          : { places, status: 'ok' as const }
      } catch {
        return { places: [], status: 'unavailable' as const }
      } finally {
        clearTimeout(timeout)
      }
    }))

    const places = new Map<string, TwoGisPlace>()
    for (const outcome of outcomes) for (const place of outcome.places) places.set(place.id, place)
    const status = outcomes.some((outcome) => outcome.status === 'ok') ? 'ok'
      : outcomes.some((outcome) => outcome.status === 'limited') ? 'limited' : 'unavailable'
    return { places: [...places.values()], status }
  }
}

export const search2GisVenues = createTwoGisSearcher()
